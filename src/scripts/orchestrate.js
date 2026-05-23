// Foundry v2.3.0 orchestrate: deterministic cycle orchestration.
// Composes internal functions (sort, finalize, history, commit, configure)
// into a single entry point the LLM drives via a 3-line loop.

import { runSort } from './sort.js';
import { parseFrontmatter } from './lib/workfile.js';
import matter from 'gray-matter';
import { readActiveStage, readLastStage, writeActiveStage, clearActiveStage } from './lib/state.js';
import { stageBaseOf } from './lib/stage-guard.js';
import { ulid as defaultUlid } from './lib/ulid.js';
import {
  readCycleTargets,
  readForgeFilePatterns,
  renderDispatchPrompt,
  synthesizeStages,
  violation,
  computeOpenFeedback,
  DISPATCH_MULTI_ACTION,
  validateDispatchMulti,
  buildDispatchMultiResponse,
} from './orchestrate-cycle.js';
import {
  handleSortResult,
  setupWorkfile,
  finaliseStage,
  handleViolation,
  routeDispatch,
} from './orchestrate-phases.js';
import { runQuench } from './quench-module.js';
import { gatherAppraiseContext, consolidateAppraise } from './appraise-module.js';
import { openFeedbackStore } from './lib/feedback-store.js';

export {
  renderDispatchPrompt, synthesizeStages, computeOpenFeedback,
  DISPATCH_MULTI_ACTION, validateDispatchMulti, buildDispatchMultiResponse,
};
export { gatherAppraiseContext, consolidateAppraise };
export { readCycleTargets, readForgeFilePatterns };
export { handleSortResult as __handleSortResultForTest };

