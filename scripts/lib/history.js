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
export function appendEntry(historyPath, { cycle, stage, iteration, comment, route }, io) {
  if (iteration == null) throw new Error('iteration is required');
  if (!comment) throw new Error('comment is required');
  if (route !== undefined && stage !== 'sort') {
    throw new Error(`route is only valid on stage='sort' entries; got stage='${stage}'`);
  }

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
    seq: existing.length,
  };
  if (route !== undefined) entry.route = route;
  existing.push(entry);

  const body = yaml.dump(existing);
  const tmp = `${historyPath}.tmp`;
  io.writeFile(tmp, body);
  io.rename(tmp, historyPath);
}

/**
 * Count forge entries for a cycle.
 */
export function getIteration(historyPath, cycle, io) {
  const history = loadHistory(historyPath, cycle, io);
  return history.filter(e => (e.stage || '').split(':')[0] === 'forge').length;
}
