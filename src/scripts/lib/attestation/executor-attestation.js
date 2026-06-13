/**
 * Executor attestation helpers shared across stage executors.
 *
 * Each helper reads the run ID from WORK.md, builds the attestation
 * parameters, and calls appendStageAttestation.  Diagnostic only —
 * failures are caught and logged; the executor return value is never
 * affected.
 */

import { readRunId } from '../workfile.js';
import { appendStageAttestation } from './hash.js';
import { openFeedbackStore } from '../feedback-store.js';

// ---------------------------------------------------------------------------
// Forge attestation
// ---------------------------------------------------------------------------

function countForgeViolations(result) {
  if (!result) return 1;
  return result.ok ? 0 : 1;
}

function getChangedFiles(result) {
  if (!result) return [];
  return result.changedFiles || [];
}

function buildForgeAttestationParams(result, arV, outputType, forgeItem) {
  const violations = countForgeViolations(result);
  const artefactHashes = arV ? [{ path: outputType, hash: arV }] : [];
  const resolved = forgeItem ? [forgeItem.id] : [];
  return { violations, artefact_hashes: artefactHashes, feedback_resolved: resolved };
}

export function appendForgeAttestation(io, cycleId, forgeOpts) {
  const { result, arV, outputType, forgeItem, wont_fix, iteration = 1 } = forgeOpts;
  try {
    const runId = readRunId(io);
    if (!runId) return;
    const extra = buildForgeAttestationParams(result, arV, outputType, forgeItem);
    appendStageAttestation(io, runId, {
      stage: 'forge',
      cycle: cycleId || runId,
      iteration,
      timestamp: new Date().toISOString(),
      evaluations: [],
      violations: extra.violations,
      changed_files: getChangedFiles(result),
      artefact_hashes: extra.artefact_hashes,
      feedback_opened: [],
      feedback_resolved: extra.feedback_resolved,
      wont_fix,
    });
  } catch (_err) {
    console.warn('forge: attestation append failed', _err.message);
  }
}

// ---------------------------------------------------------------------------
// Quench attestation
// ---------------------------------------------------------------------------

function buildQuenchAttestationParams(runId, cycleId, opts) {
  const { aVersion, outputType, store, feedbackList, artefact_hashes, iteration = 1, violations: explicitViolations } = opts;
  const violations = explicitViolations ?? (feedbackList ? feedbackList.length : 0);
  const quenchItems = getQuenchItems(store);
  const hashes = getArtefactHashes(artefact_hashes, aVersion, outputType);
  return {
    stage: 'quench',
    cycle: cycleId || runId,
    iteration,
    timestamp: new Date().toISOString(),
    evaluations: [],
    violations,
    violations_list: feedbackList || [],
    changed_files: [],
    artefact_hashes: hashes,
    feedback_opened: quenchItems.map(i => i.id),
    feedback_resolved: [],
  };
}

export function appendQuenchAttestation(io, cycleId, opts) {
  try {
    const runId = readRunId(io);
    if (!runId) return;
    const params = buildQuenchAttestationParams(runId, cycleId, opts);
    appendStageAttestation(io, runId, params);
  } catch (_err) {
    console.warn('quench: attestation append failed', _err.message);
  }
}

function getQuenchItems(store) {
  return store
    ? store.list().filter(i =>
        i.source && i.source.startsWith('quench:') && i.history.length === 1
      )
    : [];
}

function getArtefactHashes(artefact_hashes, aVersion, outputType) {
  return artefact_hashes || (aVersion ? [{ path: outputType, hash: aVersion }] : []);
}

// ---------------------------------------------------------------------------
// Assay attestation
// ---------------------------------------------------------------------------

function getAssayItemIds(store, cycleId) {
  return store
    ? store.list()
        .filter(i => i.source && i.source.startsWith('system:assay-') && i.history.length === 1)
        .map(i => i.id)
    : [];
}

