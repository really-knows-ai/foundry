/**
 * Stage executor functions used by the run state machine.
 *
 * Exports: executeForge, executeQuench, executeAssay, executeAppraise
 * (executeAppraise is re-exported from run-appraise.js)
 */

import { getCycleDefinition } from './lib/config.js';
import { computeArtefactVersion } from './lib/artefacts.js';
import { appendEntry, getIteration } from './lib/history.js';
import { enforceForgeContract } from './lib/forge-contract.js';
import { openFeedbackStore } from './lib/feedback-store.js';
import { buildForgeHistoryEntry } from './lib/workfile.js';
import { forgeDispatch } from './lib/forge-dispatch.js';
import { appendForgeAttestation } from './lib/attestation/executor-attestation.js';

async function resolveModel(forgeModel, sortModel) {
  const model = (forgeModel || sortModel || '');
  if (!model) return undefined;
  if (model.indexOf('/') === -1) return { providerID: '', modelID: model };
  const mod = await import('./lib/parse-model-id.js');
  return mod.parseModelId(model);
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

  const changedFiles = stageOutputLines
    .map(l => l.file)
    .filter(Boolean)
    .filter((f, i, arr) => arr.indexOf(f) === i)
    .sort();

  appendEntry(historyPath, buildForgeHistoryEntry({
    cycle: cycleId, stage: route, iteration: 1,
    comment: 'forge completed for ' + cycleId,
    artefactVersion: postVersion,
    contractPassed: contractResult.contractPassed,
    changedFiles,
  }), io);

  if (!contractResult.contractPassed) return { ok: false, error: 'Forge contract failed' };
  return { ok: true, contractPassed: true, artefactVersion: postVersion, changedFiles, wont_fix: lastOutput.status === 'wont-fix' };
}


/** Empty forge opts for error-path attestation calls. */
function forgeOptsEmpty() {
  return { result: null, arV: null, outputType: null, forgeItem: null, wont_fix: false };
}

/**
 * Resolve forge cycle context: validate cycleId, read CFM.
 * Returns the resolved context or calls appendForgeAttestation and returns an error result.
 */
async function resolveForgeCycle(forgeOpts) {
  const { sort, io, historyPath } = forgeOpts;
  const cycleId = cycleIdFrom(forgeOpts.cycleId, sort);
  const iteration = getIteration(historyPath, cycleId, io) || 1;

  if (!cycleId) {
    appendForgeAttestation(io, cycleId, iteration, forgeOptsEmpty());
    return { error: 'executeForge: no cycleId in sort result' };
  }

  const cfm = await readCfm(cycleId, io).catch(function() { return null; });
  if (!cfm) {
    appendForgeAttestation(io, cycleId, iteration, forgeOptsEmpty());
    return { error: 'executeForge: cycle ' + cycleId + ' not found' };
  }

  return { cycleId, iteration, cfm };
}

/** Execute a forge stage. */
export async function executeForge(forgeOpts) {
  const { sort, io, worktree, historyPath, feedbackPath } = forgeOpts;
  const cwd2 = forgeOpts.cwd;

  const resolved = await resolveForgeCycle(forgeOpts);
  if (resolved.error) return { ok: false, error: resolved.error };
  const { cycleId, iteration, cfm } = resolved;

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
  if (dispatch.error) {
    appendForgeAttestation(io, cycleId, iteration, {
      result: { ok: false, error: dispatch.error },
      arV: null, outputType, forgeItem, wont_fix: false,
    });
    return { ok: false, error: dispatch.error };
  }

  const arV = await makeArtefactVersion(io, outputType, cwd2);

  const result = await finalizeForgeOutcome({
    cycleId, historyPath, io, stageOutputLines: dispatch.stageOutputLines, store, arV, route: sort.route, forgeItem,
  });

  appendForgeAttestation(io, cycleId, iteration, {
    result, arV, outputType, forgeItem, wont_fix: result.wont_fix,
  });
  return result;
}

// Re-export executeAppraise from its dedicated module.
export { executeAppraise } from './run-appraise.js';

// Re-export executeAssay from its dedicated module.
export { executeAssay } from './run-assay.js';

// Re-export executeQuench from its dedicated module.
export { executeQuench } from './run-quench.js';
