/**
 * JSONL trace appender for dry-run branches.
 *
 * Trace files live under `.foundry/trace/<branchSlug>.jsonl`, one JSON
 * record per line. The IO contract is async and minimal so the module
 * stays testable with in-memory mocks.
 */

const TRACE_DIR = '.foundry/trace';

/**
 * Convert a git branch name to a filesystem-safe slug by replacing every
 * `/` with `-`. Pure string transform — no validation, since callers pass
 * already-validated branch names.
 */
export function branchSlug(branch) {
  return branch.replace(/\//g, '-');
}

function tracePath(branch) {
  return `${TRACE_DIR}/${branchSlug(branch)}.jsonl`;
}

/**
 * Append a single JSONL record to the trace file for `branch`.
 *
 * Ensures the trace directory exists before writing. Uses `io.appendFile`
 * when present, otherwise falls back to read-then-write concatenation
 * (treating ENOENT as empty).
 */
export async function appendTraceRecord({ branch, record, io }) {
  const path = tracePath(branch);
  const line = JSON.stringify(record) + '\n';

  await io.mkdirp(TRACE_DIR);

  if (typeof io.appendFile === 'function') {
    await io.appendFile(path, line);
    return;
  }

  let existing = '';
  try {
    existing = await io.readFile(path);
  } catch (err) {
    if (err && err.code !== 'ENOENT') throw err;
  }
  await io.writeFile(path, existing + line);
}

/**
 * Truncate the trace file for `branch` to empty. No-op when the file
 * does not exist.
 */
export async function truncateTrace({ branch, io }) {
  const path = tracePath(branch);
  if (!(await io.exists(path))) return;
  await io.writeFile(path, '');
}
