/**
 * Human-appraise stage handlers for the run state machine.
 *
 * Two modes:
 * 1. Deadlock override (deadlock-human-appraise: true) — user resolves or
 *    rejects each deadlocked feedback item.
 * 2. Always-human-appraise (always-human-appraise: true) — user approves
 *    or rejects the artefact change with optional feedback.
 *
 * When both flags are set, deadlock takes priority.
 */

import { writeActiveStage, clearActiveStage, writeLastStage } from './lib/state.js';
import { openFeedbackStore } from './lib/feedback-store.js';
import { parseFrontmatter } from './lib/workfile.js';
import { validateHumanAppraiseOutput, isDeadlockResolution } from './lib/stage-output-schemas.js';

export function terminalPromptUser(stage, artefact, feedback, goal) {
  return { action: 'prompt_user', stage, artefact, feedback: feedback || [], goal: goal || '' };
}

export function terminalDone(fm) {
  return { action: 'done', flow: fm.flow || '', artefact: fm['artefact-path'] || fm.artefact || '' };
}

export function terminalViolation(details, recoverable) {
  return { action: 'violation', details: details || 'unknown error', recoverable: !!recoverable };
}

function getLastMessageId(messages) {
  if (!Array.isArray(messages) || messages.length < 1) return '';
  const lastMsg = messages[messages.length - 1];
  if (lastMsg.info) return lastMsg.info.id;
  return lastMsg.id || '';
}

/**
 * Query the boundary marker (last message id) from the session.
 */
export async function queryBoundaryMarker(client, context, worktree) {
  try {
    const messages = await client.session.messages({
      path: { id: context.sessionID },
      query: { directory: worktree },
    });
    return getLastMessageId(messages);
  } catch {
    return '';
  }
}

/**
 * Load all items not in resolved state from the feedback store.
 * Returns the full item objects (including complete history array).
 *
 * @param {object} io — IO adapter
 * @param {string} fp — path to feedback store file
 * @returns {object[]} — full feedback items excluding resolved
 */
export function loadDeadlockItems(io, fp) {
  try {
    const store = openFeedbackStore(fp, io);
    return store.list()
      .filter(function(it) { return it.history[0].state !== 'resolved'; });
  } catch {
    return [];
  }
}

async function getGitHeadSha(io) {
  try {
    return io.exec(['git', 'rev-parse', 'HEAD']).toString().trim();
  } catch {
    return 'unknown';
  }
}

function writeHumanAppraiseStage(io, cycleId, boundaryMarker, baseSha) {
  writeActiveStage(io, {
    cycle: cycleId,
    stage: 'human-appraise:' + cycleId,
    boundaryMarker: boundaryMarker,
    baseSha: baseSha,
    startedAt: new Date().toISOString(),
  });
}

function artefactPath(fm) {
  const p = fm['artefact-path'];
  if (p) return p;
  const a = fm.artefact;
  return a || '';
}

/**
 * Record boundary marker and return prompt_user for human-appraise stage.
 */
export async function handleHumanAppraiseInit(opts, cycleId, hp, fp) {
  const { client, context, io, worktree } = opts;
  try {
    const boundaryMarker = await queryBoundaryMarker(client, context, worktree);
    const r = readWork(io);
    if (r.error) return r.error;
    const fm = r.fm;
    const baseSha = await getGitHeadSha(io);

    writeHumanAppraiseStage(io, cycleId, boundaryMarker, baseSha);

    const feedbackList = loadDeadlockItems(io, fp);
    return terminalPromptUser(
      'human-appraise',
      artefactPath(fm),
      feedbackList,
      fm.goal || '',
    );
  } catch (err) {
    return terminalViolation('human-appraise setup error: ' + err.message, true);
  }
}

function readWork(io) {
  const text = io.exists('WORK.md') ? io.readFile('WORK.md') : null;
  if (!text) return { error: terminalViolation('continueRun: WORK.md not found', false) };
  const fm = parseFrontmatter(text);
  if (!fm.cycle) return { error: terminalViolation('No cycle in WORK.md frontmatter', false) };
  return { fm };
}

function closeHumanAppraiseStage(io, activeStage, cycleId, summary) {
  clearActiveStage(io);
  writeLastStage(io, {
    cycle: cycleId,
    stage: 'human-appraise:' + cycleId,
    baseSha: activeStage.baseSha || '',
    summary: summary,
  });
}

// ---------------------------------------------------------------------------
// Stage-output reader
// ---------------------------------------------------------------------------

function parseRecordLine(line) {
  let parsed;
  try { parsed = JSON.parse(line); } catch { return null; }
  const validation = validateHumanAppraiseOutput(parsed);
  return validation.ok ? parsed : null;
}

function readOutputFile(outDir, fileName, io) {
  let content;
  try { content = io.readFile(outDir + fileName); } catch { return []; }
  return content.trim().split('\n')
    .filter(Boolean)
    .map(function(line) { return parseRecordLine(line); })
    .filter(Boolean);
}

export function readHumanAppraiseOutputs(io) {
  const outDir = '.foundry/stage-outputs/';
  if (!io.exists(outDir)) return [];

  return io.readDir(outDir)
    .filter(function(f) { return f.endsWith('.jsonl'); })
    .flatMap(function(f) { return readOutputFile(outDir, f, io); });
}

// ---------------------------------------------------------------------------
// Deadlock resolution loop (4.3)
// ---------------------------------------------------------------------------

