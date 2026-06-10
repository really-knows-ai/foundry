/**
 * Stage executor functions used by the run state machine.
 *
 * Exports: executeForge, executeQuench, executeAssay, executeAppraise
 * (executeAppraise is re-exported from run-appraise.js)
 */

import { getCycleDefinition, getLawsForQuench } from './lib/config.js';
import { getArtefactFiles, computeArtefactVersion } from './lib/artefacts.js';
import { appendEntry } from './lib/history.js';
import { enforceForgeContract } from './lib/forge-contract.js';
import { openFeedbackStore } from './lib/feedback-store.js';
import { resolveStaleFeedback } from './quench-module.js';
import { spawnWithTimeout } from './lib/assay/spawn-with-timeout.js';
import { readActiveStage } from './lib/state.js';
import { buildForgeHistoryEntry } from './lib/workfile.js';
import { forgeDispatch } from './lib/forge-dispatch.js';
import { assayDispatch } from './lib/assay-dispatch.js';

const QUILL_TIMEOUT_MS = 60_000;
const MAX_QUILL_TIMEOUT_MS = 600_000;

async function resolveModel(forgeModel, sortModel) {
  const model = (forgeModel || sortModel || '');
  if (!model) return undefined;
  if (model.indexOf('/') === -1) return { providerID: '', modelID: model };
  const mod = await import('./lib/parse-model-id.js');
  return mod.parseModelId(model);
}

function tryParseJson(str) {
  try { return JSON.parse(str); } catch { return null; }
}

function cycleIdFrom(cycleId, sort) {
  return sort.cycleId || cycleId || (sort.route ? sort.route.split(':')[1] : null);
}

async function readCfm(cycleId, io) {
  const def = await getCycleDefinition('foundry', cycleId, io);
  return def.frontmatter || {};
}

async function makeArtefactVersion(io, outputType, cwd) {
  const result = await computeArtefactVersion('foundry', outputType, io, cwd).catch(function() { return undefined; });
  return result;
}

function resolveForgeModel(cfm) {
  return (cfm.models && cfm.models.forge) || '';
}

function extractForgeCfm(cfm) {
  return {
    outputType: cfm['output-type'] || '',
    forgeModel: resolveForgeModel(cfm),
    filePatterns: cfm['file-patterns'] || [],
  };
}

/**
 * Select the next feedback item for forge to address.
 *
 * Selection rules:
 * 1. List all items from the feedback store.
 * 2. Filter to items whose `history[0].state` is `open` or `rejected`
 *    (these are the states forge operates on).
 * 3. Sort by creation order (oldest `history[0].timestamp` first) so
 *    feedback is addressed FIFO. When timestamps are equal, sort by
 *    state so `open` precedes `rejected`, then by id for determinism.
 * 4. Return the first matching item, or `null` if none exists.
 *
 * @param {object} feedbackStore — opened feedback store with a `.list()` method
 * @returns {object|null} — the selected feedback item, or null
 */
export function selectForgeFeedback(feedbackStore) {
  const items = feedbackStore.list();
  const candidates = items.filter(it =>
    it.history[0].state === 'open' || it.history[0].state === 'rejected');
  if (candidates.length === 0) return null;
  candidates.sort(compareCandidates);
  return candidates[0];
}

/** Sort comparator: oldest timestamp first, then open before rejected, then by id. */
function compareCandidates(a, b) {
  const ts = a.history[0].timestamp.localeCompare(b.history[0].timestamp);
  if (ts !== 0) return ts;
  const st = a.history[0].state.localeCompare(b.history[0].state);
  if (st !== 0) return st;
  return a.id.localeCompare(b.id);
}

function extractPreVersion(forgeItem) {
  if (!forgeItem) return '';
  return forgeItem.artefact_version || '';
}

