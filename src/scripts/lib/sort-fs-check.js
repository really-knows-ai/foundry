/**
 * Sort filesystem-check helpers — git-backed routines that verify which
 * files were modified during a stage and that prior stage commits are clean.
 *
 * Extracted from `src/scripts/sort.js` to keep that file under the
 * configured `max-lines` limit and to lower per-function complexity.
 */

import { readFileSync, writeFileSync, existsSync, renameSync } from 'fs';
import { execFileSync } from 'child_process';

import { minimatch } from 'minimatch';
import { parseFrontmatter } from './workfile.js';

export const defaultIO = {
  readFile: (p) => readFileSync(p, 'utf-8'),
  writeFile: (p, c) => writeFileSync(p, c),
  rename: (from, to) => renameSync(from, to),
  exists: (p) => existsSync(p),
  exec: (argv) => execFileSync(argv[0], argv.slice(1), { encoding: 'utf8' }),
};

function findSortCommitSha(log, cycle) {
  const sortPattern = `[${cycle}] sort:`;
  for (const line of log.trim().split('\n')) {
    if (line.includes(sortPattern)) {
      return line.split(' ', 1)[0];
    }
  }
  return null;
}

export function getModifiedFiles(cycle, io = defaultIO) {
  try {
    const log = io.exec(['git', 'log', '--oneline', '-20']);
    const sortSha = findSortCommitSha(log, cycle);
    if (!sortSha) return [];
    const output = io.exec(['git', 'diff', '--name-only', '--no-renames', '-z', sortSha, 'HEAD']);
    return output.split('\0').filter(Boolean);
  } catch {
    return [];
  }
}

export function globMatch(filePath, pattern) {
  return minimatch(filePath, pattern);
}

function resolveForgePatterns(foundryDir, cycleDef, io) {
  const cycleText = io.readFile(cycleDef);
  const cycleFm = parseFrontmatter(cycleText);
  const outputType = cycleFm['output-type'];
  if (!outputType) return null;

  const artDefPath = `${foundryDir}/artefacts/${outputType}/definition.md`;
  if (!io.exists(artDefPath)) return null;

  const artText = io.readFile(artDefPath);
  const artFm = parseFrontmatter(artText);
  return artFm['file-patterns'] || [];
}

function tryResolveForgePatterns(foundryDir, cycleDef, io) {
  try {
    return resolveForgePatterns(foundryDir, cycleDef, io);
  } catch {
    return null;
  }
}

export function getAllowedPatterns(lastBase, foundryDir, cycleDef, io = defaultIO) {
  const always = ['WORK.md', 'WORK.feedback.yaml', 'WORK.history.yaml'];
  if (lastBase === 'assay') return [...always, '.foundry/**', 'foundry-memory/**'];
  if (lastBase !== 'forge') return always;
  const filePatterns = tryResolveForgePatterns(foundryDir, cycleDef, io);
  return filePatterns ? [...always, ...filePatterns] : always;
}

export function checkModifiedFiles(lastBase, foundryDir, cycleDef, cycle, io = defaultIO) {
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

/**
 * Return a list of tool-managed files that have uncommitted changes
 * (modified, staged, or untracked) in the working tree.
 *
 * Tool-managed files are WORK.md, WORK.feedback.yaml, WORK.history.yaml,
 * and anything under .foundry/. `foundry_cycle_run` is the sole writer
 * of these between stages, and every stage commit is performed internally
 * by the orchestrator's git bridge (the previously-public
 * `foundry_git_commit` tool was deregistered in v2.3.0). If this function
 * returns a non-empty list at the start of a sort invocation, a prior
 * stage's commit was skipped or aborted.
 */
export function getDirtyToolManagedFiles(io = defaultIO) {
  try {
    const output = io.exec([
      'git', 'status', '--porcelain', '-z', '--',
      'WORK.md', 'WORK.feedback.yaml', 'WORK.history.yaml', '.foundry',
    ]);
    return output
      .split('\0')
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => line.replace(/^[\sMADRCU?!]+/, '').trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}
