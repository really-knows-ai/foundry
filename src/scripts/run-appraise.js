/**
 * Appraise stage executor — SDK dispatch, stage-output collection, consolidation.
 *
 * Called by the run state machine when sort routes to an appraise stage.
 */

import { getArtefactFiles, computeArtefactVersion } from './lib/artefacts.js';
import { appendEntry } from './lib/history.js';
import { openFeedbackStore } from './lib/feedback-store.js';
import { writeActiveStage, clearActiveStage, writeLastStage } from './lib/state.js';
import { buildAppraiserPrompt, parseConsolidated } from './appraise-module.js';

import { parseModelId } from './lib/parse-model-id.js';
import { selectAppraisers, getCycleDefinition } from './lib/config.js';

function resolveBaseSha(io) {
  try {
    return io.exec(['git', 'rev-parse', 'HEAD']).toString().trim();
  } catch {
    return 'unknown';
  }
}

function resolveAppraiseModel(appraiser, cfm) {
  const modelStr = appraiser.model || (cfm.models && cfm.models.appraise) || null;
  if (!modelStr) return undefined;
  return parseModelId(modelStr);
}

function cleanStageOutputDir(io) {
  const outDir = '.foundry/stage-outputs/';
  if (io.exists(outDir)) {
    for (const f of io.readDir(outDir)) {
      io.unlink(outDir + f);
    }
  }
  io.mkdir(outDir);
}

async function readCfm(cycleId, io) {
  const def = await getCycleDefinition('foundry', cycleId, io);
  return def.frontmatter || {};
}

async function cycleIdFrom(cycleId, sort) {
  return sort.cycleId || cycleId || (sort.route ? sort.route.split(':')[1] : null);
}

export { resolveAppraiseModel, cleanStageOutputDir };

// ---------------------------------------------------------------------------
// Stage lifecycle
// ---------------------------------------------------------------------------

async function setupAppraiseStage(apprOpts) {
  const { io } = apprOpts;
  const sort = apprOpts.sort;
  const cycleId = await cycleIdFrom(apprOpts.cycleId, sort);
  if (!cycleId) return { error: 'executeAppraise: no cycleId in sort result' };

  const cfm = await readCfm(cycleId, io).catch(function() { return null; });
  if (!cfm) return { error: 'executeAppraise: cycle ' + cycleId + ' not found' };

  const outputType = cfm['output-type'];
  if (!outputType) return { error: 'executeAppraise: cycle ' + cycleId + ' has no output-type' };

  const tokenHash = 'plugin-' + Date.now() + '-' + String(Date.now() % 0x1000000).padStart(6, '0');
  const baseSha = resolveBaseSha(io);
  writeActiveStage(io, {
    cycle: cycleId, stage: 'appraise:' + cycleId,
    baseSha: baseSha, tokenHash: tokenHash,
    startedAt: new Date().toISOString(),
  });

  cleanStageOutputDir(io);
  return { tokenHash, baseSha, cycleId, outputType, cfm };
}

function emptyAppraiseResult(io, cycleId, baseSha, historyPath, reason) {
  clearActiveStage(io);
  writeLastStage(io, { cycle: cycleId, stage: 'appraise:' + cycleId, baseSha: baseSha, summary: reason });
  appendEntry(historyPath, { cycle: cycleId, stage: 'appraise:' + cycleId, iteration: 1, comment: 'appraise: ' + reason }, io);
  return { ok: true };
}

async function dispatchSingleAppraiser(appraiser, opts) {
  const { client, childSessions, context, worktree, outputType, cfm } = opts;
  const session = await client.session.create({
    body: { parentID: context.sessionID, title: 'Appraise: ' + (appraiser.name || appraiser.id) },
    query: { directory: worktree },
  });
  childSessions.set(session.id, 'appraise');

  const resolvedModel = resolveAppraiseModel(appraiser, cfm);
  const promptBody = { system: buildAppraiserPrompt({ appraiser, typeId: outputType }), parts: [] };
  if (resolvedModel) promptBody.model = resolvedModel;

  await client.session.prompt({
    path: { id: session.id },
    query: { directory: worktree },
    body: promptBody,
  });

  return session;
}

function readAppraiseStageOutputs(io) {
  const outDir = '.foundry/stage-outputs/';
  if (!io.exists(outDir)) return [];
  return io.readDir(outDir)
    .filter(function(f) { return f.endsWith('.jsonl'); })
    .map(function(f) { return outDir + f; });
}

