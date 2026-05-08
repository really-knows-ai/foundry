import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { CozoDb } = require('cozo-node');

export function openMemoryDb(dbPath) {
  return new CozoDb('sqlite', dbPath);
}

export function closeMemoryDb(db) {
  if (db && typeof db.close === 'function') db.close();
}

/**
 * Canonical Cozo string literal encoder.
 *
 * Emits a **single-quoted** literal. Single-quoted literals honour standard
 * escape sequences and safely handle embedded `"`, `\`, newlines, CR, tabs,
 * and backslashes, producing a safe round-trip for all supported characters.
 * (Cozo's `"..."` form is raw and stores backslash sequences literally.)
 *
 * Used by every query builder in this package so read and write paths never
 * diverge on what they consider a safe literal. NUL characters are rejected
 * here because Cozo single-quoted string literals lack `\0` escape support.
 * The write path (putEntity, relate, unrelate) also validates for NUL in
 * validateEntityWrite/validateEdgeWrite, providing defence in depth for
 * import paths and future callers.
 */
export function cozoStringLit(s) {
  const str = String(s);
  if (str.includes('\0')) {
    throw new Error('cozoStringLit: string must not contain NUL (\\0)');
  }
  const escaped = str
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
  return `'${escaped}'`;
}

function entRelName(type) { return `ent_${type}`; }
function edgeRelName(type) { return `edge_${type}`; }

async function relationExists(db, name) {
  const res = await db.run('::relations');
  return res.rows.some((r) => r[0] === name);
}

export async function listRelations(db) {
  const res = await db.run('::relations');
  return res.rows.map((r) => r[0]);
}

export async function createEntityRelation(db, type, opts = {}) {
  const name = entRelName(type);
  if (await relationExists(db, name)) return;
  const { dim } = opts;
  // Cozo 0.7 requires a typed vector (<F32; N>) for HNSW indexing. When no
  // embeddings are configured we keep the flexible [Float]? column so the
  // relation can still be created and written to without embeddings.
  const embeddingCol = Number.isInteger(dim) && dim > 0
    ? `embedding: <F32; ${dim}>? default null`
    : `embedding: [Float]? default null`;
  await db.run(`:create ${name} { name: String => value: String, ${embeddingCol} }`);
}

export async function createEdgeRelation(db, type) {
  const name = edgeRelName(type);
  if (await relationExists(db, name)) return;
  await db.run(`:create ${name} { from_type: String, from_name: String, to_type: String, to_name: String }`);
}

export async function dropRelation(db, relationName) {
  await db.run(`::remove ${relationName}`);
}

function isIgnorableError(err, patterns) {
  const msg = String(err && (err.display || err.message || err));
  return patterns.some((p) => p.test(msg));
}

function assertHnswDim(dim) {
  if (!Number.isInteger(dim) || dim <= 0) throw new Error('createHnswIndex: dim must be positive integer');
}

function resolveHnswOpts(opts) {
  const { dim, ef = 50, m = 16 } = opts ?? {};
  return { dim, ef, m };
}

export async function createHnswIndex(db, relationName, opts) {
  const { dim, ef, m } = resolveHnswOpts(opts);
  assertHnswDim(dim);
  try {
    await db.run(`::hnsw create ${relationName}:vec { fields: [embedding], dim: ${dim}, ef: ${ef}, m: ${m} }`);
  } catch (err) {
    if (isIgnorableError(err, [/already exists/i, /already created/i])) return;
    throw err;
  }
}

export async function dropHnswIndex(db, relationName) {
  try {
    await db.run(`::hnsw drop ${relationName}:vec`);
  } catch (err) {
    if (isIgnorableError(err, [/not found/i, /does not exist/i, /no such/i])) return;
    throw err;
  }
}

export async function checkpoint(db) {
  try {
    await db.run('::compact');
  } catch (err) {
    if (!isIgnorableError(err, [/unknown system op/i, /parser::pest/i])) throw err;
  }
}

export { entRelName, edgeRelName };
