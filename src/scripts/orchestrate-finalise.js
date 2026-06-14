// Foundry v3.x orchestrate: finalise stage and violation handlers.

import { sealCycleAttestation as hashSealCycle } from './lib/attestation/hash.js';
import { buildForgeHistoryEntry, parseFrontmatter } from './lib/workfile.js';
import { baseStage } from './lib/sort-routing.js';
import { clearActiveStage, clearLastStage } from './lib/state.js';
import { allowedPatternsForStage } from './lib/git-policy.js';
import { stageBaseOf } from './lib/stage-guard.js';
import { appendEntry, getIteration } from './lib/history.js';
import yaml from 'js-yaml';
import {
  tryCommit,
  violation,
  computeOpenFeedback,
  readForgeFilePatterns,
} from './orchestrate-cycle.js';

function buildFinalizeViolation(finalizeResult) {
  if (finalizeResult.error === 'unexpected_files') {
    return violation(`unexpected files written by subagent: ${(finalizeResult.files || []).join(', ')}`, finalizeResult.files || []);
  }
  return violation(`stage_finalize error: ${finalizeResult.error}`, []);
}

function resolveStageSummary(ctx) {
  return ctx.structuredSummary || ctx.lastStage.summary || '(no summary)';
}

function buildStageEntryBase(ctx) {
  const summary = resolveStageSummary(ctx);
  const changed = ctx.lastStage.changedFiles ?? [];
  const base = { cycle: ctx.cycleId, stage: ctx.lastStage.stage,
    iteration: ctx.iteration, comment: summary,
    openFeedback: ctx.openFeedback, changedFiles: changed,
  };
  if (baseStage(ctx.lastStage.stage || '') !== 'forge') return base;
  return { ...base, ...buildForgeHistoryEntry({
    cycle: ctx.cycleId, stage: ctx.lastStage.stage,
    iteration: ctx.iteration, comment: summary,
    artefactVersion: ctx.artefactVersion,
    contractPassed: ctx.contractPassed,
    changedFiles: changed,
  }) };
}

function writeHistoryEntries(ctx) {
  appendEntry(ctx.historyPath, {
    cycle: ctx.cycleId, stage: 'sort', iteration: ctx.iteration,
    route: ctx.lastStage.stage,
    comment: `route ${ctx.lastStage.stage}`,
    openFeedback: ctx.openFeedback,
  }, ctx.io);
  appendEntry(ctx.historyPath, buildStageEntryBase(ctx), ctx.io);
}

async function computeAllowedPatterns(lastStage, cycleId, io) {
  const stageB = stageBaseOf(lastStage.stage);
  let forgeFilePatterns = [];
  if (stageB === 'forge') {
    const result = await readForgeFilePatterns(cycleId, io);
    forgeFilePatterns = result ? result.patterns : [];
  }
  return allowedPatternsForStage({ stageBase: stageB, forgeFilePatterns });
}

function buildCommitMessage(cycleId, lastStage, structuredSummary) {
  return `[${cycleId}] ${lastStage.stage}: ${structuredSummary || lastStage.summary || '(no summary)'}`;
}

function rollbackState(io, original) {
  io.writeFile('WORK.md', original.workMd);
  if (original.history !== null) { io.writeFile('WORK.history.yaml', original.history); }
  else if (io.exists('WORK.history.yaml')) { io.unlink('WORK.history.yaml'); }
}

async function tryStageCommit(git, lastStage, cycleId, io, structuredSummary) {
  if (!git || typeof git.commit !== 'function') return null;
  const allowedPatterns = await computeAllowedPatterns(lastStage, cycleId, io);
  return tryCommit(git, buildCommitMessage(cycleId, lastStage, structuredSummary), allowedPatterns, lastStage.stage);
}

function clearStageState(activeStage, lastStage, io) {
  if (activeStage) clearActiveStage(io);
  if (lastStage) clearLastStage(io);
}

// ---------------------------------------------------------------------------
// Seal delegator — matches the R4/R8 signature sealCycleAttestation(runId, io)
// ---------------------------------------------------------------------------

/**
 * Seal the current run by delegating to hash.js sealCycleAttestation.
 *
 * @param {string} runId  ULID run identifier
 * @param {object} io     IO interface
 * @returns {Promise<{ ok: boolean, sealSha?: string, compositeStatus?: string, stageCount?: number, error?: string }>}
 */
export async function sealCycleAttestation(runId, io) {
  let result;
  try {
    result = await hashSealCycle(runId, io);
  } catch (err) {
    return { ok: false, error: err.message };
  }
  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  return {
    ok: true,
    sealSha: result.seal_hash,
    compositeStatus: result.composite_status,
    stageCount: result.stage_count,
  };
}

// ---------------------------------------------------------------------------
// Cycle stage list reader (for detecting final stage)
// ---------------------------------------------------------------------------