export function finalizeForgeOutcome(opts) {
  const { cycleId, historyPath, io, stageOutputLines, store, arV, route, forgeItem } = opts;
  const postVersion = arV || '';
  const lastOutput = stageOutputLines.length > 0
    ? stageOutputLines[stageOutputLines.length - 1]
    : { status: 'done' };
  const item = forgeItem || null;
  const preVersion = extractPreVersion(forgeItem);

  const contractResult = enforceForgeContract({
    item, preVersion, postVersion,
    output: lastOutput, feedbackStore: store, cycleId,
  });

  appendEntry(historyPath, buildForgeHistoryEntry({
    cycle: cycleId, stage: route, iteration: 1,
    comment: 'forge completed for ' + cycleId,
    artefactVersion: postVersion,
    contractPassed: contractResult.contractPassed,
    changedFiles: [],
  }), io);

  if (!contractResult.contractPassed) return { ok: false, error: 'Forge contract failed' };
  return { ok: true, contractPassed: true, artefactVersion: postVersion, changedFiles: [] };
}


/** Execute a forge stage. */
export async function executeForge(forgeOpts) {
  const { sort, io, worktree, historyPath, feedbackPath } = forgeOpts;
  const cwd2 = forgeOpts.cwd;

  const cycleId = cycleIdFrom(forgeOpts.cycleId, sort);
  if (!cycleId) return { ok: false, error: 'executeForge: no cycleId in sort result' };

  const cfm = await readCfm(cycleId, io).catch(function(err) { return null; });
  if (!cfm) return { ok: false, error: 'executeForge: cycle ' + cycleId + ' not found' };

  const { outputType, forgeModel, filePatterns } = extractForgeCfm(cfm);

  const store = openFeedbackStore(feedbackPath, io);
  const forgeItem = selectForgeFeedback(store);

  const promptContext = {
    stage: sort.route, cycle: cycleId, token: sort.token || '',
    cwd: cwd2, filePatterns, outputType, forgeItem,
  };

  const modelParam = await resolveModel(forgeModel);

  const dispatch = await forgeDispatch({
    sort, io, worktree, cycleId, dispatchPrompt: promptContext, modelParam,
  });
  if (dispatch.error) return { ok: false, error: dispatch.error };

  const arV = await makeArtefactVersion(io, outputType, cwd2);

  return finalizeForgeOutcome({
    cycleId, historyPath, io, stageOutputLines: dispatch.stageOutputLines, store, arV, route: sort.route, forgeItem,
  });
}

function buildValidatorCommand(validator, artefact) {
  const path = typeof artefact === 'string' ? artefact : (artefact.file || '');
  return validator.command + ' ' + path;
}

function computeValidatorTimeout(validator) {
  return Math.min((validator.timeout || QUILL_TIMEOUT_MS), MAX_QUILL_TIMEOUT_MS);
}

const isValidatorFailure = r => !r.ok || r.timedOut || r.tooMuchOutput;

function failText(validator, result, timeoutMs) {
  if (result.timedOut) return 'validator ' + validator.id + ' timed out after ' + timeoutMs + 'ms';
  if (result.tooMuchOutput) return 'validator ' + validator.id + ' exceeded output limit';
  return 'validator ' + validator.id + ' failed (exit code: ' + result.exitCode + ')';
}

function handleValidatorFailure(result, validator, timeoutMs, opts) {
  const text = failText(validator, result, timeoutMs);
  pushQuenchFeedback({ ...opts, validator, text, cId: opts.cycleId });
  opts.feedbackList.push(text);
}

function processParsedLine(parsed, opts) {
  if (!parsed) return;
  const text = parsed.text || parsed.message || 'violation';
  pushQuenchFeedback({ ...opts, text, cId: opts.cycleId });
  opts.feedbackList.push(text);
}

function processValidatorOutputs(result, opts) {
  if (!result.stdout || !result.stdout.trim()) return;
  const lines = result.stdout.trim().split('\n').filter(Boolean);
  for (let li = 0; li < lines.length; li++) {
    processParsedLine(tryParseJson(lines[li]), opts);
  }
}

// Quench helpers

function pushQuenchFeedback(opts) {
  const { store, validator, artefact, text, aVersion, cId } = opts;
  store.add({
    file: typeof artefact === 'string' ? artefact : (artefact.file || ''),
    tag: 'validator:' + validator.id,
    text: text,
    source: 'quench:' + cId,
    artefact_version: aVersion || '',
    cycle: cId,
  });
}

