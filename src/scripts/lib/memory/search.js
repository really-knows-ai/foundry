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

/**
 * Semantic nearest-neighbour search over entity values.
 *
 * Performance characteristics:
 * - With N entity types and k requested results, this fetches k results from
 *   each type (N×k vectors total), then returns the global top-k.
 * - This is necessary to get semantically correct results when top matches are
 *   distributed across multiple entity types.
 * - Use `type_filter` to reduce N when you know which types are relevant,
 *   limiting the amplification factor.
 * - Example: 10 types, k=20, no filter → fetches 200 vectors, returns 20.
 * - Example: 10 types, k=20, filter=['class', 'finding'] → fetches 40 vectors, returns 20.
 *
 * @param {object} params
 * @param {object} params.store - Memory store with schema and db
 * @param {string} params.query_text - Text to search for
 * @param {number} [params.k=5] - Number of results to return
 * @param {string[]} [params.type_filter] - Restrict search to specific entity types
 * @param {Function} params.embedder - Function to embed query text
 * @returns {Promise<Array<{type: string, name: string, value: string, distance: number}>>}
 */
export async function search({ store, query_text, k = 5, type_filter, embedder }) {
  if (!embedder) throw new Error('search requires an embedder');
  if (typeof query_text !== 'string' || !query_text) throw new Error('query_text required');

  const types = (type_filter && type_filter.length > 0)
    ? type_filter
    : Object.keys(store.schema.entities);
  const [queryVec] = await embedder([query_text]);

  // K-amplification: fetch k from each type to ensure global top-k correctness.
  // With N types, this fetches N×k results. The alternative (fetching k/N per
  // type) would miss results when top matches are unevenly distributed.
  // Callers can use type_filter to reduce N when type relevance is known.
  const all = [];
  for (const t of types) {
    const hits = await searchOneType(store.db, t, queryVec, k);
    all.push(...hits);
  }
  all.sort((a, b) => a.distance - b.distance);
  return all.slice(0, k);
}
