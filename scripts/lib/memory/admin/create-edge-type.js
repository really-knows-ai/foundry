import { memoryPaths } from '../paths.js';
import { loadSchema, writeSchema, bumpVersion, hashFrontmatter } from '../schema.js';
import { invalidateStore } from '../singleton.js';

const IDENT = /^[a-z][a-z0-9_]*$/;

function normaliseList(v, key) {
  if (v === 'any') return 'any';
  if (!Array.isArray(v) || v.length === 0 || !v.every((s) => typeof s === 'string' && s)) {
    throw new Error(`'${key}' must be 'any' or a non-empty list of entity type names`);
  }
  // Deduplicate while preserving first-occurrence order. `[class, class]` is a
  // user mistake, not a meaningful declaration.
  const seen = new Set();
  const out = [];
  for (const name of v) {
    if (seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

function renderFrontmatter(fm) {
  const lines = [`type: ${fm.type}`];
  for (const key of ['sources', 'targets']) {
    const v = fm[key];
    lines.push(v === 'any' ? `${key}: any` : `${key}: [${v.join(', ')}]`);
  }
  return lines.join('\n');
}

export async function createEdgeType({ worktreeRoot, io, name, sources, targets, body }) {
  if (!IDENT.test(name)) throw new Error(`invalid identifier: '${name}'`);
  if (typeof body !== 'string' || !body.trim()) throw new Error(`body must be non-empty`);
  const srcs = normaliseList(sources, 'sources');
  const tgts = normaliseList(targets, 'targets');

  const p = memoryPaths('foundry');
  const schema = await loadSchema('foundry', io);

  if (schema.edges[name]) throw new Error(`edge type '${name}' already exists`);
  if (schema.entities[name]) throw new Error(`'${name}' is already declared as an entity type`);
  if (await io.exists(p.edgeTypeFile(name))) throw new Error(`edge type file already exists on disk`);

  for (const list of [srcs, tgts]) {
    if (list === 'any') continue;
    for (const t of list) {
      if (!schema.entities[t]) throw new Error(`entity type '${t}' is not declared`);
    }
  }

  const frontmatter = { type: name, sources: srcs, targets: tgts };
  const fileContent = `---\n${renderFrontmatter(frontmatter)}\n---\n\n${body.trim()}\n`;
  await io.writeFile(p.edgeTypeFile(name), fileContent);
  await io.writeFile(p.relationFile(name), '');

  schema.edges[name] = { frontmatterHash: hashFrontmatter(frontmatter) };
  bumpVersion(schema);
  await writeSchema('foundry', schema, io);

  invalidateStore(worktreeRoot);
  return { type: name, sources: srcs, targets: tgts };
}