function resolveDeadlockRecord(record, store, cycleId, stage) {
  const itemId = record.itemId;
  const verdict = record.verdict;

  if (verdict === 'resolved') {
    store.forceState(itemId, 'resolved', cycleId, stage);
    return true;
  }

  if (verdict === 'rejected') {
    store.forceState(itemId, 'rejected', cycleId, stage);
    if (record.feedback) {
      const item = store.get(itemId);
      if (item) {
        store.add({
          file: item.file, tag: 'human', text: record.feedback,
          source: 'human-appraise:' + cycleId, cycle: cycleId,
        });
      }
    }
    return true;
  }

  return false;
}

/**
 * Process deadlock-resolution stage-output records and transition items.
 *
 * For each valid record with an itemId:
 *  - resolved: forceState to 'resolved'
 *  - rejected: forceState to 'rejected', and if feedback is provided, add
 *    a new feedback item so it re-enters the forge queue
 */
function processDeadlockResolutions(records, store, cycleId, stage) {
  for (const record of records) {
    if (!isDeadlockResolution(record)) continue;
    resolveDeadlockRecord(record, store, cycleId, stage);
  }
}

function readDeadlockUserPrompt(io, fm, fp) {
  const deadlockItems = loadDeadlockItems(io, fp);
  return terminalPromptUser('human-appraise', artefactPath(fm), deadlockItems, fm.goal || '');
}

/**
 * Handle the deadlock override scenario.
 * Reads stage-output records, resolves/rejects items, and either closes
 * the stage or re-prompts with remaining items.
 */
function handleDeadlockOverride(ctx) {
  const { io, activeStage, cycleId, store, fm, fp } = ctx;

  // If no items are in the deadlocked state, terminate with a violation
  const deadlockedItems = store.list()
    .filter(function(it) { return it.history[0].state === 'deadlocked'; });
  if (deadlockedItems.length === 0) {
    return terminalViolation(
      'deadlock-human-appraise enabled but no items in deadlocked state',
      false,
    );
  }

  const records = readHumanAppraiseOutputs(io);
  const stage = 'human-appraise:' + cycleId;

  if (records.length === 0) return readDeadlockUserPrompt(io, fm, fp);

  processDeadlockResolutions(records, store, cycleId, stage);

  // Check if any deadlocked items remain unprocessed
  const remaining = store.list()
    .filter(function(it) { return it.history[0].state === 'deadlocked'; });

  if (remaining.length === 0) {
    closeHumanAppraiseStage(io, activeStage, cycleId, 'deadlock resolved');
    return { action: 'continue-run' };
  }

  return terminalPromptUser(
    'human-appraise',
    artefactPath(fm),
    remaining,
    fm.goal || '',
  );
}

// ---------------------------------------------------------------------------
// Always-human-appraise (4.4)
// ---------------------------------------------------------------------------

function alwaysHumanPrompt(io, fm) {
  return terminalPromptUser('human-appraise', artefactPath(fm), [], fm.goal || '');
}

function approveAlwaysHuman(io, activeStage, cycleId) {
  closeHumanAppraiseStage(io, activeStage, cycleId, 'human approved');
  return { action: 'continue-run' };
}

function rejectAlwaysHuman(ctx, feedback) {
  const { io, activeStage, cycleId, store, fm } = ctx;
  if (feedback) {
    store.add({
      file: artefactPath(fm), tag: 'human',
      text: feedback, source: 'human-appraise:' + cycleId, cycle: cycleId,
    });
  }
  const summary = feedback ? 'human rejected — feedback captured' : 'human rejected';
  closeHumanAppraiseStage(io, activeStage, cycleId, summary);
  return { action: 'continue-run' };
}

/**
 * Handle the always-human-appraise scenario.
 * Reads stage-output records and either approves (close stage) or rejects
 * (store feedback, close stage). Returns prompt_user when no records exist.
 */
function handleAlwaysHumanAppraise(ctx) {
  const { io, activeStage, cycleId, fm } = ctx;
  const records = readHumanAppraiseOutputs(io);

  if (records.length === 0) return alwaysHumanPrompt(io, fm);

  const record = records.find(function(r) { return !isDeadlockResolution(r); });
  if (!record) return alwaysHumanPrompt(io, fm);

  if (record.verdict === 'approved') return approveAlwaysHuman(io, activeStage, cycleId);
  if (record.verdict === 'rejected') return rejectAlwaysHuman(ctx, record.feedback);

  return alwaysHumanPrompt(io, fm);
}

// ---------------------------------------------------------------------------
// Resume handler
// ---------------------------------------------------------------------------

/**
 * Handle resuming a human-appraise stage (entry point for continueRun).
 *
 * Branching logic:
 * 1. If deadlock-human-appraise is true → run deadlock override
 * 2. Else if always-human-appraise is true → run always-human-appraise
 * 3. Otherwise → violation (no scenario configured)
 */
export function handleHumanAppraiseResume(io, activeStage) {
  const cycleId = activeStage.cycle || '';

  const r = readWork(io);
  if (r.error) return r.error;
  const fm = r.fm;

  const fp = 'WORK.feedback.yaml';
  const store = openFeedbackStore(fp, io);

  const isDeadlock = fm['deadlock-human-appraise'] === true;
  const isAlwaysHuman = fm['always-human-appraise'] === true;

  if (isDeadlock) {
    return handleDeadlockOverride({ io, activeStage, cycleId, store, fm, fp });
  }

  if (isAlwaysHuman) {
    return handleAlwaysHumanAppraise({ io, activeStage, cycleId, store, fm, fp });
  }

  return terminalViolation(
    'human-appraise: no scenario configured — expected deadlock-human-appraise or always-human-appraise',
    false,
  );
}
