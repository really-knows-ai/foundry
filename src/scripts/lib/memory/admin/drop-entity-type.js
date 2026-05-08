
import { memoryPaths } from '../paths.js';
import { loadSchema, writeSchema, bumpVersion, hashFrontmatter } from '../schema.js';
import { parseEdgeRows, serialiseEdgeRows } from '../ndjson.js';
import { invalidateStore } from '../singleton.js';
import { parseFrontmatter } from '../frontmatter.js';
import {
  withLiveMemoryDb,
  dropLiveEntityType,
  dropLiveEdgeType,
  replaceLiveEdgeRows,
} from './live-store.js';
import { renderEdgeFrontmatter, composeMarkdown } from './helpers.js';

function adjustFmKeyValue(fm, key, name) {
  if (fm[key] === 'any') return fm[key];
  if (!Array.isArray(fm[key])) return fm[key];
  const filtered = fm[key].filter((t) => t !== name);
  return filtered.length > 0 ? filtered : fm[key];
}

function wouldCascadeForKey(fm, key, name) {
  if (fm[key] === 'any') return false;
  if (!Array.isArray(fm[key])) return false;
  const filtered = fm[key].filter((t) => t !== name);
  return filtered.length === 0 && fm[key].includes(name);
}

function computeEdgeFmAdjustment(fm, name) {
  const nextFm = { ...fm };
  let wouldCascade = false;
  for (const key of ['sources', 'targets']) {
    nextFm[key] = adjustFmKeyValue(fm, key, name);
    if (wouldCascadeForKey(fm, key, name)) wouldCascade = true;
  }
  return { nextFm, wouldCascade };
}

function edgeReferencesType(fm, name) {
  return (
    (Array.isArray(fm.sources) && fm.sources.includes(name)) ||
    (Array.isArray(fm.targets) && fm.targets.includes(name))
  );
}

async function countAffectedRows(io, p, edgeName, name) {
  const relFile = p.relationFile(edgeName);
  if (!(await io.exists(relFile))) return 0;
  const rows = parseEdgeRows(await io.readFile(relFile));
  return rows.filter((r) => r.from_type === name || r.to_type === name).length;
}

async function analyseEdgeForDrop({ io, p, name, edgeName }) {
  const edgeFile = p.edgeTypeFile(edgeName);
  if (!(await io.exists(edgeFile))) return null;
  const edgeText = await io.readFile(edgeFile);
  const parsed = parseFrontmatter(edgeText, { filename: edgeFile });
  if (!parsed.hasFrontmatter) return null;
  const fm = parsed.frontmatter;

  const { nextFm, wouldCascade } = computeEdgeFmAdjustment(fm, name);
  if (wouldCascade) return { name: edgeName, action: 'cascadeDrop' };
  if (!edgeReferencesType(fm, name)) return null;

  const rowsAffected = await countAffectedRows(io, p, edgeName, name);
  return { name: edgeName, action: 'prune', rowsAffected, nextFm };
}

async function analyseEntityDrop({ io, p, name, schema }) {
  const entityRelFile = p.relationFile(name);
  let entityRows = 0;
  if (await io.exists(entityRelFile)) {
    const text = await io.readFile(entityRelFile);
    entityRows = text.split('\n').filter((l) => l.trim() !== '').length;
  }

  const affectedEdges = [];
  for (const edgeName of Object.keys(schema.edges)) {
    const result = await analyseEdgeForDrop({ io, p, name, edgeName });
    if (result) affectedEdges.push(result);
  }

  return { entityRows, affectedEdges };
}

function buildPreview(analysis, name) {
  return {
    type: 'entity',
    name,
    entityRows: analysis.entityRows,
    affectedEdges: analysis.affectedEdges.map((e) => {
      const base = { name: e.name, action: e.action };
      if (e.action === 'prune') base.rowsAffected = e.rowsAffected;
      return base;
    }),
  };
}

async function processAffectedEdgesDisk(io, p, analysis, schema, name) {
  for (const edge of analysis.affectedEdges) {
    const edgeFile = p.edgeTypeFile(edge.name);
    if (edge.action === 'cascadeDrop') {
      await io.unlink(edgeFile);
      await io.unlink(p.relationFile(edge.name));
      delete schema.edges[edge.name];
      continue;
    }

    const edgeText = await io.readFile(edgeFile);
    const parsed = parseFrontmatter(edgeText, { filename: edgeFile });
    const body = parsed.body;
    const nextFm = edge.nextFm;
    await io.writeFile(edgeFile, composeMarkdown(renderEdgeFrontmatter(nextFm), body));
    schema.edges[edge.name].frontmatterHash = hashFrontmatter({
      type: edge.name,
      sources: nextFm.sources,
      targets: nextFm.targets,
    });

    const relFile = p.relationFile(edge.name);
    if (await io.exists(relFile)) {
      const rows = parseEdgeRows(await io.readFile(relFile));
      const kept = rows.filter((r) => r.from_type !== name && r.to_type !== name);
      await io.writeFile(relFile, serialiseEdgeRows(kept));
    }
  }
}

async function updateLiveDb(worktreeRoot, io, p, analysis, name) {
  await withLiveMemoryDb({ worktreeRoot, io }, async (db) => {
    for (const edge of analysis.affectedEdges) {
      if (edge.action === 'cascadeDrop') {
        await dropLiveEdgeType(db, edge.name);
        continue;
      }
      const relFile = p.relationFile(edge.name);
      const rows = await io.exists(relFile)
        ? parseEdgeRows(await io.readFile(relFile))
        : [];
      await replaceLiveEdgeRows(db, edge.name, rows);
    }
    await dropLiveEntityType(db, name);
  });
}

export async function dropEntityType({ worktreeRoot, io, name, confirm }) {
  const foundryDir = 'foundry';
  const p = memoryPaths(foundryDir);
  const schema = await loadSchema(foundryDir, io);
  if (!schema.entities[name]) throw new Error(`entity type '${name}' not declared`);

  const analysis = await analyseEntityDrop({ io, p, name, schema });

  if (confirm !== true) {
    return { requiresConfirm: true, preview: buildPreview(analysis, name) };
  }

  await io.unlink(p.entityTypeFile(name));
  await io.unlink(p.relationFile(name));
  await processAffectedEdgesDisk(io, p, analysis, schema, name);

  delete schema.entities[name];
  bumpVersion(schema);
  await writeSchema(foundryDir, schema, io);

  try {
    await updateLiveDb(worktreeRoot, io, p, analysis, name);
  } finally {
    invalidateStore(worktreeRoot);
  }
  return { dropped: name };
}
