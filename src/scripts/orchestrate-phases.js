// Foundry v2.3.0 orchestrate: phase logic.
// Private phase functions used by runOrchestrate.

import {
  getArtefactType,
  getCycleDefinition,
  getLawsForQuench,
} from './lib/config.js';
import { parseFrontmatter, writeFrontmatter } from './lib/workfile.js';
import matter from 'gray-matter';
import { clearActiveStage, clearLastStage } from './lib/state.js';
import { appendEntry, getIteration } from './lib/history.js';
import { stageBaseOf } from './lib/stage-guard.js';
import { allowedPatternsForStage } from './lib/git-policy.js';
import { loadExtractor } from './lib/assay/loader.js';
import { checkExtractorAgainstCycle } from './lib/assay/permissions.js';
import {
  readForgeFilePatterns,
  computeOpenFeedback,
  violation,
  tryCommit,
  synthesizeStages,
  renderDispatchPrompt,
  checkIterationLimits,
} from './orchestrate-cycle.js';
import {
  doneAction,
  blockedAction,
  humanAppraiseAction,
  missingModelViolation,
} from './orchestrate-terminals.js';

function makeDispatchPayload({ route, cycleId, token, cwd, filePatterns, outputType }) {
  return { stage: route, cycle: cycleId, token, cwd, filePatterns, outputType };
}

async function buildDispatchAction(route, model, token, ctx) {
  if (!model) return missingModelViolation(ctx.cycleId, route, ctx.io, ctx.foundryDir, ctx.baseBranch ?? 'main');
  const base = route.split(':')[0];
  let filePatterns = null;
  let outputType = null;
  if (base === 'forge') {
    const result = await readForgeFilePatterns(ctx.cycleId, ctx.io);
    if (result) {
      filePatterns = result.patterns;
      outputType = result.outputType;
    }
  }
  const payload = { route, cycleId: ctx.cycleId, token, cwd: ctx.cwd, filePatterns, outputType };
  return { action: 'dispatch', stage: route, subagent_type: model,
    prompt: renderDispatchPrompt(makeDispatchPayload(payload)) };
}

export function routeDispatch(route) {
  return typeof route === 'string' ? route.split(':')[0] : '';
}

async function handleTerminalRoute(route, sortResult, ctx) {
  const baseBranch = ctx.baseBranch || 'main';
  if (route === 'done') return doneAction(ctx.cycleId, ctx.io, ctx.foundryDir, baseBranch);
  if (route === 'blocked') return blockedAction(ctx.cycleId, ctx.io, sortResult.details, ctx.foundryDir, baseBranch);
  const details = sortResult.details || 'sort returned violation';
  return violation(details);
}

function isTerminalRoute(route) {
  return route === 'done' || route === 'blocked' || route === 'violation';
}

function getRouteBase(route) {
  return routeDispatch(route);
}

export async function handleSortResult(sortResult, ctx) {
  const { route, model, token, reason } = sortResult;
  const routeBase = getRouteBase(route);
  const result = await resolveRouteResult({ route, routeBase, model, token, ctx });
  if (reason !== undefined) result.reason = reason;
  return result;
}

async function resolveRouteResult({ route, routeBase, model, token, ctx }) {
  if (isTerminalRoute(route)) return handleTerminalRoute(route, { route }, ctx);
  if (routeBase === 'quench' || routeBase === 'appraise') return violation(routeBase + ' route reached handleSortResult');
  if (routeBase === 'human-appraise') return humanAppraiseAction(route, token, ctx);
  return buildDispatchAction(route, model, token, ctx);
}

async function fetchCycleDefinition(foundryDir, cycleId, io) {
  try { return await getCycleDefinition(foundryDir, cycleId, io); } catch { return null; }
}

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

function isAssayAbsent(assayBlock) { return assayBlock === undefined || assayBlock === null; }
function isAssayInvalid(assayBlock) { return typeof assayBlock !== 'object' || Array.isArray(assayBlock); }

function checkAssayExtractors(list, cycleId) {
  if (!Array.isArray(list) || list.length === 0) {
    return violation(`cycle ${cycleId}: 'assay.extractors' must be a non-empty array`, ['WORK.md']);
  }
  return null;
}

function checkAssayShape(cfm, cycleId) {
  const assayBlock = cfm.assay;
  if (isAssayAbsent(assayBlock)) return { ok: true, extractors: null };
  if (isAssayInvalid(assayBlock)) {
    return { error: violation(`cycle ${cycleId}: 'assay' must be a mapping`, ['WORK.md']) };
  }
  const extErr = checkAssayExtractors(assayBlock.extractors, cycleId);
  if (extErr) return { error: extErr };
  return { ok: true, extractors: assayBlock.extractors };
}

