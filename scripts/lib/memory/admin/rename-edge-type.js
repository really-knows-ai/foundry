
import { memoryPaths } from '../paths.js';
import { loadSchema, writeSchema, bumpVersion, hashFrontmatter } from '../schema.js';
import { invalidateStore } from '../singleton.js';
import { parseFrontmatter } from '../frontmatter.js';
import { renderEdgeFrontmatter, composeMarkdown } from './helpers.js';

const IDENT = /^[a-z][a-z0-9_]*$/;

export async function renameEdgeType({ worktreeRoot, io, from, to }) {
  if (!IDENT.test(to)) throw new Error(`invalid identifier: '${to}'`);
  if (from === to) throw new Error(`from and to identical`);

  const foundryDir = 'foundry';
  const p = memoryPaths(foundryDir);
  const schema = await loadSchema(foundryDir, io);
  if (!schema.edges[from]) throw new Error(`edge type '${from}' not declared`);
  if (schema.edges[to] || schema.entities[to]) throw new Error(`'${to}' already exists`);

  const oldFile = p.edgeTypeFile(from);
  const text = await io.readFile(oldFile);
  const parsed = parseFrontmatter(text, { filename: oldFile });
  if (!parsed.hasFrontmatter) throw new Error(`edge type file lacks frontmatter`);
  const fm = parsed.frontmatter;
  fm.type = to;
  const body = parsed.body;
  await io.writeFile(p.edgeTypeFile(to), composeMarkdown(renderEdgeFrontmatter(fm), body));
  await io.unlink(oldFile);

  const oldRel = p.relationFile(from);
  if (await io.exists(oldRel)) {
    const rel = await io.readFile(oldRel);
    await io.writeFile(p.relationFile(to), rel);
    await io.unlink(oldRel);
  } else {
    await io.writeFile(p.relationFile(to), '');
  }

  schema.edges[to] = { frontmatterHash: hashFrontmatter({ type: to, sources: fm.sources, targets: fm.targets }) };
  delete schema.edges[from];
  bumpVersion(schema);
  await writeSchema(foundryDir, schema, io);

  invalidateStore(worktreeRoot);
  return { from, to };
}
