/**
 * Sort routing helpers — pure functions that decide the next stage given
 * the current stage list, history, feedback, and iteration counters.
 *
 * Replaced the handler-dispatch pattern with a state-driven decision tree
 * that routes based on feedback item state, history, and the stage list.
 */

export function baseStage(stage) {
  return stage.split(':')[0];
}

export function findFirst(stages, base) {
  for (const s of stages) {
    if (baseStage(s) === base) return s;
  }
  return null;
}

/**
 * Returns the next stage in `stages` after `current`, or null if at the end.
 */
export function nextStageInChain(stages, current) {
  const idx = stages.indexOf(current);
  if (idx !== -1 && idx + 1 < stages.length) {
    return stages[idx + 1];
  }
  return null;
}

/**
 * Returns the first stage in `stages` whose base matches `base`, with
 * a fallback for `human-appraise`. For `human-appraise`, if no exact
 * match is found, falls back to `human-appraise:<cycle>`.
 */
export function first(base, stages, cycle) {
  if (base === 'human-appraise') {
    const stage = findFirst(stages, 'human-appraise');
    return stage !== null ? stage : `human-appraise:${cycle}`;
  }
  return findFirst(stages, base);
}

/**
 * Returns the first stage in `stages` whose base appears after `base`
 * in the canonical chain order [forge, quench, appraise, human-appraise].
 * Returns null if base is not in the canonical order or no subsequent
 * stage is configured.
 */
export function firstAfter(stages, base) {
  const canon = ['forge', 'quench', 'appraise', 'human-appraise'];
  const baseIdx = canon.indexOf(base);
  if (baseIdx === -1) return null;
  for (let i = baseIdx + 1; i < canon.length; i++) {
    const found = findFirst(stages, canon[i]);
    if (found !== null) return found;
  }
  return null;
}

/**
 * Returns true when a stage with the given base exists in `stages`.
 */
export function hasStage(stages, base) {
  return findFirst(stages, base) !== null;
}

/**
 * Called after all unresolved and addressed items have been exhausted.
 * Finds the next stage after `lastStage` via `nextStageInChain`.
 * Returns 'done' if no next stage exists.
 * Returns 'done' if the next stage is human-appraise and
 * opts.alwaysHumanAppraise is false.
 * Otherwise returns the next stage.
 */
export function forwardClean(stages, lastStage, opts = {}) {
  const next = nextStageInChain(stages, lastStage);
  if (next === null) return 'done';
  if (baseStage(next) === 'human-appraise' && !opts.alwaysHumanAppraise) {
    return 'done';
  }
  return next;
}

// ---------------------------------------------------------------------------
// Helpers extracted to keep determineRoute within complexity limits
// ---------------------------------------------------------------------------

/**
 * Validates maxIterations, stages list, and history emptiness.
 * Returns a route value when the input is terminal, or null to continue.
 */
function isValidMaxIterations(maxIterations) {
  return typeof maxIterations === 'number' && Number.isInteger(maxIterations) && maxIterations >= 1;
}

function validateRoute(maxIterations, stages, history) {
  if (!isValidMaxIterations(maxIterations)) return 'blocked';
  if (!stages || stages.length === 0) return 'blocked';
  if (history.length === 0) return stages[0];
  return null;
}

/**
 * Extracts routing state from history and feedback: the last non-sort
 * stage entry (full alias), its base stage name, forge iteration count
 * per the first unresolved item, and categorised feedback items.
 *
 * The forge count tracks attempts against the current (first) unresolved
 * item only. Each feedback item carries its own `forge_count` (set by
 * `loadFeedback` in sort.js) that records how many forge runs it has
 * actually consumed. This satisfies SPEC R7: each item gets at most
 * `max-iterations` attempts before the cycle deadlocks.
 */
function computeRoutingState(history, feedback) {
  const nonSort = history.filter(e => baseStage(e.stage || '') !== 'sort');
  const lastEntry = nonSort.length > 0 ? nonSort[nonSort.length - 1].stage : null;
  const lastStage = lastEntry !== null ? baseStage(lastEntry) : null;
  const unresolvedItems = feedback.filter(f => f.state === 'open' || f.state === 'rejected');
  const addressedItems = feedback.filter(f => f.state === 'actioned' || f.state === 'wont-fix');
  // Per-item forge count: use the maximum forge_count across all unresolved
  // items. This ensures that if any item has exhausted its iteration budget,
  // the route blocks — no single item with remaining budget can mask an
  // item that has hit the cap.
  const forgeCount = unresolvedItems.length > 0
    ? Math.max(...unresolvedItems.map(i => i.forge_count || 0))
    : 0;
  return { lastEntry, lastStage, forgeCount, unresolvedItems, addressedItems };
}

