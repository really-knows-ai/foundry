/**
 * Attestation payload builder.
 *
 * Constructs a deterministic, cryptographically verifiable record of work completion.
 *
 * @typedef {Object} CoverageMapEntry
 * @property {string} unitId                 - Unit identifier (e.g. "security::law-by-law::0")
 * @property {string} group                  - Law group name
 * @property {'bundle'|'law-by-law'} mode    - Evaluation mode
 * @property {string|null} law               - Law ID (null for bundle-mode entries)
 * @property {CoverageEvalEntry[]} evaluations - Per-(appraiser,pass) completion records
 * @property {number} violations             - Count of attributed violations
 *
 * @typedef {Object} CoverageEntry
 * @property {string} group                  - Law group name
 * @property {'bundle'|'law-by-law'} mode    - Evaluation mode
 * @property {string} [law]                  - Law ID (absent for bundle-mode entries)
 * @property {CoverageEvalEntry[]} evaluations - Per-(appraiser,pass) completion records
 * @property {number} violations             - Count of attributed violations
 * @property {'pass'|'fail'|'incomplete'} status - Derived unit status
 *
 * @typedef {Object} CoverageEvalEntry
 * @property {string} appraiser              - Appraiser ID
 * @property {number} pass                   - 1-based pass index
 * @property {boolean} completed             - Whether the session completed
 */

import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { parseFrontmatter } from '../workfile.js';
import { getArtefactFiles } from '../artefacts.js';
import { getCycleDefinition } from '../config.js';
import { parseAllHistoryEntries } from '../history.js';
import { sha256Text, sortPaths } from './hash.js';

function defaultIo(cwd) {
  return {
    readFile: (filePath) => readFileSync(filePath, 'utf8'),
    exists: (filePath) => existsSync(filePath),
    exec: (args) => execFileSync(args[0], args.slice(1), { cwd, encoding: 'utf8' }),
  };
}

function readWorkFiles(cwd, io) {
  const { readFile, exists } = io ?? defaultIo(cwd);

  return {
    workText: readFile(path.join(cwd, 'WORK.md')),
    historyText: exists(path.join(cwd, 'WORK.history.yaml')) ? readFile(path.join(cwd, 'WORK.history.yaml')) : '',
    feedbackText: exists(path.join(cwd, 'WORK.feedback.yaml')) ? readFile(path.join(cwd, 'WORK.feedback.yaml')) : '',
  };
}

function parseAndSortHistoryEntries(historyText) {
  const allHistoryEntries = parseAllHistoryEntries(historyText);
  return allHistoryEntries.slice().sort((a, b) => {
    const seqA = typeof a.seq === 'number' ? a.seq : 0;
    const seqB = typeof b.seq === 'number' ? b.seq : 0;
    return seqA - seqB;
  });
}

function buildStageRecord(entry) {
  const record = {
    changed_files: entry.changed_files ? sortPaths(entry.changed_files) : [],
    cycle: entry.cycle,
    iteration: entry.iteration,
    open_feedback: entry.open_feedback ?? 0,
  };

  if (entry.route !== undefined) {
    record.route = entry.route;
  }

  record.stage = entry.stage;

  return record;
}

function buildStagesFromEntries(sortedEntries) {
  return sortedEntries.map(buildStageRecord);
}

function def(value, fallback) {
  return value || fallback;
}

function buildContract(frontmatter) {
  return {
    allowed_write_scope: def(frontmatter['allowed-write-scope'], []),
    entry_cycle: frontmatter.cycle,
    expected_output_types: def(frontmatter['expected-output-types'], []),
    flow_id: frontmatter.flow,
    required_deterministic_checks: def(frontmatter['required-deterministic-checks'], []),
    required_human_gates: def(frontmatter['required-human-gates'], null),
    required_stages: def(frontmatter.stages, []),
  };
}

function buildGovernance(frontmatter, workText, historyText, feedbackText) {
  return {
    config_commit: def(frontmatter['config-commit'], null),
    workfile_hashes: {
      'WORK.md': sha256Text(workText),
      'WORK.history.yaml': sha256Text(historyText),
      'WORK.feedback.yaml': sha256Text(feedbackText),
    },
  };
}

async function discoverCycleOutputs(resolvedFd, cycleId, resolvedIo, options) {
  try {
    const cfm = (await getCycleDefinition(resolvedFd, cycleId, resolvedIo)).frontmatter;
    const outputType = cfm && cfm['output-type'];
    if (outputType) return getArtefactFiles(resolvedFd, outputType, resolvedIo, options);
  } catch {
    // If cycle definition is missing, outputs remain empty
  }
  return [];
}

