import { listEntities, getEntity, neighbours } from '../reads.js';

export async function dumpMemory({ store, vocabulary, type, name, depth = 1 }) {
  const lines = [];
  if (type && name) {
    const ent = await getEntity(store, { type, name });
    if (!ent) return `(no entity found: ${type}/${name})`;
    lines.push(`# ${type}/${name}`);
    lines.push('');
    lines.push(ent.value);
    lines.push('');
    const nbrs = await neighbours(store, { type, name, depth }, vocabulary);
    if (nbrs.edges.length > 0) {
      lines.push(`## Edges`);
      for (const e of nbrs.edges) {
        lines.push(`- ${e.from_type}/${e.from_name} --${e.edge_type}--> ${e.to_type}/${e.to_name}`);
      }
    }
    return lines.join('\n');
  }
  if (type) {
    const rows = await listEntities(store, { type });
    lines.push(`# entities of type '${type}' (${rows.length})`);
    for (const r of rows) lines.push(`- ${r.name}`);
    return lines.join('\n');
  }
  // Summary.
  lines.push(`# memory summary`);
  for (const t of Object.keys(vocabulary.entities)) {
    const rows = await listEntities(store, { type: t });
    lines.push(`- entity ${t}: ${rows.length} rows`);
  }
  return lines.join('\n');
}
