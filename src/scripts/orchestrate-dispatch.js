// Foundry v3.x orchestrate: post-dispatch handlers for structured output
// reading from .foundry/stage-outputs/ files.

import path from 'node:path';
import { computeArtefactVersion } from './lib/artefacts.js';
import { enforceForgeContract } from './lib/forge-contract.js';
import { loadHistory } from './lib/history.js';
import { stageBaseOf } from './lib/stage-guard.js';
import { readForgeFilePatterns, violation } from './orchestrate-cycle.js';
import { openFeedbackStore } from './lib/feedback-store.js';
import { finaliseStage } from './orchestrate-phases.js';

const FORGE_CTX = '.foundry/forge-context.json';

export function safeUnlink(io, filePath) {
  try { io.unlink(filePath); } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    console.warn(`ENOENT: file already removed: ${filePath}`);
  }
}

export async function readStageOutput(filePath, io) {
  try {
    const content = await io.readFile(filePath);
    const lines = content.trim().split('\n').filter(Boolean);
    if (lines.length === 0) return null;
    return JSON.parse(lines[0]);
  } catch {
    return null;
  }
}

async function readForgeStageOutput(io) {
  let entries;
  try { entries = await io.readDir('.foundry/stage-outputs'); } catch { entries = []; }
  return parseForgeOutput(entries, io);
}

async function parseForgeOutput(entries, io) {
  const files = (Array.isArray(entries) ? entries : []).filter(f => f.endsWith('.jsonl'));
  if (files.length === 0) return { ok: false, error: 'forge: no stage output found' };
  if (files.length > 1) return { ok: false, error: 'forge: unexpected multiple output files' };
  const filePath = path.join('.foundry/stage-outputs', files[0]);
  const output = await readStageOutput(filePath, io);
  if (!output) return { ok: false, error: 'forge: malformed stage output' };
  safeUnlink(io, filePath);
  return { ok: true, output };
}

export async function enforceForgeStage(forgeCtx, fgResult, cycleId, io, cwd) {
  const postVersion = await computeArtefactVersion('foundry', fgResult.outputType, io, cwd);
  const feedbackStore = openFeedbackStore('WORK.feedback.yaml', io);

  const stageResult = await readForgeStageOutput(io);
  if (!stageResult.ok) return stageResult;

  const output = stageResult.output;
  if (output.reason) {
    console.log(`forge stage output reason: ${output.reason}`);
  }
  // Build summary string for the existing enforceForgeContract which expects
  // the old free-text format: "ACTIONED", "WONT-FIX: reason", or "DONE".
  const summary = buildForgeSummary(output);
  const item = forgeCtx.forgeItem || null;

  const { contractPassed } = enforceForgeContract({
    item, preVersion: forgeCtx.forgePreVersion, postVersion, summary, feedbackStore, cycleId,
  });

  if (checkConsecutiveFailures(contractPassed, io, cycleId)) {
    return { violation: 'forge contract failed 3 consecutive times — unable to satisfy feedback requirements' };
  }
  return { postVersion, contractPassed, summary };
}

function buildForgeSummary(output) {
  if (output.status === 'wont-fix') {
    return output.reason ? `WONT-FIX: ${output.reason}` : 'WONT-FIX';
  }
  if (output.status === 'actioned') return 'ACTIONED';
  return 'DONE';
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

export function checkConsecutiveFailures(contractPassed, io, cycleId) {
  if (!contractPassed) {
    return countConsecutiveForgeFailures(io, cycleId) + 1 >= 3;
  }
  return false;
}

export async function captureForgeContext(sortResult, args, preCheck, io) {
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
    ? ({
      id: unresolvedItems[0].id,
      file: unresolvedItems[0].file,
      tag: unresolvedItems[0].tag,
      text: unresolvedItems[0].text,
      source: (typeof unresolvedItems[0].source === 'string'
        ? unresolvedItems[0].source.split(':')[0]
        : unresolvedItems[0].source),
      sourceAlias: unresolvedItems[0].source,
    })
    : null;
  const ctx = { forgePreVersion: preVersion, forgeItem };
  io.writeFile(FORGE_CTX, JSON.stringify(ctx));
}

export async function runForgePostDispatch(args, activeStage, lastStage, cycleId, io) {
  const fgResult = await readForgeFilePatterns(cycleId, io);
  const base = { lastStage, activeStage, cycleId, io, finalize: args.finalize, git: args.git };
  if (!fgResult) return finaliseStage(base);
  if (!io.exists(FORGE_CTX)) return finaliseStage(base);
  const forgeCtx = JSON.parse(io.readFile(FORGE_CTX));
  io.unlink(FORGE_CTX);
  const result = await enforceForgeStage(forgeCtx, fgResult, cycleId, io, args.cwd);
  if (result.violation) return violation(result.violation, []);
  if (result.error) return violation(result.error, []);
  return finaliseStage({
    ...base,
    postVersion: result.postVersion,
    contractPassed: result.contractPassed,
    structuredSummary: result.summary,
  });
}

function isVerdictApproved(output) {
  return output && output.verdict === 'approved';
}

async function readStageOutputFiles(io) {
  const dir = '.foundry/stage-outputs';
  let entries;
  try { entries = await io.readDir(dir); } catch { entries = []; }
  return (entries || []).filter(f => f.endsWith('.jsonl'));
}

export async function runHumanAppraisePostDispatch(args, activeStage, lastStage, cycleId, io) {
  const files = await readStageOutputFiles(io);

  if (files.length === 0) {
    return finaliseStage({
      lastStage: { ...lastStage, summary: 'Human appraisal complete' }, activeStage, cycleId, io,
      finalize: args.finalize, git: args.git,
    });
  }

  const output = await readStageOutput(path.join('.foundry/stage-outputs', files[0]), io);
  let humanSummary = 'Human appraisal complete';
  if (isVerdictApproved(output)) humanSummary = 'Human approved';
  for (const f of files) {
    safeUnlink(io, path.join('.foundry/stage-outputs', f));
  }

  return finaliseStage({
    lastStage: { ...lastStage, summary: humanSummary }, activeStage, cycleId, io,
    finalize: args.finalize, git: args.git,
  });
}

export function routePostDispatchStage(baseStageName, opts) {
  if (baseStageName === 'forge') return runForgePostDispatch(opts.args, opts.activeStage, opts.lastStage, opts.cycleId, opts.io);
  if (baseStageName === 'human-appraise') return runHumanAppraisePostDispatch(opts.args, opts.activeStage, opts.lastStage, opts.cycleId, opts.io);
  return finaliseStage({
    lastStage: opts.lastStage,
    activeStage: opts.activeStage,
    cycleId: opts.cycleId,
    io: opts.io,
    finalize: opts.args.finalize,
    git: opts.args.git,
  });
}
