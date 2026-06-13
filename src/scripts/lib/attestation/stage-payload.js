/**
 * Stage attestation payload builder.
 *
 * Schema version: foundry-stage-attestation/v1
 *
 * Each stage (assay, forge, quench, appraise, human-appraise) produces its
 * own attestation record when it completes. The cycle-level attestation
 * (foundry-cycle-attestation/v1) merges all stage attestations into a
 * composite record.
 *
 * Migration note: the current cycle-level schema foundry-attestation/v2
 * (produced by buildAttestationPayload in payload.js) will eventually be
 * replaced by the composite buildCycleAttestation from cycle-payload.js.
 * Stage attestations are the new atomic unit; the cycle-level attestation
 * becomes an aggregation of stage records rather than a single snapshot.
 *
 * @module stage-payload
 */

/**
 * @typedef {'assay'|'forge'|'quench'|'appraise'|'human-appraise'} StageName
 */

/**
 * @typedef {'pass'|'fail'|'incomplete'|'actioned'|'wont-fix'|'resolved'|'rejected'} StageAttestationStatus
 */

/**
 * @typedef {Object} EvalEntry
 * @property {string} appraiser - Appraiser identifier
 * @property {'passed'|'failed'} verdict - Evaluation verdict
 * @property {boolean} completed - Whether the evaluation is complete
 */

/**
 * @typedef {Object} StageAttestation
 * @property {string} schema - Always "foundry-stage-attestation/v1"
 * @property {StageName} stage - The stage that produced this attestation
 * @property {string} cycle - Cycle identifier
 * @property {number} iteration - 1-based iteration number
 * @property {string} timestamp - ISO 8601 timestamp of stage completion
 * @property {StageAttestationStatus} status - Derived stage status
 * @property {string[]} changed_files - Sorted array of file paths changed
 * @property {EvalEntry[]} evaluations - Completion records
 * @property {number} violations - Violation count
 * @property {string[]} feedback_opened - Feedback IDs opened during this stage
 * @property {string[]} feedback_resolved - Feedback IDs resolved during this stage
 * @property {Array<{path: string, hash: string}>} artefact_hashes - Artefact hash records
 */

/** Schema version for per-stage attestation payloads */
export const STAGE_ATTESTATION_SCHEMA = 'foundry-stage-attestation/v1';

const VALID_STAGES = new Set(['assay', 'forge', 'quench', 'appraise', 'human-appraise']);

/**
 * Default a potentially undefined value.
 *
 * @template T
 * @param {T|null|undefined} value
 * @param {T} fallback
 * @returns {T}
 */
function defaultTo(value, fallback) {
  return value !== undefined && value !== null ? value : fallback;
}

/**
 * Sort an array of strings lexicographically (mutates in place).
 *
 * @param {string[]} arr
 * @returns {string[]}
 */
function sortStrings(arr) {
  return arr.sort((a, b) => {
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  });
}

/**
 * Assert that a required field is present.
 *
 * @param {unknown} value
 * @param {string} name
 * @returns {void}
 * @throws {TypeError}
 */
function requireField(value, name) {
  if (value === undefined || value === null || value === '') {
    throw new TypeError(`Missing required field: ${name}`);
  }
}

/*
 * Per-stage status derivation functions.
 *
 * Each accepts (evaluations, violations, flags) and returns a status string.
 */

function assayStatus(evaluations, violations, flags) {
  if (violations > 0) return 'fail';
  if (evaluations.length > 0 && evaluations.some(e => !e.completed)) return 'incomplete';
  return 'pass';
}

function forgeStatus(evaluations, violations, flags) {
  if (violations > 0) return 'fail';
  if (flags.changed_files && flags.changed_files.length > 0) return 'actioned';
  if (flags.wont_fix) return 'wont-fix';
  return 'pass';
}

function quenchStatus(evaluations, violations, flags) {
  if (violations > 0) return 'fail';
  if (evaluations.some(e => !e.completed)) return 'incomplete';
  return 'pass';
}

function appraiseStatus(evaluations, violations, flags) {
  const verdicts = flags.appraiser_verdicts;
  if (!verdicts || verdicts.length === 0) return 'incomplete';
  if (verdicts.some(v => v.verdict === 'rejected')) return 'fail';
  if (verdicts.length < evaluations.length) return 'incomplete';
  return 'pass';
}

