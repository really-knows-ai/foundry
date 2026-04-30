/**
 * finishDryRun — captures a dry-run branch as an on-disk snapshot under
 * `.snapshots/<runId>/` on the parent config branch, then deletes the
 * dry-run branch. Implements §11.3 of the config-branch design.
 */

import { ulid } from '../ulid.js';
import { branchSlug } from '../tracing.js';
import { renderReadme } from './render.js';

const WORK_FILES = ['WORK.md', 'WORK.history.yaml', 'WORK.feedback.yaml'];

export async function finishDryRun({ message, branch, io, execFile }) {
  // 1. Verify clean tracked tree.
  const status = await execFile(['status', '--porcelain', '--untracked-files=no']);
  const trimmed = status.trim();
  if (trimmed.length > 0) {
    const dirty = trimmed.split('\n').map(l => l.slice(3).trim()).filter(Boolean);
    return { ok: false, error: 'dirty worktree: cannot finish dry-run with uncommitted tracked changes', dirty };
  }

  // 2. Compute parent.
  const m = branch.match(/^dry-run\/([^/]+)\/[^/]+$/);
  if (!m) {
    return { ok: false, error: `cannot derive parent config branch from '${branch}'` };
  }
  const parent = `config/${m[1]}`;

  // 3. Capture diff.
  const diffPatch = await execFile(['diff', `${parent}...HEAD`]);

  // 4. Capture WORK files.
  const workCapture = {};
  for (const f of WORK_FILES) {
    if (await io.exists(f)) {
      workCapture[f] = await io.readFile(f);
    }
  }

  // 5. Capture trace.
  const traceFile = `.foundry/trace/${branchSlug(branch)}.jsonl`;
  let traceText = '';
  if (await io.exists(traceFile)) {
    traceText = await io.readFile(traceFile);
  }

  // 6. Build runId & snapshot dir.
  const runId = `${branchSlug(branch)}-${ulid()}`;
  const snapDir = `.snapshots/${runId}`;

  // 7. Render README.
  const readme = renderReadme({
    branch,
    parent,
    message,
    workfile: workCapture['WORK.md'] ?? '',
    traceText,
  });

  // 8. Checkout parent.
  await execFile(['checkout', parent]);

  // 9. Materialise snapshot directory. If any write fails, preserve dry-run branch.
  try {
    await io.mkdirp(`${snapDir}/work`);
    await io.writeFile(`${snapDir}/README.md`, readme);
    for (const [name, body] of Object.entries(workCapture)) {
      await io.writeFile(`${snapDir}/work/${name}`, body);
    }
    await io.writeFile(`${snapDir}/diff.patch`, diffPatch);
    await io.writeFile(`${snapDir}/trace.jsonl`, traceText);
  } catch (err) {
    return { ok: false, error: `snapshot write failed: ${err.message}` };
  }

  // 10. Force-delete dry-run branch.
  await execFile(['branch', '-D', branch]);

  // 11. Truncate trace file.
  if (await io.exists(traceFile)) {
    await io.writeFile(traceFile, '');
  }

  // 12.
  return { ok: true, runId, snapshotPath: snapDir, branch: parent };
}
