/**
 * Deterministic run state machine.
 *
 * Used by both `foundry_run` and `foundry_continue`. Reads filesystem state
 * (WORK.md, WORK.history.yaml, WORK.feedback.yaml, .foundry/), iterates
 * through stages via `runSort`, and dispatches each stage.
 *
 * Exports: runRun, executeForge, executeQuench, executeAssay
 */

import { runSort as defaultRunSort } from './sort.js';
import { markWorkfileFailed } from './lib/failed-flow.js';
import { parseFrontmatter } from './lib/workfile.js';
import { tryCommit } from './orchestrate-cycle.js';
import { executeForge, executeQuench, executeAssay } from './run-executors.js';

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

function doSort(runSort, historyPath, io) {
  try {
    return runSort({ workPath: 'WORK.md', historyPath, io });
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

function getHandler(base) {
  if (base === 'forge') return handleForge;
  if (base === 'quench') return handleQuench;
  if (base === 'assay') return handleAssay;
  return null;
}

function checkTerminalRoute(route, fm, s) {
  if (route === 'done') return terminalDone(fm);
  if (route === 'blocked') return terminalBlocked(s.details);
  return null;
}

function isAppraiseBase(route) {
  const base = routeBaseOf(route);
  return base === 'appraise' || base === 'human-appraise';
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

/** Execute one iteration of the state machine loop. Returns `{ done, result }`. */
async function runOneIteration(opts, runSort, hp) {
  const { io } = opts;

  const r = readWork(io);
  if (r.error) return { done: true, result: r.error };

  const fm = r.fm;
  const s = doSort(runSort, hp, io);
  if (s.error) return { done: true, result: s.error };

  const terminal = checkTerminalRoute(s.route, fm, s);
  if (terminal) return { done: true, result: terminal };

  if (isAppraiseBase(s.route)) return { done: true, result: terminalDone(fm) };

  return dispatchRouteHandler(opts, s, fm.cycle, hp);
}

/** Run the state machine loop. */
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

export { executeForge, executeQuench, executeAssay };
