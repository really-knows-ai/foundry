import { memoryPaths } from './paths.js';
import {
  openMemoryDb,
  closeMemoryDb,
  createEntityRelation,
  createEdgeRelation,
  createHnswIndex,
  checkpoint,
  entRelName,
  edgeRelName,
  listRelations,
  dropRelation,
  dropHnswIndex,
  cozoStringLit,
} from './cozo.js';
import { serialiseEntityRows, serialiseEdgeRows, parseEntityRows, parseEdgeRows } from './ndjson.js';

function vecLit(v) {
  return `vec([${v.map((n) => Number(n).toString()).join(', ')}])`;
}

async function importRelation(db, relName, rows, kind) {
  if (rows.length === 0) return;
  if (kind === 'entity') {
    // Partition by presence of embedding so the two column shapes are written
    // with matching :put headers.
    const withVec = rows.filter((r) => Array.isArray(r.embedding));
    const plain = rows.filter((r) => !Array.isArray(r.embedding));
    if (plain.length > 0) {
      const data = plain.map((r) => `[${cozoStringLit(r.name)}, ${cozoStringLit(r.value)}]`).join(', ');
      await db.run(`?[name, value] <- [${data}]\n:put ${relName} { name => value }`);
    }
    if (withVec.length > 0) {
      const data = withVec
        .map((r) => `[${cozoStringLit(r.name)}, ${cozoStringLit(r.value)}, ${vecLit(r.embedding)}]`)
        .join(', ');
      await db.run(`?[name, value, embedding] <- [${data}]\n:put ${relName} { name => value, embedding }`);
    }
  } else {
    const data = rows.map((r) => `[${cozoStringLit(r.from_type)}, ${cozoStringLit(r.from_name)}, ${cozoStringLit(r.to_type)}, ${cozoStringLit(r.to_name)}]`).join(', ');
    await db.run(`?[from_type, from_name, to_type, to_name] <- [${data}]\n:put ${relName} { from_type, from_name, to_type, to_name }`);
  }
}

async function exportEntityRelation(db, type) {
  const res = await db.run(`?[name, value, embedding] := *ent_${type}{name, value, embedding}`);
  return res.rows.map(([name, value, embedding]) => {
    const row = { name, value };
    if (Array.isArray(embedding) && embedding.length > 0) row.embedding = embedding;
    return row;
  });
}

async function exportEdgeRelation(db, type) {
  const res = await db.run(`?[ft, fn, tt, tn] := *edge_${type}{from_type: ft, from_name: fn, to_type: tt, to_name: tn}`);
  return res.rows.map(([ft, fn, tt, tn]) => ({ from_type: ft, from_name: fn, to_type: tt, to_name: tn }));
}

export async function openStore({ foundryDir, schema, io, dbAbsolutePath }) {
  const p = memoryPaths(foundryDir);
  if (!(await io.exists(p.root))) await io.mkdir(p.root);
  if (!(await io.exists(p.relationsDir))) await io.mkdir(p.relationsDir);

  const db = openMemoryDb(dbAbsolutePath);

  // Reconcile the on-disk Cozo database with the declared schema. Admin
  // operations (drop-*, rename-*) update the schema + type files + NDJSON on
  // disk and invalidate the singleton, but they don't touch the live .db (the
  // process has typically closed the handle by then). On reopen, any
  // `ent_<t>` or `edge_<t>` relation not in `schema` is orphan cruft — drop
  // it here so `::relations` stays consistent and disk footprint doesn't grow
  // unboundedly.
  await reconcileRelations(db, schema);

  const embeddingsDim = schema.embeddings && schema.embeddings.dimensions;
  for (const type of Object.keys(schema.entities)) {
    await createEntityRelation(db, type, embeddingsDim ? { dim: embeddingsDim } : {});
    if (embeddingsDim) {
      await createHnswIndex(db, entRelName(type), { dim: embeddingsDim });
    }
    const file = p.relationFile(type);
    if (await io.exists(file)) {
      const text = await io.readFile(file);
      const rows = parseEntityRows(text);
      await importRelation(db, entRelName(type), rows, 'entity');
    }
  }
  for (const type of Object.keys(schema.edges)) {
    await createEdgeRelation(db, type);
    const file = p.relationFile(type);
    if (await io.exists(file)) {
      const text = await io.readFile(file);
      const rows = parseEdgeRows(text);
      await importRelation(db, edgeRelName(type), rows, 'edge');
    }
  }

  return { db, foundryDir, schema, paths: p };
}

async function reconcileRelations(db, schema) {
  const expected = new Set([
    ...Object.keys(schema.entities).map(entRelName),
    ...Object.keys(schema.edges).map(edgeRelName),
  ]);
  let existing;
  try {
    existing = await listRelations(db);
  } catch {
    return; // fresh db; ::relations may error before any :create.
  }
  for (const rel of existing) {
    // Only touch top-level ent_/edge_ relations. ::relations also lists HNSW
    // index entries (e.g. `ent_class:vec`) — those are dropped transitively
    // when the base relation is removed, and `::hnsw drop foo:vec:vec` is a
    // parse error.
    if (!/^(ent|edge)_[^:]+$/.test(rel)) continue;
    if (expected.has(rel)) continue;
    if (rel.startsWith('ent_')) {
      await dropHnswIndex(db, rel); // no-op if absent
    }
    await dropRelation(db, rel);
  }
}

export async function syncStore({ store, io }) {
  const { db, schema, paths: p } = store;
  await checkpoint(db);
  for (const type of Object.keys(schema.entities)) {
    const rows = await exportEntityRelation(db, type);
    await io.writeFile(p.relationFile(type), serialiseEntityRows(rows));
  }
  for (const type of Object.keys(schema.edges)) {
    const rows = await exportEdgeRelation(db, type);
    await io.writeFile(p.relationFile(type), serialiseEdgeRows(rows));
  }
}

export function closeStore(store) {
  closeMemoryDb(store.db);
}
