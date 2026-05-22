/**
 * Artefacts table utilities for WORK.md.
 *
 * Parses, adds rows to, and updates status in the markdown artefacts table.
 */

import { minimatch } from 'minimatch';
import { sortPaths } from './attestation/hash.js';
import { getArtefactType } from './config.js';

// --- Table line classifiers ---

function isTableHeader(line) {
  return line.startsWith('| File');
}

function isTableSeparator(line) {
  return line.startsWith('|---');
}

function isTableRow(line) {
  return line.startsWith('|');
}

function parseTableRow(line) {
  const cols = line.split('|').slice(1, -1).map(c => c.trim());
  return cols.length >= 4 ? cols : null;
}

// --- Status validation ---

function validateStatus(newStatus) {
  if (newStatus === 'draft') {
    throw new Error('status draft not permitted; artefacts are registered automatically during orchestration');
  }
  if (!['done', 'blocked'].includes(newStatus)) {
    throw new Error(`invalid status: ${newStatus}`);
  }
}

// --- Table boundary detection ---

function findTableHeader(lines) {
  for (let i = 0; i < lines.length; i++) {
    if (isTableHeader(lines[i].trim())) return i;
  }
  return -1;
}

function findTableSeparator(lines, afterIdx) {
  for (let i = afterIdx + 1; i < lines.length; i++) {
    if (isTableSeparator(lines[i].trim())) return i;
  }
  return -1;
}

function getTableBounds(lines) {
  const headerIdx = findTableHeader(lines);
  if (headerIdx < 0) return null;
  const sepIdx = findTableSeparator(lines, headerIdx);
  if (sepIdx < 0) return null;
  return { headerIdx, sepIdx };
}

function findTableEnd(lines, startIdx) {
  for (let i = startIdx; i < lines.length; i++) {
    const stripped = lines[i].trim();
    if (!isTableRow(stripped)) return i;
  }
  return lines.length;
}

function formatTableRow(cols) {
  return '| ' + cols.join(' | ') + ' |';
}

/**
 * Parse the artefacts markdown table from text.
 * @param {string} text
 * @returns {Array<{file: string, type: string, cycle: string, status: string}>}
 */
export function parseArtefactsTable(text) {
  const lines = text.split('\n');
  const bounds = getTableBounds(lines);
  if (!bounds) return [];

  const artefacts = [];
  const endIdx = findTableEnd(lines, bounds.sepIdx + 1);

  for (let i = bounds.sepIdx + 1; i < endIdx; i++) {
    const cols = parseTableRow(lines[i].trim());
    if (cols) {
      artefacts.push({
        file: cols[0],
        type: cols[1],
        cycle: cols[2],
        status: cols[3],
      });
    }
  }

  return artefacts;
}

/**
 * Add a row to the artefacts table.
 * @param {string} text - Full WORK.md text
 * @param {{file: string, type: string, cycle: string, status: string}} row
 * @returns {string} Updated text
 */
export function addArtefactRow(text, { file, type, cycle, status }) {
  const lines = text.split('\n');
  const bounds = getTableBounds(lines);

  if (!bounds) {
    throw new Error('Artefacts table not found');
  }

  const endIdx = findTableEnd(lines, bounds.sepIdx + 1);
  const insertAt = endIdx > bounds.sepIdx + 1 ? endIdx - 1 : bounds.sepIdx;
  const newRow = `| ${file} | ${type} | ${cycle} | ${status} |`;
  lines.splice(insertAt + 1, 0, newRow);
  return lines.join('\n');
}

/**
 * Update the status column for a specific file in the artefacts table.
 * @param {string} text - Full WORK.md text
 * @param {string} file - File name to match
 * @param {string} newStatus - New status value
 * @returns {string} Updated text
 */
export function setArtefactStatus(text, file, newStatus) {
  validateStatus(newStatus);

  const lines = text.split('\n');
  const bounds = getTableBounds(lines);

  if (!bounds) {
    throw new Error(`File not found in artefacts table: ${file}`);
  }

  const endIdx = findTableEnd(lines, bounds.sepIdx + 1);

  for (let i = bounds.sepIdx + 1; i < endIdx; i++) {
    const cols = parseTableRow(lines[i].trim());
    if (cols && cols[0] === file) {
      cols[3] = newStatus;
      lines[i] = formatTableRow(cols);
      return lines.join('\n');
    }
  }

  throw new Error(`File not found in artefacts table: ${file}`);
}

/**
 * Get draft artefacts for a specific cycle from the artefacts table.
 * @param {string} cycleId - Cycle ID to filter by
 * @param {object} io - IO interface
 * @returns {Array<{file: string, type: string, cycle: string, status: string}>}
 */
export function getArtefactsForCycle(cycleId, io) {
  const text = io.readFile('WORK.md');
  const artefacts = parseArtefactsTable(text);
  return artefacts.filter(a => a.cycle === cycleId && a.status === 'draft');
}

// --- Shared branch artefact discovery ---

const STATUS_HANDLERS = {
  A: (parts) => [{ file: parts[1], state: 'new' }],
  M: (parts) => [{ file: parts[1], state: 'modified' }],
  T: (parts) => [{ file: parts[1], state: 'modified' }],
  U: (parts) => [{ file: parts[1], state: 'modified' }],
  D: (parts) => [{ file: parts[1], state: 'deleted' }],
  R: (parts) => [
    { file: parts[1], state: 'deleted' },
    { file: parts[2], state: 'new' },
  ],
  C: (parts) => [{ file: parts[2], state: 'new' }],
};

