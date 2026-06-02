/**
 * Attestation builder.
 *
 * Verifies cycle completeness and produces the ATTEST.md content string.
 */

import path from 'node:path';
import { load as loadYaml } from 'js-yaml';
import { parseFrontmatter } from '../workfile.js';
import { parseAllHistoryEntries } from '../history.js';
import { sha256Buffer } from './hash.js';
import { buildAttestationPayload } from './payload.js';
import { canonicalJson } from './canonical-json.js';
import { renderAttestedCommitMessage } from './render.js';

function readWorkFiles(cwd, io) {
  const workPath = path.join(cwd, 'WORK.md');
  const historyPath = path.join(cwd, 'WORK.history.yaml');
  const feedbackPath = path.join(cwd, 'WORK.feedback.yaml');

  return {
    workText: io.readFile(workPath),
    historyText: io.exists(historyPath) ? io.readFile(historyPath) : '',
    feedbackText: io.exists(feedbackPath) ? io.readFile(feedbackPath) : '',
  };
}

function checkMissingStages(frontmatter, historyText) {
  const entries = parseAllHistoryEntries(historyText);
  const completed = new Set(entries.map(e => e.stage));
  const missing = (frontmatter.stages ?? []).filter(s => !completed.has(s));
  if (missing.length > 0) {
    return `foundry_attest: required stage(s) not completed: ${missing.join(', ')}`;
  }
  return null;
}

function checkUnresolvedFeedback(feedbackText) {
  const doc = feedbackText.trim() ? (loadYaml(feedbackText) ?? {}) : {};
  const items = doc.items ?? [];
  const unresolved = items.filter(item => item?.history?.[0]?.state !== 'resolved');
  if (unresolved.length > 0) {
    return `foundry_attest: ${unresolved.length} unresolved feedback item(s): ${unresolved.map(i => i.id).join(', ')}`;
  }
  return null;
}

function findCycleError(frontmatter, historyText, feedbackText) {
  const missingError = checkMissingStages(frontmatter, historyText);
  if (missingError) return missingError;

  return checkUnresolvedFeedback(feedbackText);
}

function computeDiffSha(execGit, baseBranch) {
  const mergeBase = execGit(['merge-base', 'HEAD', baseBranch]).trim();
  const diffOutput = execGit(['diff', mergeBase, 'HEAD']);
  const diffBuf = Buffer.isBuffer(diffOutput) ? diffOutput : Buffer.from(diffOutput, 'utf8');
  return sha256Buffer(diffBuf);
}

export async function buildAttestation({
  cwd,
  foundryDir,
  baseBranch,
  branchBaseSha,
  goalText,
  archiveBranch,
  archiveTipSha,
  io,
  execGit,
  coverage,
}) {
  const { workText, historyText, feedbackText } = readWorkFiles(cwd, io);
  const frontmatter = parseFrontmatter(workText);

  const cycleError = findCycleError(frontmatter, historyText, feedbackText);
  if (cycleError) {
    return { ok: false, error: cycleError };
  }

  const diffSha = computeDiffSha(execGit, baseBranch);

  const payload = await buildAttestationPayload({
    cwd,
    foundryDir: foundryDir ?? 'foundry',
    goalText,
    archiveBranch,
    archiveTipSha,
    baseBranch,
    branchBaseSha,
    io,
    coverage,
  });

  const payloadJson = canonicalJson(payload);
  const commitMessage = renderAttestedCommitMessage({ humanSummary: goalText, payloadJson });

  const content = commitMessage.replace(
    '-----BEGIN FOUNDRY ATTESTATION-----',
    `diff-sha256: ${diffSha}\n\n-----BEGIN FOUNDRY ATTESTATION-----`
  );

  return { ok: true, content, diffSha };
}
