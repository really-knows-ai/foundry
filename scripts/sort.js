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
import { parseArgs } from 'util';
import { join } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import { minimatch } from 'minimatch';
import { validateTags, extractAllTags } from './lib/tags.js';
import { parseFrontmatter } from './lib/workfile.js';
import { parseArtefactsTable } from './lib/artefacts.js';
import { loadHistory } from './lib/history.js';

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

function parseFeedback(text, cycle, artefacts) {
  const cycleFiles = new Set();
  for (const art of artefacts) {
    if (art.cycle === cycle) {
      cycleFiles.add(art.file || '');
    }
  }

  const items = [];
  let currentFile = null;
  let inFeedback = false;
  let feedbackLevel = 0; // 1 for '# Feedback', 2 for '## Feedback'

  for (const line of text.split('\n')) {
    const stripped = line.trim();

    if (stripped === '# Feedback' || stripped === '## Feedback') {
      inFeedback = true;
      feedbackLevel = stripped.startsWith('## ') ? 2 : 1;
      continue;
    }

    // Exit feedback on a heading at the same or higher level
    if (inFeedback && /^#{1,2} /.test(stripped)) {
      const level = stripped.startsWith('## ') ? 2 : 1;
      if (level <= feedbackLevel && stripped !== '# Feedback' && stripped !== '## Feedback') {
        inFeedback = false;
        continue;
      }
    }

    if (!inFeedback) continue;

    // File sub-headings are one level below the Feedback heading
    const fileHeadingPrefix = feedbackLevel === 1 ? '## ' : '### ';
    if (stripped.startsWith(fileHeadingPrefix)) {
      currentFile = stripped.slice(fileHeadingPrefix.length).trim();
      continue;
    }

    if (cycleFiles.has(currentFile) && /^- \[/.test(stripped)) {
      items.push(parseFeedbackItem(stripped));
    }
  }

  return items;
}

function parseFeedbackItem(line) {
  const item = { raw: line, state: 'unknown', tags: [], resolved: false };

  if (line.startsWith('- [ ]')) {
    item.state = 'open';
  } else if (line.startsWith('- [x]')) {
    item.state = 'actioned';
  } else if (line.startsWith('- [~]')) {
    item.state = 'wont-fix';
  }

  if (line.includes('| approved')) {
    item.resolved = true;
  } else if (line.includes('| rejected')) {
    item.state = 'rejected';
    item.resolved = false;
  }

  item.tags = extractAllTags(line);

  return item;
}

// ---------------------------------------------------------------------------
// Routing logic
// ---------------------------------------------------------------------------

function determineRoute(stages, history, feedback, maxIterations) {
  const forgeCount = history.filter(e => baseStage(e.stage || '') === 'forge').length;

  const nonSortHistory = history.filter(e => baseStage(e.stage || '') !== 'sort');
  const lastEntry = nonSortHistory.length > 0 ? nonSortHistory[nonSortHistory.length - 1].stage : null;
  const lastBase = lastEntry ? baseStage(lastEntry) : null;

  if (lastBase === null) return stages[0];

  if (lastBase === 'hitl') {
    const next = nextInRoute(stages, lastEntry);
    return next ?? 'done';
  }

  if (lastBase === 'forge') {
    const next = nextInRoute(stages, lastEntry);
    return next ?? 'done';
  }

  if (lastBase === 'quench') {
    return nextAfterQuench(stages, lastEntry, feedback, forgeCount, maxIterations);
  }

  if (lastBase === 'appraise') {
    return nextAfterAppraise(stages, feedback, forgeCount, maxIterations);
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

function nextAfterAppraise(stages, feedback, forgeCount, maxIterations) {
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

  return 'done';
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
// Exports (for testing) — keep main() private
// ---------------------------------------------------------------------------

export { parseArtefactsTable } from './lib/artefacts.js';
export { loadHistory } from './lib/history.js';

export {
  baseStage,
  findFirst,
  nextInRoute,
  parseFrontmatter,
  parseFeedback,
  parseFeedbackItem,
  determineRoute,
  nextAfterQuench,
  nextAfterAppraise,
  globMatch,
  getModifiedFiles,
  getAllowedPatterns,
  checkModifiedFiles,
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const { values } = parseArgs({
    options: {
      work: { type: 'string', default: 'WORK.md' },
      history: { type: 'string', default: 'WORK.history.yaml' },
      'foundry-dir': { type: 'string', default: 'foundry' },
      'cycle-def': { type: 'string' },
    },
  });

  const workPath = values.work;
  const historyPath = values.history;
  const foundryDir = values['foundry-dir'];

  if (!existsSync(workPath)) {
    process.stderr.write('ERROR: WORK.md not found\n');
    process.exit(1);
  }

  const workText = readFileSync(workPath, 'utf-8');
  const frontmatter = parseFrontmatter(workText);

  const cycle = frontmatter.cycle;
  const stages = frontmatter.stages;
  const maxIterations = frontmatter['max-iterations'] ?? 3;

  if (!cycle) {
    process.stderr.write('ERROR: No cycle in WORK.md frontmatter\n');
    process.exit(1);
  }

  if (!stages || !Array.isArray(stages)) {
    process.stderr.write('ERROR: No stages in WORK.md frontmatter\n');
    process.exit(1);
  }

  if (!findFirst(stages, 'forge')) {
    process.stderr.write('ERROR: stages must include at least one forge stage\n');
    process.exit(1);
  }

  const artefacts = parseArtefactsTable(workText);
  const history = loadHistory(historyPath, cycle, defaultIO);
  const feedback = parseFeedback(workText, cycle, artefacts);

  // --- File modification enforcement ---
  const nonSortHistory = history.filter(e => baseStage(e.stage || '') !== 'sort');
  if (nonSortHistory.length > 0) {
    const lastEntry = nonSortHistory[nonSortHistory.length - 1];
    const lastBase = baseStage(lastEntry.stage || '');

    // Resolve cycle-def: CLI arg > WORK.md frontmatter field
    const cycleDef = values['cycle-def']
      || frontmatter['cycle-def']
      || `${foundryDir}/cycles/${cycle}.md`;

    const result = checkModifiedFiles(lastBase, foundryDir, cycleDef, cycle);
    if (!result.ok) {
      console.log('violation');
      process.stderr.write(`File modification violation after ${lastBase} stage:\n`);
      result.violations.forEach(f => process.stderr.write(`  ${f}\n`));
      process.exit(0);
    }
  }

  // --- Tag validation ---
  const tagErrors = validateTags(workText, foundryDir);
  if (tagErrors.length > 0) {
    console.log('violation');
    process.stderr.write(`Feedback tag validation failed (${tagErrors.length} issue${tagErrors.length > 1 ? 's' : ''}):\n`);
    tagErrors.forEach(e => process.stderr.write(`  line ${e.line}: ${e.message}\n`));
    process.exit(0);
  }

  const route = determineRoute(stages, history, feedback, maxIterations);
  console.log(route);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
