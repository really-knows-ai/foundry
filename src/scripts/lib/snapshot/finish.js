/**
 * finishDryRun — captures a dry-run branch as an on-disk snapshot under
 * `.snapshots/<runId>/` on the parent config branch, then deletes the
 * dry-run branch. Implements §11.3 of the config-branch design.
 *
 * Recovery: If snapshot write fails (line 73), the function returns early
 * with {ok: false, ...} whilst still on the dry-run branch. The dry-run
 * branch and partial `.snapshots/<runId>/` directory (if any) remain.
 * Manual cleanup: delete the dry-run branch with `git branch -D <branch>`
 * and remove the incomplete snapshot directory under `.snapshots/` if present.
 */

import { ulid } from '../ulid.js';
import { branchSlug } from '../tracing.js';
import { renderReadme } from './render.js';

const WORK_FILES = ['WORK.md', 'WORK.history.yaml', 'WORK.feedback.yaml'];

async function checkCleanTree(execFile) {
  const status = await execFile(['status', '--porcelain', '--untracked-files=no']);
  const trimmed = status.trim();
  if (trimmed.length > 0) {
    const dirty = trimmed.split('\n').map(l => l.slice(3).trim()).filter(Boolean);
    return { ok: false, error: 'dirty worktree: cannot finish dry-run with uncommitted tracked changes', dirty };
  }
  return { ok: true };
}

function deriveParent(branch) {
  const m = branch.match(/^dry-run\/([^/]+)\/[^/]+$/);
  if (!m) return { ok: false, error: `cannot derive parent config branch from '${branch}'` };
  return { ok: true, parent: `config/${m[1]}` };
}

async function captureWorkFiles(io) {
  const workCapture = {};
  for (const f of WORK_FILES) {
    if (await io.exists(f)) {
      workCapture[f] = await io.readFile(f);
    }
  }
  return workCapture;
}

async function captureTrace(io, branch) {
  const traceFile = `.foundry/trace/${branchSlug(branch)}.jsonl`;
  if (await io.exists(traceFile)) return { traceFile, traceText: await io.readFile(traceFile) };
  return { traceFile, traceText: '' };
}

async function writeSnapshot({ io, snapDir, readme, workCapture, diffPatch, traceText }) {
  await io.mkdirp(`${snapDir}/work`);
  await io.writeFile(`${snapDir}/README.md`, readme);
  for (const [name, body] of Object.entries(workCapture)) {
    await io.writeFile(`${snapDir}/work/${name}`, body);
  }
  await io.writeFile(`${snapDir}/diff.patch`, diffPatch);
  await io.writeFile(`${snapDir}/trace.jsonl`, traceText);
}

async function truncateTraceIfExists(io, traceFile) {
  if (await io.exists(traceFile)) await io.writeFile(traceFile, '');
}

async function cleanupDryRunBranch(execFile, parent, branch) {
  await execFile(['checkout', parent]);
  await execFile(['branch', '-D', branch]);
}

export async function finishDryRun({ message, branch, io, execFile }) {
  // 1. Verify clean tracked tree.
  const cleanCheck = await checkCleanTree(execFile);
  if (!cleanCheck.ok) return cleanCheck;

  // 2. Compute parent.
  const parentResult = deriveParent(branch);
  if (!parentResult.ok) return parentResult;
  const parent = parentResult.parent;

  // 3-5. Capture diff, WORK files, and trace.
  const diffPatch = await execFile(['diff', `${parent}...HEAD`]);
  const workCapture = await captureWorkFiles(io);
  const { traceFile, traceText } = await captureTrace(io, branch);

  // 6-7. Build runId, snapshot dir, and render README.
  const runId = `${branchSlug(branch)}-${ulid()}`;
  const snapDir = `.snapshots/${runId}`;
  const readme = renderReadme({ branch, parent, message, workfile: workCapture['WORK.md'] ?? '', traceText });

  // 8. Materialise snapshot directory. If any write fails, preserve dry-run branch.
  try {
    await writeSnapshot({ io, snapDir, readme, workCapture, diffPatch, traceText });
  } catch (err) {
    return { ok: false, error: `snapshot write failed: ${err.message}` };
  }

  // 9-11. Checkout parent, delete dry-run branch, truncate trace.
  await cleanupDryRunBranch(execFile, parent, branch);
  await truncateTraceIfExists(io, traceFile);

  // 12.
  return { ok: true, runId, snapshotPath: snapDir, branch: parent };
}
