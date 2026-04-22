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
} from './cozo.js';
import { serialiseEntityRows, serialiseEdgeRows, parseEntityRows, parseEdgeRows } from './ndjson.js';

function escape(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

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
      const data = plain.map((r) => `["${escape(r.name)}", "${escape(r.value)}"]`).join(', ');
      await db.run(`?[name, value] <- [${data}]\n:put ${relName} { name => value }`);
    }
    if (withVec.length > 0) {
      const data = withVec
        .map((r) => `["${escape(r.name)}", "${escape(r.value)}", ${vecLit(r.embedding)}]`)
        .join(', ');
      await db.run(`?[name, value, embedding] <- [${data}]\n:put ${relName} { name => value, embedding }`);
    }
  } else {
    const data = rows.map((r) => `["${escape(r.from_type)}", "${escape(r.from_name)}", "${escape(r.to_type)}", "${escape(r.to_name)}"]`).join(', ');
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
