import { memoryPaths } from '../paths.js';
import { loadSchema, writeSchema, bumpVersion, hashFrontmatter } from '../schema.js';
import { invalidateStore } from '../singleton.js';
import { withLiveMemoryDb, createLiveEdgeType } from './live-store.js';

const IDENT = /^[a-z][a-z0-9_]*$/;

function deduplicateFirstOccurrence(list) {
  const seen = new Set();
  const out = [];
  for (const name of list) {
    if (seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

function normaliseList(v, key) {
  if (v === 'any') return 'any';
  if (!Array.isArray(v) || v.length === 0 || !v.every((s) => typeof s === 'string' && s)) {
    throw new Error(`'${key}' must be 'any' or a non-empty list of entity type names`);
  }
  // Deduplicate while preserving first-occurrence order. `[class, class]` is a
  // user mistake, not a meaningful declaration.
  return deduplicateFirstOccurrence(v);
}

function renderFrontmatter(fm) {
  const lines = [`type: ${fm.type}`];
  for (const key of ['sources', 'targets']) {
    const v = fm[key];
    lines.push(v === 'any' ? `${key}: any` : `${key}: [${v.join(', ')}]`);
  }
  return lines.join('\n');
}

function validateEdgeTypeInputs(name, body) {
  if (!IDENT.test(name)) throw new Error(`invalid identifier: '${name}'`);
  if (typeof body !== 'string' || !body.trim()) throw new Error(`body must be non-empty`);
}

async function assertNoDuplicateDeclaration(name, schema, p, io) {
  if (schema.edges[name]) throw new Error(`edge type '${name}' already exists`);
  if (schema.entities[name]) throw new Error(`'${name}' is already declared as an entity type`);
  if (await io.exists(p.edgeTypeFile(name))) throw new Error(`edge type file already exists on disk`);
}

function assertEntityTypesExist(lists, entities) {
  for (const list of lists) {
    if (list === 'any') continue;
    for (const t of list) {
      if (!entities[t]) throw new Error(`entity type '${t}' is not declared`);
    }
  }
}

async function validateEdgeTypeCreation({ name, srcs, tgts, schema, p, io }) {
  await assertNoDuplicateDeclaration(name, schema, p, io);
  assertEntityTypesExist([srcs, tgts], schema.entities);
}

export async function createEdgeType({ worktreeRoot, io, name, sources, targets, body }) {
  validateEdgeTypeInputs(name, body);
  const srcs = normaliseList(sources, 'sources');
  const tgts = normaliseList(targets, 'targets');

  const foundryDir = 'foundry';
  const p = memoryPaths(foundryDir);
  const schema = await loadSchema(foundryDir, io);

  await validateEdgeTypeCreation({ name, body, srcs, tgts, schema, p, io });

  const frontmatter = { type: name, sources: srcs, targets: tgts };
  const fileContent = `---\n${renderFrontmatter(frontmatter)}\n---\n\n${body.trim()}\n`;
  await io.writeFile(p.edgeTypeFile(name), fileContent);
  await io.writeFile(p.relationFile(name), '');

  schema.edges[name] = { frontmatterHash: hashFrontmatter(frontmatter) };
  bumpVersion(schema);
  await writeSchema(foundryDir, schema, io);

  try {
    await withLiveMemoryDb({ worktreeRoot, io }, async (db) => {
      await createLiveEdgeType(db, name);
    });
  } finally {
    invalidateStore(worktreeRoot);
  }
  return { type: name, sources: srcs, targets: tgts };
}
