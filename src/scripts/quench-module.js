/**
 * Quench module — deterministic validation run entirely within the orchestrator.
 *
 * The module discovers artefact changes via branch-based artefact discovery,
 * runs validators for each artefact change, posts feedback for each validation
 * item, resolves prior quench feedback, and finalises the stage. No LLM
 * involvement.
 */

import { readActiveStage } from './lib/state.js';
import { getArtefactFiles, computeArtefactVersion } from './lib/artefacts.js';
import { getCycleDefinition } from './lib/config.js';
import { performValidation } from './lib/validation.js';
import { openFeedbackStore } from './lib/feedback-store.js';
import { hashText } from './lib/feedback-transitions.js';

/**
 * Resolve stale feedback items whose artefact version does not match the
 * current on-disk version. Items from this stage's source base with a
 * mismatched artefact_version are auto-resolved as superseded.
 *
 * @param {object[]} items - Feedback items to check
 * @param {string} currentVersion - Current on-disk artefact version
 * @param {string} stageBase - Stage base name (e.g. 'quench') to filter by source
 * @param {object} store - Feedback store instance with autoResolve method
 * @param {string} cycle - Current cycle identifier
 */
export async function resolveStaleFeedback(items, currentVersion, stageBase, store, cycle) {
  for (const item of items) {
    if (shouldSkipStaleResolve(item, currentVersion, stageBase)) continue;
    const reason = `superseded by forge revision ${currentVersion}`;
    store.autoResolve({ id: item.id, reason, cycle });
  }
}

function shouldSkipStaleResolve(item, currentVersion, stageBase) {
  if (item.history[0].state === 'resolved') return true;
  const itemBase = typeof item.source === 'string' ? item.source.split(':')[0] : '';
  if (itemBase !== stageBase) return true;
  if (item.artefact_version === currentVersion) return true;
  return false;
}

/**
 * Resolve stale quench-sourced feedback using the given store.
 * Errors are silently caught — stale resolution is best-effort.
 *
 * @param {object} ctx - Orchestration context
 * @param {string|undefined} currentVersion - Current artefact version, or undefined
 * @param {object} store - Feedback store instance
 */
async function resolveStaleQuenchFeedback(ctx, currentVersion, store) {
  try {
    if (currentVersion === undefined || currentVersion === null) return;
    await resolveStaleFeedback(store.list(), currentVersion, 'quench', store, ctx.cycleId);
  } catch {
    // Graceful degrade — stale resolution is best-effort.
    // The orchestrator handles IO failures at the cycle level.
  }
}

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

  const cycleDef = await getCycleDefinition(ctx.foundryDir, ctx.cycleId, ctx.io);
  const outputType = cycleDef.frontmatter['output-type'];
  if (!outputType) {
    return { ok: false, error: `Cycle ${ctx.cycleId} has no output-type` };
  }

  return await runQuenchWithStale(ctx, activeStageRecord, outputType);
}

async function runQuenchWithStale(ctx, activeStageRecord, outputType) {
  const artefactVersion = await computeArtefactVersion(
    ctx.foundryDir, outputType, ctx.io, ctx.cwd,
  ).catch(() => undefined);
  const discovery = await discoverArtefacts(ctx, outputType);
  if (!discovery.ok) return discovery;
  if (discovery.artefacts.length === 0) {
    return await handleNoArtefacts(ctx, activeStageRecord);
  }
  return await processArtefacts(ctx, discovery.artefacts, activeStageRecord, outputType, artefactVersion);
}

async function discoverArtefacts(ctx, outputType) {
  try {
    const artefacts = await getArtefactFiles(ctx.foundryDir, outputType, ctx.io, { baseBranch: ctx.baseBranch ?? 'main' });
    return { ok: true, artefacts };
  } catch (err) {
    return { ok: false, error: `Failed to discover artefacts: ${err.message}` };
  }
}

/**
 * Handle the case where no artefacts exist for this cycle.
 */
async function handleNoArtefacts(ctx, activeStageRecord) {
  const summary = 'SKIP: no files';
  await ctx.finalize({
    lastStage: { stage: ctx.stageId, summary, baseSha: activeStageRecord.baseSha },
    activeStage: activeStageRecord,
  });
  return { ok: true, summary };
}

/**
 * Process each artefact: run validation, post feedback, handle errors.
 */
async function processArtefacts(ctx, artefacts, activeStageRecord, outputType, artefactVersion) {
  const perArtefact = [];
  const currentFeedback = [];
  let allOk = true;
  ctx.store = openFeedbackStore('WORK.feedback.yaml', ctx.io);
  await resolveStaleQuenchFeedback(ctx, artefactVersion, ctx.store);

  for (const artefact of artefacts) {
    const result = await performValidation({
      typeId: outputType,
      io: ctx.io,
      foundryDir: ctx.foundryDir,
      artefacts: [artefact],
    });

    const outcome = handleArtefactResult(ctx, artefact, result, currentFeedback, artefactVersion);
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
function handleArtefactResult(ctx, artefact, result, currentFeedback, artefactVersion) {
  if (isNoValidators(result)) {
    return { ok: true, text: `${artefact.file}: OK: no validators` };
  }

  if (result.error) {
    return { ok: false, text: `${artefact.file}: ${result.error}` };
  }

  if (isAllErrors(result)) {
    const messages = result.errors.map(e => e.message).join('; ');
    return { ok: false, text: `${artefact.file}: ${messages}` };
  }

  postFeedbackItems(ctx, artefact, result, currentFeedback, artefactVersion);
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
 * True when the candidate feedback item is a duplicate of an existing item
 * that has already been addressed in the current or prior cycle iteration.
 *
 * actioned and wont-fix items are always treated as duplicates. resolved
 * items are duplicates only when their artefact version matches the current
 * version — a resolved item from a prior version should generate fresh
 * feedback.
 *
 * NOTE: Uses `history[0]` as the most recent state. The feedback store
 * must prepend new entries (not append) so that index 0 always holds the
 * latest state. If the store implementation changes to append, this check
 * and all consumers of `history[0]` will break.
 */
function isDuplicateFeedback(existing, artefactVersion) {
  const state = existing.history[0].state;
  if (state === 'actioned' || state === 'wont-fix') return true;
  if (state === 'resolved' && existing.artefact_version === artefactVersion) return true;
  return false;
}

/**
 * Post feedback items for validation results and track for resolution.
 *
 * Skips items whose file:tag:text already exists in actioned, wont-fix,
 * or resolved state (with matching artefact version). This covers both
 * the direct case (items the user has actioned or wont-fixed) and the
 * stale-resolution case where items were advanced to resolved before
 * validation runs. Prevents the quench → forge feedback accumulation
 * loop when validators produce the same message across forge revisions.
 */
function postFeedbackItems(ctx, artefact, result, currentFeedback, artefactVersion) {
  const store = ctx.store;
  const allItems = store.list();

  for (const item of result.items) {
    const tag = `law:${item.lawId}:${item.validatorId}`;
    const textHash = hashText(item.text);

    const existing = allItems.find(it =>
      it.file === artefact.file &&
      it.tag === tag &&
      hashText(it.text) === textHash &&
      isDuplicateFeedback(it, artefactVersion)
    );

    if (existing) {
      currentFeedback.push({ file: artefact.file, tag });
      continue;
    }

    ctx.feedback.add({ file: artefact.file, text: item.text, tag, artefact_version: artefactVersion });
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
