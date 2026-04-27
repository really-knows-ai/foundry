/**
 * Failed-flow lifecycle helpers.
 *
 * When a tool encounters an unrecoverable error (e.g. stage_end could not
 * flush memory to NDJSON and the on-disk source of truth is now behind
 * the live DB), it marks WORK.md with `status: failed` and a `reason`.
 *
 * Every mutating tool guards on this state via `requireNotFailed`. This
 * includes both work-branch FS writers (artefacts, feedback, workfile,
 * stage, orchestrate) and memory writers — both row-level (memory_put,
 * memory_relate, memory_unrelate) and admin (create_*, rename_*, drop_*,
 * reset, init, vacuum, change_embedding_model). The rule: anything that
 * mutates disk or live DB state is blocked, because the work-branch FS
 * is the source-of-truth that's thrown away on abandon-and-retry.
 *
 * Read-only diagnostics are intentionally exempt: workfile_get,
 * memory_list/get/neighbours/query/search, memory_dump, memory_validate.
 * These are needed to figure out what went wrong before abandoning the
 * cycle.
 *
 * The only ways out are `foundry_workfile_delete` (abandon the cycle) or
 * manually editing WORK.md to remove the failed status after fixing the
 * underlying issue.
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
