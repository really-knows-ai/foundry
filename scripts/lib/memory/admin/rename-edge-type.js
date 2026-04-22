import yaml from 'js-yaml';
import { memoryPaths } from '../paths.js';
import { loadSchema, writeSchema, bumpVersion, hashFrontmatter } from '../schema.js';
import { invalidateStore } from '../singleton.js';

const IDENT = /^[a-z][a-z0-9_]*$/;

function renderEdgeFrontmatter(fm) {
  const lines = [`type: ${fm.type}`];
  for (const key of ['sources', 'targets']) {
    const v = fm[key];
    lines.push(v === 'any' ? `${key}: any` : `${key}: [${v.join(', ')}]`);
  }
  return lines.join('\n');
}

export async function renameEdgeType({ worktreeRoot, io, from, to }) {
  if (!IDENT.test(to)) throw new Error(`invalid identifier: '${to}'`);
  if (from === to) throw new Error(`from and to identical`);

  const p = memoryPaths('foundry');
  const schema = await loadSchema('foundry', io);
  if (!schema.edges[from]) throw new Error(`edge type '${from}' not declared`);
  if (schema.edges[to] || schema.entities[to]) throw new Error(`'${to}' already exists`);

  const oldFile = p.edgeTypeFile(from);
  const text = await io.readFile(oldFile);
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  if (!m) throw new Error(`edge type file lacks frontmatter`);
  const fm = yaml.load(m[1]) ?? {};
  fm.type = to;
  const body = text.replace(/^---\n[\s\S]*?\n---\r?\n?/, '');
  await io.writeFile(p.edgeTypeFile(to), `---\n${renderEdgeFrontmatter(fm)}\n---\n${body.startsWith('\n') ? '' : '\n'}${body}`);
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
  await writeSchema('foundry', schema, io);

  invalidateStore(worktreeRoot);
  return { from, to };
}
