// Block write assertions (rule heads that modify a relation).
const WRITE_ASSERTIONS = /(^|\s)(:put|:rm|:create|:replace|:ensure|:ensure_not)(\s|$)/;

// All `::foo` system ops go through an allowlist. Anything not listed here —
// including `::remove`, `::hnsw create|drop`, `::index create|drop`, `::fts …`,
// `::kill` — is rejected. Add entries here after confirming they are
// side-effect-free.
const SYSTEM_OP = /(^|\s)(::[a-zA-Z_]+)/g;
const ALLOWED_SYSTEM_OPS = new Set([
  '::relations',
  '::columns',
  '::describe',
  '::indices',
  '::compact',
  '::explain',
  '::running',
  '::show_triggers',
]);

export async function runQuery(store, query) {
  if (typeof query !== 'string') throw new Error('query must be a string');
  if (WRITE_ASSERTIONS.test(query)) {
    throw new Error('query is read-only; write assertions (:put, :rm, :create, etc.) are not permitted');
  }
  for (const m of query.matchAll(SYSTEM_OP)) {
    const op = m[2];
    if (!ALLOWED_SYSTEM_OPS.has(op)) {
      throw new Error(`query is read-only; system op ${op} is not permitted (allowed: ${[...ALLOWED_SYSTEM_OPS].sort().join(', ')})`);
    }
  }
  let res;
  try {
    res = await store.db.run(query);
  } catch (err) {
    const msg = err?.display ?? err?.message ?? String(err);
    throw new Error(`query error: ${msg}`);
  }
  const headers = res.headers ?? [];
  const rows = (res.rows ?? []).map((row) => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = row[i]; });
    return obj;
  });
  return { headers, rows };
}
