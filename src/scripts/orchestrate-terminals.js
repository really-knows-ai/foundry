import { getCycleDefinition } from './lib/config.js';
import { getArtefactFiles } from './lib/artefacts.js';
import { readCycleTargets, readRecentFeedback, violation } from './orchestrate-cycle.js';

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
  const { cycleId, io, baseBranch } = ctx;
  const fd = ctx.foundryDir || 'foundry';
  const base = baseBranch || 'main';
  const cfm = (await getCycleDefinition(fd, cycleId, io)).frontmatter;
  const artefact = await findOutputArtefacts(cfm, io, fd, base);
  const artefactFile = artefact ? artefact.file : null;
  return { action: 'human_appraise', stage: route, token, context: { cycle: cycleId, artefact_file: artefactFile, recent_feedback: readRecentFeedback(io) } };
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
