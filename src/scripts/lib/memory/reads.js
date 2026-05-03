import { entRelName, edgeRelName, cozoStringLit as cozoLit } from './cozo.js';

export async function getEntity(store, { type, name }) {
  const rel = entRelName(type);
  const res = await store.db.run(`?[v] := *${rel}{name: ${cozoLit(name)}, value: v}`);
  if (res.rows.length === 0) return null;
  return { type, name, value: res.rows[0][0] };
}

export async function listEntities(store, { type }) {
  const rel = entRelName(type);
  const res = await store.db.run(`?[n, v] := *${rel}{name: n, value: v}`);
  return res.rows.map(([name, value]) => ({ type, name, value }));
}

export async function neighbours(store, { type, name, depth = 1, edge_types }, vocabulary) {
  const edgeTypes = edge_types && edge_types.length > 0
    ? edge_types.filter((t) => vocabulary.edges[t])
    : Object.keys(vocabulary.edges);

  const visited = new Map();
  const edgesOut = [];
  const frontier = new Map();
  frontier.set(`${type}/${name}`, { type, name });

  const start = await getEntity(store, { type, name });
  if (start) visited.set(`${type}/${name}`, start);
  else visited.set(`${type}/${name}`, { type, name, value: null });

  for (let d = 0; d < depth; d++) {
    const nextFrontier = new Map();
    for (const et of edgeTypes) {
      const rel = edgeRelName(et);
      for (const [, node] of frontier) {
        {
          const res = await store.db.run(
            `?[tt, tn] := *${rel}{from_type: ${cozoLit(node.type)}, from_name: ${cozoLit(node.name)}, to_type: tt, to_name: tn}`,
          );
          for (const [tt, tn] of res.rows) {
            edgesOut.push({ edge_type: et, from_type: node.type, from_name: node.name, to_type: tt, to_name: tn });
            const key = `${tt}/${tn}`;
            if (!visited.has(key)) nextFrontier.set(key, { type: tt, name: tn });
          }
        }
        {
          const res = await store.db.run(
            `?[ft, fn] := *${rel}{from_type: ft, from_name: fn, to_type: ${cozoLit(node.type)}, to_name: ${cozoLit(node.name)}}`,
          );
          for (const [ft, fn] of res.rows) {
            edgesOut.push({ edge_type: et, from_type: ft, from_name: fn, to_type: node.type, to_name: node.name });
            const key = `${ft}/${fn}`;
            if (!visited.has(key)) nextFrontier.set(key, { type: ft, name: fn });
          }
        }
      }
    }
    for (const [key, node] of nextFrontier) {
      if (visited.has(key)) continue;
      const ent = await getEntity(store, node);
      visited.set(key, ent ?? { ...node, value: null });
    }
    frontier.clear();
    for (const [k, v] of nextFrontier) frontier.set(k, v);
    if (frontier.size === 0) break;
  }

  const edgeKey = (e) => [e.edge_type, e.from_type, e.from_name, e.to_type, e.to_name].join('\u0000');
  const seen = new Set();
  const edges = [];
  for (const e of edgesOut) {
    const k = edgeKey(e);
    if (seen.has(k)) continue;
    seen.add(k);
    edges.push(e);
  }

  return { entities: [...visited.values()], edges };
}
