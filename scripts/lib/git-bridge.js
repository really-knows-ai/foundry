// scripts/lib/git-bridge.js
//
// Policy-enforcing git commit helper used by the orchestrator.
//
// Replaces a previous `git add . && git commit -m msg` flow that would
// silently capture any unrelated worktree changes (pre-existing user edits,
// stray untracked files, secrets). This helper:
//
//   1. Reads the worktree status (NUL-terminated) so paths with spaces /
//      renames are handled safely.
//   2. Partitions dirty files against the phase's allowed patterns and
//      Foundry's tool-managed list (WORK.md / WORK.history.yaml /
//      WORK.feedback.yaml / .foundry/**).
//   3. If anything unexpected is dirty, throws a structured error with the
//      offending file list — the orchestrator turns this into a `violation`
//      action with `affected_files`. Nothing is staged or committed.
//   4. Otherwise stages ONLY the allowed paths explicitly via argv (no
//      `git add .`, no shell strings) and creates the commit.
//
// `execFile` is injected so tests can drive the helper without spawning git.
//
// Returns the short commit SHA on success.

import { partitionDirty, parsePorcelainZ } from './git-policy.js';

class UnexpectedFilesError extends Error {
  constructor(files) {
    super(`unexpected_files: ${files.join(', ')}`);
    this.code = 'unexpected_files';
    this.files = files;
  }
}

export { UnexpectedFilesError };

/**
 * @param {object} opts
 * @param {string} opts.message      Commit message.
 * @param {string[]} [opts.allowedPatterns]  Globs allowed to be dirty for this phase.
 * @param {(args: string[]) => string} opts.execFile
 *   Synchronous git runner: receives argv (no `git`), returns stdout as utf-8.
 * @returns {string}  Short SHA of the new commit.
 * @throws {UnexpectedFilesError} if the worktree contains any file outside
 *   the tool-managed list and `allowedPatterns`. Nothing is staged in this case.
 */
export function commitWithPolicy({ message, allowedPatterns = [], execFile }) {
  const porcelain = execFile(['status', '-z', '--porcelain', '--untracked-files=all']);
  const dirty = parsePorcelainZ(porcelain);
  const { allowed, unexpected } = partitionDirty(dirty, allowedPatterns);
  if (unexpected.length) throw new UnexpectedFilesError(unexpected);

  // Reset the index so a previous `git add` of an unexpected file (e.g. left
  // over from a failed run) cannot leak into our commit. Then add ONLY the
  // allowed paths explicitly via argv — never `git add .`.
  execFile(['reset', '--quiet']);
  if (allowed.length === 0) {
    // Nothing to commit; the worktree is clean of any change we'd be
    // expected to capture. Return null so the caller knows no SHA was made.
    return null;
  }
  execFile(['add', '--', ...allowed]);
  execFile(['commit', '-m', message]);
  return execFile(['rev-parse', '--short', 'HEAD']).trim();
}
