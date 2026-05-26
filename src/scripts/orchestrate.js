// Foundry v2.3.0 orchestrate: deterministic cycle orchestration.
// Composes internal functions (sort, finalize, history, commit, configure)
// into a single entry point the LLM drives via a 3-line loop.

import { runSort } from './sort.js';
import matter from 'gray-matter';
import { readActiveStage, readLastStage, writeActiveStage, clearActiveStage } from './lib/state.js';
import { stageBaseOf } from './lib/stage-guard.js';
import { ulid as defaultUlid } from './lib/ulid.js';
import { computeArtefactVersion } from './lib/artefacts.js';
import { enforceForgeContract } from './lib/forge-contract.js';
import { loadHistory } from './lib/history.js';
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
import { guardNoWorkMd, guardMissingCycleId, guardSetupInconsistent, guardOrphanedStage, guardMissingLastStage, guardLastResults } from './lib/orchestrate-guards.js';

export {
  renderDispatchPrompt, synthesizeStages, computeOpenFeedback,
  DISPATCH_MULTI_ACTION, validateDispatchMulti, buildDispatchMultiResponse,
};
export { gatherAppraiseContext, consolidateAppraise };
export { readCycleTargets, readForgeFilePatterns };
export { handleSortResult as __handleSortResultForTest };
export { captureForgeContext as __captureForgeContextForTest };

export function needsSetup(workMdContent) {
  const { data } = matter(workMdContent);
  return !data || !data.stages;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

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
      return store.add({
        file: item.file, tag: item.tag, text: item.text, source: stageId, cycle: cycleId,
        artefact_version: item.artefact_version,
      });
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
    baseBranch: args.baseBranch ?? 'main', cwd: args.cwd ?? process.cwd(),
    feedback: buildFeedback(cycleId, stageId, io) };
}

function buildAppraiseCtx(cycleId, args, io) {
  const stageId = `appraise:${cycleId}`;
  return { cycleId, io, git: args.git, finalize: buildFinalizeWrapper(cycleId, args, io),
    foundryDir: 'foundry', defaultModel: args.defaultModel,
    baseBranch: args.baseBranch ?? 'main', cwd: args.cwd ?? process.cwd(),
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

const FORGE_CTX = '.foundry/forge-context.json';

async function captureForgeContext(sortResult, args, preCheck, io) {
  const fgResult = await readForgeFilePatterns(preCheck.cycleId, io);
  if (!fgResult) return;
  const preVersion = await computeArtefactVersion('foundry', fgResult.outputType, io, args.cwd);
  const allItems = openFeedbackStore('WORK.feedback.yaml', io).list();
  // Only capture unresolved items (open/rejected) — resolved items are terminal
  // and presenting them to forge causes the contract to fail and revert them.
  const unresolvedItems = allItems.filter(item => {
    const state = item.history?.[0]?.state ?? 'open';
    return state === 'open' || state === 'rejected';
  });
  if (!io.exists('.foundry')) io.mkdir('.foundry');
  const forgeItem = unresolvedItems.length > 0
    ? {
      id: unresolvedItems[0].id,
      file: unresolvedItems[0].file,
      tag: unresolvedItems[0].tag,
      text: unresolvedItems[0].text,
      source: unresolvedItems[0].source,
    }
    : null;
  const ctx = { forgePreVersion: preVersion, forgeItem };
  io.writeFile(FORGE_CTX, JSON.stringify(ctx));
}

function countConsecutiveForgeFailures(io, cycleId) {
  if (!io.exists('WORK.history.yaml')) return 0;
  const entries = loadHistory('WORK.history.yaml', cycleId, io);
  let count = 0;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (stageBaseOf(entries[i].stage) !== 'forge') break;
    if (entries[i].contract_passed === false) count++;
    else break;
  }
  return count;
}

async function enforceForgeStage(activeStage, fgResult, cycleId, io, cwd) {
  const postVersion = await computeArtefactVersion('foundry', fgResult.outputType, io, cwd);
  const feedbackStore = openFeedbackStore('WORK.feedback.yaml', io);
  const items = activeStage.forgeItem ? [{ id: activeStage.forgeItem.id }] : [];
  const { contractPassed } = enforceForgeContract({
    items, preVersion: activeStage.forgePreVersion,
    postVersion, feedbackStore, cycleId,
  });
  if (!contractPassed && countConsecutiveForgeFailures(io, cycleId) + 1 >= 3) {
    return { violation: 'forge contract failed 3 consecutive times — unable to satisfy feedback requirements' };
  }
  return { postVersion, contractPassed };
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
  if (base === 'forge') await captureForgeContext(sortResult, args, preCheck, io);
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

async function runForgePostDispatch(args, activeStage, lastStage, cycleId, io) {
  const fgResult = await readForgeFilePatterns(cycleId, io);
  const base = { lastStage, activeStage, cycleId, io, finalize: args.finalize, git: args.git };
  if (!fgResult) return finaliseStage(base);
  if (!io.exists(FORGE_CTX)) return finaliseStage(base);
  const forgeCtx = JSON.parse(io.readFile(FORGE_CTX));
  io.unlink(FORGE_CTX);
  if (!forgeCtx.forgePreVersion) return finaliseStage(base);
  const result = await enforceForgeStage(forgeCtx, fgResult, cycleId, io, args.cwd);
  if (result.violation) return violation(result.violation, []);
  return finaliseStage({ ...base, postVersion: result.postVersion, contractPassed: result.contractPassed });
}

async function runPostDispatch(args, activeStage, lastStage, cycleId, io) {
  if (!args.lastResult) return null;
  if (args.lastResult.ok === false) {
    return handleViolation({ lastResult: args.lastResult, activeStage, lastStage, cycleId, io });
  }
  const stageErr = guardMissingLastStage(lastStage);
  if (stageErr) return stageErr;
  if (stageBaseOf(lastStage.stage) === 'forge') return runForgePostDispatch(args, activeStage, lastStage, cycleId, io);
  return finaliseStage({ lastStage, activeStage, cycleId, io, finalize: args.finalize, git: args.git });
}