async function run1Validator(validator, artefact, vOpts) {
  const { store, cycleId, aVersion, cwd, worktree, feedbackList } = vOpts;
  const command = buildValidatorCommand(validator, artefact);
  const timeoutMs = computeValidatorTimeout(validator);
  const result = await spawnWithTimeout({ command, cwd: worktree || cwd, timeoutMs, env: process.env })
    .catch(function() {
      return { ok: false, timedOut: false, stdout: '', stderr: 'internal error', tooMuchOutput: false };
    });

  if (isValidatorFailure(result)) {
    handleValidatorFailure(result, validator, timeoutMs, {
      store, artefact, aVersion, cycleId, feedbackList,
    });
    return;
  }

  processValidatorOutputs(result, { store, validator, artefact, aVersion, cycleId, feedbackList });
}

async function discoverQuenchArtefacts(io, outputType) {
  return getArtefactFiles('foundry', outputType, io, { baseBranch: 'main' }).catch(function(err) {
    return null;
  });
}

async function resolveQuenchCycle(cycleId, io) {
  const cfm = await readCfm(cycleId, io).catch(function() { return null; });
  if (!cfm) return { error: { ok: false, error: 'executeQuench: cycle ' + cycleId + ' not found' } };
  const outputType = cfm['output-type'];
  if (!outputType) return { error: { ok: false, error: 'executeQuench: cycle ' + cycleId + ' has no output-type' } };
  return { cfm, outputType };
}

async function resolveQuenchFeedbackStore(io, outputType, cwd2, feedbackPath, cycleId) {
  const store = openFeedbackStore(feedbackPath, io);
  const aVersion = await makeArtefactVersion(io, outputType, cwd2);
  if (aVersion) {
    resolveStaleFeedback(store.list(), aVersion, 'quench', store, cycleId).catch(() => undefined);
  }
  return { store, aVersion };
}

async function resolveQuenchValidators(io, outputType) {
  const laws = await getLawsForQuench('foundry', io, { typeId: outputType }).catch(function() { return []; });
  return laws.flatMap(l => l.validators || []);
}

async function resolveQuenchArtefacts(io, outputType) {
  return (await discoverQuenchArtefacts(io, outputType)) || [];
}

async function runValidatorsForArtefacts(validators, artefacts, vOpts) {
  for (let vi = 0; vi < validators.length; vi++) {
    for (let ai = 0; ai < artefacts.length; ai++) {
      await run1Validator(validators[vi], artefacts[ai], vOpts);
    }
  }
}

function buildQuenchSummary(feedbackList, cycleId, stage, historyPath, io) {
  const summary = feedbackList.length > 0 ? 'quench: ' + feedbackList.length + ' violation(s)' : 'quench: passed';
  appendEntry(historyPath, { cycle: cycleId, stage, iteration: 1, comment: summary }, io);
  return { ok: true, summary };
}

// ---------------------------------------------------------------------------
// executeQuench
// ---------------------------------------------------------------------------

/** Execute a quench stage. */
export async function executeQuench(quenchOpts) {
  const { sort, io, worktree, historyPath, feedbackPath } = quenchOpts;
  const cwd2 = quenchOpts.cwd;

  const cycleId = cycleIdFrom(quenchOpts.cycleId, sort);
  if (!cycleId) return { ok: false, error: 'executeQuench: no cycleId in sort result' };

  readActiveStage(io);

  const cycleResolved = await resolveQuenchCycle(cycleId, io);
  if (cycleResolved.error) return cycleResolved.error;

  const fbResult = await resolveQuenchFeedbackStore(
    io, cycleResolved.outputType, cwd2, feedbackPath, cycleId,
  );
  const { store, aVersion } = fbResult;
  const artefacts = await resolveQuenchArtefacts(io, cycleResolved.outputType);
  if (artefacts.length === 0) {
    appendEntry(historyPath, { cycle: cycleId, stage: sort.route, iteration: 1, comment: 'quench: no artefacts' }, io);
    return { ok: true, summary: 'SKIP: no artefacts' };
  }

  const validators = await resolveQuenchValidators(io, cycleResolved.outputType);
  if (validators.length === 0) {
    appendEntry(historyPath, { cycle: cycleId, stage: sort.route, iteration: 1, comment: 'quench: no validators' }, io);
    return { ok: true, summary: 'SKIP: no validators' };
  }

  const feedbackList = [];
  const vOpts = { store, cycleId, aVersion, cwd: cwd2, worktree, feedbackList };
  await runValidatorsForArtefacts(validators, artefacts, vOpts);

  return buildQuenchSummary(feedbackList, cycleId, sort.route, historyPath, io);
}

