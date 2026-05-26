// Foundry v3.x orchestrate: finalise stage and violation handlers.

import { buildForgeHistoryEntry } from './lib/workfile.js';
import { baseStage } from './lib/sort-routing.js';
import { clearActiveStage, clearLastStage } from './lib/state.js';
import { allowedPatternsForStage } from './lib/git-policy.js';
import { stageBaseOf } from './lib/stage-guard.js';
import { appendEntry, getIteration } from './lib/history.js';
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

function buildStageEntryBase(ctx) {
  const summary = ctx.lastStage.summary || '(no summary)';
  const changed = ctx.lastStage.changedFiles ?? [];
  return { cycle: ctx.cycleId, stage: ctx.lastStage.stage,
    iteration: ctx.iteration, comment: summary,
    openFeedback: ctx.openFeedback, changedFiles: changed,
    ...(baseStage(ctx.lastStage.stage || '') === 'forge'
      ? buildForgeHistoryEntry({
        cycle: ctx.cycleId, stage: ctx.lastStage.stage,
        iteration: ctx.iteration, comment: summary,
        artefactVersion: ctx.artefactVersion,
        contractPassed: ctx.contractPassed,
        changedFiles: changed,
      })
      : {}),
  };
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
  const { lastStage, activeStage, cycleId, io, finalize, git, postVersion, contractPassed } = args;
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
  });
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
