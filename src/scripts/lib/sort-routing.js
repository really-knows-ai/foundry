/**
 * Sort routing helpers — pure functions that decide the next stage given
 * the current stage list, history, feedback, and iteration counters.
 *
 * Extracted from `src/scripts/sort.js` to keep that file under the
 * configured `max-lines` limit and to lower per-function complexity.
 */

// An item is "open" (still in flight) when its head state is not
// 'resolved' or 'deadlocked'. The deadlocked check is retained for
// backward compatibility with existing feedback files.
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

function firstForgeOrBlocked(stages) {
  const stage = findFirst(stages, 'forge');
  return stage !== null ? stage : 'blocked';
}

function nextRouteOrDone(stages, current) {
  const nextStage = nextInRoute(stages, current);
  return nextStage !== null ? nextStage : 'done';
}

function firstHumanOrSuffixed(stages, cycle) {
  const stage = findFirst(stages, 'human-appraise');
  return stage !== null ? stage : `human-appraise:${cycle}`;
}

function isBelowIterationCap(forgeCount, maxIterations, alwaysHumanAppraise) {
  return alwaysHumanAppraise || forgeCount < maxIterations;
}

function callHandlerOrBlocked(handler) {
  return handler ? handler() : 'blocked';
}

function routeForgeIfNeeded(stages, forgeCount, maxIterations, opts = {}) {
  const { alwaysHumanAppraise, deadlockHumanAppraise, cycle } = opts;
  if (isBelowIterationCap(forgeCount, maxIterations, alwaysHumanAppraise)) {
    return firstForgeOrBlocked(stages);
  }
  if (!deadlockHumanAppraise) return 'blocked';
  if (!findFirst(stages, 'human-appraise')) return 'blocked';
  return `human-appraise:${cycle}`;
}

function appraiseForgeOrApproval(stages, openItems, forgeCount, maxIterations, opts = {}) {
  if (hasItemsNeedingForge(openItems)) {
    return routeForgeIfNeeded(stages, forgeCount, maxIterations, opts);
  }
  if (hasItemsPendingApproval(openItems)) {
    const stage = findFirst(stages, 'appraise');
    return stage !== null ? stage : 'blocked';
  }
  return null;
}

function routeAlwaysHumanAppraise(stages, current, openItems, cycle) {
  if (openItems.length > 0) {
    return firstHumanOrSuffixed(stages, cycle);
  }
  return nextRouteOrDone(stages, current);
}

function decideAppraiseRoute(opts) {
  const {
    stages, current, openItems, forgeCount, maxIterations,
    alwaysHumanAppraise, deadlockHumanAppraise, cycle,
  } = opts;
  const decided = appraiseForgeOrApproval(
    stages, openItems, forgeCount, maxIterations,
    { alwaysHumanAppraise, deadlockHumanAppraise, cycle },
  );
  if (decided !== null) return decided;
  return nextRouteOrDone(stages, current);
}

export function nextAfterAppraise({
  stages, current, feedback, forgeCount, maxIterations,
  alwaysHumanAppraise = false, deadlockHumanAppraise = false, cycle = 'default',
}) {
  const openItems = feedback.filter(isOpenItem);
  if (alwaysHumanAppraise) {
    return routeAlwaysHumanAppraise(stages, current, openItems, cycle);
  }
  return decideAppraiseRoute({
    stages, current, openItems, forgeCount, maxIterations,
    alwaysHumanAppraise, deadlockHumanAppraise, cycle,
  });
}

export function nextAfterQuench(stages, current, feedback, opts = {}) {
  const { forgeCount = 0, maxIterations = 100 } = opts;
  const openItems = feedback.filter(isOpenItem);
  const needsForge = hasItemsNeedingForge(openItems);
  if (needsForge) return routeForgeIfNeeded(stages, forgeCount, maxIterations, opts);
  return nextRouteOrDone(stages, current);
}

function lastNonSortStage(history) {
  const nonSort = history.filter(e => baseStage(e.stage || '') !== 'sort');
  if (nonSort.length === 0) return null;
  return nonSort[nonSort.length - 1].stage;
}

function buildRouteHandlers({
  stages, lastEntry, feedback, forgeCount, maxIterations,
  alwaysHumanAppraise, deadlockHumanAppraise, cycle,
}) {
  const appraiseRoute = () => nextAfterAppraise({
    stages, current: lastEntry, feedback, forgeCount, maxIterations,
    alwaysHumanAppraise, deadlockHumanAppraise, cycle,
  });
  return {
    'assay': () => firstForgeOrBlocked(stages),
    'forge': () => nextRouteOrDone(stages, lastEntry),
    'quench': () => nextAfterQuench(
      stages, lastEntry, feedback,
      { forgeCount, maxIterations, alwaysHumanAppraise, deadlockHumanAppraise, cycle },
    ),
    'appraise': appraiseRoute,
    'human-appraise': appraiseRoute,
  };
}

function countForgeIterations(history) {
  return history.filter(e => baseStage(e.stage || '') === 'forge').length;
}

function routeFromLastEntry(opts) {
  const {
    stages, lastEntry, feedback, forgeCount, maxIterations,
    alwaysHumanAppraise, deadlockHumanAppraise, cycle,
  } = opts;
  if (lastEntry === null) return stages[0];
  const handlers = buildRouteHandlers({
    stages, lastEntry, feedback, forgeCount, maxIterations,
    alwaysHumanAppraise, deadlockHumanAppraise, cycle,
  });
  const handler = handlers[baseStage(lastEntry)];
  return callHandlerOrBlocked(handler);
}

export function determineRoute(stages, history, feedback, maxIterations, opts = {}) {
  const { alwaysHumanAppraise = false, deadlockHumanAppraise = false, cycle = 'default' } = opts;
  const forgeCount = countForgeIterations(history);
  const lastEntry = lastNonSortStage(history);
  return routeFromLastEntry({
    stages, lastEntry, feedback, forgeCount, maxIterations,
    alwaysHumanAppraise, deadlockHumanAppraise, cycle,
  });
}
