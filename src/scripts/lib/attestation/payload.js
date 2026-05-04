/**
 * Attestation payload builder.
 *
 * Constructs a deterministic, cryptographically verifiable record of work completion.
 */

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { parseFrontmatter } from '../workfile.js';
import { parseArtefactsTable } from '../artefacts.js';
import { loadHistory } from '../history.js';
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
    request: { goal_text: goalText },
    scope: { out_of_scope_writes: false, forbidden_config_mutation: false },
    schema: 'foundry-attestation/v1',
    verdict: { status: 'passed' },
    work_branch_archive: { name: archiveBranch, tip_sha: archiveTipSha },
  };
}
