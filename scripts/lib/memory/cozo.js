import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { CozoDb } = require('cozo-node');

export function openMemoryDb(dbPath) {
  return new CozoDb('sqlite', dbPath);
}

export function closeMemoryDb(db) {
  if (db && typeof db.close === 'function') db.close();
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

export async function createHnswIndex(db, relationName, { dim, ef = 50, m = 16 } = {}) {
  if (!Number.isInteger(dim) || dim <= 0) throw new Error('createHnswIndex: dim must be positive integer');
  try {
    await db.run(`::hnsw create ${relationName}:vec { fields: [embedding], dim: ${dim}, ef: ${ef}, m: ${m} }`);
  } catch (err) {
    const msg = String(err && (err.display || err.message || err));
    if (/already exists|already created/i.test(msg)) return;
    throw err;
  }
}

export async function dropHnswIndex(db, relationName) {
  try {
    await db.run(`::hnsw drop ${relationName}:vec`);
  } catch (err) {
    const msg = String(err && (err.display || err.message || err));
    if (/not found|does not exist|no such/i.test(msg)) return;
    throw err;
  }
}

export async function checkpoint(db) {
  // Cozo 0.7 sqlite backend exposes `::compact` for on-demand WAL flush/compaction.
  // `::checkpoint` is not a recognised system op on this version (produces parser::pest).
  try {
    await db.run('::compact');
  } catch (err) {
    const msg = String(err && (err.display || err.message || err));
    if (!/unknown system op|parser::pest/i.test(msg)) throw err;
  }
}

export { entRelName, edgeRelName };
