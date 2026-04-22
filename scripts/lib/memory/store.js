import { memoryPaths } from './paths.js';
import { openMemoryDb, closeMemoryDb, createEntityRelation, createEdgeRelation, checkpoint, entRelName, edgeRelName } from './cozo.js';
import { serialiseEntityRows, serialiseEdgeRows, parseEntityRows, parseEdgeRows } from './ndjson.js';

function escape(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

async function importRelation(db, relName, rows, kind) {
  if (rows.length === 0) return;
  if (kind === 'entity') {
    const data = rows.map((r) => `["${escape(r.name)}", "${escape(r.value)}"]`).join(', ');
    await db.run(`?[name, value] <- [${data}]\n:put ${relName} { name => value }`);
  } else {
    const data = rows.map((r) => `["${escape(r.from_type)}", "${escape(r.from_name)}", "${escape(r.to_type)}", "${escape(r.to_name)}"]`).join(', ');
    await db.run(`?[from_type, from_name, to_type, to_name] <- [${data}]\n:put ${relName} { from_type, from_name, to_type, to_name }`);
  }
}

async function exportEntityRelation(db, type) {
  const res = await db.run(`?[name, value] := *ent_${type}{name, value}`);
  return res.rows.map(([name, value]) => ({ name, value }));
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

  for (const type of Object.keys(schema.entities)) {
    await createEntityRelation(db, type);
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