export function needsSetup(workMdContent) {
  const { data } = matter(workMdContent);
  return !data || !data.stages;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

function guardNoWorkMd(io) {
  if (!io.exists('WORK.md')) return violation('no WORK.md; flow skill must create it first');
  return null;
}

function guardMissingCycleId(io) {
  const workContent = io.readFile('WORK.md');
  const fm = parseFrontmatter(workContent);
  if (!fm.cycle) return violation('WORK.md frontmatter missing cycle field', ['WORK.md']);
  return { cycleId: fm.cycle, workContent };
}

function guardSetupInconsistent(lastResult) {
  if (lastResult) return violation('inconsistent state: lastResult provided but WORK.md still needs setup', ['WORK.md']);
  return null;
}

function guardOrphanedStage(activeStage, lastResult) {
  if (activeStage && !lastResult) {
    return violation(
      `prior stage ${activeStage.stage} orphaned — no lastResult provided but active stage exists. ` +
      `Likely cause: previous orchestrate call returned dispatch but caller did not follow up.`,
      [],
    );
  }
  return null;
}

function guardMissingLastStage(lastStage) {
  if (!lastStage) return violation('lastResult provided but no last stage recorded — orphaned state');
  return null;
}

function checkLastResultsConflict(args) {
  if (args.lastResult !== undefined && args.lastResults !== undefined) return violation('lastResult and lastResults are mutually exclusive');
  return null;
}

function checkLastResultsShape(args) {
  if (args.lastResults === undefined) return null;
  if (!Array.isArray(args.lastResults)) return violation('lastResults must be an array');
  return null;
}

function isDuplicateConsolidation(lastStage, activeStage) {
  return lastStage && lastStage.stage === activeStage.stage;
}

function checkLastResultsStageContext(args, activeStage, lastStage) {
  if (args.lastResults === undefined) return null;
  if (!activeStage) return violation('lastResults provided but no active stage exists');
  if (stageBaseOf(activeStage.stage) !== 'appraise') return violation(`lastResults provided but active stage "${activeStage.stage}" is not an appraise stage`);
  if (isDuplicateConsolidation(lastStage, activeStage)) return violation(`duplicate lastResults: consolidation already completed for this appraise stage "${activeStage.stage}"`);
  return null;
}

function guardLastResults(args, activeStage, lastStage) {
  return checkLastResultsConflict(args)
    ?? checkLastResultsShape(args)
    ?? checkLastResultsStageContext(args, activeStage, lastStage);
}

function buildSortArgs(args, now) {
  return {
    cycleDef: args.cycleDef ?? null, mint: args.mint,
    now: typeof now === 'function' ? now() : now,
    ulid: args.ulid ?? defaultUlid, defaultModel: args.defaultModel,
  };
}

function buildSortContext(cycleId, args, io) {
  return { cycleId, cwd: args.cwd ?? process.cwd(), io, foundryDir: args.foundryDir ?? 'foundry', baseBranch: args.baseBranch ?? 'main' };
}

function buildSetupArgs(cycleResult, args, io) {
  return { cycleId: cycleResult.cycleId, workContent: cycleResult.workContent, io, git: args.git, foundryDir: 'foundry' };
}

function isViolation(result) {
  return result && result.action === 'violation';
}

function buildFinalizeWrapper(cycleId, args, io) {
  return ({ lastStage, activeStage }) =>
    finaliseStage({ lastStage, activeStage, cycleId, io, finalize: args.finalize, git: args.git });
}

function buildFeedback(cycleId, stageId, io) {
  return {
    add: (item) => {
      const store = openFeedbackStore('WORK.feedback.yaml', io);
      return store.add({ file: item.file, tag: item.tag, text: item.text, source: stageId, cycle: cycleId });
    },
    list: (query) => {
      const store = openFeedbackStore('WORK.feedback.yaml', io);
      let items = store.list();
      if (query?.file) items = items.filter(it => it.file === query.file);
      if (query?.source) items = items.filter(it => it.source === query.source);
      return items;
    },
    resolve: (id, decision, reason) => {
      const store = openFeedbackStore('WORK.feedback.yaml', io);
      const target = decision === 'approved' ? 'resolved' : 'rejected';
      return store.transition({ id, target, stage: stageId, cycle: cycleId });
    },
  };
}

function buildQuenchContext(cycleId, args, io) {
  const stageId = `quench:${cycleId}`;
  return { cycleId, stageId, io, git: args.git, finalize: buildFinalizeWrapper(cycleId, args, io),
    now: args.now, ulid: args.ulid, mint: args.mint, foundryDir: 'foundry', defaultModel: args.defaultModel,
    baseBranch: args.baseBranch ?? 'main',
    feedback: buildFeedback(cycleId, stageId, io) };
}

function buildAppraiseCtx(cycleId, args, io) {
  const stageId = `appraise:${cycleId}`;
  return { cycleId, io, git: args.git, finalize: buildFinalizeWrapper(cycleId, args, io),
    foundryDir: 'foundry', defaultModel: args.defaultModel,
    baseBranch: args.baseBranch ?? 'main',
    activeStage: readActiveStage(io), lastStage: readLastStage(io),
    feedback: buildFeedback(cycleId, stageId, io) };
}

function resolveBaseSha(io) {
  try {
    const sha = io.exec(['git', 'rev-parse', 'HEAD']);
    if (sha && typeof sha === 'string' && sha.trim()) return sha.trim();
  } catch { /* use default */ }
  return '0000000';
}

function writeStageRecord(io, cycleId, route) {
  writeActiveStage(io, { cycle: cycleId, stage: `${route}`, token: null, baseSha: resolveBaseSha(io) });
}

async function handleQuenchRoute(sortResult, preCheck, args, io) {
  writeStageRecord(io, preCheck.cycleId, sortResult.route);
  const quenchCtx = buildQuenchContext(preCheck.cycleId, args, io);
  const quenchResult = await runQuench(quenchCtx);
  if (quenchResult.ok === false) return violation(quenchResult.error || 'quench failed');
  const nextSort = runSort(buildSortArgs(args, args.now ?? Date.now), io);
  return dispatchByRoute(nextSort, args, preCheck, io);
}

async function dispatchAppraiseOrConsolidate(sortResult, preCheck, args, io, result) {
  if (!result.tasks || result.tasks.length === 0) {
    return handleAppraiseConsolidateRoute(sortResult, preCheck, { ...args, lastResults: [] }, io);
  }
  const validationErr = validateDispatchMulti(result);
  if (validationErr) return validationErr;
  if (sortResult.reason !== undefined) result.reason = sortResult.reason;
  return result;
}

async function handleAppraiseGatherRoute(sortResult, preCheck, args, io) {
  writeStageRecord(io, preCheck.cycleId, sortResult.route);
  const result = await gatherAppraiseContext(buildAppraiseCtx(preCheck.cycleId, args, io));
  if (result.action === 'violation') { clearActiveStage(io); return result; }
  return dispatchAppraiseOrConsolidate(sortResult, preCheck, args, io, result);
}

async function handleAppraiseConsolidateRoute(sortResult, preCheck, args, io) {
  const ctx = buildAppraiseCtx(preCheck.cycleId, args, io);
  const result = await consolidateAppraise(ctx, args.lastResults);
  if (result.action === 'violation') {
    clearActiveStage(io);
    return result;
  }
  if (!result.ok) return violation(result.error || 'appraise consolidation failed');
  const nextSort = runSort(buildSortArgs(args, args.now ?? Date.now), io);
  return dispatchByRoute(nextSort, args, preCheck, io);
}

async function dispatchByRoute(sortResult, args, preCheck, io) {
  const base = routeDispatch(sortResult.route);
  if (base === 'quench') return handleQuenchRoute(sortResult, preCheck, args, io);
  if (base === 'appraise') {
    return args.lastResults
      ? handleAppraiseConsolidateRoute(sortResult, preCheck, args, io)
      : handleAppraiseGatherRoute(sortResult, preCheck, args, io);
  }
  return handleSortResult(sortResult, buildSortContext(preCheck.cycleId, args, io));
}

export async function runOrchestrate(args, io) {
  const preCheck = runPreChecks(io);
  if (preCheck.error) return preCheck.error;
  return runOrchestrateFlow(preCheck, args, io);
}

function checkFlowGuards(args, activeStage, lastStage) {
  const lastResultsErr = guardLastResults(args, activeStage, lastStage);
  if (lastResultsErr) return lastResultsErr;
  // Only flag orphaned stage when not on consolidation path (lastResults path has activeStage but no lastResult)
  if (args.lastResults === undefined) return guardOrphanedStage(activeStage, args.lastResult);
  return null;
}

async function runOrchestrateFlow(preCheck, args, io) {
  const setupResult = await runSetupIfNeeded(preCheck, args, io);
  if (isViolation(setupResult)) return setupResult;
  const activeStage = readActiveStage(io);
  const lastStage = readLastStage(io);
  const guardErr = checkFlowGuards(args, activeStage, lastStage);
  if (guardErr) return guardErr;
  const postDispatchResult = await runPostDispatch(args, activeStage, lastStage, preCheck.cycleId, io);
  if (isViolation(postDispatchResult)) return postDispatchResult;
  return runSortAndDispatch(args, preCheck, io);
}

async function runSortAndDispatch(args, preCheck, io) {
  const sortResult = runSort(buildSortArgs(args, args.now ?? Date.now), io);
  return dispatchByRoute(sortResult, args, preCheck, io);
}

function runPreChecks(io) {
  const noWork = guardNoWorkMd(io);
  if (noWork) return { error: noWork };
  const cycleResult = guardMissingCycleId(io);
  if (cycleResult.error) return { error: cycleResult };
  return cycleResult;
}

async function runSetupIfNeeded(preCheck, args, io) {
  if (!needsSetup(preCheck.workContent)) return null;
  const err = guardSetupInconsistent(args.lastResult);
  return err || setupWorkfile(buildSetupArgs(preCheck, args, io));
}

async function runPostDispatch(args, activeStage, lastStage, cycleId, io) {
  if (!args.lastResult) return null;
  if (args.lastResult.ok === false) {
    return handleViolation({ lastResult: args.lastResult, activeStage, lastStage, cycleId, io });
  }
  const stageErr = guardMissingLastStage(lastStage);
  const finaliseArgs = { lastStage, activeStage, cycleId, io, finalize: args.finalize ?? null, git: args.git };
  return stageErr || finaliseStage(finaliseArgs);
}