/**
 * Checks whether the iteration cap has been reached.
 * When the cap is reached and not bypassed by alwaysHumanAppraise,
 * routes to human-appraise (if deadlockHumanAppraise) or 'blocked'.
 * Otherwise routes to forge via first('forge', stages).
 */
function routeToHumanOrBlock(firstFn, stages, opts) {
  if ((opts.deadlockHumanAppraise || opts.alwaysHumanAppraise) && hasStage(stages, 'human-appraise')) {
    return firstFn('human-appraise', stages, opts.cycle);
  }
  return 'blocked';
}

function checkIterationAndRoute(firstFn, stages, forgeCount, maxIterations, opts) {
  if (forgeCount >= maxIterations) {
    return routeToHumanOrBlock(firstFn, stages, opts);
  }
  if (!hasStage(stages, 'forge')) return 'blocked';
  return firstFn('forge', stages);
}

/**
 * Collects unique source bases from addressed items and finds the
 * earliest stage in the canonical chain that has a matching configured
 * stage. Returns the resolved stage alias when found, or null to
 * fall through to forwardClean.
 */
function routeAddressedItems(addressedItems, stages, opts) {
  const sourceBases = [...new Set(addressedItems.map(i => baseStage(i.source || '')))];
  const chain = ['quench', 'appraise', 'human-appraise'];
  for (const base of chain) {
    if (sourceBases.includes(base) && hasStage(stages, base)) {
      return first(base, stages, opts.cycle);
    }
  }
  return null;
}

/**
 * Routes addressed items to their earliest source stage, falling through
 * to forwardClean when no source matches or no addressed items exist.
 */
function routeAddressedOrForward(addressedItems, stages, lastEntry, opts) {
  const routed = routeAddressedItems(addressedItems, stages, opts);
  if (routed !== null) return routed;
  return forwardClean(stages, lastEntry, opts);
}

/**
 * Handles the R7 case when the last non-sort history entry is forge.
 * If unresolved items exist, delegates to checkIterationAndRoute.
 * If clean, routes via firstAfter to the first evaluation stage,
 * or 'done' if no stage follows forge.
 */
function handleForgeJustRan(stages, unresolvedItems, forgeCount, maxIterations, opts) {
  if (unresolvedItems.length > 0) {
    return checkIterationAndRoute(first, stages, forgeCount, maxIterations, opts);
  }
  const next = firstAfter(stages, 'forge');
  return next !== null ? next : 'done';
}

/**
 * Handles R1 (unresolved, addressed) and R2 (forward) routing paths.
 * Extracted to keep determineRoute within the complexity limit.
 */
function routeFeedbackState(state, stages, maxIterations, opts) {
  if (state.unresolvedItems.length > 0) {
    return checkIterationAndRoute(first, stages, state.forgeCount, maxIterations, opts);
  }
  if (state.addressedItems.length > 0) {
    return routeAddressedOrForward(state.addressedItems, stages, state.lastEntry, opts);
  }
  return forwardClean(stages, state.lastEntry, opts);
}

// ---------------------------------------------------------------------------
// determineRoute — state-driven decision tree
// ---------------------------------------------------------------------------

/**
 * Determines the next route given the current cycle state.
 *
 * The decision tree reads feedback item state, history, and the stage
 * list to route to forge, an evaluation stage, human-appraise, 'done',
 * or 'blocked'. It never calls computeArtefactVersion and does not
 * read item.artefact_version.
 *
 * @param {string[]} stages - Configured stage aliases in chain order
 * @param {object[]} history - Cycle history entries
 * @param {object[]} feedback - Feedback items with state, source, etc.
 * @param {number} maxIterations - Maximum forge iterations
 * @param {object} [opts] - Options object
 * @param {boolean} [opts.alwaysHumanAppraise=false]
 * @param {boolean} [opts.deadlockHumanAppraise=false]
 * @param {string} [opts.cycle='default']
 * @returns {string} Next route: stage alias, 'done', or 'blocked'
 */
export function determineRoute(stages, history, feedback, maxIterations, opts = {}) {
  const validation = validateRoute(maxIterations, stages, history);
  if (validation !== null) return validation;

  const state = computeRoutingState(history, feedback);

  if (state.lastStage === null) return stages[0];
  if (state.lastStage === 'forge') return handleForgeJustRan(stages, state.unresolvedItems, state.forgeCount, maxIterations, opts);

  return routeFeedbackState(state, stages, maxIterations, opts);
}
