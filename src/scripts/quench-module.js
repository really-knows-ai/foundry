/**
 * Quench module — deterministic validation run entirely within the orchestrator.
 *
 * The module runs validators for each draft artefact in the current cycle,
 * posts feedback for each validation item, resolves prior quench feedback,
 * and finalises the stage. No LLM involvement.
 */

import { readActiveStage } from './lib/state.js';
import { getArtefactsForCycle, setArtefactStatus } from './lib/artefacts.js';
import { performValidation } from './lib/validation.js';

/**
 * Run quench (deterministic validation) for a cycle.
 *
 * @param {object} ctx - Context object with io, feedback, finalize, etc.
 * @returns {Promise<{ok: boolean, summary?: string, error?: string}>}
 */
export async function runQuench(ctx) {
  const activeStageRecord = readActiveStage(ctx.io);
  if (!activeStageRecord) {
    return { ok: false, error: 'No active stage found' };
  }

  const artefacts = getArtefactsForCycle(ctx.cycleId, ctx.io);

  if (artefacts.length === 0) {
    return await handleNoArtefacts(ctx, activeStageRecord);
  }

  return await processArtefacts(ctx, artefacts, activeStageRecord);
}

/**
 * Handle the case where no artefacts exist for this cycle.
 */
async function handleNoArtefacts(ctx, activeStageRecord) {
  const summary = 'SKIP: no artefacts';
  await ctx.finalize({
    lastStage: { stage: ctx.stageId, summary, baseSha: activeStageRecord.baseSha },
    activeStage: activeStageRecord,
  });
  return { ok: true, summary };
}

/**
 * Process each artefact: run validation, post feedback, handle errors.
 */
async function processArtefacts(ctx, artefacts, activeStageRecord) {
  const perArtefact = [];
  const currentFeedback = [];
  let allOk = true;

  for (const artefact of artefacts) {
    const result = await performValidation({
      typeId: artefact.type,
      io: ctx.io,
      foundryDir: ctx.foundryDir,
    });

    const outcome = handleArtefactResult(ctx, artefact, result, currentFeedback);
    perArtefact.push(outcome.text);
    if (!outcome.ok) allOk = false;
  }

  const summary = perArtefact.join('; ');
  resolvePriorFeedback(ctx, currentFeedback);

  await ctx.finalize({
    lastStage: { stage: ctx.stageId, summary, baseSha: activeStageRecord.baseSha },
    activeStage: activeStageRecord,
  });

  if (!allOk) {
    return { ok: false, summary, error: 'One or more artefacts failed validation' };
  }
  return { ok: true, summary };
}

/**
 * Handle validation result for a single artefact.
 *
 * Returns { ok, text } where `ok` indicates whether the artefact passed
 * validation and `text` is the per-artefact summary line.
 */
function handleArtefactResult(ctx, artefact, result, currentFeedback) {
  if (isNoValidators(result)) {
    return { ok: true, text: `${artefact.file}: OK: no validators` };
  }

  if (result.error) {
    markArtefactBlocked(ctx.io, artefact.file);
    return { ok: false, text: `${artefact.file}: ${result.error}` };
  }

  if (isAllErrors(result)) {
    markArtefactBlocked(ctx.io, artefact.file);
    const messages = result.errors.map(e => e.message).join('; ');
    return { ok: false, text: `${artefact.file}: ${messages}` };
  }

  postFeedbackItems(ctx, artefact, result, currentFeedback);
  return { ok: true, text: `${artefact.file}: ${result.items.length} issues found` };
}

/**
 * True when no validators are configured for this artefact type.
 */
function isNoValidators(result) {
  return result.ok && result.validatorsRun === 0 && result.items.length === 0 && result.errors.length === 0;
}

/**
 * True when validators ran but produced only errors with no valid items.
 */
function isAllErrors(result) {
  return result.items.length === 0 && result.errors.length > 0;
}

/**
 * Post feedback items for validation results and track for resolution.
 */
function postFeedbackItems(ctx, artefact, result, currentFeedback) {
  for (const item of result.items) {
    const tag = `law:${item.lawId}:${item.validatorId}`;
    ctx.feedback.add({ file: artefact.file, text: item.text, tag });
    currentFeedback.push({ file: artefact.file, tag });
  }
}

/**
 * Resolve prior quench feedback items against current results.
 */
function resolvePriorFeedback(ctx, currentFeedback) {
  const currentSigs = new Set(currentFeedback.map(fb => `${fb.file}:${fb.tag}`));
  const priorItems = ctx.feedback.list({ source: ctx.stageId });

  for (const prior of priorItems) {
    if (prior.state === 'resolved') continue;
    const sig = `${prior.file}:${prior.tag}`;
    const decision = currentSigs.has(sig) ? 'rejected' : 'approved';
    ctx.feedback.resolve(prior.id, decision);
  }
}

/**
 * Mark an artefact as blocked in the artefacts table.
 */
function markArtefactBlocked(io, file) {
  const workText = io.readFile('WORK.md');
  const updated = setArtefactStatus(workText, file, 'blocked');
  io.writeFile('WORK.md', updated);
}