function readCycleStages(cycleName, io) {
  try {
    const content = io.readFile(`.foundry/cycles/${cycleName}.yaml`);
    const doc = yaml.load(content);
    return doc?.stages ?? [];
  } catch {
    return [];
  }
}

/**
 * Determine whether the current stage is the final stage of its cycle.
 */
function isFinalStageOfCycle(lastStage, cycleId, io) {
  const workText = io.readFile('WORK.md');
  const fm = parseFrontmatter(workText);
  const cycleName = fm['foundry-cycle'] || cycleId;
  const cycleStages = readCycleStages(cycleName, io);
  if (cycleStages.length === 0) return false;
  const currentStageName = lastStage.stage ? lastStage.stage.split(':')[0] : '';
  const lastStageName = cycleStages[cycleStages.length - 1].split(':')[0];
  return currentStageName === lastStageName;
}

/**
 * Read the run ID from WORK.md frontmatter.
 */
function readRunIdFromWork(io) {
  const workText = io.readFile('WORK.md');
  const fm = parseFrontmatter(workText);
  return fm['foundry-run'] || null;
}

/**
 * Seal the run on the final stage of the cycle.
 * Extracted from finaliseStage to keep complexity and line count down.
 */
async function maybeSealRun(lastStage, cycleId, git, io) {
  const runId = readRunIdFromWork(io);
  if (!runId) return;
  if (!isFinalStageOfCycle(lastStage, cycleId, io)) return;
  if (computeOpenFeedback(io) !== 0) return;

  const sealResult = await sealCycleAttestation(runId, io);
  if (!sealResult.ok) {
    console.warn(`finaliseStage: seal failed for run ${runId}: ${sealResult.error}`);
    return;
  }

  const bodyFields = [
    `foundry-run: ${runId}`,
    `attestation-seal: ${sealResult.sealSha}`,
    `composite-status: ${sealResult.compositeStatus}`,
    `stage-count: ${sealResult.stageCount}`,
  ].join('\n');

  // Read the current HEAD commit message via execFile, then append seal fields.
  const currentMessage = git.execFile(['log', '-1', '--pretty=%B']);
  const augmentedMessage = currentMessage.trimEnd() + '\n\n' + bodyFields;

  try {
    git.execFile(['commit', '--amend', '--allow-empty', '-m', augmentedMessage]);
  } catch (err) {
    console.warn(`finaliseStage: amend failed for run ${runId}: ${err.message}`);
  }
}

export async function finaliseStage(args) {
  const { lastStage, activeStage, cycleId, io, finalize, git, postVersion, contractPassed, structuredSummary } = args;
  const original = {
    workMd: io.readFile('WORK.md'),
    history: io.exists('WORK.history.yaml') ? io.readFile('WORK.history.yaml') : null,
  };
  if (typeof finalize !== 'function') {
    return violation('orchestrate caller must inject a `finalize` function when providing lastResult; the plugin wires lib/finalize.finalizeStage; tests must pass a stub.', []);
  }
  const finalizeResult = await finalize({
    cycleId, stage: lastStage.stage, baseSha: lastStage.baseSha, io,
    artefact_version: postVersion, contractPassed,
  });
  if (!finalizeResult.ok) {
    clearStageState(activeStage, null, io);
    return buildFinalizeViolation(finalizeResult);
  }
  const historyPath = 'WORK.history.yaml';
  const iteration = getIteration(historyPath, cycleId, io);
  const openFeedback = computeOpenFeedback(io);
  writeHistoryEntries({
    historyPath, cycleId,
    lastStage: { ...lastStage, changedFiles: finalizeResult.changedFiles },
    iteration, openFeedback, io,
    artefactVersion: postVersion, contractPassed,
    structuredSummary,
  });
  const commitErr = await tryStageCommit(git, lastStage, cycleId, io, structuredSummary);
  if (commitErr) {
    rollbackState(io, original);
    clearStageState(activeStage, null, io);
    return commitErr;
  }

  await maybeSealRun(lastStage, cycleId, git, io);
  clearStageState(activeStage, lastStage, io);
  return null;
}

export function handleViolation(args) {
  const { lastResult, activeStage, lastStage } = args;
  const failedStage = activeStage || lastStage;
  if (!failedStage) { return violation('lastResult.ok=false but the orchestrator has no record of which stage failed — no active stage and no last stage on disk. Call foundry_cycle_run() without arguments to sort and get back on track'); }
  clearStageState(activeStage, lastStage, args.io);
  return violation(
    `subagent dispatch failed for stage "${failedStage.stage}": ${lastResult.error || 'unknown error'}. ` +
    `Call foundry_cycle_run() to get the next action — the orchestrator will sort and route accordingly.`,
    lastResult.affected_files || [],
  );
}