function humanAppraiseStatus(evaluations, violations, flags) {
  if (flags.verdict === 'resolved') return 'resolved';
  if (flags.verdict === 'rejected') return 'rejected';
  return 'incomplete';
}

const STAGE_DERIVERS = {
  assay: assayStatus,
  forge: forgeStatus,
  quench: quenchStatus,
  appraise: appraiseStatus,
  'human-appraise': humanAppraiseStatus,
};

/**
 * Derive stage attestation status from stage type, evaluations, violations,
 * and stage-specific flags.
 *
 * @param {StageName} stageName - The stage type
 * @param {EvalEntry[]} [evaluations=[]] - Completion records
 * @param {number} [violations=0] - Violation count
 * @param {Object} [flags={}] - Stage-specific flags
 * @param {string[]} [flags.changed_files] - Files changed during the stage
 *   (forge)
 * @param {boolean} [flags.wont_fix] - Whether forge marked as wont-fix (forge)
 * @param {'resolved'|'rejected'} [flags.verdict] - Human verdict
 *   (human-appraise)
 * @param {Array<{appraiser: string, verdict: 'resolved'|'rejected'}>}
 *   [flags.appraiser_verdicts] - Appraiser verdicts (appraise)
 * @returns {StageAttestationStatus}
 */
export function deriveStageStatus(stageName, evaluations = [], violations = 0, flags = {}) {
  const deriv = STAGE_DERIVERS[stageName];
  if (!deriv) {
    throw new TypeError(`Invalid stage name: ${stageName}`);
  }
  return deriv(evaluations, violations, flags);
}

/**
 * Build a stage attestation payload.
 *
 * Accepts stage data, validates required fields, derives status, sorts
 * arrays, and returns a frozen StageAttestation.
 *
 * @param {Object} opts
 * @param {StageName} opts.stage - Stage name
 * @param {string} opts.cycle - Cycle identifier
 * @param {number} opts.iteration - 1-based iteration number
 * @param {string} opts.timestamp - ISO 8601 timestamp
 * @param {EvalEntry[]} [opts.evaluations] - Completion records
 * @param {number} [opts.violations] - Violation count
 * @param {string[]} [opts.changed_files] - Changed file paths
 * @param {string[]} [opts.feedback_opened] - Feedback IDs opened
 * @param {string[]} [opts.feedback_resolved] - Feedback IDs resolved
 * @param {Array<{path: string, hash: string}>} [opts.artefact_hashes]
 *   - Artefact hash records
 * @param {boolean} [opts.wont_fix] - Forge-specific wont-fix flag
 * @param {'resolved'|'rejected'} [opts.verdict] - Human-appraise verdict
 * @param {Array<{appraiser: string, verdict: 'resolved'|'rejected'}>}
 *   [opts.appraiser_verdicts] - Appraise verdicts
 * @returns {StageAttestation}
 */
export function buildStageAttestation({
  stage, cycle, iteration, timestamp,
  changed_files: changedFilesInput,
  wont_fix, verdict, appraiser_verdicts,
  evaluations, violations,
  feedback_opened: feedbackOpened,
  feedback_resolved: feedbackResolved,
  artefact_hashes: artefactHashes,
} = {}) {
  requireField(stage, 'stage');
  requireField(cycle, 'cycle');
  requireField(iteration, 'iteration');
  requireField(timestamp, 'timestamp');
  if (!VALID_STAGES.has(stage)) {
    throw new TypeError(`Invalid stage name: ${stage}`);
  }

  const evalsVal = defaultTo(evaluations, []);
  const violationsVal = defaultTo(violations, 0);
  const changedFiles = sortStrings([...defaultTo(changedFilesInput, [])]);
  const fbOpened = defaultTo(feedbackOpened, []);
  const fbResolved = defaultTo(feedbackResolved, []);
  const artHashes = defaultTo(artefactHashes, []);

  const flags = {
    changed_files: changedFiles, wont_fix: !!wont_fix,
    verdict, appraiser_verdicts,
  };

  const status = deriveStageStatus(stage, evalsVal, violationsVal, flags);

  return Object.freeze({
    schema: STAGE_ATTESTATION_SCHEMA, stage, cycle, iteration,
    timestamp, status, changed_files: changedFiles,
    evaluations: evalsVal, violations: violationsVal,
    feedback_opened: fbOpened, feedback_resolved: fbResolved,
    artefact_hashes: artHashes,
  });
}
