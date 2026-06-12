/**
 * Appraise stage executor — SDK dispatch, stage-output collection, consolidation.
 *
 * Called by the run state machine when sort routes to an appraise stage.
 */

import { getArtefactFiles, computeArtefactVersion } from './lib/artefacts.js';
import { appendEntry, getIteration } from './lib/history.js';
import { openFeedbackStore } from './lib/feedback-store.js';
import { writeActiveStage, clearActiveStage, writeLastStage } from './lib/state.js';
import { parseConsolidated } from './appraise-module.js';
import { resolveGroupConfig } from './lib/group-config.js';
import { buildDispatch } from './lib/evaluation-units.js';

import { parseModelId } from './lib/parse-model-id.js';
import { getCycleDefinition, getLaws, getAppraisers, getFlow, getArtefactType } from './lib/config.js';

import { writePromptFile as _writePromptFile, spawnDispatch as _spawnDispatch, awaitProcess as _awaitProcess, withCleanup as _withCleanup } from './lib/dispatch-cli.js';
import { dispatchAppraisePrompt, batchAppraiseDispatch, checkAppraiseDispatchFailure } from './lib/appraise-dispatch.js';
import { tryAppraiseAddress, buildAddressDispatchFn } from './appraise-address.js';
import { buildCompletionCoverage, writeCoverageFile } from './lib/appraise-coverage.js';
import { appendAppraiseAttestation } from './lib/attestation/executor-attestation.js';

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

export { recordToUnitId, buildCompletionCoverage, writeCoverageFile } from './lib/appraise-coverage.js';

export { dispatchAppraisePrompt, batchAppraiseDispatch };

// Catch-only helpers to reduce cyclomatic complexity in executeAppraise
function catchEmptyArray() { return []; }
function catchEmptyFlow() { return { frontmatter: {} }; }

// Extract injectable dispatch helpers from apprOpts with defaults
function extractDispatchHelpers(apprOpts) {
  return {
    writePromptFile: apprOpts.writePromptFile || _writePromptFile,
    spawnDispatch: apprOpts.spawnDispatch || _spawnDispatch,
    awaitProcess: apprOpts.awaitProcess || _awaitProcess,
    withCleanup: apprOpts.withCleanup || _withCleanup,
  };
}

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

