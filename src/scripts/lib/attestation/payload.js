/**
 * Attestation payload builder.
 *
 * Constructs a deterministic, cryptographically verifiable record of work completion.
 */

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { parseFrontmatter } from '../workfile.js';
import { parseArtefactsTable } from '../artefacts.js';
import { parseAllHistoryEntries } from '../history.js';
import { sha256Text, sortPaths } from './hash.js';

function defaultIo() {
  return {
    readFile: (filePath) => readFileSync(filePath, 'utf8'),
    fileExists: (filePath) => existsSync(filePath),
  };
}

function readWorkFiles(cwd, io) {
  const { readFile, fileExists } = io ?? defaultIo();

  return {
    workText: readFile(path.join(cwd, 'WORK.md')),
    historyText: fileExists(path.join(cwd, 'WORK.history.yaml')) ? readFile(path.join(cwd, 'WORK.history.yaml')) : '',
    feedbackText: fileExists(path.join(cwd, 'WORK.feedback.yaml')) ? readFile(path.join(cwd, 'WORK.feedback.yaml')) : '',
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

export function buildAttestationPayload({ cwd, goalText, archiveBranch, archiveTipSha, io }) {
  const { workText, historyText, feedbackText } = readWorkFiles(cwd, io);

  const frontmatter = parseFrontmatter(workText);
  const artefacts = parseArtefactsTable(workText);

  const sortedEntries = parseAndSortHistoryEntries(historyText);
  const stages = buildStagesFromEntries(sortedEntries);

  return {
    contract: buildContract(frontmatter),
    governance: buildGovernance(frontmatter, workText, historyText, feedbackText),
    outputs: artefacts.map(row => ({ path: row.file, status: row.status })),
    process: { stages },
    request: { goal_text: goalText },
    schema: 'foundry-attestation/v1',
    work_branch_archive: { name: archiveBranch, tip_sha: archiveTipSha },
  };
}
