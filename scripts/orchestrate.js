// Foundry v2.3.0 orchestrate: deterministic cycle orchestration.
// Composes internal functions (sort, finalize, history, commit, configure)
// into a single entry point the LLM drives via a 3-line loop.

import { runSort } from './sort.js';
import {
  getCycleDefinition,
  getArtefactType,
  getValidation,
} from './lib/config.js';
import { parseFrontmatter, writeFrontmatter } from './lib/workfile.js';
import { parseArtefactsTable, addArtefactRow, setArtefactStatus } from './lib/artefacts.js';
import { readActiveStage, readLastStage, clearActiveStage } from './lib/state.js';
import { appendEntry, getIteration } from './lib/history.js';

export function renderDispatchPrompt({ stage, cycle, token, cwd, filePatterns }) {
  const lines = [
    `You are a Foundry stage agent. Invoke the ${stage.split(':')[0]} skill and follow its instructions exactly.`,
    ``,
    `Stage: ${stage}`,
    `Cycle: ${cycle}`,
    `Token: ${token}`,
    `Working directory: ${cwd}`,
  ];
  if (filePatterns && filePatterns.length) {
    lines.push(`File patterns (forge only): ${JSON.stringify(filePatterns)}`);
  }
  lines.push(
    ``,
    `Your FIRST tool call MUST be foundry_stage_begin({stage, cycle, token}) using the values above.`,
    `Your LAST tool call MUST be foundry_stage_end({summary}).`,
    ``,
    `When done, report back a brief summary. Do NOT call foundry_history_append, foundry_git_commit, or foundry_artefacts_add — the orchestrator handles all of those.`
  );
  return lines.join('\n');
}

export function synthesizeStages({ cycleId, hasValidation, humanAppraise }) {
  const stages = [`forge:${cycleId}`];
  if (hasValidation) stages.push(`quench:${cycleId}`);
  stages.push(`appraise:${cycleId}`);
  if (humanAppraise) stages.push(`human-appraise:${cycleId}`);
  return stages;
}

export function needsSetup(workMdContent) {
  const match = workMdContent.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return true;
  const fm = match[1];
  return !/^stages:/m.test(fm);
}

// ---------------------------------------------------------------------------
// Task-6 stub helpers (wired in later). readForgeFilePatterns is real now
// because the first-call dispatch prompt needs it.
// ---------------------------------------------------------------------------

export function findCycleOutputArtefact(cycleId, io) {
  if (!io.exists('WORK.md')) return null;
  const content = io.readFile('WORK.md');
  const rows = parseArtefactsTable(content);
  const match = rows.find(r => r.cycle === cycleId);
  return match ? { file: match.file, type: match.type, status: match.status } : null;
}

export async function readCycleTargets(cycleId, io) {
  try {
    const cd = await getCycleDefinition('foundry', cycleId, io);
    return cd.frontmatter?.targets ?? [];
  } catch {
    return [];
  }
}

export async function readForgeFilePatterns(cycleId, io) {
  try {
    const cd = await getCycleDefinition('foundry', cycleId, io);
    const output = cd.frontmatter?.output;
    if (!output) return null;
    const at = await getArtefactType('foundry', output, io);
    return at.frontmatter?.['file-patterns'] ?? null;
  } catch {
    return null;
  }
}

function readRecentFeedback(_cycleId, _io) { return []; }

function violation(details, affectedFiles = []) {
  return {
    action: 'violation',
    details,
    recoverable: false,
    affected_files: affectedFiles,
  };
}

function markArtefactBlocked(cycleId, io) {
  if (!io.exists('WORK.md')) return;
  const content = io.readFile('WORK.md');
  const rows = parseArtefactsTable(content);
  const row = rows.find(r => r.cycle === cycleId);
  if (!row) return;
  try {
    io.writeFile('WORK.md', setArtefactStatus(content, row.file, 'blocked'));
  } catch {
    // setArtefactStatus is strict; if row already blocked/done or invalid, ignore.
  }
}

// ---------------------------------------------------------------------------
// Sort result -> action shape
// ---------------------------------------------------------------------------

