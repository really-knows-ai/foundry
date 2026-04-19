import yaml from 'js-yaml';

/**
 * Load history entries for a cycle, sorted by timestamp ascending.
 */
export function loadHistory(historyPath, cycle, io) {
  if (!io.exists(historyPath)) return [];
  const data = yaml.load(io.readFile(historyPath)) || [];
  const filtered = data.filter(e => e.cycle === cycle);
  filtered.sort((a, b) => {
    const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
    const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
    return ta - tb;
  });
  return filtered;
}

/**
 * Append a history entry with auto-generated ISO timestamp.
 */
export function appendEntry(historyPath, { cycle, stage, iteration, comment, route }, io) {
  if (iteration == null) throw new Error('iteration is required');
  if (!comment) throw new Error('comment is required');

  let existing = [];
  if (io.exists(historyPath)) {
    existing = yaml.load(io.readFile(historyPath)) || [];
  }

  const entry = {
    cycle,
    stage,
    iteration,
    comment,
    timestamp: new Date().toISOString(),
  };
  if (route !== undefined) entry.route = route;
  existing.push(entry);

  io.writeFile(historyPath, yaml.dump(existing));
}

/**
 * Count forge entries for a cycle.
 */
export function getIteration(historyPath, cycle, io) {
  const history = loadHistory(historyPath, cycle, io);
  return history.filter(e => (e.stage || '').split(':')[0] === 'forge').length;
}

/**
 * Return the `route` field from the most recent `sort` history entry for a
 * given cycle, or null if none exists.
 */
export function readLastSortRoute(historyPath, cycle, io) {
  const entries = loadHistory(historyPath, cycle, io).filter(e => e.stage === 'sort');
  if (!entries.length) return null;
  return entries[entries.length - 1].route ?? null;
}
