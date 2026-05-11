#!/usr/bin/env node

/**
 * Sort — deterministic routing for a Foundry Cycle.
 *
 * Reads WORK.md, WORK.feedback.yaml, and WORK.history.yaml to determine
 * the next stage to execute, or signal completion/blocked.
 *
 * Usage:
 *     node scripts/sort.js [--work WORK.md] [--history WORK.history.yaml]
 *
 * Output (stdout): a full stage alias (e.g., forge:write-haiku), 'done', or 'blocked'
 * Exit code: 0 on success, 1 on error
 */

import { parseFrontmatter } from './lib/workfile.js';
import { loadHistory } from './lib/history.js';
import { openFeedbackStore } from './lib/feedback-store.js';
import { ulid as defaultUlid } from './lib/ulid.js';
import {
  baseStage,
  findFirst,
  determineRoute,
} from './lib/sort-routing.js';
import {
  defaultIO,
  checkModifiedFiles,
  getDirtyToolManagedFiles,
} from './lib/sort-fs-check.js';

// ---------------------------------------------------------------------------
// Top-level deadlock pass (spec §6.1)
// ---------------------------------------------------------------------------

/**
 * Walk the feedback store and write a `state=deadlocked` snapshot for every
 * non-resolved item whose history depth has reached the configured threshold.
 * One atomic batch write via `store.writeDeadlockedSnapshots(ids, ...)`.
 *
 * Sort is the only writer of `state=deadlocked` per spec §6.1.
 *
 * @returns {boolean} true iff at least one snapshot was written.
 */
function runDeadlockPass(store, { threshold, enabled, cycle }) {
  if (!enabled) return false;
  const qualifying = store.list().filter(item => {
    // history[0] is the most recent state per the feedback-store invariant
    // (entries are prepended to keep newest at head).
    const head = item.history[0];
    if (head.state === 'resolved' || head.state === 'deadlocked') return false;
    return item.history.length >= threshold;
  });
  if (qualifying.length === 0) return false;
  store.writeDeadlockedSnapshots(
    qualifying.map(it => it.id),
    `depth >= threshold=${threshold}`,
    'sort',
    cycle,
  );
  return true;
}

// ---------------------------------------------------------------------------
// runSort — structured result for programmatic use
// ---------------------------------------------------------------------------

function isDispatchableRoute(route) {
  return typeof route === 'string' && /^(assay|forge|quench|appraise|human-appraise):/.test(route);
}

function validateStages(stages) {
  if (!stages || !Array.isArray(stages)) return { error: 'No stages in WORK.md frontmatter' };
  if (!findFirst(stages, 'forge')) return { error: 'stages must include at least one forge stage' };
  return null;
}

function validateWorkMd(workPath, io) {
  if (!io.exists(workPath)) return { error: 'WORK.md not found' };
  const workText = io.readFile(workPath);
  const frontmatter = parseFrontmatter(workText);
  if (!frontmatter.cycle) return { error: 'No cycle in WORK.md frontmatter' };
  const stagesError = validateStages(frontmatter.stages);
  if (stagesError) return stagesError;
  return { frontmatter, cycle: frontmatter.cycle, stages: frontmatter.stages };
}

function extractFrontmatterDefaults(frontmatter) {
  return {
    maxIterations: frontmatter['max-iterations'] ?? 3,
    humanAppraiseEnabled: frontmatter['human-appraise'] === true,
    deadlockAppraise: frontmatter['deadlock-appraise'] !== false,
    deadlockIterations: frontmatter['deadlock-iterations'] ?? 5,
  };
}

function checkDirtyFiles(history, io) {
  if (history.length === 0) return null;
  const dirty = getDirtyToolManagedFiles(io);
  if (dirty.length === 0) return null;
  return `Uncommitted tool-managed files since last sort: ${dirty.join(', ')}. `
    + `Each stage's commit is performed internally by foundry_orchestrate; `
    + `if you see this, the prior stage's commit was skipped or aborted. `
    + `Re-run foundry_orchestrate or commit the listed files manually before retrying.`;
}

function loadFeedbackAndRunDeadlock(cycle, deadlockIterations, deadlockAppraise, io) {
  const store = openFeedbackStore('WORK.feedback.yaml', io);
  runDeadlockPass(store, { threshold: deadlockIterations, enabled: deadlockAppraise, cycle });
  const feedback = store.list().map(item => ({
    id: item.id,
    file: item.file,
    state: item.history[0].state,
    depth: item.history.length,
  }));
  const anyDeadlocked = feedback.some(f => f.state === 'deadlocked');
  return { feedback, anyDeadlocked };
}

function resolveCycleDef(cycleDef, frontmatter, foundryDir, cycle) {
  return cycleDef || frontmatter['cycle-def'] || `${foundryDir}/cycles/${cycle}.md`;
}

function checkModifiedFilesAfterLastStage({ history, foundryDir, cycleDef, cycle, frontmatter, io }) {
  const nonSortHistory = history.filter(e => baseStage(e.stage || '') !== 'sort');
  if (nonSortHistory.length === 0) return { nonSortHistory };
  const lastBase = baseStage(nonSortHistory[nonSortHistory.length - 1].stage || '');
  const resolvedCycleDef = resolveCycleDef(cycleDef, frontmatter, foundryDir, cycle);
  const result = checkModifiedFiles(lastBase, foundryDir, resolvedCycleDef, cycle, io);
  if (!result.ok) {
    return { error: `File modification violation after ${lastBase} stage: ${result.violations.join(', ')}` };
  }
  return { nonSortHistory };
}

