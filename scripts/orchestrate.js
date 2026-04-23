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
import { listFeedback } from './lib/feedback.js';
import { loadExtractor } from './lib/assay/loader.js';

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

export function synthesizeStages({ cycleId, hasValidation, humanAppraise, assay = false }) {
  const stages = [];
  if (assay) stages.push(`assay:${cycleId}`);
  stages.push(`forge:${cycleId}`);
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

function readRecentFeedback(cycleId, io, limit = 5) {
  // Best-effort: surface recent deadlocked items (rejected or wont-fix) for
  // the human-appraise checkpoint. Returns last `limit` matching entries.
  // On any parse error, return [] rather than crashing the cycle.
  try {
    if (!io.exists('WORK.md')) return [];
    const content = io.readFile('WORK.md');
    const rows = parseArtefactsTable(content);
    const items = listFeedback(content, cycleId, rows);
    const deadlocked = items.filter(
      it => it.state === 'wont-fix' || it.state === 'rejected'
    );
    return deadlocked.slice(-limit);
  } catch {
    return [];
  }
}

function violation(details, affectedFiles = []) {
  return {
    action: 'violation',
    details,
    recoverable: false,
    affected_files: affectedFiles,
  };
}

function markArtefactBlocked(cycleId, io) {
  if (!io.exists('WORK.md')) return { ok: true };
  const content = io.readFile('WORK.md');
  const rows = parseArtefactsTable(content);
  const row = rows.find(r => r.cycle === cycleId);
  if (!row) return { ok: true };
  try {
    io.writeFile('WORK.md', setArtefactStatus(content, row.file, 'blocked'));
    return { ok: true };
  } catch (e) {
    // Surface to caller: setArtefactStatus is strict (e.g. row already
    // blocked/done, invalid status). Don't crash; let caller annotate
    // the violation.
    return { ok: false, error: e?.message || String(e) };
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
  if (!model) {
    const art = findCycleOutputArtefact(cycleId, io);
    return violation(
      `cycle ${cycleId} stage ${route} has no model declared in cycle definition (\`models:\` field) and no default available`,
      [art?.file].filter(Boolean)
    );
  }

  const filePatterns = base === 'forge'
    ? await readForgeFilePatterns(cycleId, io)
    : null;

  return {
    action: 'dispatch',
    stage: route,
    subagent_type: model,
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

    // Validate and normalise the cycle's `assay:` opt-in, if present.
    const assayBlock = cfm.assay;
    let assayExtractors = null;
    if (assayBlock !== undefined && assayBlock !== null) {
      if (typeof assayBlock !== 'object' || Array.isArray(assayBlock)) {
        return violation(`cycle ${cycleId}: 'assay' must be a mapping (got ${typeof assayBlock})`, ['WORK.md']);
      }
      const list = assayBlock.extractors;
      if (!Array.isArray(list) || list.length === 0) {
        return violation(`cycle ${cycleId}: 'assay.extractors' must be a non-empty array`, ['WORK.md']);
      }

      // Memory must be enabled.
      const memoryEnabled = await io.exists('foundry/memory/config.md');
      if (!memoryEnabled) {
        return violation(`cycle ${cycleId}: 'assay:' requires memory to be enabled (run the init-memory skill first)`, ['WORK.md']);
      }

      // Build the cycle's write-types set.
      const cycleWrite = cfm.memory?.write;
      if (!Array.isArray(cycleWrite)) {
        return violation(`cycle ${cycleId}: 'assay:' requires the cycle to declare memory.write`, ['WORK.md']);
      }
      const cycleWriteSet = new Set(cycleWrite);

      // Load each extractor and check its memory.write ⊆ cycle.memory.write.
      for (const name of list) {
        let ext;
        try { ext = await loadExtractor(foundryDir, name, io); }
        catch (err) { return violation(`cycle ${cycleId}: ${err.message}`, ['WORK.md']); }
        const missing = ext.memoryWrite.filter((t) => !cycleWriteSet.has(t));
        if (missing.length > 0) {
          return violation(
            `cycle ${cycleId}: extractor '${name}' writes types not permitted by the cycle's memory.write: ${missing.join(', ')}`,
            ['WORK.md'],
          );
        }
      }
      assayExtractors = list;
    }

    let stages;
    if (Array.isArray(cfm.stages)) {
      if (cfm.stages.length === 0) {
        const art = findCycleOutputArtefact(cycleId, io);
        return violation(
          `cycle ${cycleId} has no stages declared in cycle definition`,
          [art?.file, 'WORK.md'].filter(Boolean)
        );
      }
      stages = cfm.stages.map(s =>
        typeof s === 'string' && s.includes(':') ? s : `${s}:${cycleId}`
      );
    } else {
      stages = synthesizeStages({
        cycleId,
        hasValidation: !!validation && validation.length > 0,
        humanAppraise: cfm['human-appraise'] === true,
        assay: !!assayExtractors,
      });
    }

    const newFm = { ...fm };
    newFm.stages = stages;
    newFm['max-iterations'] = cfm['max-iterations'] ?? 3;
    newFm['human-appraise'] = cfm['human-appraise'] === true;
    newFm['deadlock-appraise'] = cfm['deadlock-appraise'] !== false;
    newFm['deadlock-iterations'] = cfm['deadlock-iterations'] ?? 5;
    if (cfm.models) newFm.models = cfm.models;
    if (assayExtractors) newFm.assay = { extractors: assayExtractors };

    const body = workContent.replace(/^---\n[\s\S]+?\n---\n?/, '');
    const fmBlock = writeFrontmatter(newFm);
    const newWork = body ? `${fmBlock}\n${body}` : fmBlock;
    io.writeFile('WORK.md', newWork);

    if (git && typeof git.commit === 'function') {
      git.commit(`[${cycleId}] setup: configure stages and limits`);
    }

    workContent = io.readFile('WORK.md');
  }

  const activeStage = readActiveStage(io);
  const lastStage = readLastStage(io);

  if (activeStage && !lastResult) {
    return violation(
      `prior stage ${activeStage.stage} orphaned — no lastResult provided but active stage exists. ` +
      `Likely cause: previous orchestrate call returned dispatch but caller did not follow up.`,
      []
    );
  }

  if (lastResult) {
    // Subagent crash path: stage_end may NOT have been called, so activeStage
    // can still exist and lastStage may be stale or absent. Prefer activeStage
    // (current dispatch) over lastStage (could be from a prior cycle).
    if (lastResult.ok === false) {
      const failedStage = activeStage || lastStage;
      if (!failedStage) {
        return violation('lastResult.ok=false but no stage recorded — orphaned state');
      }
      const blockResult = markArtefactBlocked(cycleId, io);
      if (activeStage) clearActiveStage(io);
      const art = findCycleOutputArtefact(cycleId, io);
      const blockNote = blockResult.ok ? '' : ` (also: failed to mark artefact blocked: ${blockResult.error})`;
      return violation(
        `subagent dispatch failed: ${lastResult.error || 'unknown error'}${blockNote}`,
        [art?.file].filter(Boolean)
      );
    }

    // Happy path: foundry_stage_end has run, which writes lastStage and clears
    // activeStage. lastStage is the canonical source of stage identity & baseSha.
    if (!lastStage) {
      return violation('lastResult provided but no last stage recorded — orphaned state');
    }

    let finalizeResult;
    if (typeof finalize !== 'function') {
      return violation(
        'orchestrate caller must inject a `finalize` function when providing lastResult; ' +
        'the plugin wires lib/finalize.finalizeStage; tests must pass a stub.',
        []
      );
    }
    finalizeResult = await finalize({
      cycleId,
      stage: lastStage.stage,
      baseSha: lastStage.baseSha,
      io,
    });

    if (!finalizeResult.ok) {
      const blockResult = markArtefactBlocked(cycleId, io);
      if (activeStage) clearActiveStage(io);
      const blockNote = blockResult.ok ? '' : ` (also: failed to mark artefact blocked: ${blockResult.error})`;
      if (finalizeResult.error === 'unexpected_files') {
        return violation(
          `unexpected files written by subagent: ${(finalizeResult.files || []).join(', ')}${blockNote}`,
          finalizeResult.files || []
        );
      }
      return violation(`stage_finalize error: ${finalizeResult.error}${blockNote}`, []);
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

    const summary = lastStage.summary || '(no summary)';
    const historyPath = 'WORK.history.yaml';
    const iteration = getIteration(historyPath, cycleId, io);

    appendEntry(historyPath, {
      cycle: cycleId,
      stage: 'sort',
      iteration,
      route: lastStage.stage,
      comment: `route ${lastStage.stage}`,
    }, io);
    appendEntry(historyPath, {
      cycle: cycleId,
      stage: lastStage.stage,
      iteration,
      comment: summary,
    }, io);

    if (git && typeof git.commit === 'function') {
      git.commit(`[${cycleId}] ${lastStage.stage}: ${summary}`);
    }
    // Defensive: stage_end clears activeStage already; this is a no-op in the
    // normal lifecycle but cleans up if the subagent skipped stage_end.
    if (activeStage) clearActiveStage(io);
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

// Test-only export; keep underscored to discourage runtime use.
export { handleSortResult as __handleSortResultForTest };
