
import { memoryPaths } from '../paths.js';
import { loadSchema, writeSchema, bumpVersion, hashFrontmatter } from '../schema.js';
import { parseEdgeRows, serialiseEdgeRows, parseEntityRows, serialiseEntityRows } from '../ndjson.js';
import { invalidateStore } from '../singleton.js';
import { parseFrontmatter } from '../frontmatter.js';
import { renderEdgeFrontmatter, composeMarkdown } from './helpers.js';
import matter from 'gray-matter';
import yaml from 'js-yaml';

const IDENT = /^[a-z][a-z0-9_]*$/;

function assertValidIdentifier(id) {
  if (!IDENT.test(id)) throw new Error(`invalid identifier: '${id}'`);
}

function assertDistinct(from, to) {
  if (from === to) throw new Error(`from and to are identical`);
}

function assertSourceExists(schema, from) {
  if (!schema.entities[from]) throw new Error(`entity type '${from}' not declared`);
}

function assertTargetFree(schema, to) {
  if (schema.entities[to]) throw new Error(`'${to}' already exists`);
  if (schema.edges[to]) throw new Error(`'${to}' already exists`);
}

function validateRename(schema, from, to) {
  assertValidIdentifier(to);
  assertDistinct(from, to);
  assertSourceExists(schema, from);
  assertTargetFree(schema, to);
}

async function rewriteEntityTypeFile(from, to, p, io) {
  const oldFile = p.entityTypeFile(from);
  const text = await io.readFile(oldFile);
  const { data, content } = matter(text);
  const fm = { ...data, type: to };
  const fmBlock = `---\n${yaml.dump(fm, { lineWidth: -1, sortKeys: false }).trim()}\n---`;
  const newText = content ? `${fmBlock}\n${content}` : fmBlock;
  await io.writeFile(p.entityTypeFile(to), newText);
  await io.unlink(oldFile);
}

async function rewriteEntityRelationFile(from, to, p, io) {
  const oldRel = p.relationFile(from);
  if (await io.exists(oldRel)) {
    const rows = parseEntityRows(await io.readFile(oldRel));
    await io.writeFile(p.relationFile(to), serialiseEntityRows(rows));
    await io.unlink(oldRel);
  } else {
    await io.writeFile(p.relationFile(to), '');
  }
}

function mapEdgeArray(arr, from, to) {
  return arr.map((x) => (x === from ? to : x));
}

function needsRename(fm, from) {
  if (fm === 'any') return false;
  return Array.isArray(fm) && fm.includes(from);
}

function applyRename(fm, from, to) {
  let changed = false;
  for (const key of ['sources', 'targets']) {
    if (needsRename(fm[key], from)) {
      fm[key] = mapEdgeArray(fm[key], from, to);
      changed = true;
    }
  }
  return changed;
}

function mapEdgeRows(rows, from, to) {
  let rowsChanged = false;
  const newRows = rows.map((r) => {
    let nr = r;
    if (r.from_type === from) { nr = { ...nr, from_type: to }; rowsChanged = true; }
    if (r.to_type === from) { nr = { ...nr, to_type: to }; rowsChanged = true; }
    return nr;
  });
  return { newRows, rowsChanged };
}

async function updateEdgeTypeRows(edgeName, from, to, ctx) {
  const relFile = ctx.p.relationFile(edgeName);
  if (await ctx.io.exists(relFile)) {
    const rows = parseEdgeRows(await ctx.io.readFile(relFile));
    const { newRows, rowsChanged } = mapEdgeRows(rows, from, to);
    if (rowsChanged) await ctx.io.writeFile(relFile, serialiseEdgeRows(newRows));
  }
}

async function updateEdgeTypeFrontmatter(edgeName, from, to, ctx) {
  const edgeFile = ctx.p.edgeTypeFile(edgeName);
  const edgeText = await ctx.io.readFile(edgeFile);
  const parsed = parseFrontmatter(edgeText, { filename: edgeFile });
  if (!parsed.hasFrontmatter) return null;

  const changed = applyRename(parsed.frontmatter, from, to);
  if (!changed) return null;

  const body = parsed.body;
  const hash = hashFrontmatter({
    type: edgeName,
    sources: parsed.frontmatter.sources,
    targets: parsed.frontmatter.targets,
  });
  await ctx.io.writeFile(edgeFile, composeMarkdown(renderEdgeFrontmatter(parsed.frontmatter), body));
  return hash;
}

async function updateAllEdgeTypes(from, to, ctx) {
  const hashes = new Map();
  for (const edgeName of Object.keys(ctx.schema.edges)) {
    const hash = await updateEdgeTypeFrontmatter(edgeName, from, to, ctx);
    if (hash !== null) hashes.set(edgeName, hash);
    await updateEdgeTypeRows(edgeName, from, to, ctx);
  }
  for (const [edgeName, hash] of hashes) {
    ctx.schema.edges[edgeName].frontmatterHash = hash;
  }
}

async function updateSchema(schema, from, to, foundryDir, io) {
  schema.entities[to] = { frontmatterHash: hashFrontmatter({ type: to }) };
  delete schema.entities[from];
  bumpVersion(schema);
  await writeSchema(foundryDir, schema, io);
}

export async function renameEntityType({ worktreeRoot, io, from, to }) {
  const foundryDir = 'foundry';
  const p = memoryPaths(foundryDir);
  const schema = await loadSchema(foundryDir, io);

  validateRename(schema, from, to);
  await rewriteEntityTypeFile(from, to, p, io);
  await rewriteEntityRelationFile(from, to, p, io);
  const ctx = { p, io, schema };
  await updateAllEdgeTypes(from, to, ctx);
  await updateSchema(schema, from, to, foundryDir, io);

  invalidateStore(worktreeRoot);
  return { from, to };
}
