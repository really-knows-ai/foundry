/**
 * Deterministic run state machine.
 *
 * Used by both `foundry_run` and `foundry_continue`. Reads filesystem state
 * (WORK.md, WORK.history.yaml, WORK.feedback.yaml, .foundry/), iterates
 * through stages via `runSort`, and dispatches each stage.
 *
 * Exports: runRun, continueRun, executeForge, executeQuench, executeAssay, executeAppraise
 */

import { runSort as defaultRunSort } from './sort.js';
import { markWorkfileFailed, readFailedStatus } from './lib/failed-flow.js';
import { parseFrontmatter, setFrontmatterField } from './lib/workfile.js';
import { tryCommit, readCycleTargets, synthesizeStages } from './orchestrate-cycle.js';
import { appendEntry } from './lib/history.js';
import { executeForge, executeQuench, executeAssay, executeAppraise } from './run-executors.js';
import { readActiveStage } from './lib/state.js';
import { stageBaseOf } from './lib/stage-guard.js';
import { handleHumanAppraiseInit, handleHumanAppraiseResume } from './run-human-appraise.js';

function guardNotFailed(io) {
  if (!io.exists('WORK.md')) return null;
  const fm = parseFrontmatter(io.readFile('WORK.md'));
  if (fm.status !== 'failed') return null;
  return { action: 'violation', details: 'runRun: flow is in failed state', recoverable: false };
}

function terminalDone(fm) {
  return { action: 'done', flow: fm.flow || '', artefact: fm['artefact-path'] || fm.artefact || '' };
}

function terminalBlocked(details) {
  return { action: 'violation', details: details || 'runRun: run is blocked', recoverable: false };
}

function terminalViolation(details, recoverable) {
  return { action: 'violation', details: details || 'unknown error', recoverable: !!recoverable };
}

function routeBaseOf(route) {
  return typeof route === 'string' ? route.split(':')[0] : '';
}

function tryCommitStage(git, message) {
  if (!git || typeof git.commit !== 'function') return null;
  return tryCommit(git, message, [], 'phase');
}

function readWork(io) {
  const text = io.exists('WORK.md') ? io.readFile('WORK.md') : null;
  if (!text) return { error: terminalBlocked('WORK.md not found') };
  const fm = parseFrontmatter(text);
  if (!fm.cycle) return { error: terminalBlocked('No cycle in WORK.md frontmatter') };
  return { fm };
}

function doSort(runSort, historyPath, io, mint) {
  try {
    return runSort({ workPath: 'WORK.md', historyPath, io, ...(mint ? { mint } : {}) });
  } catch (err) {
    return { error: terminalViolation('runRun: sort error -- ' + err.message, false) };
  }
}

async function handleForge(opts, sortResult, cycleId, hp, fp) {
  const { client, childSessions, context, io, worktree, cwd } = opts;
  try {
    const fResult = await executeForge({
      sort: sortResult, cwd, client, childSessions, context, io,
      worktree, historyPath: hp, feedbackPath: fp, cycleId,
    });
    if (fResult.ok) return {};
    markWorkfileFailed(io, fResult.error || 'forge execution failed');
    return terminalViolation(fResult.error || 'forge execution failed', true);
  } catch (err) {
    markWorkfileFailed(io, 'forge dispatch error: ' + err.message);
    return terminalViolation('forge dispatch error: ' + err.message, true);
  }
}

async function handleQuench(opts, sortResult, cycleId, hp, fp) {
  const { io, worktree, cwd } = opts;
  await executeQuench({ sort: sortResult, cwd, io, worktree, historyPath: hp, feedbackPath: fp, cycleId });
  return {};
}

async function handleAssay(opts, sortResult, cycleId, hp, fp) {
  const { io, worktree, cwd } = opts;
  await executeAssay({ sort: sortResult, cwd, io, worktree, historyPath: hp, feedbackPath: fp, cycleId });
  return {};
}

