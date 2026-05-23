// Foundry v2.3.0 orchestrate: cycle-level helpers.
// Pure utilities and cycle-data accessors used by orchestration phases.

import {
  getCycleDefinition,
  getArtefactType,
} from './lib/config.js';
import { openFeedbackStore } from './lib/feedback-store.js';

// ---------------------------------------------------------------------------
// Public helpers (re-exported by orchestrate.js for tests).
// ---------------------------------------------------------------------------

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
  try {
    const patterns = await fetchFilePatterns(output, io);
    return patterns ? { patterns, outputType: output } : null;
  } catch {
    return null;
  }
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



// ---------------------------------------------------------------------------
// Stage synthesis (pure utility, used by setupWorkfile and exported publicly).
// ---------------------------------------------------------------------------

export function synthesizeStages({ cycleId, hasValidation, alwaysHumanAppraise, assay = false }) {
  const stages = [];
  if (assay) stages.push(`assay:${cycleId}`);
  stages.push(`forge:${cycleId}`);
  if (hasValidation) stages.push(`quench:${cycleId}`);
  stages.push(`appraise:${cycleId}`);
  if (alwaysHumanAppraise) stages.push(`human-appraise:${cycleId}`);
  return stages;
}

// ---------------------------------------------------------------------------
// Dispatch-multi action constants and validators.
// ---------------------------------------------------------------------------

export const DISPATCH_MULTI_ACTION = 'dispatch_multi';

/**
 * Validate a dispatch_multi action object.
 *
 * Checks action type, tasks array shape, and each task's required fields.
 * Returns undefined on success, a violation object on failure.
 */
function validString(value) {
  return typeof value === 'string' && value.length > 0;
}

function checkActionType(action) {
  if (!action || action.action !== DISPATCH_MULTI_ACTION) {
    return violation(`action must be "${DISPATCH_MULTI_ACTION}"`, []);
  }
  return undefined;
}

function validateAllTasks(tasks) {
  for (let i = 0; i < tasks.length; i++) {
    const err = checkDispatchTask(tasks[i], i);
    if (err) return err;
  }
  return undefined;
}

export function validateDispatchMulti(action) {
  const typeErr = checkActionType(action);
  if (typeErr) return typeErr;
  if (!Array.isArray(action.tasks)) {
    return violation('dispatch_multi tasks must be an array', []);
  }
  return validateAllTasks(action.tasks);
}

function checkDispatchTask(task, index) {
  if (!validString(task.subagent_type)) {
    return violation(`dispatch_multi tasks[${index}]: subagent_type must be a non-empty string`, []);
  }
  if (!validString(task.prompt)) {
    return violation(`dispatch_multi tasks[${index}]: prompt must be a non-empty string`, []);
  }
  return undefined;
}

/**
 * Build a dispatch_multi response object.
 *
 * Pure utility for constructing the action envelope expected by the
 * orchestrate skill's LLM loop.
 */
export function buildDispatchMultiResponse(tasks, stage, cycle) {
  return {
    action: DISPATCH_MULTI_ACTION,
    tasks,
    stage,
    cycle,
  };
}

// ---------------------------------------------------------------------------
// Dispatch prompt rendering (pure utility, used by handleSortResult and exported publicly).
// ---------------------------------------------------------------------------

function buildForgePromptLines({ cycle, outputType }) {
  return [
    ``,
    `Before producing output you MUST call these tools to understand the context:`,
    outputType
      ? `  - foundry_config_cycle({ cycleId: "${cycle}" }) — to learn the cycle definition, including its output type "${outputType}"`
      : `  - foundry_config_cycle({ cycleId: "${cycle}" }) — to learn the cycle definition`,
    outputType
      ? `  - foundry_config_artefact_type({ typeId: "${outputType}" }) — to learn the artefact type definition and file patterns`
      : `  - foundry_config_artefact_type({ typeId: "<output type>" }) — to learn the artefact type definition and file patterns`,
    outputType
      ? `  - foundry_config_laws({ typeId: "${outputType}" }) — to learn all applicable quality laws`
      : `  - foundry_config_laws({ typeId: "<output type>" }) — to learn all applicable quality laws`,
    `  - foundry_workfile_get({}) — to learn the goal`,
    `  - foundry_feedback_list({}) — to check for existing feedback from prior iterations`,
  ];
}

export function renderDispatchPrompt({ stage, cycle, token, cwd, filePatterns, outputType }) {
  const base = stage.split(':')[0];
  const lines = [
    `You are a Foundry stage agent. Invoke the ${base} skill and follow its instructions exactly.`,
    ``,
    `Stage: ${stage}`,
    `Cycle: ${cycle}`,
    `Token: ${token}`,
    `Working directory: ${cwd}`,
  ];
  if (filePatterns && filePatterns.length) {
    lines.push(`File patterns (forge only): ${JSON.stringify(filePatterns)}`);
  }
  if (base === 'forge') {
    lines.push(...buildForgePromptLines({ cycle, outputType }));
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

export function checkIterationLimits(cfm, cycleId) {
  const maxIt = cfm['max-iterations'];
  const dlIt = cfm['deadlock-iterations'];
  if (maxIt !== undefined && dlIt !== undefined && dlIt > maxIt) {
    return violation(
      `cycle ${cycleId}: deadlock-iterations (${dlIt}) cannot exceed max-iterations (${maxIt})`,
      ['WORK.md'],
    );
  }
  return null;
}
