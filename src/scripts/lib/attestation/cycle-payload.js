/**
 * Cycle attestation composite builder.
 *
 * Schema version: foundry-cycle-attestation/v1
 *
 * Merges per-stage attestation records into a single cycle-level attestation.
 * The composite record derives an overall status, aggregates feedback and
 * artefact summaries, and records wall-clock duration across stages.
 *
 * @module cycle-payload
 */

/**
 * @typedef {'pass'|'fail'|'incomplete'|'mixed'|'rejected'} CycleAttestationStatus
 */

/**
 * @typedef {Object} CycleAttestation
 * @property {string} schema - Always "foundry-cycle-attestation/v1"
 * @property {string} cycle - Cycle identifier
 * @property {import('./stage-payload.js').StageAttestation[]}
 *   stage_attestations - Sorted stage records
 * @property {CycleAttestationStatus} composite_status
 *   - Derived overall status
 * @property {number|null} cycle_duration_ms
 *   - Wall-clock duration (null if single stage)
 * @property {{opened: number, resolved: number, rejected: number,
 *   open_remaining: number}} feedback_summary - Feedback totals
 * @property {{total_changed: number, unique_paths: number}}
 *   artefact_summary - Artefact change totals
 * @property {Object|null} governance
 *   - Governance workfile hashes (nullable)
 */

/** Schema version for cycle-level attestation payloads */
export const CYCLE_ATTESTATION_SCHEMA = 'foundry-cycle-attestation/v1';

/** Stage ordinal for deterministic sorting */
const STAGE_ORDINAL = {
  assay: 0,
  forge: 1,
  quench: 2,
  appraise: 3,
  'human-appraise': 4,
};

/**
 * Sort comparator: by (iteration asc, stage ordinal asc).
 *
 * @param {import('./stage-payload.js').StageAttestation} a
 * @param {import('./stage-payload.js').StageAttestation} b
 * @returns {number}
 */
function byIterationThenStage(a, b) {
  if (a.iteration !== b.iteration) return a.iteration - b.iteration;
  return (STAGE_ORDINAL[a.stage] ?? 99) - (STAGE_ORDINAL[b.stage] ?? 99);
}

/**
 * Build feedback summary from stage attestations.
 *
 * @param {import('./stage-payload.js').StageAttestation[]} stageAttestations
 * @returns {{opened: number, resolved: number,
 *   rejected: number, open_remaining: number}}
 */
function buildFeedbackSummary(stageAttestations) {
  let opened = 0;
  let resolved = 0;
  let rejected = 0;
  for (const sa of stageAttestations) {
    opened += sa.feedback_opened.length;
    resolved += sa.feedback_resolved.length;
    if (sa.status === 'rejected') {
      rejected += sa.feedback_resolved.length;
    }
  }
  return { opened, resolved, rejected, open_remaining: opened - resolved };
}

/**
 * Build artefact summary from stage attestations.
 *
 * @param {import('./stage-payload.js').StageAttestation[]} stageAttestations
 * @returns {{total_changed: number, unique_paths: number}}
 */
function buildArtefactSummary(stageAttestations) {
  const uniqueFiles = new Set();
  let totalChanged = 0;
  for (const sa of stageAttestations) {
    for (const f of sa.changed_files) {
      totalChanged++;
      uniqueFiles.add(f);
    }
  }
  return { total_changed: totalChanged, unique_paths: uniqueFiles.size };
}

/**
 * Compute wall-clock duration across stage attestations.
 *
 * Returns null when fewer than two attestations exist.
 *
 * @param {import('./stage-payload.js').StageAttestation[]} stageAttestations
 * @returns {number|null}
 */
function computeDurationMs(stageAttestations) {
  if (stageAttestations.length < 2) return null;
  let minTime = Infinity;
  let maxTime = -Infinity;
  for (const sa of stageAttestations) {
    const t = new Date(sa.timestamp).getTime();
    if (t < minTime) minTime = t;
    if (t > maxTime) maxTime = t;
  }
  return maxTime - minTime;
}

/**
 * Resolve status from a list of per-stage status values.
 *
 * Priority: fail > rejected > incomplete > pass/resolved > mixed
 *
 * @param {string[]} statuses
 * @returns {CycleAttestationStatus}
 */
function resolveCompositeStatus(statuses) {
  if (statuses.some(s => s === 'fail')) return 'fail';
  if (statuses.some(s => s === 'rejected')) return 'rejected';
  if (statuses.some(s => s === 'incomplete')) return 'incomplete';
  if (statuses.every(s => s === 'pass' || s === 'resolved')) return 'pass';
  return 'mixed';
}

/**
 * Derive composite cycle status from per-stage status values.
 *
 * An empty array produces 'incomplete'.
 *
 * @param {import('./stage-payload.js').StageAttestation[]} stageAttestations
 * @returns {CycleAttestationStatus}
 */
export function deriveCompositeStatus(stageAttestations) {
  if (stageAttestations.length === 0) return 'incomplete';
  return resolveCompositeStatus(stageAttestations.map(s => s.status));
}

/**
 * Build a cycle attestation payload.
 *
 * Validates inputs, sorts stage attestations, derives composite status and
 * summaries, and returns a frozen CycleAttestation. An empty
 * stage_attestations array produces an incomplete status.
 *
 * @param {Object} opts
 * @param {string} opts.cycle - Cycle identifier
 * @param {import('./stage-payload.js').StageAttestation[]}
 *   opts.stage_attestations - Per-stage attestation records
 * @param {Object} [opts.governance] - Governance workfile hashes
 * @returns {CycleAttestation}
 * @throws {TypeError}
 */
export function buildCycleAttestation({
  cycle,
  stage_attestations: stageAttestations,
  governance,
} = {}) {
  if (!cycle) {
    throw new TypeError('Missing required field: cycle');
  }
  if (!Array.isArray(stageAttestations)) {
    throw new TypeError('stage_attestations must be an array');
  }

  const sorted = [...stageAttestations].sort(byIterationThenStage);
  const compositeStatus = deriveCompositeStatus(sorted);
  const feedbackSummary = buildFeedbackSummary(sorted);
  const artefactSummary = buildArtefactSummary(sorted);
  const durationMs = computeDurationMs(sorted);

  return Object.freeze({
    schema: CYCLE_ATTESTATION_SCHEMA,
    cycle,
    stage_attestations: sorted,
    composite_status: compositeStatus,
    cycle_duration_ms: durationMs,
    feedback_summary: feedbackSummary,
    artefact_summary: artefactSummary,
    governance,
  });
}
