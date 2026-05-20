// Foundry v2.3.0 orchestrate: deterministic cycle orchestration.
// Composes internal functions (sort, finalize, history, commit, configure)
// into a single entry point the LLM drives via a 3-line loop.

import { runSort } from './sort.js';
import { parseFrontmatter } from './lib/workfile.js';
import { readActiveStage, readLastStage } from './lib/state.js';
import { stageBaseOf } from './lib/stage-guard.js';
import { ulid as defaultUlid } from './lib/ulid.js';
import {
  findCycleOutputArtefact,
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
} from './orchestrate-phases.js';

export {
  renderDispatchPrompt, synthesizeStages, computeOpenFeedback,
  DISPATCH_MULTI_ACTION, validateDispatchMulti, buildDispatchMultiResponse,
};
export { findCycleOutputArtefact, readCycleTargets, readForgeFilePatterns };
export { handleSortResult as __handleSortResultForTest };

export function needsSetup(workMdContent) {
  const match = workMdContent.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return true;
  const fm = match[1];
  return !/^stages:/m.test(fm);
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

function guardNoWorkMd(io) {
  if (!io.exists('WORK.md')) {
    return violation('no WORK.md; flow skill must create it first');
  }
  return null;
}

function guardMissingCycleId(io) {
  const workContent = io.readFile('WORK.md');
  const fm = parseFrontmatter(workContent);
  if (!fm.cycle) {
    return violation('WORK.md frontmatter missing cycle field', ['WORK.md']);
  }
  return { cycleId: fm.cycle, workContent };
}

function guardSetupInconsistent(lastResult) {
  if (lastResult) {
    return violation(
      'inconsistent state: lastResult provided but WORK.md still needs setup',
      ['WORK.md'],
    );
  }
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
  if (!lastStage) {
    return violation('lastResult provided but no last stage recorded — orphaned state');
  }
  return null;
}

function checkLastResultsConflict(args) {
  if (args.lastResult !== undefined && args.lastResults !== undefined) {
    return violation('lastResult and lastResults are mutually exclusive');
  }
  return null;
}

function checkLastResultsShape(args) {
  if (args.lastResults === undefined) return null;
  if (!Array.isArray(args.lastResults)) {
    return violation('lastResults must be an array');
  }
  return null;
}

function isDuplicateConsolidation(lastStage, activeStage) {
  return lastStage && lastStage.stage === activeStage.stage;
}

function checkLastResultsStageContext(args, activeStage, lastStage) {
  if (args.lastResults === undefined) return null;
  if (!activeStage) {
    return violation('lastResults provided but no active stage exists');
  }
  if (stageBaseOf(activeStage.stage) !== 'appraise') {
    return violation(
      `lastResults provided but active stage "${activeStage.stage}" is not an appraise stage`,
    );
  }
  if (isDuplicateConsolidation(lastStage, activeStage)) {
    return violation(
      `duplicate lastResults: consolidation already completed for this appraise stage "${activeStage.stage}"`,
    );
  }
  return null;
}

function guardLastResults(args, activeStage, lastStage) {
  return checkLastResultsConflict(args)
    ?? checkLastResultsShape(args)
    ?? checkLastResultsStageContext(args, activeStage, lastStage);
}

function buildSortArgs(args, now) {
  return {
    cycleDef: args.cycleDef ?? null,
    mint: args.mint,
    now: typeof now === 'function' ? now() : now,
    ulid: args.ulid ?? defaultUlid,
    defaultModel: args.defaultModel,
  };
}

function buildSortContext(cycleId, args, io) {
  return { cycleId, cwd: args.cwd ?? process.cwd(), io };
}

function buildSetupArgs(cycleResult, args, io) {
  return {
    cycleId: cycleResult.cycleId,
    workContent: cycleResult.workContent,
    io,
    git: args.git,
    foundryDir: 'foundry',
  };
}

function isViolation(result) {
  return result && result.action === 'violation';
}

export async function runOrchestrate(args, io) {
  const preCheck = runPreChecks(io);
  if (preCheck.error) return preCheck.error;
  return runOrchestrateFlow(preCheck, args, io);
}

function checkFlowGuards(args, activeStage, lastStage) {
  const lastResultsErr = guardLastResults(args, activeStage, lastStage);
  if (lastResultsErr) return lastResultsErr;

  // Only flag an orphaned stage when not on the consolidation path.
  // When lastResults is provided, an active stage without lastResult is
  // expected (this is the consolidation path after parallel appraiser
  // dispatch).
  if (args.lastResults === undefined) {
    return guardOrphanedStage(activeStage, args.lastResult);
  }
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

  const sortResult = runSort(buildSortArgs(args, args.now ?? Date.now), io);
  return handleSortResult(sortResult, buildSortContext(preCheck.cycleId, args, io));
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
  if (err) return err;
  return setupWorkfile(buildSetupArgs(preCheck, args, io));
}

async function runPostDispatch(args, activeStage, lastStage, cycleId, io) {
  if (!args.lastResult) return null;
  if (args.lastResult.ok === false) {
    return handleViolation({ lastResult: args.lastResult, activeStage, lastStage, cycleId, io });
  }

  const stageErr = guardMissingLastStage(lastStage);
  if (stageErr) return stageErr;

  return finaliseStage({
    lastStage, activeStage, cycleId, io,
    finalize: args.finalize ?? null,
    git: args.git,
  });
}
