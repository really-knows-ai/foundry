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
  if (lastResult) return violation('inconsistent state: lastResult provided but WORK.md still needs setup', ['WORK.md']);
  return null;
}

export function guardOrphanedStage(activeStage, lastResult) {
  if (activeStage && !lastResult) {
    return violation(
      `prior stage ${activeStage.stage} orphaned — no lastResult provided but active stage exists. ` +
      `Likely cause: previous orchestrate call returned dispatch but caller did not follow up.`,
      [],
    );
  }
  return null;
}

export function guardMissingLastStage(lastStage) {
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

function checkLastResultsStageContext(args, activeStage, lastStage) {
  if (args.lastResults === undefined) return null;
  if (!activeStage) return violation('lastResults provided but no active stage exists');
  if (stageBaseOf(activeStage.stage) !== 'appraise') return violation(`lastResults provided but active stage "${activeStage.stage}" is not an appraise stage`);
  if (isDuplicateConsolidation(lastStage, activeStage)) return violation(`duplicate lastResults: consolidation already completed for this appraise stage "${activeStage.stage}"`);
  return null;
}

export function guardLastResults(args, activeStage, lastStage) {
  return checkLastResultsConflict(args)
    ?? checkLastResultsShape(args)
    ?? checkLastResultsStageContext(args, activeStage, lastStage);
}
