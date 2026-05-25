import yaml from 'js-yaml';
import { markWorkfileFailed } from './failed-flow.js';
import { sortPaths } from './attestation/hash.js';

/**
 * Parse WORK.history.yaml text into an array of entries.
 * Throws `WORK.history.yaml malformed: ...` on parse failure or non-array root.
 * Empty/null/undefined input yields [].
 */
function parseHistory(text) {
  let data;
  try {
    data = yaml.load(text) || [];
    if (!Array.isArray(data)) {
      throw new Error('root is not an array');
    }
  } catch (err) {
    throw new Error(`WORK.history.yaml malformed: ${err.message}`, { cause: err });
  }
  return data;
}

/**
 * Parse the full WORK.history.yaml text into all entries (no cycle filter).
 * Returns entries in file declaration order. Throws on malformed YAML or non-array root.
 * Empty/null/undefined input yields [].
 */
export function parseAllHistoryEntries(text) {
  return parseHistory(text);
}

function markFailedDefensive(io, msg) {
  try { markWorkfileFailed(io, msg); } catch { /* WORK.md gone; nothing to mark */ }
}

function entryTimestamp(entry) {
  return entry.timestamp ? new Date(entry.timestamp).getTime() : 0;
}

function entrySeq(entry) {
  return typeof entry.seq === 'number' ? entry.seq : 0;
}

function compareEntries(a, b) {
  const ta = entryTimestamp(a);
  const tb = entryTimestamp(b);
  if (ta !== tb) return ta - tb;
  return entrySeq(a) - entrySeq(b);
}

/**
 * Load history entries for a cycle, sorted by timestamp ascending.
 */
export function loadHistory(historyPath, cycle, io) {
  if (!io.exists(historyPath)) return [];
  let data;
  try {
    data = parseHistory(io.readFile(historyPath));
  } catch (err) {
    markFailedDefensive(io, err.message);
    throw err;
  }
  const filtered = data.filter(e => e.cycle === cycle);
  filtered.sort(compareEntries);
  return filtered;
}

function requireIteration(value) {
  if (value === undefined) throw new Error('iteration is required');
  if (value === null) throw new Error('iteration is required');
}

function validateAppendArgs({ iteration, comment, route, stage }) {
  requireIteration(iteration);
  if (!comment) throw new Error('comment is required');
  if (route !== undefined && stage !== 'sort') {
    throw new Error(`route is only valid on stage='sort' entries; got stage='${stage}'`);
  }
}

function buildEntry({ cycle, stage, iteration, comment, route, openFeedback, changedFiles, ...rest }, seq) {
  const entry = {
    cycle,
    stage,
    iteration,
    comment,
    timestamp: new Date().toISOString(),
    seq,
    open_feedback: openFeedback ?? 0,
    ...rest,
  };
  if (route !== undefined) entry.route = route;
  if (changedFiles !== undefined) {
    entry.changed_files = sortPaths(changedFiles);
  }
  return entry;
}

/**
 * Append a history entry with auto-generated ISO timestamp.
 */
export function appendEntry(historyPath, entryOpts, io) {
  validateAppendArgs(entryOpts);

  let existing = [];
  if (io.exists(historyPath)) {
    try {
      existing = parseHistory(io.readFile(historyPath));
    } catch (err) {
      markFailedDefensive(io, err.message);
      throw err;
    }
  }

  const entry = buildEntry(entryOpts, existing.length);
  existing.push(entry);

  const body = yaml.dump(existing);
  const tmp = `${historyPath}.tmp`;
  io.writeFile(tmp, body);
  io.rename(tmp, historyPath);
}

/**
 * Count COMPLETED forge stages for a cycle. This includes forges that ran to
 * completion but whose downstream appraise deadlocked or blocked the cycle —
 * completion here means "stage_end was called", not "cycle progressed".
 * Used by sort for max-iterations enforcement.
 */
export function getIteration(historyPath, cycle, io) {
  const history = loadHistory(historyPath, cycle, io);
  return history.filter(e => (e.stage || '').split(':')[0] === 'forge').length;
}
