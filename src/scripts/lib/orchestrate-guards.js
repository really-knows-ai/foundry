// Foundry v2.3.0 orchestrate guards: validation guards for cycle orchestration.

import { parseFrontmatter } from './workfile.js';
import { stageBaseOf } from './stage-guard.js';
import { violation } from '../orchestrate-cycle.js';

function isDuplicateConsolidation(lastStage, activeStage) {
  return lastStage && lastStage.stage === activeStage.stage;
}

export function guardNoWorkMd(io) {
  if (!io.exists('WORK.md')) return violation('no WORK.md; flow skill must create it first');
  return null;
}

export function guardMissingCycleId(io) {
  const workContent = io.readFile('WORK.md');
  const fm = parseFrontmatter(workContent);
  if (!fm.cycle) return violation('WORK.md frontmatter missing cycle field', ['WORK.md']);
  return { cycleId: fm.cycle, workContent };
}

export function guardSetupInconsistent(lastResult) {
  if (lastResult) return violation('WORK.md needs setup (no stages configured), but you passed lastResult — stages are configured during setup. Call foundry_orchestrate() without any arguments to initialise the cycle first', ['WORK.md']);
  return null;
}

export function guardOrphanedStage(activeStage, lastResult) {
  if (activeStage && !lastResult) {
    return violation(
      `stage "${activeStage.stage}" is active but you called foundry_orchestrate() without lastResult — ` +
      `the orchestrator cannot advance past an active stage. ` +
      `If this stage was abandoned or its subagent already finished (stage was entered via foundry_stage_begin and exited via foundry_stage_end), ` +
      `call foundry_stage_end to close it, then foundry_orchestrate() to get the next action. ` +
      `Otherwise, pass lastResult: {ok: true} (or {ok: false, error: "..."}) to report the outcome.`,
      [],
    );
  }
  return null;
}

export function guardMissingLastStage(lastStage) {
  if (!lastStage) return violation(
    'lastResult provided but the orchestrator has no record of a pending dispatch to match it against — ' +
    'the stage was already finalised (likely by foundry_stage_end in a subagent). ' +
    'Call foundry_orchestrate() without arguments to sort and get the next action.',
  );
  return null;
}

function checkLastResultsConflict(args) {
  if (args.lastResult !== undefined && args.lastResults !== undefined) return violation('pass lastResult (singular) for dispatch stages, or lastResults (plural array) for appraise dispatch_multi — not both at once');
  return null;
}

function checkLastResultsShape(args) {
  if (args.lastResults === undefined) return null;
  if (!Array.isArray(args.lastResults)) return violation('lastResults must be an array of {ok, output?, error?} objects — one per appraiser subagent result');
  return null;
}

function checkLastResultsStageContext(args, activeStage, lastStage) {
  if (args.lastResults === undefined) return null;
  if (!activeStage) return violation('lastResults (plural) provided but no active appraise stage exists. If appraise was already consolidated, call foundry_orchestrate() without arguments to get the next action');
  if (stageBaseOf(activeStage.stage) !== 'appraise') return violation(`lastResults (plural) is only valid for appraise stages, but active stage is "${activeStage.stage}". For forge or human-appraise, use lastResult (singular)`);
  if (isDuplicateConsolidation(lastStage, activeStage)) return violation(`consolidation already completed for "${activeStage.stage}". Call foundry_orchestrate() without arguments to get the next action`);
  return null;
}

export function guardLastResults(args, activeStage, lastStage) {
  return checkLastResultsConflict(args)
    ?? checkLastResultsShape(args)
    ?? checkLastResultsStageContext(args, activeStage, lastStage);
}