function emptyAppraiseResult(opts) {
  const { io, cycleId, baseSha, historyPath, reason, feedbackPath } = opts;
  appendAppraiseAttestation(io, cycleId, { iteration: 1, coverage: new Map(), feedbackPath, appraiser_verdicts: [] });
  clearActiveStage(io);
  writeLastStage(io, { cycle: cycleId, stage: 'appraise:' + cycleId, baseSha: baseSha, summary: reason });
  appendEntry(historyPath, { cycle: cycleId, stage: 'appraise:' + cycleId, iteration: 1, comment: 'appraise: ' + reason }, io);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Phase 08 helpers — law-group fan-out
// ---------------------------------------------------------------------------

/**
 * Partition an array of law objects by their group field.
 * Laws without a group are placed under the key "default".
 * @param {{id:string,text:string,group?:string}[]} laws
 * @returns {Map<string,{id:string,text:string,group:string}[]>}
 */
function partitionLawsByGroup(laws) {
  const groups = new Map();
  for (const law of laws) {
    const key = law.group || 'default';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(law);
  }
  return groups;
}

/**
 * Resolve effective config for every distinct law group.
 * Calls resolveGroupConfig for each group and collects warnings.
 * @param {string[]} groupNames
 * @param {object|null} flowGroups
 * @param {object|null} typeAppraisers
 * @param {{id:string}[]} fullAppraiserPool
 * @param {string} [artefactTypeId]
 * @returns {{configs:Map, warnings:string[]}}
 */
function resolveGroupConfigs(groupNames, flowGroups, typeAppraisers, fullAppraiserPool, artefactTypeId) {
  const configs = new Map();
  const warnings = [];
  for (const name of groupNames) {
    const resolved = resolveGroupConfig(name, flowGroups, typeAppraisers, fullAppraiserPool, artefactTypeId);
    warnings.push(...resolved.warnings);
    configs.set(name, { mode: resolved.mode, passes: resolved.passes, appraisers: resolved.appraisers });
  }
  return { configs, warnings };
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

// recordToUnitId, buildCompletionCoverage, and writeCoverageFile
// are imported from ./lib/appraise-coverage.js

/**
 * Extract flow-level groups and artefact-type appraiser config.
 * Flow groups come from the flow definition; appraisers come from the
 * artefact-type definition file.
 */
async function extractGroupsAndAppraisers(flowDef, cfm, outputType, io, foundryDir) {
  let typeAppraisers = null;
  try {
    const artefactType = await getArtefactType(foundryDir, outputType, io);
    typeAppraisers = artefactType.frontmatter?.appraisers || null;
  } catch (err) {
    console.warn('appraise:', err.message);
  }
  return {
    flowGroups: flowDef.frontmatter['law-groups'] || {},
    typeAppraisers,
  };
}

/**
 * Post-process appraise results: consolidate, post feedback, build coverage,
 * persist coverage, close stage, record history.
 */
async function postProcessAppraise(opts) {
  const {
    io, dispatchMatrix, settled, unitsByGroup, feedbackPath, cycleId,
    foundryDir, outputType, worktree, historyPath, baseSha,
  } = opts;
  const filePaths = readAppraiseStageOutputs(io);
  const failures = parseConsolidated(filePaths, io);
  const store = openFeedbackStore(feedbackPath, io);
  const stage = 'appraise:' + cycleId;
  const av = await computeArtefactVersion(foundryDir, outputType, io, worktree)
    .catch(function() { return undefined; });
  postConsolidatedFeedback(store, failures, av, stage, cycleId);
  resolveAppraiseStaleFeedback(store, cycleId);
  const coverage = buildCompletionCoverage(dispatchMatrix, settled, filePaths, io, unitsByGroup);
  writeCoverageFile(io, coverage, cycleId);
  const summary = failures.length === 0 ? 'No issues found' : 'actioned:' + failures.length;
  writeLastStage(io, { cycle: cycleId, stage, baseSha, summary });
  clearActiveStage(io);
  recordAppraiseHistory({
    historyPath, cycleId, summary,
    rejected: settled.filter(function(r) { return r.status === 'rejected'; }), io,
  });
  return coverage;
}

/**
 * Execute an appraise stage.
 *
 * Lifecycle: stage_begin, collect and partition laws, resolve group configs,
 * build dispatch matrix, parallel dispatch via scoped sessions, consolidate,
 * post feedback, build per-unit coverage, persist coverage for attestation,
 * close stage, record history.
 */
async function prepareAppraiseContext(apprOpts) {
  const { io, historyPath, feedbackPath } = apprOpts;
  const setup = await setupAppraiseStage(apprOpts);
  if (setup.error) return { error: setup.error };
  const { baseSha, cycleId, outputType, cfm } = setup;
  const foundryDir = 'foundry';

  const laws = await getLaws(foundryDir, io, { typeId: outputType }).catch(catchEmptyArray);
  if (laws.length === 0) return emptyAppraiseResult({ io, cycleId, baseSha, historyPath, reason: 'no laws', feedbackPath });

  const lawGroups = partitionLawsByGroup(laws);
  const fullAppraiserPool = await getAppraisers(foundryDir, io).catch(catchEmptyArray);
  const flowDef = await getFlow(foundryDir, cfm['flow-id'], io).catch(catchEmptyFlow);

  const artefacts = await getArtefactFiles(foundryDir, outputType, io, { baseBranch: 'main' }).catch(catchEmptyArray);
  if (artefacts.length === 0) return emptyAppraiseResult({ io, cycleId, baseSha, historyPath, reason: 'no artefacts', feedbackPath });

  const { flowGroups, typeAppraisers } = await extractGroupsAndAppraisers(flowDef, cfm, outputType, io, foundryDir);
  const { configs, warnings } = resolveGroupConfigs(
    [...lawGroups.keys()], flowGroups, typeAppraisers, fullAppraiserPool, outputType
  );
  warnings.forEach(function(w) { console.warn('appraise:', w); });

  const { unitsByGroup, dispatchMatrix } = buildDispatch(lawGroups, configs);
  if (dispatchMatrix.length === 0) return emptyAppraiseResult({ io, cycleId, baseSha, historyPath, reason: 'no dispatch entries', feedbackPath });

  return { baseSha, cycleId, outputType, foundryDir, io, unitsByGroup, dispatchMatrix, lawGroups };
}

/**
 * Run the standard artefact-evaluation appraise pipeline.
 * Called when there are no addressed feedback items to process.
 */
async function executeStandardAppraise(apprOpts) {
  const { writePromptFile, spawnDispatch, awaitProcess, withCleanup } = extractDispatchHelpers(apprOpts);
  const { io, worktree, historyPath, feedbackPath } = apprOpts;

  const ctx = await prepareAppraiseContext(apprOpts);
  if (ctx.ok) return ctx;
  if (ctx.error) return { ok: false, error: ctx.error };
  const { baseSha, cycleId, outputType, foundryDir, unitsByGroup, dispatchMatrix } = ctx;

  const dispatchOpts = {
    io, worktree, lawGroups: ctx.lawGroups, outputType,
    writePromptFile, spawnDispatch, awaitProcess, withCleanup,
  };
  const settled = await batchAppraiseDispatch(dispatchMatrix, dispatchOpts);
  const dispatchError = checkAppraiseDispatchFailure(settled);
  if (dispatchError) {
    const iteration = getIteration(historyPath, cycleId, io) + 1;
    const appraiserVerdicts = dispatchMatrix
      .filter((_, i) => settled[i].status === 'rejected')
      .map(entry => ({ appraiser: entry.appraiser.id, verdict: 'rejected' }));
    appendAppraiseAttestation(io, cycleId, {
      iteration, coverage: new Map(), feedbackPath,
      appraiser_verdicts: appraiserVerdicts,
    });
    return dispatchError;
  }

  const coverage = await postProcessAppraise({
    io, dispatchMatrix, settled, unitsByGroup, feedbackPath, cycleId,
    foundryDir, outputType, worktree, historyPath, baseSha,
  });

  const iteration = getIteration(historyPath, cycleId, io) + 1;
  const appraiserVerdicts = dispatchMatrix.map((entry, i) => ({
    appraiser: entry.appraiser.id,
    verdict: settled[i].status === 'fulfilled' ? 'resolved' : 'rejected',
  }));
  appendAppraiseAttestation(io, cycleId, { iteration, coverage, feedbackPath, appraiser_verdicts: appraiserVerdicts });
  return { ok: true, coverage };
}

export async function executeAppraise(apprOpts) {
  const { io, feedbackPath, historyPath } = apprOpts;

  const sort = apprOpts.sort;
  const earlyCycleId = await cycleIdFrom(apprOpts.cycleId, sort);
  if (!earlyCycleId) {
    appendAppraiseAttestation(io, null, { iteration: 1, coverage: new Map(), feedbackPath, appraiser_verdicts: [] });
    return { ok: false, error: 'executeAppraise: no cycleId in sort result' };
  }

  const appraisers = await getAppraisers('foundry', io).catch(function() { return []; });
  const dispatchHelpers = extractDispatchHelpers(apprOpts);
  const addressDispatchFn = buildAddressDispatchFn(appraisers, dispatchHelpers, io, apprOpts.worktree);

  const addressResult = await tryAppraiseAddress(apprOpts, io, feedbackPath, earlyCycleId, addressDispatchFn);
  if (addressResult !== null) {
    const emptyCoverage = new Map();
    const iteration = getIteration(historyPath, earlyCycleId, io) + 1;
    appendAppraiseAttestation(io, earlyCycleId, {
      iteration, coverage: emptyCoverage, feedbackPath,
      appraiser_verdicts: [],
    });
    return addressResult;
  }

  return await executeStandardAppraise(apprOpts);
}
