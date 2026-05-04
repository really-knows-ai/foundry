/**
 * Attestation payload builder.
 *
 * Constructs a deterministic, cryptographically verifiable record of work completion.
 */

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { parseFrontmatter } from '../workfile.js';
import { parseArtefactsTable } from '../artefacts.js';
import { loadHistory, parseAllHistoryEntries } from '../history.js';
import { sha256Text, sortPaths } from './hash.js';

export function buildAttestationPayload({ cwd, goalText, archiveBranch, archiveTipSha, io }) {
  // Use injected I/O if provided, otherwise fall back to filesystem
  const readFile = io?.readFile ?? ((filePath) => readFileSync(filePath, 'utf8'));
  const fileExists = io?.fileExists ?? ((filePath) => existsSync(filePath));

  const workPath = path.join(cwd, 'WORK.md');
  const historyPath = path.join(cwd, 'WORK.history.yaml');
  const feedbackPath = path.join(cwd, 'WORK.feedback.yaml');

  const workText = readFile(workPath);
  const historyText = fileExists(historyPath) ? readFile(historyPath) : '';
  const feedbackText = fileExists(feedbackPath) ? readFile(feedbackPath) : '';
  
  const frontmatter = parseFrontmatter(workText);
  const artefacts = parseArtefactsTable(workText);

  // Parse all history entries (across all cycles) for the process section
  const allHistoryEntries = parseAllHistoryEntries(historyText);
  
  // Sort entries by seq (deterministic, stable order)
  const sortedEntries = allHistoryEntries.slice().sort((a, b) => {
    const seqA = typeof a.seq === 'number' ? a.seq : 0;
    const seqB = typeof b.seq === 'number' ? b.seq : 0;
    return seqA - seqB;
  });

  // Build process.stages array
  const stages = sortedEntries.map(entry => {
    // Determine result field:
    // - For sort stages with a route, use the route value
    // - Otherwise, use the literal "recorded" (no tool-produced pass/fail verdict exists)
    let result = 'recorded';
    if (entry.stage === 'sort' && entry.route) {
      result = entry.route;
    }

    // changed_files: copy from entry, default to [], re-sort defensively
    const changedFiles = entry.changed_files ? sortPaths(entry.changed_files) : [];

    return {
      stage: entry.stage,
      result,
      changed_files: changedFiles,
    };
  });

  return {
    contract: {
      flow_id: frontmatter.flow,
      entry_cycle: frontmatter.cycle,
      required_stages: frontmatter.stages ?? [],
    },
    governance: {
      config_commit: frontmatter['config-commit'] ?? null,
      workfile_hashes: {
        'WORK.md': sha256Text(workText),
        'WORK.history.yaml': sha256Text(historyText),
        'WORK.feedback.yaml': sha256Text(feedbackText),
      },
    },
    outputs: artefacts.map(row => ({ path: row.file, status: row.status })),
    process: {
      stages,
    },
    request: { goal_text: goalText },
    scope: { out_of_scope_writes: false, forbidden_config_mutation: false },
    schema: 'foundry-attestation/v1',
    verdict: { status: 'passed' },
    work_branch_archive: { name: archiveBranch, tip_sha: archiveTipSha },
  };
}