async function handleSortResult(sortResult, { cycleId, cwd, io }) {
  const { route, model, token, details } = sortResult;
  const base = typeof route === 'string' ? route.split(':')[0] : '';

  if (route === 'done') {
    const art = findCycleOutputArtefact(cycleId, io);
    return {
      action: 'done',
      cycle: cycleId,
      artefact_file: art?.file ?? null,
      next_cycles: await readCycleTargets(cycleId, io),
    };
  }

  if (route === 'blocked') {
    const art = findCycleOutputArtefact(cycleId, io);
    return {
      action: 'blocked',
      cycle: cycleId,
      artefact_file: art?.file ?? null,
      reason: details ?? 'iteration limit reached with unresolved feedback',
    };
  }

  if (route === 'violation') {
    return violation(details ?? 'sort returned violation');
  }

  if (base === 'human-appraise') {
    const art = findCycleOutputArtefact(cycleId, io);
    return {
      action: 'human_appraise',
      stage: route,
      token,
      context: {
        cycle: cycleId,
        artefact_file: art?.file ?? null,
        recent_feedback: readRecentFeedback(cycleId, io),
      },
    };
  }

  // forge | quench | appraise
  const filePatterns = base === 'forge'
    ? await readForgeFilePatterns(cycleId, io)
    : null;

  return {
    action: 'dispatch',
    stage: route,
    subagent_type: model || 'general',
    prompt: renderDispatchPrompt({
      stage: route,
      cycle: cycleId,
      token,
      cwd,
      filePatterns,
    }),
  };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function runOrchestrate(args = {}, io) {
  const {
    cwd = process.cwd(),
    cycleDef: cycleDefOverride = null,
    git,
    mint,
    now = Date.now,
    lastResult = null,
    finalize = null,
  } = args;

  if (!io.exists('WORK.md')) {
    return violation('no WORK.md; flow skill must create it first');
  }

  let workContent = io.readFile('WORK.md');
  const fm = parseFrontmatter(workContent);
  const cycleId = fm.cycle;
  if (!cycleId) {
    return violation('WORK.md frontmatter missing cycle field', ['WORK.md']);
  }

  if (needsSetup(workContent)) {
    if (lastResult) {
      return violation(
        'inconsistent state: lastResult provided but WORK.md still needs setup',
        ['WORK.md']
      );
    }

    const foundryDir = 'foundry';
    let cycleDefDoc;
    try {
      cycleDefDoc = await getCycleDefinition(foundryDir, cycleId, io);
    } catch {
      return violation(`cycle definition not found for id: ${cycleId}`, ['WORK.md']);
    }
    const cfm = cycleDefDoc.frontmatter || {};

    const outputType = cfm.output;
    if (!outputType) {
      return violation(`cycle ${cycleId} missing output field`, ['WORK.md']);
    }

    try {
      await getArtefactType(foundryDir, outputType, io);
    } catch {
      return violation(`artefact type not found: ${outputType}`, ['WORK.md']);
    }

    const validation = await getValidation(foundryDir, outputType, io);

    let stages;
    if (Array.isArray(cfm.stages) && cfm.stages.length > 0) {
      stages = cfm.stages.map(s =>
        typeof s === 'string' && s.includes(':') ? s : `${s}:${cycleId}`
      );
    } else {
      stages = synthesizeStages({
        cycleId,
        hasValidation: !!validation && validation.length > 0,
        humanAppraise: cfm['human-appraise'] === true,
      });
    }

    const newFm = { ...fm };
    newFm.stages = stages;
    newFm['max-iterations'] = cfm['max-iterations'] ?? 3;
    newFm['human-appraise'] = cfm['human-appraise'] === true;
    newFm['deadlock-appraise'] = cfm['deadlock-appraise'] !== false;
    newFm['deadlock-iterations'] = cfm['deadlock-iterations'] ?? 5;
    if (cfm.models) newFm.models = cfm.models;

    const body = workContent.replace(/^---\n[\s\S]+?\n---\n?/, '');
    const fmBlock = writeFrontmatter(newFm);
    const newWork = body ? `${fmBlock}\n${body}` : fmBlock;
    io.writeFile('WORK.md', newWork);

    if (git && typeof git.commit === 'function') {
      git.commit(`[${cycleId}] setup: configure stages and limits`);
    }

    workContent = io.readFile('WORK.md');
  }

  if (lastResult) {
    const activeStage = readActiveStage(io);
    if (!activeStage) {
      return violation('lastResult provided but no active stage recorded — orphaned state');
    }

    if (lastResult.ok === false) {
      markArtefactBlocked(cycleId, io);
      clearActiveStage(io);
      const art = findCycleOutputArtefact(cycleId, io);
      return violation(
        `subagent dispatch failed: ${lastResult.error || 'unknown error'}`,
        [art?.file].filter(Boolean)
      );
    }

    let finalizeResult;
    if (finalize) {
      finalizeResult = await finalize({
        cycleId,
        stage: activeStage.stage,
        baseSha: activeStage.baseSha,
        io,
      });
    } else {
      // TODO(Task 10): wrap lib/finalize.finalizeStage here as the production default.
      finalizeResult = { ok: true, artefacts: [] };
    }

    if (!finalizeResult.ok) {
      markArtefactBlocked(cycleId, io);
      clearActiveStage(io);
      if (finalizeResult.error === 'unexpected_files') {
        return violation(
          `unexpected files written by subagent: ${(finalizeResult.files || []).join(', ')}`,
          finalizeResult.files || []
        );
      }
      return violation(`stage_finalize error: ${finalizeResult.error}`, []);
    }

    for (const a of finalizeResult.artefacts ?? []) {
      let wm = io.readFile('WORK.md');
      const rows = parseArtefactsTable(wm);
      if (!rows.some(r => r.file === a.file)) {
        wm = addArtefactRow(wm, {
          file: a.file,
          type: a.type,
          cycle: cycleId,
          status: a.status ?? 'draft',
        });
        io.writeFile('WORK.md', wm);
      }
    }

    const lastStage = readLastStage(io);
    const summary = lastStage?.summary || '(no summary)';
    const historyPath = 'WORK.history.yaml';
    const iteration = getIteration(historyPath, cycleId, io);

    appendEntry(historyPath, {
      cycle: cycleId,
      stage: 'sort',
      iteration,
      route: activeStage.stage,
      comment: `route ${activeStage.stage}`,
    }, io);
    appendEntry(historyPath, {
      cycle: cycleId,
      stage: activeStage.stage,
      iteration,
      comment: summary,
    }, io);

    if (git && typeof git.commit === 'function') {
      git.commit(`[${cycleId}] ${activeStage.stage}: ${summary}`);
    }
    clearActiveStage(io);
  }

  const sortResult = runSort(
    {
      cycleDef: cycleDefOverride,
      mint,
      now: typeof now === 'function' ? now() : now,
    },
    io
  );

  return handleSortResult(sortResult, { cycleId, cwd, io });
}
