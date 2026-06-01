// Foundry SDK orchestration: setup workfile pipeline.
// Validates cycle definitions, resolves stages, and bootstraps WORK.md.
// Extracted from orchestrate-phases.js during the SDK orchestration cleanup.

import {
  getArtefactType,
  getCycleDefinition,
  getLawsForQuench,
} from './lib/config.js';
import { parseFrontmatter, writeFrontmatter } from './lib/workfile.js';
import matter from 'gray-matter';
import { loadExtractor } from './lib/assay/loader.js';
import { checkExtractorAgainstCycle } from './lib/assay/permissions.js';
import {
  violation,
  tryCommit,
  synthesizeStages,
} from './orchestrate-cycle.js';

function checkOutputType(cfm, cycleId) {
  const outputType = cfm['output-type'];
  if (outputType) return { outputType };
  if (cfm.output !== undefined) {
    return { error: violation(`cycle ${cycleId} uses old schema key 'output:'. Rename it to 'output-type:' (run the upgrade-foundry skill).`, ['WORK.md']) };
  }
  return { error: violation(`cycle ${cycleId} missing output-type field`, ['WORK.md']) };
}

async function checkArtefactType(foundryDir, outputType, io) {
  try { await getArtefactType(foundryDir, outputType, io); return { ok: true }; }
  catch { return { error: violation(`artefact type not found: ${outputType}`, ['WORK.md']) }; }
}

function isAssayInvalid(assayBlock) { return typeof assayBlock !== 'object' || Array.isArray(assayBlock); }

function checkAssayExtractors(list, cycleId) {
  if (!Array.isArray(list) || list.length === 0) {
    return violation(`cycle ${cycleId}: 'assay.extractors' must be a non-empty array`, ['WORK.md']);
  }
  return null;
}

function checkAssayShape(cfm, cycleId) {
  const assayBlock = cfm.assay;
  if (assayBlock === undefined || assayBlock === null) return { ok: true, extractors: null };
  if (isAssayInvalid(assayBlock)) {
    return { error: violation(`cycle ${cycleId}: 'assay' must be a mapping`, ['WORK.md']) };
  }
  const extErr = checkAssayExtractors(assayBlock.extractors, cycleId);
  if (extErr) return { error: extErr };
  return { ok: true, extractors: assayBlock.extractors };
}

function checkCycleWriteDecl(cfm, cycleId) {
  const cycleWrite = cfm.memory?.write;
  if (!Array.isArray(cycleWrite)) {
    return violation(`cycle ${cycleId}: 'assay:' requires the cycle to declare memory.write`, ['WORK.md']);
  }
  return null;
}

async function checkExtractors(foundryDir, cycleId, list, cycleWriteSet, io) {
  for (const name of list) {
    let ext;
    try { ext = await loadExtractor(foundryDir, name, io); }
    catch (err) { return violation(`cycle ${cycleId}: ${err.message}`, ['WORK.md']); }
    const checkResult = checkExtractorAgainstCycle(ext, { writeTypes: cycleWriteSet });
    if (!checkResult.ok) { return violation(`cycle ${cycleId}: ${checkResult.error}`, ['WORK.md']); }
  }
  return null;
}

function resolveStages(cfm, cycleId, hasValidation, assayExtractors) {
  if (!Array.isArray(cfm.stages)) {
    return synthesizeStages({ cycleId, hasValidation, alwaysHumanAppraise: cfm['always-human-appraise'] === true, assay: !!assayExtractors });
  }
  if (cfm.stages.length === 0) {
    return { error: violation(`cycle ${cycleId} has no stages declared in cycle definition`, ['WORK.md']) };
  }
  return cfm.stages.map(s => typeof s === 'string' && s.includes(':') ? s : `${s}:${cycleId}`);
}