function postConsolidatedFeedback(store, consolidated, av, stage, cycleId) {
  for (const issue of consolidated) {
    store.add({
      file: issue.file, tag: 'law:' + issue.law, text: issue.issue,
      source: stage, cycle: cycleId, artefact_version: av,
    });
  }
}

function isAppraiseItem(prior) {
  if (typeof prior.source !== 'string') return false;
  return prior.source.split(':')[0] === 'appraise';
}

function isNotResolvedFeedback(prior) {
  return !(prior.history && prior.history[0] && prior.history[0].state === 'resolved');
}

function resolveAppraiseStaleFeedback(store, cycleId) {
  for (const item of store.list()) {
    if (!isAppraiseItem(item)) continue;
    if (!isNotResolvedFeedback(item)) continue;
    store.autoResolve({ id: item.id, reason: 'superseded by re-appraisal', cycle: cycleId });
  }
}

function cleanupStageOutputFiles(filePaths, io) {
  for (const fp of filePaths) {
    try { io.unlink(fp); } catch (err) { if (err.code !== 'ENOENT') console.warn('appraise: failed to delete output file', fp, err.message); }
  }
}

function recordAppraiseHistory(opts) {
  const { historyPath, cycleId, summary, rejected, io } = opts;
  const stage = 'appraise:' + cycleId;
  appendEntry(historyPath, { cycle: cycleId, stage, iteration: 1, comment: summary || 'appraise: completed' }, io);
  if (rejected.length > 0) {
    appendEntry(historyPath, {
      cycle: cycleId, stage, iteration: 1,
      comment: 'appraise: ' + rejected.length + ' appraiser(s) failed',
    }, io);
  }
}

/**
 * Execute an appraise stage.
 *
 * Lifecycle: stage_begin (set up active stage, clean output dir), parallel
 * dispatch of appraisers via child sessions, read stage-output files,
 * post consolidated feedback with artefact version, resolve prior appraise
 * feedback, clean up output files, close stage, record history.
 */
export async function executeAppraise(apprOpts) {
  const { client, childSessions, context, io, worktree, historyPath, feedbackPath } = apprOpts;

  const setup = await setupAppraiseStage(apprOpts);
  if (setup.error) return { ok: false, error: setup.error };

  const { baseSha, cycleId, outputType, cfm } = setup;
  const foundryDir = 'foundry';

  const appraisers = await selectAppraisers(foundryDir, outputType, { io }).catch(function() { return []; });
  if (appraisers.length === 0) {
    return emptyAppraiseResult(io, cycleId, baseSha, historyPath, 'no appraisers');
  }

  const artefacts = await getArtefactFiles(foundryDir, outputType, io, { baseBranch: 'main' }).catch(function() { return []; });
  if (artefacts.length === 0) {
    return emptyAppraiseResult(io, cycleId, baseSha, historyPath, 'no artefacts');
  }

  const dispatchOpts = { client, childSessions, context, worktree, cycleId, outputType, cfm, io };
  const settled = await Promise.allSettled(
    appraisers.map(function(a) { return dispatchSingleAppraiser(a, dispatchOpts); })
  );

  const filePaths = readAppraiseStageOutputs(io);
  const consolidated = parseConsolidated(filePaths, io);

  const store = openFeedbackStore(feedbackPath, io);
  const stage = 'appraise:' + cycleId;
  const av = await computeArtefactVersion(foundryDir, outputType, io, worktree).catch(function() { return undefined; });
  postConsolidatedFeedback(store, consolidated, av, stage, cycleId);
  resolveAppraiseStaleFeedback(store, cycleId);
  // Stage-output files are cleaned by cleanStageOutputDir in setupAppraiseStage.
  // cleanupStageOutputFiles from appraise-module is not called here so that
  // per-session output files remain available for debugging after the run.

  const summary = consolidated.length === 0 ? 'No issues found' : 'actioned:' + consolidated.length;
  writeLastStage(io, { cycle: cycleId, stage, baseSha, summary });
  clearActiveStage(io);

  recordAppraiseHistory({
    historyPath, cycleId, summary,
    rejected: settled.filter(function(r) { return r.status === 'rejected'; }), io,
  });

  return { ok: true };
}
