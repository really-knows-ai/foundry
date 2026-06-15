/**
 * Appraise-address sub-stage executor.
 *
 * Processes addressed feedback items (actioned/wont-fix) through appraiser
 * evaluation, collects verdicts, applies consensus configuration, and
 * transitions items to resolved (terminal) or rejected (back to forge).
 *
 * Called by executeAppraise when addressed feedback items exist for the
 * current cycle.
 */

import { collectAddressedItems, computeConsensus, readConsensusConfig } from './lib/appraise-consensus.js';
import { openFeedbackStore } from './lib/feedback-store.js';
import { validateAppraiseAddressVerdict } from './lib/stage-output-schemas.js';
import { cleanStageOutputDir } from './run-appraise.js';

// ---------------------------------------------------------------------------
// Prompt building
// ---------------------------------------------------------------------------

/**
 * Build the appraise-address prompt content for an addressed feedback item.
 *
 * @param {object} item - Addressed feedback item
 * @param {string} appraiserId - Appraiser identifier
 * @param {string} personality - Appraiser personality description
 * @returns {string} Prompt content
 */
export function buildAddressPrompt(item, appraiserId, personality) {
  const state = item.history[0].state;
  const reason = item.history[0].reason || 'No reason provided';
  const statusLine = state === 'wont-fix'
    ? '  Forge status: wont-fix\n  Forge reason: ' + reason
    : '  Forge status: actioned';

  return [
    'You are an appraiser. Your personality: ' + personality,
    '',
    'A feedback item was addressed by the forge. Assess whether the fix is satisfactory.',
    '',
    'Feedback item:',
    '  Source: ' + item.source,
    '  File: ' + item.file,
    '  Issue: ' + item.text,
    statusLine,
    '',
    'Call foundry_stage_output with one of:',
    '  - { action: "resolve" } — the fix is satisfactory',
    '  - { action: "reject", feedback: "<explanation>" } — the fix is not satisfactory',
    '',
    'Then call foundry_stage_end().',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Verdict collection
// ---------------------------------------------------------------------------

/**
 * Try to parse a single JSON line and validate it as an appraise-address verdict.
 * Returns the parsed verdict object, or null when parsing or validation fails.
 */
function tryParseVerdictLine(line) {
  let parsed;
  try { parsed = JSON.parse(line); } catch { return null; }
  const validation = validateAppraiseAddressVerdict(parsed);
  return validation.ok ? parsed : null;
}

/**
 * Read a single stage-output file and extract valid verdict lines.
 */
function collectVerdictsFromFile(fp, io) {
  let content;
  try { content = io.readFile(fp); } catch { return []; }
  return content.trim().split('\n')
    .filter(Boolean)
    .map(function(line) { return tryParseVerdictLine(line); })
    .filter(Boolean);
}

/**
 * Read stage-output files and extract appraise-address verdicts.
 *
 * Each JSON line in the output files is validated against the
 * appraise-address verdict schema. Valid verdicts are collected;
 * invalid lines are skipped.
 *
 * @param {object} io
 * @returns {object[]} Array of validated verdict objects
 */
export function collectVerdicts(io) {
  const outDir = '.foundry/stage-outputs/';
  if (!io.exists(outDir)) return [];

  return io.readDir(outDir)
    .filter(function(f) { return f.endsWith('.jsonl'); })
    .map(function(f) { return outDir + f; })
    .flatMap(function(fp) { return collectVerdictsFromFile(fp, io); });
}

/**
 * Map verdict action values to feedback state values.
 */
function verdictActionToState(action) {
  return action === 'resolve' ? 'resolved' : 'rejected';
}

// ---------------------------------------------------------------------------
// Core processing
// ---------------------------------------------------------------------------

/**
 * Process a single addressed feedback item through appraiser verdicts and
 * consensus, then transition the item.
 *
 * @param {object} item - The addressed feedback item
 * @param {object} store - Feedback store instance
 * @param {string} cycleId - Current cycle identifier
 * @param {'unanimous'|'majority'|'any'} mode - Consensus mode
 * @param {Function} collectVerdictsFn - Function that returns appraiser verdicts
 * @returns {{ ok: boolean, error?: string }}
 */
export function processAddressedItem(item, store, cycleId, mode, collectVerdictsFn) {
  const rawVerdicts = collectVerdictsFn();

  const verdicts = rawVerdicts.map(v => ({
    appraiser: v.appraiser || 'unknown',
    verdict: verdictActionToState(v.action),
  }));

  const consensus = computeConsensus(verdicts, mode);
  const target = consensus.outcome;
  const stage = 'appraise:' + cycleId;

  const rejectFeedback = rawVerdicts
    .filter(v => v.action === 'reject' && v.feedback)
    .map(v => v.feedback);

  const reason = target === 'rejected' && rejectFeedback.length > 0
    ? rejectFeedback.join('; ')
    : undefined;

  const transitionResult = store.transition({
    id: item.id,
    target,
    stage,
    cycle: cycleId,
    reason,
  });

  if (!transitionResult.ok) {
    return { ok: false, error: transitionResult.error };
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Sub-stage executor
// ---------------------------------------------------------------------------

/**
 * Dispatch a single addressed item to appraisers, collecting errors.
 * Returns true when the item should continue processing; false when skipped.
 */
async function dispatchToAppraisers(item, dispatchFn, errors) {
  if (!dispatchFn) return true;
  try {
    await dispatchFn(item);
    return true;
  } catch (err) {
    errors.push('dispatch failed for item ' + item.id + ': ' + err.message);
    return false;
  }
}

/**
 * Resolve the collect-verdicts function, using the injected one if provided,
 * otherwise creating a default that reads from stage-output files via io.
 */
function resolveCollectVerdictsFn(opts) {
  if (opts.collectVerdictsFn) return opts.collectVerdictsFn;
  return function() { return collectVerdicts(opts.io); };
}

/**
 * Process a single item within executeAppraiseAddress.
 * Uses an options bag to stay within the max-params limit.
 */
async function processItemInLoop(ctx) {
  cleanStageOutputDir(ctx.io);
  const shouldProcess = await dispatchToAppraisers(ctx.item, ctx.dispatchFn, ctx.errors);
  if (!shouldProcess) return;

  const result = processAddressedItem(ctx.item, ctx.store, ctx.cycleId, ctx.mode, ctx.collectVerdictsFn);
  if (!result.ok) {
    ctx.errors.push(result.error);
  }
}

/**
 * Execute the appraise-address sub-stage.
 *
 * 1. Collect addressed feedback items from the store
 * 2. If none, return immediately with processed: 0
 * 3. Read consensus mode from cycle definition
 * 4. For each addressed item, process it through the consensus pipeline
 *
 * @param {object} opts
 * @param {object} opts.store - Feedback store instance (openFeedbackStore)
 * @param {string} opts.cycleId - Current cycle identifier
 * @param {string} opts.foundryDir - Foundry directory path
 * @param {object} opts.io - IO adapter
 * @param {Function} [opts.collectVerdictsFn] - Injectible verdict collector
 *   Defaults to collectVerdicts bound to opts.io
 * @param {Function} [opts.dispatchFn] - Injectible dispatch function
 *   Called for each item before collecting verdicts
 * @returns {Promise<{ok: boolean, processed: number, errors?: string[]}>}
 */
export async function executeAppraiseAddress(opts) {
  const store = opts.store;
  const cycleId = opts.cycleId;

  const addressedItems = collectAddressedItems(store, cycleId);
  if (addressedItems.length === 0) {
    return { ok: true, processed: 0 };
  }

  const mode = await readConsensusConfig(opts.foundryDir, cycleId, opts.io);
  const collectVerdictsFn = resolveCollectVerdictsFn(opts);
  const dispatchFn = opts.dispatchFn || null;
  const errors = [];

  for (let i = 0; i < addressedItems.length; i++) {
    await processItemInLoop({
      item: addressedItems[i],
      store: store,
      cycleId: cycleId,
      mode: mode,
      io: opts.io,
      collectVerdictsFn: collectVerdictsFn,
      dispatchFn: dispatchFn,
      errors: errors,
    });
  }

  return {
    ok: errors.length === 0,
    processed: addressedItems.length,
    errors: errors.length > 0 ? errors : undefined,
  };
}

/**
 * Detect addressed feedback items for the cycle and run the
 * appraise-address sub-stage. Returns null when no addressed items
 * exist, allowing the caller to proceed with standard appraise.
 *
 * @param {object} opts - executeAppraise options (for feedbackPath, etc.)
 * @param {object} io - IO adapter
 * @param {string} feedbackPath - Path to WORK.feedback.yaml
 * @param {string} cycleId - Current cycle identifier
 * @returns {Promise<object|null>} executeAppraiseAddress result, or null
 */
export async function tryAppraiseAddress(opts, io, feedbackPath, cycleId, dispatchFn) {
  const store = openFeedbackStore(feedbackPath, io);
  const addressedItems = collectAddressedItems(store, cycleId);
  if (addressedItems.length === 0) return null;

  return await executeAppraiseAddress({
    store: store,
    cycleId: cycleId,
    foundryDir: 'foundry',
    io: io,
    dispatchFn: dispatchFn,
  });
}

/**
 * Build a dispatch function for addressed feedback items.
 * Returns null when no appraisers are available.
 *
 * @param {object[]} appraisers - List of appraiser objects
 * @param {{
 *   writePromptFile: Function,
 *   spawnDispatch: Function,
 *   awaitProcess: Function,
 *   withCleanup: Function,
 *   createDispatchLog?: Function,
 * }} dh
 * @param {object} io - IO adapter
 * @param {string} worktree - Worktree path
 * @returns {Function|null}
 */
export function buildAddressDispatchFn(appraisers, dispatchHelpers, io, worktree) {
  if (appraisers.length === 0) return null;
  const { writePromptFile, spawnDispatch, awaitProcess, withCleanup, createDispatchLog } = dispatchHelpers;

  return async function(item) {
    for (const appraiser of appraisers) {
      const personality = appraiser.personality || 'You are a helpful code reviewer.';
      const prompt = buildAddressPrompt(item, appraiser.id, personality);
      await withCleanup(io, async (paths) => {
        const promptPath = writePromptFile(io, prompt);
        paths.push(promptPath);
        const child = spawnDispatch(worktree, promptPath, 'foundry-appraise');
        const dispatchLog = createDispatchLog
          ? createDispatchLog(io, { ...child.foundryDispatch, stage: 'appraise-address', appraiser: appraiser.id })
          : null;
        await awaitProcess(child, 300_000, dispatchLog);
      });
    }
  };
}
