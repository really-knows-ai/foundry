// scripts/lib/git-policy.js
//
// Shared git-commit policy used by the orchestrator's git bridge.
//
// The orchestrator commits twice per cycle: once at setup (configures stages
// in WORK.md) and once after every stage finalize. Both commits historically
// used `git add .`, which silently captured any unrelated worktree changes
// (pre-existing user edits, untracked secrets, files left over from a failed
// finalize). This module provides the building blocks to commit ONLY the
// files allowed by the current phase and to report a structured violation
// when the worktree contains anything else.
//
// Intentionally framework-agnostic: takes raw inputs (porcelain string,
// allowed pattern list) and returns plain data. The bridge wires these
// helpers to execFileSync / git plumbing.

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

export const TOOL_MANAGED_PREFIX = ['.foundry/'];

export function isToolManaged(file) {
  if (TOOL_MANAGED.includes(file)) return true;
  return TOOL_MANAGED_PREFIX.some((p) => file.startsWith(p));
}

/**
 * Parse `git status -z --porcelain=v1` output into a list of file paths.
 *
 * Each record is null-terminated. Renames/copies (R/C) are emitted as two
 * null-terminated paths: `R  new\0old\0` (i.e. the destination first, then
 * the source). We surface BOTH paths so the caller can refuse a commit that
 * would carry along an unrelated source path.
 *
 * Returns a de-duplicated array of paths in encounter order.
 */
export function parsePorcelainZ(out) {
  if (!out) return [];
  const seen = new Set();
  const result = [];
  // Split on NUL but ignore the trailing empty entry.
  const parts = out.split('\0');
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i];
    if (!entry) continue;
    // Status is the first 2 chars, then a space, then the path.
    const status = entry.slice(0, 2);
    const path = entry.slice(3);
    if (!path) continue;
    if (!seen.has(path)) { seen.add(path); result.push(path); }
    // Rename (R) and copy (C) entries are followed by an extra NUL-terminated
    // source path that the caller should also account for.
    if (status[0] === 'R' || status[0] === 'C') {
      const src = parts[++i];
      if (src && !seen.has(src)) { seen.add(src); result.push(src); }
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
