import { entRelName } from './cozo.js';

function asCozoVector(v) {
  return `vec([${v.map((n) => Number(n).toString()).join(', ')}])`;
}

async function searchOneType(db, type, queryVec, k) {
  const rel = entRelName(type);
  try {
    const q = `?[name, value, dist] := ~${rel}:vec{ name, value | query: ${asCozoVector(queryVec)}, k: ${k}, bind_distance: dist, ef: 64 }`;
    const res = await db.run(q);
    return res.rows.map(([name, value, dist]) => ({ type, name, value, distance: dist }));
  } catch (err) {
    // Relation may not exist, may have no HNSW index, or simply be empty.
    const msg = String(err && (err.display || err.message || err));
    if (/index|not found|no such|does not exist|stored relation/i.test(msg)) return [];
    throw err;
  }
}

export async function search({ store, query_text, k = 5, type_filter, embedder }) {
  if (!embedder) throw new Error('search requires an embedder');
  if (typeof query_text !== 'string' || !query_text) throw new Error('query_text required');

  const types = (type_filter && type_filter.length > 0)
    ? type_filter
    : Object.keys(store.schema.entities);
  const [queryVec] = await embedder([query_text]);

  const all = [];
  for (const t of types) {
    const hits = await searchOneType(store.db, t, queryVec, k);
    all.push(...hits);
  }
  all.sort((a, b) => a.distance - b.distance);
  return all.slice(0, k);
}