// Assay helpers

async function loadExtractorByName(name, io) {
  const mod = await import('./lib/assay/loader.js');
  return mod.loadExtractor('foundry', name, io).catch(function() { return null; });
}

function runExtractorAndGetOutput(extractor, io, artefacts) {
  return extractor.run({ io, artefacts }).catch(function() { return null; });
}

const hasValidOutput = o => o && o.issues;

function processExtractorIssues(name, output, store, cycleId, issues) {
  for (const issue of output.issues) {
    store.add({
      file: issue.file || '', tag: 'extractor:' + name,
      text: issue.text || issue.message || 'extractor issue',
      source: 'system:assay-' + cycleId, artefact_version: '', cycle: cycleId,
    });
    issues.push(issue);
  }
}

async function runAllExtractors(extractors, eOpts) {
  for (const ex of extractors) await run1Extractor(ex, eOpts);
}

function getAssayExtractors(cfm) {
  return (cfm.assay && cfm.assay.extractors) || [];
}

function buildAssaySummary(issues, cycleId, stage, historyPath, io) {
  const summary = issues.length > 0 ? 'assay: ' + issues.length + ' issue(s)' : 'assay: completed';
  appendEntry(historyPath, { cycle: cycleId, stage, iteration: 1, comment: summary }, io);
  return { ok: true, summary };
}

// ---------------------------------------------------------------------------
// executeAssay
// ---------------------------------------------------------------------------

async function run1Extractor(name, eOpts) {
  const { io, artefacts, store, cycleId, issues } = eOpts;
  const extractor = await loadExtractorByName(name, io);
  if (!extractor || !extractor.run) return;

  const output = await runExtractorAndGetOutput(extractor, io, artefacts);
  if (!hasValidOutput(output)) return;

  processExtractorIssues(name, output, store, cycleId, issues);
}

function processAssayStageOutput(stageOutputLines, store, cycleId) {
  const issues = [];
  for (const line of stageOutputLines) {
    if (line.extractor && line.issues) {
      processExtractorIssues(line.extractor, line, store, cycleId, issues);
    }
  }
  return issues;
}

/** Execute an assay stage. */
export async function executeAssay(assayOpts) {
  const { sort, io, worktree, historyPath, feedbackPath } = assayOpts;
  const cwd2 = assayOpts.cwd;

  const cycleId = cycleIdFrom(assayOpts.cycleId, sort);
  if (!cycleId) return { ok: false, error: 'executeAssay: no cycleId in sort result' };

  const cfm = await readCfm(cycleId, io).catch(function() { return null; });
  if (!cfm) return { ok: false, error: 'executeAssay: cycle ' + cycleId + ' not found' };

  const extractors = getAssayExtractors(cfm);

  const promptContext = {
    stage: sort.route, cycle: cycleId, token: sort.token || '',
    cwd: cwd2, extractors,
  };

  const dispatch = await assayDispatch({
    sort, io, worktree, cycleId, dispatchPrompt: promptContext,
  });
  if (dispatch.error) return { ok: false, error: dispatch.error };

  const store = openFeedbackStore(feedbackPath, io);
  const issues = processAssayStageOutput(dispatch.stageOutputLines, store, cycleId);

  return buildAssaySummary(issues, cycleId, sort.route, historyPath, io);
}

// Re-export executeAppraise from its dedicated module.
export { executeAppraise } from './run-appraise.js';
