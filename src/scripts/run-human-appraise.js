/**
 * Human-appraise stage handlers for the run state machine.
 *
 * Handles boundary marker recording, verbatim capture, deadlock resolution,
 * and cycle transitions.
 */

import { writeActiveStage, clearActiveStage, writeLastStage } from './lib/state.js';
import { openFeedbackStore } from './lib/feedback-store.js';
import { parseFrontmatter } from './lib/workfile.js';

function verbatimCapturePath() {
  return '.foundry/verbatim-capture.txt';
}

function readVerbatimCapture(io) {
  const p = verbatimCapturePath();
  if (!io.exists(p)) return null;
  return io.readFile(p);
}

function writeVerbatimCapture(io, text) {
  io.writeFile(verbatimCapturePath(), text);
}

function deleteVerbatimCapture(io) {
  io.unlink(verbatimCapturePath());
}

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

function loadUnresolvedFeedback(io, fp) {
  try {
    const store = openFeedbackStore(fp, io);
    return store.list()
      .filter(function(it) { return it.history[0].state !== 'resolved'; })
      .map(function(it) {
        return { id: it.id, file: it.file, text: it.text, state: it.history[0].state };
      });
  } catch {
    return [];
  }
}

function collectUnresolvedFeedback(io) {
  try {
    const store = openFeedbackStore('WORK.feedback.yaml', io);
    return store.list()
      .filter(function(it) { return it.history[0].state !== 'resolved'; })
      .map(function(it) {
        return { id: it.id, file: it.file, text: it.text, state: it.history[0].state };
      });
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
export async function handleHumanAppraiseInit(opts, sortResult, cycleId, hp, fp) {
  const { client, context, io, worktree } = opts;
  try {
    const boundaryMarker = await queryBoundaryMarker(client, context, worktree);
    const r = readWork(io);
    if (r.error) return r.error;
    const fm = r.fm;
    const baseSha = await getGitHeadSha(io);

    writeHumanAppraiseStage(io, cycleId, boundaryMarker, baseSha);

    const feedbackList = loadUnresolvedFeedback(io, fp);
    return terminalPromptUser(
      'human-appraise:' + cycleId,
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

function getMessageId(m) {
  return m.info ? (m.info.id || '') : (m.id || '');
}

function findMarkerIndex(messages, boundaryMarker) {
  for (let i = 0; i < messages.length; i++) {
    if (getMessageId(messages[i]) === boundaryMarker) return i;
  }
  return -1;
}

function collectUserTextFromPart(part, texts) {
  if (part.type === 'text' && part.text) texts.push(part.text);
}

function collectUserTextAfter(parts) {
  const texts = [];
  for (const part of parts) collectUserTextFromPart(part, texts);
  return texts;
}

function isUserMessage(msg) {
  if (!msg.info) return false;
  return msg.info.role === 'user';
}

function collectPostMarkerTexts(messages, startIdx) {
  const texts = [];
  for (let i = startIdx; i < messages.length; i++) {
    const msg = messages[i];
    if (!isUserMessage(msg)) continue;
    const collected = collectUserTextAfter(msg.parts || []);
    for (const t of collected) texts.push(t);
  }
  return texts;
}

/**
 * Filter session messages to only user text parts after a boundary marker.
 */
function capturePostMarkerText(messages, boundaryMarker) {
  if (!Array.isArray(messages)) return '';
  if (!boundaryMarker) return '';

  const markerIdx = findMarkerIndex(messages, boundaryMarker);
  if (markerIdx === -1) return '';

  const texts = collectPostMarkerTexts(messages, markerIdx + 1);
  return texts.join('\n');
}

function storeFeedbackFromCapture(io, cycleId, capturedText, fm) {
  const store = openFeedbackStore('WORK.feedback.yaml', io);
  store.add({
    file: fm['artefact-path'] || fm.artefact || '',
    tag: 'human',
    text: capturedText,
    source: 'human-appraise:' + cycleId,
    cycle: cycleId,
  });
}

function closeHumanAppraiseStage(io, activeStage, cycleId, summary) {
  clearActiveStage(io);
  writeLastStage(io, {
    cycle: cycleId,
    stage: 'human-appraise:' + cycleId,
    baseSha: activeStage.baseSha || '',
    summary: summary,
  });
  deleteVerbatimCapture(io);
}

async function fetchSessionMessages(client, context, worktree) {
  return client.session.messages({
    path: { id: context.sessionID },
    query: { directory: worktree },
  });
}

function handleEmptyCapture(io, activeStage, cycleId, capturedText) {
  const trimmed = capturedText.trim();
  if (trimmed) return null;
  closeHumanAppraiseStage(io, activeStage, cycleId, 'no feedback (approval)');
  return { action: 'continue-run' };
}

function handleFreeFormCapture(io, activeStage, cycleId, capturedText, fm) {
  storeFeedbackFromCapture(io, cycleId, capturedText, fm);
  closeHumanAppraiseStage(io, activeStage, cycleId, 'human feedback captured');
  return { action: 'continue-run' };
}

function handleDeadlockCapture(io, cycleId, fm) {
  const feedbackList = collectUnresolvedFeedback(io);
  return terminalPromptUser(
    'human-appraise:' + cycleId,
    fm['artefact-path'] || fm.artefact || '',
    feedbackList,
    fm.goal || '',
  );
}

/**
 * Perform verbatim capture on first human-appraise resume.
 */
async function doCapture(cap) {
  const { io, client, context, worktree, activeStage, cycleId, boundaryMarker, fm } = cap;
  let capturedText;
  try {
    const messages = await fetchSessionMessages(client, context, worktree);
    capturedText = capturePostMarkerText(messages, boundaryMarker);
  } catch (err) {
    return terminalViolation('verbatim capture failed: ' + (err.message || String(err)), true);
  }

  const emptyResult = handleEmptyCapture(io, activeStage, cycleId, capturedText);
  if (emptyResult) return emptyResult;

  writeVerbatimCapture(io, capturedText);

  const isDeadlock = fm['deadlock-human-appraise'] === true;
  if (!isDeadlock) return handleFreeFormCapture(io, activeStage, cycleId, capturedText, fm);

  return handleDeadlockCapture(io, cycleId, fm);
}

/**
 * Check deadlock resolution on second human-appraise resume.
 */
function checkDeadlockResolution(io, activeStage, cycleId) {
  try {
    const store = openFeedbackStore('WORK.feedback.yaml', io);
    const unresolved = store.list().filter(function(it) { return it.history[0].state !== 'resolved'; });

    if (unresolved.length === 0) {
      closeHumanAppraiseStage(io, activeStage, cycleId, 'deadlock resolved');
      return { action: 'continue-run' };
    }

    return terminalViolation(
      'Human-appraise completed but ' + unresolved.length + ' feedback item(s) remain unresolved',
      true,
    );
  } catch (err) {
    return terminalViolation(
      'Error checking feedback store: ' + (err.message || String(err)),
      false,
    );
  }
}

/**
 * Handle resuming a human-appraise stage (entry point for continueRun).
 */
export async function handleHumanAppraiseResume(io, opts, activeStage) {
  const { client, context, worktree } = opts;
  const cycleId = activeStage.cycle || '';
  const boundaryMarker = activeStage.boundaryMarker || '';

  const r = readWork(io);
  if (r.error) return r.error;
  const fm = r.fm;

  const existingCapture = readVerbatimCapture(io);
  if (!existingCapture) {
    return doCapture({ io, client, context, worktree, activeStage, cycleId, boundaryMarker, fm });
  }

  return checkDeadlockResolution(io, activeStage, cycleId);
}
