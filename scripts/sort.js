#!/usr/bin/env node

/**
 * Sort — deterministic routing for a Foundry Cycle.
 *
 * Reads WORK.md (frontmatter + feedback) and WORK.history.yaml to determine
 * the next stage to execute, or signal completion/blocked.
 *
 * Usage:
 *     node scripts/sort.js [--work WORK.md] [--history WORK.history.yaml]
 *
 * Output (stdout): a full stage alias (e.g., forge:write-haiku), 'done', or 'blocked'
 * Exit code: 0 on success, 1 on error
 */

import { readFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import yaml from 'js-yaml';
import { minimatch } from 'minimatch';
import { validateTags } from './lib/tags.js';
import { parseFrontmatter } from './lib/workfile.js';
import { parseArtefactsTable } from './lib/artefacts.js';
import { loadHistory } from './lib/history.js';
import { parseFeedback, parseFeedbackItem, detectDeadlocks } from './lib/feedback.js';

// ---------------------------------------------------------------------------
// Stage helpers
// ---------------------------------------------------------------------------

function baseStage(stage) {
  return stage.split(':')[0];
}

function findFirst(stages, base) {
  for (const s of stages) {
    if (baseStage(s) === base) return s;
  }
  return null;
}

function nextInRoute(stages, current) {
  const idx = stages.indexOf(current);
  if (idx !== -1 && idx + 1 < stages.length) {
    return stages[idx + 1];
  }
  return null;
}

// ---------------------------------------------------------------------------
// I/O boundary — injectable for testing
// ---------------------------------------------------------------------------

const defaultIO = {
  readFile: (p) => readFileSync(p, 'utf-8'),
  exists: (p) => existsSync(p),
  exec: (cmd) => execSync(cmd, { encoding: 'utf8' }),
};

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Routing logic
// ---------------------------------------------------------------------------

function determineRoute(stages, history, feedback, maxIterations) {
  const forgeCount = history.filter(e => baseStage(e.stage || '') === 'forge').length;

  const nonSortHistory = history.filter(e => baseStage(e.stage || '') !== 'sort');
  const lastEntry = nonSortHistory.length > 0 ? nonSortHistory[nonSortHistory.length - 1].stage : null;
  const lastBase = lastEntry ? baseStage(lastEntry) : null;

  if (lastBase === null) return stages[0];

  if (lastBase === 'forge') {
    const next = nextInRoute(stages, lastEntry);
    return next ?? 'done';
  }

  if (lastBase === 'quench') {
    return nextAfterQuench(stages, lastEntry, feedback, forgeCount, maxIterations);
  }

  if (lastBase === 'appraise') {
    return nextAfterAppraise(stages, lastEntry, feedback, forgeCount, maxIterations, nonSortHistory);
  }

  if (lastBase === 'human-appraise') {
    return nextAfterAppraise(stages, lastEntry, feedback, forgeCount, maxIterations, nonSortHistory);
  }

  return 'blocked';
}

function nextAfterQuench(stages, current, feedback, forgeCount, maxIterations) {
  const needsForge = feedback.some(f => f.state === 'open' || f.state === 'rejected');
  if (needsForge) {
    if (forgeCount >= maxIterations) return 'blocked';
    return findFirst(stages, 'forge') ?? 'blocked';
  }

  return nextInRoute(stages, current) ?? 'done';
}

function nextAfterAppraise(stages, current, feedback, forgeCount, maxIterations, history = []) {
  // Check for deadlock escalation
  const deadlocked = detectDeadlocks(feedback, history);
  if (deadlocked.length > 0) {
    const humanAppraise = findFirst(stages, 'human-appraise');
    if (humanAppraise && baseStage(current) !== 'human-appraise') {
      return humanAppraise;
    }
    // Human-appraise not available or we're already in it — blocked
    if (forgeCount >= maxIterations) return 'blocked';
  }

  const needsForge = feedback.some(f => f.state === 'open' || f.state === 'rejected');
  if (needsForge) {
    if (forgeCount >= maxIterations) return 'blocked';
    return findFirst(stages, 'forge') ?? 'blocked';
  }

  const pendingApproval = feedback.some(
    f => (f.state === 'actioned' || f.state === 'wont-fix') && !f.resolved
  );
  if (pendingApproval) {
    return findFirst(stages, 'appraise') ?? 'blocked';
  }

  return nextInRoute(stages, current) ?? 'done';
}

// ---------------------------------------------------------------------------
// File modification enforcement
// ---------------------------------------------------------------------------

function getModifiedFiles(cycle, io = defaultIO) {
  try {
    // Find the last sort commit for this cycle to use as the base.
    // This captures ALL files modified since the last sort invocation,
    // even if the stage made multiple commits.
    const log = io.exec('git log --oneline -20');
    const sortPattern = `[${cycle}] sort:`;
    let commitCount = 1;
    let foundSortCommit = false;
    for (const line of log.trim().split('\n')) {
      commitCount++;
      if (line.includes(sortPattern)) {
        foundSortCommit = true;
        break;
      }
    }
    // If no sort commit found in recent history, fall back to HEAD~1
    if (!foundSortCommit) commitCount = 1;
    const output = io.exec(`git diff --name-only HEAD~${commitCount} HEAD`);
    return output.trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

function globMatch(filePath, pattern) {
  return minimatch(filePath, pattern);
}

function getAllowedPatterns(lastBase, foundryDir, cycleDef, io = defaultIO) {
  const always = ['WORK.md', 'WORK.history.yaml'];

  if (lastBase !== 'forge') {
    return always;
  }

  // For forge: also allow the output artefact's file-patterns
  try {
    const cycleText = io.readFile(cycleDef);
    const cycleFm = parseFrontmatter(cycleText);
    const outputType = cycleFm.output;
    if (!outputType) return always;

    const artDefPath = `${foundryDir}/artefacts/${outputType}/definition.md`;
    if (!io.exists(artDefPath)) return always;

    const artText = io.readFile(artDefPath);
    const artFm = parseFrontmatter(artText);
    const filePatterns = artFm['file-patterns'] || [];
    return [...always, ...filePatterns];
  } catch {
    return always;
  }
}

function checkModifiedFiles(lastBase, foundryDir, cycleDef, cycle, io = defaultIO) {
  const allowedPatterns = getAllowedPatterns(lastBase, foundryDir, cycleDef, io);
  const modified = getModifiedFiles(cycle, io);

  if (modified.length === 0) {
    return { ok: true, violations: [] };
  }

  const violations = modified.filter(f =>
    !allowedPatterns.some(pattern => globMatch(f, pattern))
  );

  return { ok: violations.length === 0, violations };
}

// ---------------------------------------------------------------------------
// Exported runSort — structured result for programmatic use
// ---------------------------------------------------------------------------

export function runSort({ workPath = 'WORK.md', historyPath = 'WORK.history.yaml', foundryDir = 'foundry', cycleDef } = {}, io = defaultIO) {
  if (!io.exists(workPath)) {
    return { route: 'blocked', details: 'WORK.md not found' };
  }

  const workText = io.readFile(workPath);
  const frontmatter = parseFrontmatter(workText);

  const cycle = frontmatter.cycle;
  const stages = frontmatter.stages;
  const maxIterations = frontmatter['max-iterations'] ?? 3;

  if (!cycle) return { route: 'blocked', details: 'No cycle in WORK.md frontmatter' };
  if (!stages || !Array.isArray(stages)) return { route: 'blocked', details: 'No stages in WORK.md frontmatter' };
  if (!findFirst(stages, 'forge')) return { route: 'blocked', details: 'stages must include at least one forge stage' };

  const artefacts = parseArtefactsTable(workText);
  const history = loadHistory(historyPath, cycle, io);
  const feedback = parseFeedback(workText, cycle, artefacts);

  // File modification enforcement
  const nonSortHistory = history.filter(e => baseStage(e.stage || '') !== 'sort');
  if (nonSortHistory.length > 0) {
    const lastEntry = nonSortHistory[nonSortHistory.length - 1];
    const lastBase = baseStage(lastEntry.stage || '');
    const resolvedCycleDef = cycleDef || frontmatter['cycle-def'] || `${foundryDir}/cycles/${cycle}.md`;
    const result = checkModifiedFiles(lastBase, foundryDir, resolvedCycleDef, cycle, io);
    if (!result.ok) {
      return { route: 'violation', details: `File modification violation after ${lastBase} stage: ${result.violations.join(', ')}` };
    }
  }

  // Tag validation
  const tagErrors = validateTags(workText, foundryDir);
  if (tagErrors.length > 0) {
    const details = tagErrors.map(e => `line ${e.line}: ${e.message}`).join('; ');
    return { route: 'violation', details: `Feedback tag validation failed: ${details}` };
  }

  const route = determineRoute(stages, history, feedback, maxIterations);

  // Model resolution
  let model = null;
  const routeBase = baseStage(route);
  if (frontmatter.models && frontmatter.models[routeBase]) {
    const modelId = frontmatter.models[routeBase];
    model = `foundry-${modelId.replace(/\//g, '-')}`;
  }

  return { route, ...(model ? { model } : {}) };
}

// ---------------------------------------------------------------------------
// Exports (for testing) — keep main() private
// ---------------------------------------------------------------------------

export { parseArtefactsTable } from './lib/artefacts.js';
export { loadHistory } from './lib/history.js';
export { parseFeedback, parseFeedbackItem } from './lib/feedback.js';

export {
  baseStage,
  findFirst,
  nextInRoute,
  parseFrontmatter,
  determineRoute,
  nextAfterQuench,
  nextAfterAppraise,
  globMatch,
  getModifiedFiles,
  getAllowedPatterns,
  checkModifiedFiles,
};


