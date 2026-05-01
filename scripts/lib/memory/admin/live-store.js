import { join } from 'node:path';
import {
  openMemoryDb,
  closeMemoryDb,
  createEntityRelation,
  createEdgeRelation,
  createHnswIndex,
  dropRelation,
  dropHnswIndex,
  entRelName,
  edgeRelName,
  cozoStringLit,
} from '../cozo.js';
import { memoryPaths } from '../paths.js';

async function dropRelationIfPresent(db, relationName) {
  try {
    await dropRelation(db, relationName);
  } catch (err) {
    const msg = String(err && (err.display || err.message || err));
    if (/not found|does not exist|no such/i.test(msg)) return;
    throw err;
  }
}

export async function withLiveMemoryDb({ worktreeRoot, io }, fn) {
  const paths = memoryPaths('foundry');
  if (!(await io.exists(paths.db))) return;

  const db = openMemoryDb(join(worktreeRoot, paths.db));
  try {
    await fn(db);
  } finally {
    closeMemoryDb(db);
  }
}

export async function createLiveEntityType(db, name, { embeddingsDim } = {}) {
  await createEntityRelation(db, name, embeddingsDim ? { dim: embeddingsDim } : {});
  if (embeddingsDim) {
    await createHnswIndex(db, entRelName(name), { dim: embeddingsDim });
  }
}

export async function createLiveEdgeType(db, name) {
  await createEdgeRelation(db, name);
}

export async function dropLiveEntityType(db, name) {
  await dropHnswIndex(db, entRelName(name));
  await dropRelationIfPresent(db, entRelName(name));
}

export async function dropLiveEdgeType(db, name) {
  await dropRelationIfPresent(db, edgeRelName(name));
}

export async function replaceLiveEdgeRows(db, name, rows) {
  const relationName = edgeRelName(name);
  await dropRelationIfPresent(db, relationName);
  await createEdgeRelation(db, name);
  if (rows.length === 0) return;

  const data = rows
    .map((row) => `[` +
      `${cozoStringLit(row.from_type)}, ${cozoStringLit(row.from_name)}, ` +
      `${cozoStringLit(row.to_type)}, ${cozoStringLit(row.to_name)}]`)
    .join(', ');
  await db.run(
    `?[from_type, from_name, to_type, to_name] <- [${data}]\n:put ${relationName} { from_type, from_name, to_type, to_name }`,
  );
}
