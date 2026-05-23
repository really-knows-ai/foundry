/**
 * Sort routing helpers — pure functions that decide the next stage given
 * the current stage list, history, feedback, and iteration counters.
 *
 * Extracted from `src/scripts/sort.js` to keep that file under the
 * configured `max-lines` limit and to lower per-function complexity.
 */

// Spec §6.1: an item is "open" (still in flight) when its head state is
// 'open', 'actioned', 'rejected', or 'wont-fix' — equivalently, when the
// state is neither 'resolved' nor 'deadlocked'.
const isOpenItem = (f) => f.state !== 'resolved' && f.state !== 'deadlocked';

export { isOpenItem };

export function baseStage(stage) {
  return stage.split(':')[0];
}

export function findFirst(stages, base) {
  for (const s of stages) {
    if (baseStage(s) === base) return s;
  }
  return null;
}

export function nextInRoute(stages, current) {
  const idx = stages.indexOf(current);
  if (idx !== -1 && idx + 1 < stages.length) {
    return stages[idx + 1];
  }
  return null;
}

function hasItemsNeedingForge(openItems) {
  return openItems.some(f => f.state === 'open' || f.state === 'rejected');
}

function hasItemsPendingApproval(openItems) {
  return openItems.some(f => f.state === 'actioned' || f.state === 'wont-fix');
}

function routeForgeIfNeeded(stages, forgeCount, maxIterations) {
  if (forgeCount >= maxIterations) return 'blocked';
  return findFirst(stages, 'forge') ?? 'blocked';
}

function appraiseForgeOrApproval(stages, openItems, forgeCount, maxIterations) {
  if (hasItemsNeedingForge(openItems)) {
    return routeForgeIfNeeded(stages, forgeCount, maxIterations);
  }
  if (hasItemsPendingApproval(openItems)) {
    return findFirst(stages, 'appraise') ?? 'blocked';
  }
  return null;
}

export function nextAfterAppraise({ stages, current, feedback, forgeCount, maxIterations }) {
  // Note: deadlock detection is handled by runDeadlockPass at the top of
  // runSort (spec §6.1). This helper assumes routing has already been allowed
  // to fall through (i.e., no item qualifies as deadlocked).
  const openItems = feedback.filter(isOpenItem);
  const decided = appraiseForgeOrApproval(stages, openItems, forgeCount, maxIterations);
  if (decided !== null) return decided;
  return nextInRoute(stages, current) ?? 'done';
}

export function nextAfterQuench(stages, current, feedback, forgeCount, maxIterations) {
  const openItems = feedback.filter(isOpenItem);
  const needsForge = openItems.some(f => f.state === 'open' || f.state === 'rejected');
  if (needsForge) return routeForgeIfNeeded(stages, forgeCount, maxIterations);
  return nextInRoute(stages, current) ?? 'done';
}

function lastNonSortStage(history) {
  const nonSort = history.filter(e => baseStage(e.stage || '') !== 'sort');
  if (nonSort.length === 0) return null;
  return nonSort[nonSort.length - 1].stage;
}

function buildRouteHandlers({ stages, lastEntry, feedback, forgeCount, maxIterations }) {
  const appraiseRoute = () => nextAfterAppraise({
    stages, current: lastEntry, feedback, forgeCount, maxIterations,
  });
  return {
    'assay': () => findFirst(stages, 'forge') ?? 'blocked',
    'forge': () => nextInRoute(stages, lastEntry) ?? 'done',
    'quench': () => nextAfterQuench(stages, lastEntry, feedback, forgeCount, maxIterations),
    'appraise': appraiseRoute,
    'human-appraise': appraiseRoute,
  };
}

export function determineRoute(stages, history, feedback, maxIterations) {
  const forgeCount = history.filter(e => baseStage(e.stage || '') === 'forge').length;
  const lastEntry = lastNonSortStage(history);
  if (lastEntry === null) return stages[0];
  const handlers = buildRouteHandlers({
    stages, lastEntry, feedback, forgeCount, maxIterations,
  });
  const handler = handlers[baseStage(lastEntry)];
  return handler ? handler() : 'blocked';
}
