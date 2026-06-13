/**
 * Executor attestation helpers shared across stage executors.
 *
 * Each helper reads the run ID from WORK.md, builds the attestation
 * parameters, and calls appendStageAttestation.  Diagnostic only —
 * failures are caught and logged; the executor return value is never
 * affected.
 */
 
// Five appender functions serve six stage-execution paths because
// human-appraise has two entry points (handleAlwaysHumanAppraise
// and handleDeadlockOverride), both of which call
// appendHumanAppraiseAttestation.
 
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

export async function appendForgeAttestation(io, cycleId, forgeOpts) {
  const { result, arV, outputType, forgeItem, wont_fix } = forgeOpts;
  const runId = readRunId(io);
  if (!runId) return;
  const extra = buildForgeAttestationParams(result, arV, outputType, forgeItem);
  const res = await appendStageAttestation(io, runId, {
    stage: 'forge',
    cycle: cycleId || runId,
    iteration: 1,
    timestamp: new Date().toISOString(),
    evaluations: [],
    violations: extra.violations,
    changed_files: getChangedFiles(result),
    artefact_hashes: extra.artefact_hashes,
    feedback_opened: [],
    feedback_resolved: extra.feedback_resolved,
    wont_fix,
  });
  if (!res.ok) console.warn('forge: attestation append failed', res.error);
}

// ---------------------------------------------------------------------------
// Quench attestation
// ---------------------------------------------------------------------------

function buildQuenchAttestationParams(runId, cycleId, opts, violationsOverride) {
  const { aVersion, outputType, store, feedbackList, artefact_hashes } = opts;
  const violations = violationsOverride ?? (feedbackList ? feedbackList.length : 0);
  const violation_details = feedbackList || [];
  const quenchItems = getQuenchItems(store);
  const hashes = getArtefactHashes(artefact_hashes, aVersion, outputType);
  return {
    stage: 'quench',
    cycle: cycleId || runId,
    iteration: 1,
    timestamp: new Date().toISOString(),
    evaluations: [],
    violations,
    violation_details,
    changed_files: [],
    artefact_hashes: hashes,
    feedback_opened: quenchItems.map(i => i.id),
    feedback_resolved: [],
  };
}

export async function appendQuenchAttestation(io, cycleId, opts, violationsOverride) {
  const runId = readRunId(io);
  if (!runId) return;
  const params = buildQuenchAttestationParams(runId, cycleId, opts, violationsOverride);
  const res = await appendStageAttestation(io, runId, params);
  if (!res.ok) console.warn('quench: attestation append failed', res.error);
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

function buildAssayItems(store) {
  if (!store) return [];
  return store.list().filter(i =>
    i.source && i.source.startsWith('system:assay-') && i.history.length === 1
  );
}

export async function appendAssayAttestation(io, cycleId, issues, store, violationsOverride) {
  const runId = readRunId(io);
  if (!runId) return;
  const assayItems = buildAssayItems(store);
  const res = await appendStageAttestation(io, runId, {
    stage: 'assay',
    cycle: cycleId || runId,
    iteration: 1,
    timestamp: new Date().toISOString(),
    evaluations: [],
    violations: violationsOverride ?? issues.length,
    changed_files: [],
    artefact_hashes: [],
    feedback_opened: assayItems.map(i => i.id),
    feedback_resolved: [],
  });
  if (!res.ok) console.warn('assay: attestation append failed', res.error);
}

// ---------------------------------------------------------------------------
// Appraise attestation
// ---------------------------------------------------------------------------

export async function appendAppraiseAttestation(io, cycleId, iteration, coverage, opts) {
  const { feedbackPath, violationsOverride } = opts;
  const runId = readRunId(io);
  if (!runId) return;
  const store = openFeedbackStore(feedbackPath, io);
  const totalViolations = violationsOverride ?? [...coverage.values()]
    .reduce((sum, entry) => sum + (entry.violations || 0), 0);
  const evaluations = [...coverage.values()].flatMap(entry => entry.evaluations || []);
  const appraiserVerdicts = [...coverage.values()].flatMap(entry =>
    (entry.evaluations || []).map(e => ({
      appraiser: e.appraiser,
      verdict: e.verdict === 'passed' ? 'resolved' : 'rejected',
    }))
  );
  const appraiseItems = store.list().filter(i =>
    i.source && i.source.split(':')[0] === 'appraise' && i.history.length === 1
  );
  const res = await appendStageAttestation(io, runId, {
    stage: 'appraise',
    cycle: cycleId || runId,
    iteration: iteration,
    timestamp: new Date().toISOString(),
    evaluations,
    appraiser_verdicts: appraiserVerdicts,
    violations: totalViolations,
    changed_files: [],
    artefact_hashes: [],
    feedback_opened: appraiseItems.map(i => i.id),
    feedback_resolved: [],
  });
  if (!res.ok) console.warn('appraise: attestation append failed', res.error);
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
    verdict: r.verdict === 'resolved' || r.verdict === 'approved' ? 'passed' : 'failed',
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

export async function appendHumanAppraiseAttestation(io, cycleId, opts) {
  const runId = readRunId(io);
  if (!runId) return;
  const params = buildHumanAppraiseAttestationParams(runId, cycleId, opts);
  const res = await appendStageAttestation(io, runId, params);
  if (!res.ok) console.warn('human-appraise: attestation append failed', res.error);
}
