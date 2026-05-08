// Foundry v2.3.0 orchestrate: cycle-level helpers.
// Pure utilities and cycle-data accessors used by orchestration phases.

import {
  getCycleDefinition,
  getArtefactType,
} from './lib/config.js';
import { parseArtefactsTable, setArtefactStatus } from './lib/artefacts.js';
import { openFeedbackStore } from './lib/feedback-store.js';

// ---------------------------------------------------------------------------
// Public helpers (re-exported by orchestrate.js for tests).
// ---------------------------------------------------------------------------

export function findCycleOutputArtefact(cycleId, io) {
  if (!io.exists('WORK.md')) return null;
  const content = io.readFile('WORK.md');
  const rows = parseArtefactsTable(content);
  const match = rows.find(r => r.cycle === cycleId);
  return match ? { file: match.file, type: match.type, status: match.status } : null;
}

export async function readCycleTargets(cycleId, io) {
  try {
    const cd = await getCycleDefinition('foundry', cycleId, io);
    return cd.frontmatter?.targets ?? [];
  } catch {
    return [];
  }
}

function extractOutputType(cd) {
  return cd.frontmatter?.['output-type'];
}

async function fetchFilePatterns(output, io) {
  const at = await getArtefactType('foundry', output, io);
  return at.frontmatter?.['file-patterns'] ?? null;
}

export async function readForgeFilePatterns(cycleId, io) {
  let cd;
  try {
    cd = await getCycleDefinition('foundry', cycleId, io);
  } catch {
    return null;
  }
  const output = extractOutputType(cd);
  if (!output) return null;
  return fetchFilePatterns(output, io);
}

// ---------------------------------------------------------------------------
// Private helpers.
// ---------------------------------------------------------------------------

function isWontFixOrRejected(it) {
  const s = it.history[0].state;
  return s === 'wont-fix' || s === 'rejected';
}

function compareTimestampsDesc(a, b) {
  const aTs = a.history[0].timestamp;
  const bTs = b.history[0].timestamp;
  if (aTs !== bTs) return aTs < bTs ? 1 : -1;
  return 0;
}

function feedbackProjection(it) {
  return {
    id:     it.id,
    file:   it.file,
    text:   it.text,
    state:  it.history[0].state,
    reason: it.history[0].reason,
  };
}

export function readRecentFeedback(io, limit = 5) {
  try {
    if (!io.exists('WORK.feedback.yaml')) return [];
    const store = openFeedbackStore('WORK.feedback.yaml', io);
    const items = store.list();
    const candidates = items.filter(isWontFixOrRejected);
    candidates.sort(compareTimestampsDesc);
    return candidates.slice(0, limit).map(feedbackProjection);
  } catch {
    return [];
  }
}

/**
 * Spec §10. Count non-resolved items for stamping on every history entry.
 */
function isOpenFeedback(it) {
  return it.history[0].state !== 'resolved';
}

export function computeOpenFeedback(io) {
  if (!io.exists('WORK.feedback.yaml')) return 0;
  try {
    const store = openFeedbackStore('WORK.feedback.yaml', io);
    return store.list().filter(isOpenFeedback).length;
  } catch {
    return 0;
  }
}

export function violation(details, affectedFiles = []) {
  return {
    action: 'violation',
    details,
    recoverable: false,
    affected_files: affectedFiles,
  };
}

function isUnexpectedFilesError(err) {
  return err && err.code === 'unexpected_files';
}

function collectErrorFiles(err) {
  return Array.isArray(err.files) ? err.files : [];
}

function buildSetupViolationMessage(files, phase) {
  const where = phase === 'setup'
    ? 'flow setup requires a clean worktree'
    : `stage ${phase} commit may only include allowed files`;
  return `${where}; refusing to commit unrelated changes: ${files.join(', ')}`;
}

/**
 * Call git.commit with phase-appropriate allowed patterns.
 * Returns null on success, a violation object on policy failure.
 */
export function tryCommit(git, message, allowedPatterns, phase) {
  if (!git || typeof git.commit !== 'function') return null;
  try {
    git.commit(message, { allowedPatterns });
    return null;
  } catch (err) {
    if (isUnexpectedFilesError(err)) {
      const files = collectErrorFiles(err);
      return violation(buildSetupViolationMessage(files, phase), files);
    }
    throw err;
  }
}

function findCycleRow(cycleId, rows) {
  return rows.find(r => r.cycle === cycleId);
}

function writeBlockedStatus(content, row, io) {
  try {
    io.writeFile('WORK.md', setArtefactStatus(content, row.file, 'blocked'));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

export function markArtefactBlocked(cycleId, io) {
  if (!io.exists('WORK.md')) return { ok: true };
  const content = io.readFile('WORK.md');
  const rows = parseArtefactsTable(content);
  const row = findCycleRow(cycleId, rows);
  if (!row) return { ok: true };
  return writeBlockedStatus(content, row, io);
}

export function formatBlockNote(blockResult) {
  return blockResult.ok ? '' : ` (also: failed to mark artefact blocked: ${blockResult.error})`;
}

// ---------------------------------------------------------------------------
// Stage synthesis (pure utility, used by setupWorkfile and exported publicly).
// ---------------------------------------------------------------------------

export function synthesizeStages({ cycleId, hasValidation, humanAppraise, assay = false }) {
  const stages = [];
  if (assay) stages.push(`assay:${cycleId}`);
  stages.push(`forge:${cycleId}`);
  if (hasValidation) stages.push(`quench:${cycleId}`);
  stages.push(`appraise:${cycleId}`);
  if (humanAppraise) stages.push(`human-appraise:${cycleId}`);
  return stages;
}

// ---------------------------------------------------------------------------
// Dispatch prompt rendering (pure utility, used by handleSortResult and exported publicly).
// ---------------------------------------------------------------------------

export function renderDispatchPrompt({ stage, cycle, token, cwd, filePatterns }) {
  const lines = [
    `You are a Foundry stage agent. Invoke the ${stage.split(':')[0]} skill and follow its instructions exactly.`,
    ``,
    `Stage: ${stage}`,
    `Cycle: ${cycle}`,
    `Token: ${token}`,
    `Working directory: ${cwd}`,
  ];
  if (filePatterns && filePatterns.length) {
    lines.push(`File patterns (forge only): ${JSON.stringify(filePatterns)}`);
  }
  lines.push(
    ``,
    `Your FIRST tool call MUST be foundry_stage_begin({stage, cycle, token}) using the values above.`,
    `Your LAST tool call MUST be foundry_stage_end({summary}).`,
    ``,
    `When done, report back a brief summary. Do NOT call foundry_history_append, foundry_git_commit, or foundry_artefacts_add — the orchestrator handles all of those.`
  );
  return lines.join('\n');
}
