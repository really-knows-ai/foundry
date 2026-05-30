import { getCycleDefinition } from './lib/config.js';
import { getArtefactFiles, computeArtefactVersion } from './lib/artefacts.js';
import { readCycleTargets, readRecentFeedback, violation } from './orchestrate-cycle.js';
import { openFeedbackStore } from './lib/feedback-store.js';
import { baseStage } from './lib/sort-routing.js';

async function findOutputArtefacts(cfm, io, foundryDir, baseBranch) {
  const outputType = cfm ? cfm['output-type'] : undefined;
  if (!outputType) return null;
  const artefacts = await getArtefactFiles(foundryDir, outputType, io, { baseBranch });
  return artefacts.find(a => a.state !== 'deleted') || null;
}

export async function doneAction(cycleId, io, foundryDir, baseBranch) {
  const fd = foundryDir || 'foundry';
  const base = baseBranch || 'main';
  const cfm = (await getCycleDefinition(fd, cycleId, io)).frontmatter;
  const artefact = await findOutputArtefacts(cfm, io, fd, base);
  const artefactFile = artefact ? artefact.file : null;
  return { action: 'done', cycle: cycleId, artefact_file: artefactFile, next_cycles: await readCycleTargets(cycleId, io) };
}

export async function blockedAction(cycleId, io, details, foundryDir, baseBranch) {
  const fd = foundryDir || 'foundry';
  const base = baseBranch || 'main';
  const cfm = (await getCycleDefinition(fd, cycleId, io)).frontmatter;
  const artefact = await findOutputArtefacts(cfm, io, fd, base);
  const artefactFile = artefact ? artefact.file : null;
  const reason = details || 'iteration limit reached with unresolved feedback';
  return { action: 'blocked', cycle: cycleId, artefact_file: artefactFile, reason };
}

export async function humanAppraiseAction(route, token, ctx) {
  const { cycleId, io, baseBranch, cwd } = ctx;
  const fd = ctx.foundryDir || 'foundry';
  const base = baseBranch || 'main';
  const cfm = (await getCycleDefinition(fd, cycleId, io)).frontmatter;

  try {
    await resolveStaleHumanAppraiseFeedback(cfm, fd, io, cycleId, cwd);
  } catch (err) {
    return { action: 'violation', details: `version check failed: ${err.message}`, recoverable: false, affected_files: [] };
  }

  io.writeFile('.foundry/dispatch-token', token);

  const artefact = await findOutputArtefacts(cfm, io, fd, base);
  const artefactFile = artefact ? artefact.file : null;
  return { action: 'human_appraise', stage: route, context: { cycle: cycleId, artefact_file: artefactFile, recent_feedback: readRecentFeedback(io) } };
}

/**
 * Resolve stale human-appraise feedback. Errors propagate to the caller
 * (humanAppraiseAction) which surfaces them as a violation.
 */
async function resolveStaleHumanAppraiseFeedback(cfm, fd, io, cycleId, cwd) {
  const outputType = cfm['output-type'];
  if (!outputType) return;
  const store = openFeedbackStore('WORK.feedback.yaml', io);
  const currentVersion = await computeArtefactVersion(fd, outputType, io, cwd);
  for (const item of store.list()) {
    if (shouldSkipHumanAppraiseResolve(item, currentVersion)) continue;
    store.autoResolve({
      id: item.id,
      reason: `superseded by forge revision ${currentVersion}`,
      cycle: cycleId,
    });
  }
}

function shouldSkipHumanAppraiseResolve(item, currentVersion) {
  if (item.history[0].state === 'resolved') return true;
  if (typeof item.source !== 'string' || baseStage(item.source) !== 'human-appraise') return true;
  if (item.artefact_version === currentVersion) return true;
  return false;
}

export async function missingModelViolation(cycleId, route, io, foundryDir, baseBranch) {
  const fd = foundryDir || 'foundry';
  const base = baseBranch || 'main';
  const cfm = (await getCycleDefinition(fd, cycleId, io)).frontmatter;
  const outputType = cfm ? cfm['output-type'] : undefined;
  const artefacts = outputType ? await getArtefactFiles(fd, outputType, io, { baseBranch: base }) : [];
  const affectedFiles = artefacts.filter(a => a.state !== 'deleted').map(a => a.file);
  return violation(`cycle ${cycleId} stage ${route} has no model declared in cycle definition`, affectedFiles);
}