function checkMemoryEnabled(io, cycleId) {
  if (!io.exists('foundry/memory/config.md')) {
    return violation(`cycle ${cycleId}: 'assay:' requires memory to be enabled (run the init-memory skill first)`, ['WORK.md']);
  }
  return null;
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

function stageTag(s, cycleId) {
  return typeof s === 'string' && s.includes(':') ? s : `${s}:${cycleId}`;
}

function resolveStages(cfm, cycleId, hasValidation, assayExtractors) {
  if (!Array.isArray(cfm.stages)) {
    return synthesizeStages({ cycleId, hasValidation, humanAppraise: cfm['human-appraise'] === true, assay: !!assayExtractors });
  }
  if (cfm.stages.length === 0) {
    return { error: violation(`cycle ${cycleId} has no stages declared in cycle definition`, ['WORK.md']) };
  }
  return cfm.stages.map(s => stageTag(s, cycleId));
}

function applyFmDefaults(newFm, cfm, assayExtractors) {
  const maxIt = cfm['max-iterations'] ?? 3;
  newFm['max-iterations'] = maxIt;
  newFm['human-appraise'] = cfm['human-appraise'] === true;
  newFm['deadlock-appraise'] = cfm['deadlock-appraise'] !== false;
  newFm['deadlock-iterations'] = cfm['deadlock-iterations'] ?? maxIt;
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
  const memErr = checkMemoryEnabled(io, cycleId);
  if (memErr) return memErr;
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
  const cycleDefDoc = await fetchCycleDefinition(foundryDir, cycleId, io);
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
  const validityErr = checkIterationLimits(ctx.cfm, ctx.cycleId);
  if (validityErr) return validityErr;
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

function readOriginalState(io) {
  return { workMd: io.readFile('WORK.md'), history: io.exists('WORK.history.yaml') ? io.readFile('WORK.history.yaml') : null };
}

function buildFinalizeViolation(finalizeResult) {
  if (finalizeResult.error === 'unexpected_files') {
    return violation(`unexpected files written by subagent: ${(finalizeResult.files || []).join(', ')}`, finalizeResult.files || []);
  }
  return violation(`stage_finalize error: ${finalizeResult.error}`, []);
}

function writeHistoryEntries(ctx) {
  appendEntry(ctx.historyPath, { cycle: ctx.cycleId, stage: 'sort', iteration: ctx.iteration, route: ctx.lastStage.stage, comment: `route ${ctx.lastStage.stage}`, openFeedback: ctx.openFeedback }, ctx.io);
  appendEntry(ctx.historyPath, { cycle: ctx.cycleId, stage: ctx.lastStage.stage, iteration: ctx.iteration, comment: ctx.lastStage.summary || '(no summary)', openFeedback: ctx.openFeedback, changedFiles: ctx.lastStage.changedFiles ?? [] }, ctx.io);
}

async function computeAllowedPatterns(lastStage, cycleId, io) {
  const stageBase = stageBaseOf(lastStage.stage);
  let forgeFilePatterns = [];
  if (stageBase === 'forge') {
    const result = await readForgeFilePatterns(cycleId, io);
    forgeFilePatterns = result ? result.patterns : [];
  }
  return allowedPatternsForStage({ stageBase, forgeFilePatterns });
}

function buildCommitMessage(cycleId, lastStage) {
  return `[${cycleId}] ${lastStage.stage}: ${lastStage.summary || '(no summary)'}`;
}

function rollbackState(io, original) {
  io.writeFile('WORK.md', original.workMd);
  if (original.history !== null) { io.writeFile('WORK.history.yaml', original.history); }
  else if (io.exists('WORK.history.yaml')) { io.unlink('WORK.history.yaml'); }
}

async function tryStageCommit(git, lastStage, cycleId, io) {
  if (!git || typeof git.commit !== 'function') return null;
  const allowedPatterns = await computeAllowedPatterns(lastStage, cycleId, io);
  return tryCommit(git, buildCommitMessage(cycleId, lastStage), allowedPatterns, lastStage.stage);
}

function clearStageState(activeStage, lastStage, io) {
  if (activeStage) clearActiveStage(io);
  if (lastStage) clearLastStage(io);
}

export async function finaliseStage(args) {
  const { lastStage, activeStage, cycleId, io, finalize, git } = args;
  const original = readOriginalState(io);
  if (typeof finalize !== 'function') {
    return violation('orchestrate caller must inject a `finalize` function when providing lastResult; the plugin wires lib/finalize.finalizeStage; tests must pass a stub.', []);
  }
  const finalizeResult = await finalize({ cycleId, stage: lastStage.stage, baseSha: lastStage.baseSha, io });
  if (!finalizeResult.ok) {
    clearStageState(activeStage, null, io);
    return buildFinalizeViolation(finalizeResult);
  }
  const historyPath = 'WORK.history.yaml';
  const iteration = getIteration(historyPath, cycleId, io);
  const openFeedback = computeOpenFeedback(io);
  writeHistoryEntries({ historyPath, cycleId, lastStage, iteration, openFeedback, io });
  const commitErr = await tryStageCommit(git, lastStage, cycleId, io);
  if (commitErr) {
    rollbackState(io, original);
    clearStageState(activeStage, null, io);
    return commitErr;
  }
  clearStageState(activeStage, lastStage, io);
  return null;
}

export function handleViolation(args) {
  const { lastResult, activeStage, lastStage } = args;
  const failedStage = activeStage || lastStage;
  if (!failedStage) { return violation('lastResult.ok=false but no stage recorded — orphaned state'); }
  clearStageState(activeStage, lastStage, args.io);
  return violation(
    `subagent dispatch failed: ${lastResult.error || 'unknown error'}`,
    lastResult.affected_files || [],
  );
}