function buildAssayCycle(cycleId, runId) {
  return cycleId || runId;
}

export function appendAssayAttestation(io, cycleId, issues, store, iteration = 1, explicitViolations) {
  try {
    const runId = readRunId(io);
    if (!runId) return;
    const feedbackOpened = getAssayItemIds(store, cycleId);
    appendStageAttestation(io, runId, {
      stage: 'assay',
      cycle: buildAssayCycle(cycleId, runId),
      iteration,
      timestamp: new Date().toISOString(),
      evaluations: [],
      violations: explicitViolations ?? issues.length,
      changed_files: [],
      artefact_hashes: [],
      feedback_opened: feedbackOpened,
      feedback_resolved: [],
    });
  } catch (_err) {
    console.warn('assay: attestation append failed', _err.message);
  }
}

// ---------------------------------------------------------------------------
// Appraise attestation
// ---------------------------------------------------------------------------

export function appendAppraiseAttestation(io, cycleId, opts) {
  try {
    const runId = readRunId(io);
    if (!runId) return;
    const { iteration, coverage, feedbackPath, appraiser_verdicts, violations: explicitViolations } = opts;
    const store = openFeedbackStore(feedbackPath, io);
    const totalViolations = explicitViolations ?? [...coverage.values()]
      .reduce((sum, entry) => sum + (entry.violations || 0), 0);
    const evaluations = [...coverage.values()].flatMap(entry => entry.evaluations || []);
    const appraiseItems = store.list().filter(i =>
      i.source && i.source.split(':')[0] === 'appraise' && i.history.length === 1
    );
    appendStageAttestation(io, runId, {
      stage: 'appraise',
      cycle: cycleId || runId,
      iteration,
      timestamp: new Date().toISOString(),
      evaluations,
      violations: totalViolations,
      changed_files: [],
      artefact_hashes: [],
      feedback_opened: appraiseItems.map(i => i.id),
      feedback_resolved: [],
      appraiser_verdicts,
    });
  } catch (_err) {
    console.warn('appraise: attestation append failed', _err.message);
  }
}

function getResolvedRecordIds(records) {
  return records
    ? records.filter(r => r.verdict === 'resolved').map(r => r.itemId)
    : [];
}

function getHumanAppraiseOpenedIds(store, cycleId, newItemIds) {
  return store
    ? store.list()
        .filter(i => i.source === 'human-appraise:' + cycleId && i.history.length === 1)
        .map(i => i.id)
    : (newItemIds || []);
}

function buildHumanEvaluations(records) {
  if (!records || records.length === 0) return [];
  return records.map(r => ({
    appraiser: 'human',
    verdict: (r.verdict === 'resolved' || r.verdict === 'approved') ? 'passed' : 'failed',
    completed: true,
  }));
}

// ---------------------------------------------------------------------------
// Human-appraise attestation
// ---------------------------------------------------------------------------

function buildHumanAppraiseAttestationParams(runId, cycleId, opts) {
  const { verdict, records, newItemIds, store, iteration = 1 } = opts;
  const resolvedIds = getResolvedRecordIds(records);
  const openedIds = getHumanAppraiseOpenedIds(store, cycleId, newItemIds);
  return {
    stage: 'human-appraise',
    cycle: cycleId || runId,
    iteration,
    timestamp: new Date().toISOString(),
    evaluations: buildHumanEvaluations(records),
    violations: 0,
    changed_files: [],
    artefact_hashes: [],
    feedback_opened: openedIds,
    feedback_resolved: resolvedIds,
    verdict: verdict || 'resolved',
  };
}

export function appendHumanAppraiseAttestation(io, cycleId, opts) {
  try {
    const runId = readRunId(io);
    if (!runId) return;
    const params = buildHumanAppraiseAttestationParams(runId, cycleId, opts);
    appendStageAttestation(io, runId, params);
  } catch (_err) {
    console.warn('human-appraise: attestation append failed', _err.message);
  }
}
