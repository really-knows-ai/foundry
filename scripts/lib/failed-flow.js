/**
 * Failed-flow lifecycle helpers.
 *
 * When a tool encounters an unrecoverable error (e.g. stage_end cannot
 * flush memory to NDJSON and the on-disk source of truth is now behind
 * the live DB), it marks WORK.md with `status: failed` and a `reason`.
 *
 * Every mutating tool guards on this state via `requireNotFailed`. This
 * includes work-branch FS writers (artefacts, feedback, workfile, stage,
 * orchestrate), memory writers — row-level (memory_put, memory_relate,
 * memory_unrelate) and admin (create_*, rename_*, drop_*, reset, init,
 * vacuum, change_embedding_model) — and `validate_run`, since validation
 * commands are project-defined subprocesses with arbitrary side effects
 * (linters with --fix, formatters). The rule is simple: tools that mutate
 * disk or live DB state, or run unsandboxed subprocesses that could mutate
 * it, stay blocked while the abandoned work-branch filesystem remains the
 * source of truth.
 *
 * Read-only diagnostics (workfile_get, memory_list/get/neighbours/query/search,
 * memory_dump, memory_validate) remain available to support diagnosis before
 * the cycle is abandoned.
 *
 * Recovery paths: `foundry_workfile_delete` abandons the cycle; editing
 * WORK.md to remove the failed status after fixing the underlying issue
 * restores normal operation. `foundry_stage_retry` provides a deterministic
 * rollback mechanism: it discards uncommitted memory changes, clears the
 * failed status, and resets the stage state, provided the git working tree
 * is clean.
 */
import { parseFrontmatter, setFrontmatterField, writeFrontmatter } from './workfile.js';

const MAX_REASON_LEN = 500;

function truncateReason(reason) {
  const s = String(reason ?? '');
  if (s.length <= MAX_REASON_LEN) return s;
  return s.slice(0, MAX_REASON_LEN) + '...';
}

/**
 * @param {{exists: (p: string) => boolean, readFile: (p: string) => string}} io
 * @returns {{reason: string} | null}
 */
export function readFailedStatus(io) {
  if (!io.exists('WORK.md')) return null;
  const text = io.readFile('WORK.md');
  const fm = parseFrontmatter(text);
  if (fm.status !== 'failed') return null;
  return { reason: fm.reason === undefined ? '' : String(fm.reason) };
}

/**
 * Idempotent: sets `status: failed` and `reason` if not already failed.
 * Preserves the first failure reason when called multiple times - the
 * initial diagnostic reason is more valuable than cascading failures.
 * @param {object} io - requires exists, readFile, writeFile
 * @param {string} reason
 */
export function markWorkfileFailed(io, reason) {
  if (!io.exists('WORK.md')) {
    throw new Error('markWorkfileFailed: WORK.md not found');
  }
  const text = io.readFile('WORK.md');
  
  // Check if already failed - preserve the first failure reason
  const failed = readFailedStatus(io);
  if (failed) {
    // Already failed - skip overwrite to preserve diagnostic first reason
    return;
  }
  
  const withStatus = setFrontmatterField(text, 'status', 'failed');
  const withReason = setFrontmatterField(withStatus, 'reason', truncateReason(reason));
  io.writeFile('WORK.md', withReason);
}

/**
 * Tool guard: returns `{ok:true}` when the flow is healthy, otherwise
 * `{ok:false, error}` with a message that tells the LLM exactly how to
 * escape (abandon the flow).
 * @param {object} io
 * @returns {{ok: true} | {ok: false, error: string}}
 */
export function requireNotFailed(io) {
  let failed;
  try {
    failed = readFailedStatus(io);
  } catch (err) {
    // WORK.md is corrupted (malformed YAML) or unreadable (IO error).
    // This is a trouble signal - refuse to proceed.
    return {
      ok: false,
      error:
        `WORK.md is corrupted or unreadable. ` +
        `No mutating tools are permitted. Use foundry_workfile_delete({confirm: true}) ` +
        `to abandon the cycle, then back out to main and delete the work branch.`,
    };
  }
  
  if (!failed) return { ok: true };
  const reason = failed.reason || '(no reason recorded)';
  return {
    ok: false,
    error:
      `flow is in failed state (reason: ${reason}). ` +
      `No mutating tools are permitted. Use foundry_workfile_delete({confirm: true}) ` +
      `to abandon the cycle, then back out to main and delete the work branch.`,
  };
}

/**
 * Clears the failed status from WORK.md, restoring normal operation.
 * Idempotent: safe to call even if not failed.
 * @param {object} io - requires exists, readFile, writeFile
 */
export function clearWorkfileFailed(io) {
  if (!io.exists('WORK.md')) {
    throw new Error('clearWorkfileFailed: WORK.md not found');
  }
  const text = io.readFile('WORK.md');
  const fm = parseFrontmatter(text);
  
  // Remove status and reason fields
  delete fm.status;
  delete fm.reason;
  
  // Rebuild the file with cleaned frontmatter
  const fmBlock = writeFrontmatter(fm);
  const body = text.replace(/^---\n.+?\n---\n?/s, '');
  io.writeFile('WORK.md', body ? `${fmBlock}\n${body}` : fmBlock);
}