export function applyFmDefaults(newFm, cfm, assayExtractors) {
  const maxIt = cfm['max-iterations'] ?? 3;
  newFm['max-iterations'] = maxIt;
  newFm['always-human-appraise'] = cfm['always-human-appraise'] === true;
  newFm['deadlock-human-appraise'] = cfm['deadlock-human-appraise'] === true;
  if (cfm.models) newFm.models = cfm.models;
  if (assayExtractors) newFm.assay = { extractors: assayExtractors };
}

function buildNewFrontmatter(workContent, stages, cfm, assayExtractors) {
  const fm = parseFrontmatter(workContent);
  const newFm = { ...fm };
  newFm.stages = stages;
  applyFmDefaults(newFm, cfm, assayExtractors);
  const body = matter(workContent).content;
  const fmBlock = writeFrontmatter(newFm);
  return body ? `${fmBlock}\n${body}` : fmBlock;
}

async function checkAssayPrereqs(cfm, cycleId, io) {
  if (!io.exists('foundry/memory/config.md')) {
    return violation(`cycle ${cycleId}: 'assay:' requires memory to be enabled (run the init-memory skill first)`, ['WORK.md']);
  }
  return checkCycleWriteDecl(cfm, cycleId);
}

async function runAssayValidation(cfm, cycleId, io, foundryDir) {
  const assayResult = checkAssayShape(cfm, cycleId);
  if (assayResult.error) return assayResult;
  if (!assayResult.extractors) return { ok: true, extractors: null };
  const prereqErr = await checkAssayPrereqs(cfm, cycleId, io);
  if (prereqErr) return { error: prereqErr };
  const cycleWriteSet = new Set(cfm.memory.write);
  const extErr = await checkExtractors(foundryDir, cycleId, assayResult.extractors, cycleWriteSet, io);
  if (extErr) return { error: extErr };
  return { ok: true, extractors: assayResult.extractors };
}

export async function setupWorkfile(args) {
  const { cycleId, workContent, io, git, foundryDir } = args;
  const cycleDefDoc = await getCycleDefinition(foundryDir, cycleId, io).catch(() => null);
  if (!cycleDefDoc) return violation(`cycle definition not found for id: ${cycleId}`, ['WORK.md']);
  const cfm = cycleDefDoc.frontmatter || {};
  return runSetupPipeline({ cfm, cycleId, workContent, io, git, foundryDir });
}

async function runSetupPipeline(ctx) {
  const typeResult = checkOutputType(ctx.cfm, ctx.cycleId);
  if (typeResult.error) return typeResult.error;
  const artefactResult = await checkArtefactType(ctx.foundryDir, typeResult.outputType, ctx.io);
  if (artefactResult.error) return artefactResult.error;
  const lawsWithValidators = await getLawsForQuench(ctx.foundryDir, ctx.io, { typeId: typeResult.outputType });
  const assayResult = await runAssayValidation(ctx.cfm, ctx.cycleId, ctx.io, ctx.foundryDir);
  if (assayResult.error) return assayResult.error;
  return completeSetup({ ...ctx, lawsWithValidators, assayResult });
}

async function completeSetup(ctx) {
  const hasValidation = ctx.lawsWithValidators && ctx.lawsWithValidators.length > 0;
  const stagesResult = resolveStages(ctx.cfm, ctx.cycleId, hasValidation, ctx.assayResult.extractors);
  if (stagesResult.error) return stagesResult.error;
  const newWork = buildNewFrontmatter(ctx.workContent, stagesResult, ctx.cfm, ctx.assayResult.extractors);
  ctx.io.writeFile('WORK.md', newWork);
  return trySetupCommit(ctx);
}

async function trySetupCommit(ctx) {
  if (!ctx.git || typeof ctx.git.commit !== 'function') {
    return { ok: true, workContent: ctx.io.readFile('WORK.md') };
  }
  const v = tryCommit(ctx.git, `[${ctx.cycleId}] setup: configure stages and limits`, [], 'setup');
  if (v) return v;
  return { ok: true, workContent: ctx.io.readFile('WORK.md') };
}