async function handleAppraise(opts, sortResult, cycleId, hp, fp) {
  const { client, childSessions, context, io, worktree, cwd } = opts;
  try {
    const aResult = await executeAppraise({
      sort: sortResult, cwd, client, childSessions, context, io,
      worktree, historyPath: hp, feedbackPath: fp, cycleId,
    });
    if (aResult.ok) return {};
    markWorkfileFailed(io, aResult.error || 'appraise execution failed');
    return terminalViolation(aResult.error || 'appraise execution failed', true);
  } catch (err) {
    markWorkfileFailed(io, 'appraise dispatch error: ' + err.message);
    return terminalViolation('appraise dispatch error: ' + err.message, true);
  }
}

function getHandler(base) {
  if (base === 'forge') return handleForge;
  if (base === 'quench') return handleQuench;
  if (base === 'assay') return handleAssay;
  if (base === 'appraise') return handleAppraise;
  return null;
}

function checkTerminalRoute(route, fm, s) {
  if (route === 'done') return terminalDone(fm);
  if (route === 'blocked') return terminalBlocked(s.details);
  return null;
}

function isHumanAppraiseBase(route) {
  return routeBaseOf(route) === 'human-appraise';
}

async function dispatchRouteHandler(opts, s, cycleId, hp) {
  const base = routeBaseOf(s.route);
  const handler = getHandler(base);
  if (!handler) return { done: true, result: terminalViolation('runRun: unknown route ' + s.route, false) };

  const hResult = await handler(opts, s, cycleId, hp, 'WORK.feedback.yaml');
  if (hResult.action) return { done: true, result: hResult };

  const commitErr = tryCommitStage(opts.git, '[' + cycleId + '] ' + base + ': ' + s.route);
  if (commitErr) return { done: true, result: commitErr };

  return { done: false };
}

/**
 * When sort determines a cycle transition, handle it and return the
 * appropriate result for the caller. Returns null when there are no
 * cycle targets (caller should proceed to terminal violation).
 */
async function handleCycleTargets(opts, fm, historyPath) {
  const io = opts.io;
  const targets = await readCycleTargets(fm.cycle, io)
    .catch(function() { return []; });
  if (!Array.isArray(targets) || targets.length === 0) return null;
  const transitionResult = await handleCycleTransition(io, fm.cycle, fm, historyPath);
  if (transitionResult === null) return { done: false };
  return { done: true, result: transitionResult };
}

/**
 * When the sort route is not a known stage handler, check for human-appraise
 * or cycle targets. Returns a terminal result on human-appraise, transition,
 * violation, or null when the route is a known stage handler (caller should
 * dispatch normally).
 */
async function handleUnknownRoute(opts, s, fm, historyPath, prefix) {
  const route = s.route;
  const base = routeBaseOf(route);
  if (getHandler(base)) return null;

  if (isHumanAppraiseBase(route)) {
    return { done: true, result: await handleHumanAppraiseInit(opts, s, fm.cycle, historyPath, 'WORK.feedback.yaml') };
  }

  const cycleResult = await handleCycleTargets(opts, fm, historyPath);
  if (cycleResult) return cycleResult;

  return { done: true, result: terminalViolation(prefix + ': unknown route ' + route, false) };
}

async function runOneIteration(opts, runSort, hp) {
  const { io, mint } = opts;

  const r = readWork(io);
  if (r.error) return { done: true, result: r.error };

  const fm = r.fm;
  const s = doSort(runSort, hp, io, mint);
  if (s.error) return { done: true, result: s.error };

  const terminal = checkTerminalRoute(s.route, fm, s);
  if (terminal) return { done: true, result: terminal };

  const tResult = await handleUnknownRoute(opts, s, fm, hp, 'runRun');
  if (tResult) return tResult;

  return dispatchRouteHandler(opts, s, fm.cycle, hp);
}

/** Run the state machine loop from a clean start. */
export async function runRun(opts) {
  const { io, sortFn } = opts;
  const runSort = sortFn || defaultRunSort;

  const guard = guardNotFailed(io);
  if (guard) return guard;

  const hp = 'WORK.history.yaml';

  while (true) {
    const iter = await runOneIteration(opts, runSort, hp);
    if (iter.done) return iter.result;
  }
}

