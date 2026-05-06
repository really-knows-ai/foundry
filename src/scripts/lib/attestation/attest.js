/**
 * Attestation builder.
 *
 * Verifies cycle completeness and produces the ATTEST.md content string.
 */

import path from 'node:path';
import { load as loadYaml } from 'js-yaml';
import { parseFrontmatter } from '../workfile.js';
import { parseArtefactsTable } from '../artefacts.js';
import { parseAllHistoryEntries } from '../history.js';
import { sha256Buffer } from './hash.js';
import { buildAttestationPayload } from './payload.js';
import { canonicalJson } from './canonical-json.js';
import { renderAttestedCommitMessage } from './render.js';

export async function buildAttestation({
  cwd,
  baseBranch,
  goalText,
  archiveBranch,
  archiveTipSha,
  io,
  execGit,
}) {
  const readFile = io.readFile;
  const fileExists = io.fileExists;

  const workPath = path.join(cwd, 'WORK.md');
  const historyPath = path.join(cwd, 'WORK.history.yaml');
  const feedbackPath = path.join(cwd, 'WORK.feedback.yaml');

  const workText = readFile(workPath);
  const historyText = fileExists(historyPath) ? readFile(historyPath) : '';
  const feedbackText = fileExists(feedbackPath) ? readFile(feedbackPath) : '';

  const frontmatter = parseFrontmatter(workText);
  const artefacts = parseArtefactsTable(workText);
  const requiredStages = frontmatter.stages ?? [];

  // --- Verification ---

  // 1. No blocked artefacts
  const blockedArtefacts = artefacts.filter(a => a.status === 'blocked');
  if (blockedArtefacts.length > 0) {
    return {
      ok: false,
      error: `foundry_attest: cycle has blocked artefact(s): ${blockedArtefacts.map(a => a.file).join(', ')}`,
    };
  }

  // 2. All required stages present in history
  const allEntries = parseAllHistoryEntries(historyText);
  const completedStages = new Set(allEntries.map(e => e.stage));
  const missingStages = requiredStages.filter(s => !completedStages.has(s));
  if (missingStages.length > 0) {
    return {
      ok: false,
      error: `foundry_attest: required stage(s) not completed: ${missingStages.join(', ')}`,
    };
  }

  // 3. No unresolved feedback
  const feedbackDoc = feedbackText.trim() ? (loadYaml(feedbackText) ?? {}) : {};
  const feedbackItems = feedbackDoc.items ?? [];
  const unresolved = feedbackItems.filter(item => item?.history?.[0]?.state !== 'resolved');
  if (unresolved.length > 0) {
    return {
      ok: false,
      error: `foundry_attest: ${unresolved.length} unresolved feedback item(s): ${unresolved.map(i => i.id).join(', ')}`,
    };
  }

  // --- Diff SHA ---
  const mergeBase = execGit(['merge-base', 'HEAD', baseBranch]).trim();
  const diffOutput = execGit(['diff', mergeBase, 'HEAD']);
  const diffBuf = Buffer.isBuffer(diffOutput) ? diffOutput : Buffer.from(diffOutput, 'utf8');
  const diffSha = sha256Buffer(diffBuf);

  // --- Build payload ---
  const payload = buildAttestationPayload({
    cwd,
    goalText,
    archiveBranch,
    archiveTipSha,
    io,
  });

  const payloadJson = canonicalJson(payload);
  const commitMessage = renderAttestedCommitMessage({ humanSummary: goalText, payloadJson });

  // Prepend diff-sha256 line before the attestation block
  const content = commitMessage.replace(
    '-----BEGIN FOUNDRY ATTESTATION-----',
    `diff-sha256: ${diffSha}\n\n-----BEGIN FOUNDRY ATTESTATION-----`
  );

  return { ok: true, content, diffSha };
}
