/**
 * Failed-flow lifecycle helpers.
 *
 * When a tool encounters an unrecoverable error (e.g. stage_end cannot
 * flush memory to NDJSON and the on-disk source of truth is now behind
 * the live DB), it marks WORK.md with `status: failed` and a `reason`.
 *
 * Every mutating tool guards on this state via `requireNotFailed`. This
 * includes both work-branch FS writers (artefacts, feedback, workfile,
 * stage, orchestrate) and memory writers — both row-level (memory_put,
 * memory_relate, memory_unrelate) and admin (create_*, rename_*, drop_*,
 * reset, init, vacuum, change_embedding_model). It also includes
 * `validate_run`, since validation commands are project-defined
 * subprocesses with arbitrary side effects (linters with --fix,
 * formatters). The rule is simple: tools that mutate disk or live DB state,
 * or run unsandboxed subprocesses that could mutate it, stay blocked while
 * the abandoned work-branch filesystem remains the source of truth.
 *
 * Read-only diagnostics remain available: workfile_get,
 * memory_list/get/neighbours/query/search, memory_dump, memory_validate.
 * These tools support diagnosis before the cycle is abandoned.
 *
 * Recovery paths are `foundry_workfile_delete` to abandon the cycle or
 * editing WORK.md to remove the failed status after the underlying issue
 * is fixed.
 */
import { parseFrontmatter, setFrontmatterField } from './workfile.js';

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
 * Idempotent: overwrites `status` and `reason` whether or not they were set.
 * @param {object} io - requires exists, readFile, writeFile
 * @param {string} reason
 */
export function markWorkfileFailed(io, reason) {
  if (!io.exists('WORK.md')) {
    throw new Error('markWorkfileFailed: WORK.md not found');
  }
  const text = io.readFile('WORK.md');
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
  const failed = readFailedStatus(io);
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