/**
 * Derive coverage status for a single evaluation unit.
 *
 * Status is computed deterministically from completion data and violations.
 * It is never taken from the model, never asserted by an appraiser, and
 * never stored in a verdict field.
 *
 * @param {number} violations - Count of violations attributed to the unit
 * @param {CoverageEvalEntry[]} evaluations - Per-(appraiser,pass) completion records
 * @returns {'pass'|'fail'|'incomplete'}
 */
function deriveCoverageStatus(violations, evaluations) {
  if (violations > 0) return 'fail';
  if (evaluations.some(e => !e.completed)) return 'incomplete';
  return 'pass';
}

/**
 * Sort comparator: by (appraiser asc, pass asc).
 *
 * @param {CoverageEvalEntry} a
 * @param {CoverageEvalEntry} b
 * @returns {number}
 */
function byAppraiserThenPass(a, b) {
  if (a.appraiser < b.appraiser) return -1;
  if (a.appraiser > b.appraiser) return 1;
  return a.pass - b.pass;
}

/**
 * Check whether a value is null or undefined.
 *
 * @param {unknown} v
 * @returns {boolean}
 */
function isNullOrUndefined(v) {
  return v === null || v === undefined;
}

/**
 * Compare law fields for sorting: null/undefined sorts before any string.
 *
 * @param {string|null|undefined} la
 * @param {string|null|undefined} lb
 * @returns {number}
 */
function compareLaw(la, lb) {
  if (la === lb) return 0;
  if (isNullOrUndefined(la)) return -1;
  if (isNullOrUndefined(lb)) return 1;
  if (la < lb) return -1;
  return 1;
}

/**
 * Sort comparator: by (group asc, law asc) with null law sorting first.
 *
 * @param {CoverageEntry} a
 * @param {CoverageEntry} b
 * @returns {number}
 */
function byGroupThenLaw(a, b) {
  if (a.group < b.group) return -1;
  if (a.group > b.group) return 1;
  return compareLaw(a.law, b.law);
}

/**
 * Build a single coverage entry from a coverage map entry.
 *
 * Sorts evaluations by (appraiser, pass) and derives status.
 * Includes law field only for non-null law values.
 *
 * @param {CoverageMapEntry} entry
 * @returns {CoverageEntry}
 */
function buildCoverageEntry(entry) {
  const sortedEvals = entry.evaluations.slice().sort(byAppraiserThenPass);
  const covEntry = {
    group: entry.group,
    mode: entry.mode,
    evaluations: sortedEvals,
    violations: entry.violations,
    status: deriveCoverageStatus(entry.violations, entry.evaluations),
  };
  if (entry.law !== null && entry.law !== undefined) {
    covEntry.law = entry.law;
  }
  return covEntry;
}

/**
 * Build coverage entries from the Phase 08 coverage map.
 *
 * Iterates the coverage Map, derives status per unit, sorts entries by
 * (group, law), and sorts each evaluations array by (appraiser, pass).
 *
 * @param {Map<string, CoverageMapEntry>} [coverage] - Per-unit coverage data
 * @returns {CoverageEntry[]} Sorted coverage entries ready for the payload
 */
function buildCoverageSection(coverage) {
  if (!coverage) return [];

  const entries = [];
  for (const entry of coverage.values()) {
    entries.push(buildCoverageEntry(entry));
  }
  entries.sort(byGroupThenLaw);
  return entries;
}

export async function buildAttestationPayload(
  { cwd, foundryDir: fd, goalText, archiveBranch, archiveTipSha, baseBranch, branchBaseSha, io, coverage },
) {
  const resolvedIo = io || defaultIo(cwd);
  const resolvedFd = fd || 'foundry';
  const { workText, historyText, feedbackText } = readWorkFiles(cwd, resolvedIo);

  const frontmatter = parseFrontmatter(workText);

  // Discover artefact outputs from branch changes
  let outputs = [];
  const cycleId = frontmatter.cycle;
  if (cycleId) {
    outputs = await discoverCycleOutputs(resolvedFd, cycleId, resolvedIo, { baseBranch, branchBaseSha });
  }

  const outputEntries = outputs.map(({ file, state }) => ({ path: file, state }));

  const sortedEntries = parseAndSortHistoryEntries(historyText);
  const stages = buildStagesFromEntries(sortedEntries);

  const sortedCoverageEntries = buildCoverageSection(coverage);

  return {
    contract: buildContract(frontmatter),
    governance: buildGovernance(frontmatter, workText, historyText, feedbackText),
    outputs: outputEntries,
    process: { stages },
    request: { goal_text: goalText },
    schema: 'foundry-attestation/v2',
    coverage: sortedCoverageEntries,
    work_branch_archive: { name: archiveBranch, tip_sha: archiveTipSha },
  };
}
