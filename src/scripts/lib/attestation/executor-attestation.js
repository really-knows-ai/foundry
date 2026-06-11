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

function buildForgeAttestationParams(result, arV, outputType, forgeItem) {
  const violations = result.ok ? 0 : 1;
  const artefactHashes = arV ? [{ path: outputType, hash: arV }] : [];
  const resolved = forgeItem ? [forgeItem.id] : [];
  return { violations, artefact_hashes: artefactHashes, feedback_resolved: resolved };
}

export function appendForgeAttestation(io, cycleId, forgeOpts) {
  const { result, arV, outputType, forgeItem } = forgeOpts;
  try {
    const runId = readRunId(io);
    if (!runId) return;
    const extra = buildForgeAttestationParams(result, arV, outputType, forgeItem);
    appendStageAttestation(io, runId, {
      stage: 'forge',
      cycle: cycleId,
      iteration: 1,
      timestamp: new Date().toISOString(),
      evaluations: [],
      violations: extra.violations,
      changed_files: result.changedFiles || [],
      artefact_hashes: extra.artefact_hashes,
      feedback_opened: [],
      feedback_resolved: extra.feedback_resolved,
    });
  } catch (_err) {
    console.warn('forge: attestation append failed', _err.message);
  }
}

// ---------------------------------------------------------------------------
// Quench attestation helpers
// ---------------------------------------------------------------------------

export function appendEarlyQuenchAttestation(io, cycleId, earlyOpts) {
  try {
    const runId = readRunId(io);
    if (!runId) return;
    appendStageAttestation(io, runId, {
      stage: 'quench',
      cycle: cycleId,
      iteration: 1,
      timestamp: new Date().toISOString(),
      evaluations: [],
      violations: 0,
      changed_files: [],
      artefact_hashes: earlyOpts.artefact_hashes || [],
      feedback_opened: [],
      feedback_resolved: [],
    });
  } catch (_err) {
    console.warn('quench: attestation append failed', _err.message);
  }
}

export function appendQuenchAttestation(io, cycleId, quenchOpts) {
  try {
    const runId = readRunId(io);
    if (!runId) return;
    const { aVersion, outputType, store, feedbackList } = quenchOpts;
    const quenchItems = store.list().filter(i =>
      i.source && i.source.startsWith('quench:') && i.history.length === 1
    );
    appendStageAttestation(io, runId, {
      stage: 'quench',
      cycle: cycleId,
      iteration: 1,
      timestamp: new Date().toISOString(),
      evaluations: [],
      violations: feedbackList.length,
      changed_files: [],
      artefact_hashes: aVersion ? [{ path: outputType, hash: aVersion }] : [],
      feedback_opened: quenchItems.map(i => i.id),
      feedback_resolved: [],
    });
  } catch (_err) {
    console.warn('quench: attestation append failed', _err.message);
  }
}

// ---------------------------------------------------------------------------
// Assay attestation
// ---------------------------------------------------------------------------

export function appendAssayAttestation(io, cycleId, issues, store) {
  try {
    const runId = readRunId(io);
    if (!runId) return;
    const assayItems = store.list().filter(i =>
      i.source && i.source.startsWith('system:assay-') && i.history.length === 1
    );
    appendStageAttestation(io, runId, {
      stage: 'assay',
      cycle: cycleId,
      iteration: 1,
      timestamp: new Date().toISOString(),
      evaluations: [],
      violations: issues.length,
      changed_files: [],
      artefact_hashes: [],
      feedback_opened: assayItems.map(i => i.id),
      feedback_resolved: [],
    });
  } catch (_err) {
    console.warn('assay: attestation append failed', _err.message);
  }
}

// ---------------------------------------------------------------------------
// Appraise attestation
// ---------------------------------------------------------------------------

export function appendAppraiseAttestation(io, cycleId, iteration, coverage, feedbackPath) {
  try {
    const runId = readRunId(io);
    if (!runId) return;
    const store = openFeedbackStore(feedbackPath, io);
    const totalViolations = [...coverage.values()]
      .reduce((sum, entry) => sum + (entry.violations || 0), 0);
    const evaluations = [...coverage.values()].flatMap(entry => entry.evaluations || []);
    const appraiseItems = store.list().filter(i =>
      i.source && i.source.split(':')[0] === 'appraise' && i.history.length === 1
    );
    appendStageAttestation(io, runId, {
      stage: 'appraise',
      cycle: cycleId,
      iteration: iteration,
      timestamp: new Date().toISOString(),
      evaluations,
      violations: totalViolations,
      changed_files: [],
      artefact_hashes: [],
      feedback_opened: appraiseItems.map(i => i.id),
      feedback_resolved: [],
    });
  } catch (_err) {
    console.warn('appraise: attestation append failed', _err.message);
  }
}

// ---------------------------------------------------------------------------
// Human-appraise attestation helpers
// ---------------------------------------------------------------------------

export function appendDeadlockResolveAttestation(io, cycleId, records, newItemIds) {
  try {
    const runId = readRunId(io);
    if (!runId) return;
    const resolvedIds = records
      .filter(r => r.verdict === 'resolved')
      .map(r => r.itemId);
    appendStageAttestation(io, runId, {
      stage: 'human-appraise',
      cycle: cycleId,
      iteration: 1,
      timestamp: new Date().toISOString(),
      evaluations: [],
      violations: 0,
      changed_files: [],
      artefact_hashes: [],
      feedback_opened: newItemIds,
      feedback_resolved: resolvedIds,
      verdict: 'resolved',
    });
  } catch (_err) {
    console.warn('human-appraise: attestation append failed', _err.message);
  }
}

export function appendHumanAppraiseAttestation(io, cycleId, iteration, verdict, store) {
  try {
    const runId = readRunId(io);
    if (!runId) return;
    const openedIds = store.list()
      .filter(i => i.source === 'human-appraise:' + cycleId && i.history.length === 1)
      .map(i => i.id);
    appendStageAttestation(io, runId, {
      stage: 'human-appraise',
      cycle: cycleId,
      iteration: iteration,
      timestamp: new Date().toISOString(),
      evaluations: [],
      violations: 0,
      changed_files: [],
      artefact_hashes: [],
      feedback_opened: openedIds,
      feedback_resolved: [],
      verdict,
    });
  } catch (_err) {
    console.warn('human-appraise: attestation append failed', _err.message);
  }
}
