// scripts/lib/git-policy.js
//
// Shared git-commit policy used by the orchestrator's git bridge.
//
// The orchestrator commits twice per cycle: a setup commit that configures
// stages in WORK.md and a post-finalise commit after each stage finalise.
// This module defines the phase-specific file allow-lists for those commits
// and reports a structured violation when the worktree contains any other
// paths.
//
// This module accepts raw inputs (porcelain string, allowed pattern list)
// and returns plain data. The bridge wires these helpers to git plumbing.

import { minimatch } from 'minimatch';

export const TOOL_MANAGED = [
  'WORK.md',
  'WORK.history.yaml',
  'WORK.feedback.yaml',
  // The plugin's secret bootstrap idempotently appends `.foundry/` to the
  // project's `.gitignore` (see scripts/lib/secret.js). Treat it as
  // tool-managed so the orchestrator's setup commit can sweep up that change
  // without flagging it as an unexpected dirty file.
  '.gitignore',
];

const TOOL_MANAGED_PREFIX = ['.foundry/'];

export const CONFIG_ALLOWED_PATTERNS = [
  'foundry/**',
  'package.json',
  'pnpm-lock.yaml',
];

export function isToolManaged(file) {
  if (TOOL_MANAGED.includes(file)) return true;
  return TOOL_MANAGED_PREFIX.some((p) => file.startsWith(p));
}

function addIfNew(seen, result, path) {
  if (path && !seen.has(path)) {
    seen.add(path);
    result.push(path);
  }
}

function isRenameOrCopy(status) {
  return status[0] === 'R' || status[0] === 'C';
}

/**
 * Parse `git status -z --porcelain=v1` output into a list of file paths.
 *
 * Each record is null-terminated. Renames/copies (R/C) are emitted as two
 * null-terminated paths: `R  new\0old\0` (i.e. the destination first, then
 * the source). Per git-status(1), the -z format reverses the usual "from -> to"
 * order to "to from" for renames. We surface BOTH paths so the caller can refuse
 * a commit that would carry along an unrelated source path.
 *
 * Returns a de-duplicated array of paths in encounter order.
 */
export function parsePorcelainZ(out) {
  if (!out) return [];
  const seen = new Set();
  const result = [];
  const parts = out.split('\0');
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i];
    if (!entry) continue;
    const path = entry.slice(3);
    addIfNew(seen, result, path);
    if (isRenameOrCopy(entry)) {
      addIfNew(seen, result, parts[++i]);
    }
  }
  return result;
}

/**
 * Partition a list of dirty files into (allowed, unexpected) given the
 * stage's allowed glob patterns. Tool-managed files are ALWAYS allowed.
 */
export function partitionDirty(files, allowedPatterns = []) {
  const allowed = [];
  const unexpected = [];
  for (const f of files) {
    if (isToolManaged(f)) { allowed.push(f); continue; }
    if (allowedPatterns.some((p) => minimatch(f, p, { dot: true }))) { allowed.push(f); continue; }
    unexpected.push(f);
  }
  return { allowed, unexpected };
}

/**
 * Compute the allowed glob patterns for a given stage.
 *
 * - forge: artefact type's file-patterns (caller resolves; passed in).
 * - assay: writes under foundry-memory/**.
 * - quench / appraise / human-appraise: no surface files allowed; only
 *   tool-managed files may change.
 * - setup (no stage): no surface files allowed.
 */
export function allowedPatternsForStage({ stageBase, forgeFilePatterns = [] } = {}) {
  if (stageBase === 'forge') return forgeFilePatterns;
  if (stageBase === 'assay') return ['foundry-memory/**'];
  return [];
}

/**
 * Check that every file changed on a config branch lives inside foundry/ or
 * is tool-managed. Returns null when clean, or { files: [...] } when outside
 * files are detected.
 *
 * @param {string} diffOut - Raw `git diff --name-only base..branch` output
 * @returns {null|{files: string[]}}
 */
export function checkConfigBranchFiles(diffOut) {
  if (!diffOut) return null;
  const toolManaged = new Set(TOOL_MANAGED);
  const outside = diffOut.split('\n')
    .map(f => f.trim())
    .filter(f => f.length > 0 && !toolManaged.has(f))
    .filter(f => !CONFIG_ALLOWED_PATTERNS.some(p => minimatch(f, p, { dot: true })))
    .filter(f => !TOOL_MANAGED_PREFIX.some(p => f.startsWith(p)));
  return outside.length ? { files: outside } : null;
}