function getCurrentNonSortStage(nonSortHistory) {
  return nonSortHistory.length > 0 ? nonSortHistory[nonSortHistory.length - 1].stage : null;
}

function resolveDeadlockRoute(stages, nonSortHistory, cycle) {
  const currentNonSort = getCurrentNonSortStage(nonSortHistory);
  if (currentNonSort && baseStage(currentNonSort) === 'human-appraise') return 'blocked';
  return findFirst(stages, 'human-appraise') || `human-appraise:${cycle}`;
}

function resolveRoute(ctx) {
  if (ctx.anyDeadlocked) return resolveDeadlockRoute(ctx.stages, ctx.nonSortHistory, ctx.cycle);
  return determineRoute(ctx.stages, ctx.history, ctx.feedback, ctx.maxIterations);
}

function resolveModel(route, frontmatter, agentsDir, io) {
  const routeBase = baseStage(route);
  if (!frontmatter.models || !frontmatter.models[routeBase]) return null;
  const modelId = frontmatter.models[routeBase];
  const model = `foundry-${modelId.replace(/[/.]/g, '-')}`;
  const agentPath = `${agentsDir}/${model}.md`;
  if (!io.exists(agentPath)) {
    return {
      error: `Missing required subagent: ${model}.md is not present in ${agentsDir}/. `
        + `Call foundry_refresh_agents() to regenerate agent files, then restart.`,
    };
  }
  return model;
}

function checkModel(route, frontmatter, agentsDir, io) {
  const modelResult = resolveModel(route, frontmatter, agentsDir, io);
  if (modelResult && modelResult.error) return { error: modelResult.error };
  return { model: typeof modelResult === 'string' ? modelResult : null };
}

function mintToken({ route, model, mint, cycle, now, ulid }) {
  const result = { route, ...(model ? { model } : {}) };
  if (mint && isDispatchableRoute(route)) {
    const token = mint({ route, cycle, exp: now + 10 * 60 * 1000, nonce: ulid(now) });
    if (token) result.token = token;
  }
  return result;
}

// runSort is decomposed into single-purpose phase helpers above so the
// orchestrating function itself stays within the configured complexity
// limit. Each phase either returns an error envelope (handled by
// firstError) or contributes data to the routing decision.

function firstError(...envelopes) {
  for (const env of envelopes) {
    if (env && env.error) return env.error;
  }
  return null;
}

function preparePhases({ workPath, historyPath, foundryDir, cycleDef, io }) {
  const validation = validateWorkMd(workPath, io);
  if (validation.error) return { kind: 'blocked', details: validation.error };
  const { frontmatter, cycle, stages } = validation;
  const defaults = extractFrontmatterDefaults(frontmatter);
  const history = loadHistory(historyPath, cycle, io);
  const dirtyError = checkDirtyFiles(history, io);
  if (dirtyError) return { kind: 'violation', details: dirtyError };
  const { feedback, anyDeadlocked } = loadFeedbackAndRunDeadlock(
    cycle, defaults.deadlockIterations, defaults.deadlockAppraise, io,
  );
  const fileCheck = checkModifiedFilesAfterLastStage({
    history, foundryDir, cycleDef, cycle, frontmatter, io,
  });
  const violation = firstError(fileCheck);
  if (violation) return { kind: 'violation', details: violation };
  return {
    kind: 'ok',
    frontmatter, cycle, stages, defaults, history, feedback, anyDeadlocked,
    nonSortHistory: fileCheck.nonSortHistory,
  };
}

const RUN_SORT_DEFAULTS = Object.freeze({
  workPath: 'WORK.md',
  historyPath: 'WORK.history.yaml',
  foundryDir: 'foundry',
  cycleDef: undefined,
  agentsDir: '.opencode/agents',
  mint: undefined,
});

function withRunSortDefaults(args) {
  const merged = { ...RUN_SORT_DEFAULTS, ...args };
  if (merged.now === undefined) merged.now = Date.now();
  if (merged.ulid === undefined) merged.ulid = defaultUlid;
  return merged;
}

function buildRouteCtx(prep) {
  return {
    stages: prep.stages,
    history: prep.history,
    feedback: prep.feedback,
    maxIterations: prep.defaults.maxIterations,
    cycle: prep.cycle,
    anyDeadlocked: prep.anyDeadlocked,
    nonSortHistory: prep.nonSortHistory,
  };
}

export function runSort(args = {}, io = defaultIO) {
  const opts = withRunSortDefaults(args);
  const prep = preparePhases({ ...opts, io });
  if (prep.kind !== 'ok') return { route: prep.kind, details: prep.details };

  const route = resolveRoute(buildRouteCtx(prep));
  const modelCheck = checkModel(route, prep.frontmatter, opts.agentsDir, io);
  if (modelCheck.error) return { route: 'violation', details: modelCheck.error };

  return mintToken({
    route, model: modelCheck.model, mint: opts.mint, cycle: prep.cycle, now: opts.now, ulid: opts.ulid,
  });
}

// ---------------------------------------------------------------------------
// Exports (for testing) — keep main() private
// ---------------------------------------------------------------------------

export { parseArtefactsTable } from './lib/artefacts.js';
export { loadHistory } from './lib/history.js';
export { parseFrontmatter } from './lib/workfile.js';
export {
  baseStage,
  findFirst,
  nextInRoute,
  determineRoute,
  nextAfterQuench,
  nextAfterAppraise,
} from './lib/sort-routing.js';
export {
  globMatch,
  getModifiedFiles,
  getAllowedPatterns,
  checkModifiedFiles,
  getDirtyToolManagedFiles,
} from './lib/sort-fs-check.js';
