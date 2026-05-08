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

function normaliseFieldValue(k, raw) {
  if (raw === undefined) return null;
  let v = raw;
  if (v instanceof Date) v = v.toISOString();
  if (DATE_FIELDS.has(k) && v === 'null') v = null;
  return v;
}

function normaliseMeta(fm) {
  const out = {};
  for (const k of META_FIELDS) {
    out[k] = normaliseFieldValue(k, fm[k]);
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

function compareStartedAtDesc(a, b) {
  const av = a.startedAt;
  const bv = b.startedAt;
  if (!av && !bv) return 0;
  if (!av) return 1;
  if (!bv) return -1;
  return compareTimestamps(av, bv);
}

function compareTimestamps(av, bv) {
  if (av < bv) return 1;
  if (av > bv) return -1;
  return 0;
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
  out.sort(compareStartedAtDesc);
  return out;
}

function classifyPlusLine(line) {
  return line[1] === '+' ? null : 'insertion';
}

function classifyMinusLine(line) {
  return line[1] === '-' ? null : 'deletion';
}

function classifyDiffLine(line) {
  if (line.startsWith('diff --git ')) return 'file';
  if (line.startsWith('+')) return classifyPlusLine(line);
  if (line.startsWith('-')) return classifyMinusLine(line);
  return null;
}

function parseDiffStats(text) {
  let files = 0;
  let insertions = 0;
  let deletions = 0;
  for (const line of text.split('\n')) {
    const kind = classifyDiffLine(line);
    if (kind === 'file') files++;
    else if (kind === 'insertion') insertions++;
    else if (kind === 'deletion') deletions++;
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

async function readReadmeRaw(io, dir) {
  return await io.readFile(`${dir}/README.md`);
}

async function readDiffStats(io, dir) {
  return parseDiffStats(await io.readFile(`${dir}/diff.patch`));
}

async function readTraceStats(io, dir) {
  return parseTraceStats(await io.readFile(`${dir}/trace.jsonl`));
}

async function readMetadata(io, dir, missing) {
  if (missing.includes('README.md')) return {};
  const readmeText = await readReadmeRaw(io, dir);
  return parseFrontmatter(readmeText) || {};
}

async function buildSnapshotParts(io, dir, missing) {
  const fm = await readMetadata(io, dir, missing);
  const metadata = normaliseMeta(fm);

  const diff = missing.includes('diff.patch')
    ? { files: 0, insertions: 0, deletions: 0 }
    : await readDiffStats(io, dir);

  const trace = missing.includes('trace.jsonl')
    ? { lineCount: 0, firstTs: null, lastTs: null }
    : await readTraceStats(io, dir);

  const readmeText = missing.includes('README.md') ? null : await readReadmeRaw(io, dir);
  return { readmeText, metadata, diff, trace };
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
  const parts = await buildSnapshotParts(io, dir, missing);
  return { runId, readme: parts.readmeText, metadata: parts.metadata, diff: parts.diff, trace: parts.trace, missing };
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

function isExpiredCandidate(runId, cutoff) {
  if (runId.length < 26) return false;
  const ulidPart = runId.slice(-26);
  try {
    return decodeUlidTime(ulidPart) < cutoff;
  } catch {
    return false;
  }
}

async function findExpiredCandidates(io, cutoff) {
  if (!(await io.exists('.snapshots'))) return [];
  const entries = await io.readdir('.snapshots');
  return entries.filter(id => isExpiredCandidate(id, cutoff));
}

async function deleteSnapshots(io, candidates) {
  for (const runId of candidates) {
    await io.rm(`.snapshots/${runId}`, { recursive: true });
  }
}

/**
 * Prune snapshots older than `olderThanDays`. Time is decoded from the
 * trailing 26-char ULID of each runId. Entries with malformed ULIDs are
 * skipped. Requires {confirm: true} to actually delete.
 */
export async function pruneSnapshots({ olderThanDays, io, confirm, now = Date.now() }) {
  const cutoff = now - olderThanDays * 86400000;
  const cutoffIso = new Date(cutoff).toISOString();

  const candidates = await findExpiredCandidates(io, cutoff);

  if (confirm !== true) {
    return {
      ok: false,
      error: 'foundry_snapshot_prune requires {confirm: true}',
      candidates,
      cutoff: cutoffIso,
    };
  }

  await deleteSnapshots(io, candidates);
  return { ok: true, removed: candidates };
}
