import yaml from 'js-yaml';
import { memoryPaths } from '../paths.js';
import { loadSchema, writeSchema, bumpVersion, hashFrontmatter } from '../schema.js';
import { parseEdgeRows, serialiseEdgeRows, parseEntityRows, serialiseEntityRows } from '../ndjson.js';
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

export async function renameEntityType({ worktreeRoot, io, from, to }) {
  if (!IDENT.test(to)) throw new Error(`invalid identifier: '${to}'`);
  if (from === to) throw new Error(`from and to are identical`);

  const p = memoryPaths('foundry');
  const schema = await loadSchema('foundry', io);
  if (!schema.entities[from]) throw new Error(`entity type '${from}' not declared`);
  if (schema.entities[to] || schema.edges[to]) throw new Error(`'${to}' already exists`);

  // Rewrite entity type file.
  const oldFile = p.entityTypeFile(from);
  const text = await io.readFile(oldFile);
  const newText = text.replace(/^---\n([\s\S]*?)\n---/, (_, fm) => {
    const replaced = fm.replace(/^type:\s*.+$/m, `type: ${to}`);
    return `---\n${replaced}\n---`;
  });
  await io.writeFile(p.entityTypeFile(to), newText);
  await io.unlink(oldFile);

  // Rewrite entity relation file.
  const oldRel = p.relationFile(from);
  if (await io.exists(oldRel)) {
    const rows = parseEntityRows(await io.readFile(oldRel));
    await io.writeFile(p.relationFile(to), serialiseEntityRows(rows));
    await io.unlink(oldRel);
  } else {
    await io.writeFile(p.relationFile(to), '');
  }

  // Update every edge type that mentions `from` and rewrite that edge's relation rows.
  for (const edgeName of Object.keys(schema.edges)) {
    const edgeFile = p.edgeTypeFile(edgeName);
    const edgeText = await io.readFile(edgeFile);
    const m = edgeText.match(/^---\n([\s\S]*?)\n---/);
    if (!m) continue;
    const fm = yaml.load(m[1]) ?? {};
    let changed = false;
    for (const key of ['sources', 'targets']) {
      if (fm[key] === 'any') continue;
      if (Array.isArray(fm[key]) && fm[key].includes(from)) {
        fm[key] = fm[key].map((x) => (x === from ? to : x));
        changed = true;
      }
    }
    if (changed) {
      const body = edgeText.replace(/^---\n[\s\S]*?\n---\r?\n?/, '');
      await io.writeFile(edgeFile, `---\n${renderEdgeFrontmatter(fm)}\n---\n${body.startsWith('\n') ? '' : '\n'}${body}`);
      schema.edges[edgeName].frontmatterHash = hashFrontmatter({ type: edgeName, sources: fm.sources, targets: fm.targets });
    }

    // Rewrite edge rows that reference the renamed type.
    const relFile = p.relationFile(edgeName);
    if (await io.exists(relFile)) {
      const rows = parseEdgeRows(await io.readFile(relFile));
      let rowsChanged = false;
      const newRows = rows.map((r) => {
        let nr = r;
        if (r.from_type === from) { nr = { ...nr, from_type: to }; rowsChanged = true; }
        if (r.to_type === from) { nr = { ...nr, to_type: to }; rowsChanged = true; }
        return nr;
      });
      if (rowsChanged) await io.writeFile(relFile, serialiseEdgeRows(newRows));
    }
  }

  // Schema updates.
  schema.entities[to] = { frontmatterHash: hashFrontmatter({ type: to }) };
  delete schema.entities[from];
  bumpVersion(schema);
  await writeSchema('foundry', schema, io);

  invalidateStore(worktreeRoot);
  return { from, to };
}