// ---------------------------------------------------------------------------
// Continue run — reads state from disk and resumes an existing run
// ---------------------------------------------------------------------------

async function continueDispatch(opts, s, cycle, hp) {
  const handler = getHandler(routeBaseOf(s.route));
  if (!handler) return { done: true, result: terminalViolation('continueRun: unknown route ' + s.route, false) };
  const result = await handler(opts, s, cycle, hp, 'WORK.feedback.yaml');
  if (result.action) return { done: true, result: result };
  const commitErr = tryCommitStage(opts.git, '[' + cycle + '] ' + routeBaseOf(s.route));
  if (commitErr) return { done: true, result: commitErr };
  return { done: false };
}

async function continueOneIteration(opts, runSort, hp, io) {
  const r = readWork(io);
  if (r.error) return { done: true, result: r.error };

  const s = doSort(runSort, hp, io, opts.mint);
  if (s.error) return { done: true, result: s.error };

  const terminal = checkTerminalRoute(s.route, r.fm, s);
  if (terminal) return { done: true, result: terminal };

  const tResult = await handleUnknownRoute(opts, s, r.fm, hp, 'continueRun');
  if (tResult) return tResult;

  return continueDispatch(opts, s, r.fm.cycle, hp);
}

async function handleCycleTransition(io, cycleId, fm, historyPath) {
  const targets = await readCycleTargets(cycleId, io).catch(function() { return []; });
  if (!Array.isArray(targets) || targets.length === 0) {
    return terminalDone(fm);
  }

  const nextCycle = targets[0];
  const hasValidation = fm.stages ? fm.stages.some(function(s) { return s.startsWith('quench:'); }) : true;
  const alwaysHumanAppraise = fm['always-human-appraise'] === true;
  const newStages = synthesizeStages({
    cycleId: nextCycle, hasValidation: hasValidation,
    alwaysHumanAppraise: alwaysHumanAppraise, assay: false,
  });

  let workText = io.readFile('WORK.md');
  workText = setFrontmatterField(workText, 'cycle', nextCycle);
  workText = setFrontmatterField(workText, 'stages', newStages);
  io.writeFile('WORK.md', workText);

  appendEntry(historyPath, {
    action: 'cycle-transition', from: cycleId, to: nextCycle,
    stage: 'sort', cycle: nextCycle,
    comment: 'Transition from ' + cycleId + ' to ' + nextCycle,
  }, io);

  return null;
}

function checkContinuePreconditions(io) {
  if (!io.exists('WORK.md')) {
    return terminalViolation('continueRun: WORK.md not found. Use foundry_run() to start a new run.', false);
  }
  const failed = readFailedStatus(io);
  if (failed) return terminalViolation('continueRun: flow is in failed state', false);
  return null;
}

async function handleHumanAppraiseResumeIfNeeded(io, opts) {
  const activeStage = readActiveStage(io);
  if (!activeStage) return null;
  if (stageBaseOf(activeStage.stage) !== 'human-appraise') return null;
  const haResult = await handleHumanAppraiseResume(io, opts, activeStage);
  if (haResult.action !== 'continue-run') return haResult;
  return null;
}

async function processRunLoop(opts, runSort, hp, io) {
  const iter = await continueOneIteration(opts, runSort, hp, io);
  if (iter.done) return iter.result;
  const postSort = doSort(runSort, hp, io, opts.mint);
  if (postSort.error) return postSort.error;
  return processRunLoop(opts, runSort, hp, io);
}

/**
 * continueRun — resume an existing run by reading state from disk.
 */
export async function continueRun(opts) {
  const { io, sortFn } = opts;
  const runSort = sortFn || defaultRunSort;

  const preCheck = checkContinuePreconditions(io);
  if (preCheck) return preCheck;

  const hp = 'WORK.history.yaml';

  const haResult = await handleHumanAppraiseResumeIfNeeded(io, opts);
  if (haResult) return haResult;

  return processRunLoop(opts, runSort, hp, io);
}

export { executeForge, executeQuench, executeAssay, executeAppraise };