/**
 * Parse a single git diff --name-status line into one or more { file, state } entries.
 * Uses a lookup table to map status codes to handlers.
 * @param {string} line - A line from git diff --name-status output
 * @returns {Array<{file: string, state: string}>}
 */
function parseDiffStatusLine(line) {
  const parts = line.split('\t');
  const handler = STATUS_HANDLERS[parts[0][0]];
  return handler ? handler(parts) : [];
}

/**
 * Parse git diff --name-status output into an array of { file, state } entries.
 * @param {string} output - Raw output from git diff --name-status
 * @returns {Array<{file: string, state: string}>}
 */
function parseDiffOutput(output) {
  const entries = [];
  if (!output) return entries;
  for (const line of output.trim().split('\n')) {
    if (!line) continue;
    for (const entry of parseDiffStatusLine(line)) {
      entries.push(entry);
    }
  }
  return entries;
}

/**
 * Collect changed files from the branch since a given base SHA.
 * Combines committed, unstaged, staged, and untracked changes.
 *
 * Sources are ordered by increasing priority: committed, unstaged, staged, untracked.
 * This function does not deduplicate per-file entries; call dedupeArtefactChanges for that.
 *
 * @param {string} branchBaseSha - The merge-base SHA for the branch
 * @param {object} io - IO interface with exec
 * @returns {Array<{file: string, state: string}>}
 */
function getBranchChangedFiles(branchBaseSha, io) {
  const changes = [];

  // Diff-based sources: committed, unstaged, staged
  changes.push(...parseDiffOutput(io.exec(['git', 'diff', '--name-status', `${branchBaseSha}..HEAD`])));
  changes.push(...parseDiffOutput(io.exec(['git', 'diff', '--name-status'])));
  changes.push(...parseDiffOutput(io.exec(['git', 'diff', '--cached', '--name-status'])));

  // Untracked files (not in git)
  const untracked = io.exec(['git', 'ls-files', '--others', '--exclude-standard']);
  if (untracked) {
    for (const file of untracked.trim().split('\n')) {
      if (!file) continue;
      changes.push({ file, state: 'new' });
    }
  }

  return changes;
}

/**
 * Deduplicate artefact changes, keeping the most recent state for each file.
 * Because later git sources (staged, untracked) take precedence over earlier
 * ones (committed), the last occurrence of a file wins.
 *
 * @param {Array<{file: string, state: string}>} changes
 * @returns {Array<{file: string, state: string}>}
 */
function dedupeArtefactChanges(changes) {
  const seen = new Map();
  for (const { file, state } of changes) {
    seen.set(file, state);
  }
  return Array.from(seen.entries()).map(([file, state]) => ({ file, state }));
}

/**
 * Resolve the merge-base SHA between HEAD and a base branch.
 * @param {object} io - IO interface with exec
 * @param {string} [baseBranch='main'] - Base branch name
 * @returns {string} The merge-base commit SHA
 */
export function resolveBranchBaseSha(io, baseBranch = 'main') {
  if (!io.exec) {
    throw new Error('io.exec is required for resolveBranchBaseSha');
  }
  const sha = io.exec(['git', 'merge-base', 'HEAD', baseBranch]).trim();
  if (!sha) {
    throw new Error(`Failed to resolve merge-base for HEAD and ${baseBranch}`);
  }
  return sha;
}

/**
 * Extract file-patterns from an artefact type definition frontmatter.
 * Returns an empty array when frontmatter is absent or contains no patterns.
 * @param {object} def - Artefact type definition with frontmatter
 * @returns {Array<string>}
 */
function getFilePatterns(def) {
  const fm = def.frontmatter;
  return Array.isArray(fm && fm['file-patterns']) ? fm['file-patterns'] : [];
}

/**
 * Get artefact files for a given artefact type using shared branch discovery.
 *
 * Reads the artefact type definition, resolves the branch base, collects changed
 * files on the flow branch, filters by the type's file-patterns, and returns a
 * deterministically sorted list of { file, state } entries.
 *
 * @param {string} foundryDir - Path to the foundry directory
 * @param {string} typeId - Artefact type identifier
 * @param {object} io - IO interface with exec, readFile, exists
 * @param {object} [options={}] - Optional parameters
 * @param {string} [options.baseBranch='main'] - Base branch for merge-base resolution
 * @param {string} [options.branchBaseSha] - Pre-resolved merge-base SHA (takes precedence)
 * @returns {Promise<Array<{file: string, state: string}>>}
 */
export async function getArtefactFiles(foundryDir, typeId, io, options = {}) {
  const def = await getArtefactType(foundryDir, typeId, io);
  const patterns = getFilePatterns(def);

  if (patterns.length === 0) return [];

  const baseBranch = options.baseBranch || 'main';
  const branchBaseSha = options.branchBaseSha || resolveBranchBaseSha(io, baseBranch);
  const changedFiles = getBranchChangedFiles(branchBaseSha, io);
  const changes = dedupeArtefactChanges(changedFiles);
  const matching = changes.filter(({ file }) =>
    patterns.some(pattern => minimatch(file, pattern))
  );

  // Sort deterministically by file path
  const sorted = sortPaths(matching.map(({ file }) => file));
  const order = new Map(sorted.map((file, idx) => [file, idx]));
  const result = [...matching].sort((a, b) => order.get(a.file) - order.get(b.file));

  return result;
}
