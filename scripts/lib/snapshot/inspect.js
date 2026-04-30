/**
 * Snapshot inspection library: list, show, delete, prune.
 *
 * Operates on `.snapshots/<runId>/` directories produced by finishDryRun.
 * IO contract: an injected `io` object exposing async `exists`, `readFile`,
 * `readdir`, and `rm`. Pure logic; no direct fs imports.
 */

import { parseFrontmatter } from '../workfile.js';
import { decodeUlidTime } from '../ulid.js';

const REQUIRED = ['README.md', 'work/WORK.md', 'diff.patch', 'trace.jsonl'];

const META_FIELDS = ['branch', 'parent', 'flow', 'goal', 'startedAt', 'finishedAt', 'exitReason'];

// Fields that should be normalised to ISO strings if YAML parsed them as Date.
const DATE_FIELDS = new Set(['startedAt', 'finishedAt']);

function normaliseMeta(fm) {
  const out = {};
  for (const k of META_FIELDS) {
    let v = fm[k] !== undefined ? fm[k] : null;
    if (v instanceof Date) v = v.toISOString();
    if (DATE_FIELDS.has(k) && v === 'null') v = null;
    out[k] = v;
  }
  return out;
}

/**
 * Compute the list of REQUIRED files missing from a snapshot directory.
 */
async function missingFiles(io, dir) {
  const missing = [];
  for (const rel of REQUIRED) {
    if (!(await io.exists(`${dir}/${rel}`))) missing.push(rel);
  }
  return missing;
}

async function readSnapshotMeta(io, runId) {
  const dir = `.snapshots/${runId}`;
  const missing = await missingFiles(io, dir);

  if (missing.includes('README.md')) {
    return { runId, error: 'incomplete', missing };
  }

  const readmeText = await io.readFile(`${dir}/README.md`);
  const fm = parseFrontmatter(readmeText) || {};

  const entry = { runId, ...normaliseMeta(fm) };

  if (missing.length > 0) {
    entry.error = 'incomplete';
    entry.missing = missing;
  }
  return entry;
}

/**
 * List all snapshots under `.snapshots/`, sorted by startedAt desc.
 * Returns [] if `.snapshots/` does not exist.
 */
export async function listSnapshots({ io }) {
  if (!(await io.exists('.snapshots'))) return [];
  const entries = await io.readdir('.snapshots');
  const out = [];
  for (const runId of entries) {
    out.push(await readSnapshotMeta(io, runId));
  }
  // Sort by startedAt desc; missing/null sort last.
  out.sort((a, b) => {
    const av = a.startedAt;
    const bv = b.startedAt;
    if (!av && !bv) return 0;
    if (!av) return 1;
    if (!bv) return -1;
    if (av < bv) return 1;
    if (av > bv) return -1;
    return 0;
  });
  return out;
}

function parseDiffStats(text) {
  let files = 0;
  let insertions = 0;
  let deletions = 0;
  for (const line of text.split('\n')) {
    if (line.startsWith('diff --git ')) {
      files++;
    } else if (line.startsWith('+') && line[1] !== '+') {
      insertions++;
    } else if (line.startsWith('-') && line[1] !== '-') {
      deletions++;
    }
  }
  return { files, insertions, deletions };
}

function parseTraceStats(text) {
  const lines = text.split('\n').filter(l => l.length > 0);
  if (lines.length === 0) return { lineCount: 0, firstTs: null, lastTs: null };
  const parseTs = (line) => {
    try {
      return JSON.parse(line)?.ts ?? null;
    } catch {
      return null;
    }
  };
  return {
    lineCount: lines.length,
    firstTs: parseTs(lines[0]),
    lastTs: parseTs(lines[lines.length - 1]),
  };
}

/**
 * Return a structured summary of a single snapshot.
 */
export async function showSnapshot({ runId, io }) {
  const dir = `.snapshots/${runId}`;
  if (!(await io.exists(dir))) {
    return { runId, error: 'unknown_runId', missing: [...REQUIRED] };
  }

  const missing = await missingFiles(io, dir);

  const readme = missing.includes('README.md')
    ? null
    : await io.readFile(`${dir}/README.md`);

  const fm = readme ? (parseFrontmatter(readme) || {}) : {};
  const metadata = normaliseMeta(fm);

  const diff = missing.includes('diff.patch')
    ? { files: 0, insertions: 0, deletions: 0 }
    : parseDiffStats(await io.readFile(`${dir}/diff.patch`));

  const trace = missing.includes('trace.jsonl')
    ? { lineCount: 0, firstTs: null, lastTs: null }
    : parseTraceStats(await io.readFile(`${dir}/trace.jsonl`));

  return { runId, readme, metadata, diff, trace, missing };
}

/**
 * Delete a snapshot directory. Requires {confirm: true}.
 */
export async function deleteSnapshot({ runId, io, confirm }) {
  const dir = `.snapshots/${runId}`;
  if (!(await io.exists(dir))) {
    return { ok: false, error: `unknown runId '${runId}'` };
  }
  if (confirm !== true) {
    return {
      ok: false,
      error: 'foundry_snapshot_delete requires {confirm: true}',
      planned: { runId, path: dir },
    };
  }
  await io.rm(dir, { recursive: true });
  return { ok: true, runId, removed: dir };
}

/**
 * Prune snapshots older than `olderThanDays`. Time is decoded from the
 * trailing 26-char ULID of each runId. Entries with malformed ULIDs are
 * skipped. Requires {confirm: true} to actually delete.
 */
export async function pruneSnapshots({ olderThanDays, io, confirm, now = Date.now() }) {
  const cutoff = now - olderThanDays * 86400000;

  if (!(await io.exists('.snapshots'))) {
    if (confirm === true) return { ok: true, removed: [] };
    return {
      ok: false,
      error: 'foundry_snapshot_prune requires {confirm: true}',
      candidates: [],
      cutoff: new Date(cutoff).toISOString(),
    };
  }

  const entries = await io.readdir('.snapshots');
  const candidates = [];
  for (const runId of entries) {
    if (runId.length < 26) continue;
    const ulidPart = runId.slice(-26);
    let ms;
    try {
      ms = decodeUlidTime(ulidPart);
    } catch {
      continue;
    }
    if (ms < cutoff) candidates.push(runId);
  }

  if (confirm !== true) {
    return {
      ok: false,
      error: 'foundry_snapshot_prune requires {confirm: true}',
      candidates,
      cutoff: new Date(cutoff).toISOString(),
    };
  }

  for (const runId of candidates) {
    await io.rm(`.snapshots/${runId}`, { recursive: true });
  }
  return { ok: true, removed: candidates };
}
