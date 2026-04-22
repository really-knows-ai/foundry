const WRITE_TOKENS = /(^|\s)(:put|:rm|:create|:replace|:ensure|:ensure_not|::remove)(\s|$)/;

export async function runQuery(store, query) {
  if (typeof query !== 'string') throw new Error('query must be a string');
  if (WRITE_TOKENS.test(query)) {
    throw new Error('query is read-only; write assertions (:put, :rm, :create, etc.) are not permitted');
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
