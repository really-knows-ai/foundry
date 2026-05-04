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
    throw new Error(`WORK.history.yaml malformed: ${err.message}`);
  }
  return data;
}

function markFailedDefensive(io, msg) {
  try { markWorkfileFailed(io, msg); } catch { /* WORK.md gone; nothing to mark */ }
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
  filtered.sort((a, b) => {
    const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
    const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
    if (ta !== tb) return ta - tb;
    const sa = typeof a.seq === 'number' ? a.seq : 0;
    const sb = typeof b.seq === 'number' ? b.seq : 0;
    return sa - sb;
  });
  return filtered;
}

/**
 * Append a history entry with auto-generated ISO timestamp.
 */
export function appendEntry(historyPath, { cycle, stage, iteration, comment, route, openFeedback, changedFiles }, io) {
  if (iteration == null) throw new Error('iteration is required');
  if (!comment) throw new Error('comment is required');
  if (route !== undefined && stage !== 'sort') {
    throw new Error(`route is only valid on stage='sort' entries; got stage='${stage}'`);
  }

  let existing = [];
  if (io.exists(historyPath)) {
    try {
      existing = parseHistory(io.readFile(historyPath));
    } catch (err) {
      markFailedDefensive(io, err.message);
      throw err;
    }
  }

  const entry = {
    cycle,
    stage,
    iteration,
    comment,
    timestamp: new Date().toISOString(),
    seq: existing.length,
    open_feedback: openFeedback ?? 0,
  };
  if (route !== undefined) entry.route = route;
  if (changedFiles !== undefined) {
    entry.changed_files = sortPaths(changedFiles);
  }
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
