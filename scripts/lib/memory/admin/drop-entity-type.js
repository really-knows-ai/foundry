import yaml from 'js-yaml';
import { memoryPaths } from '../paths.js';
import { loadSchema, writeSchema, bumpVersion, hashFrontmatter } from '../schema.js';
import { parseEdgeRows, serialiseEdgeRows } from '../ndjson.js';
import { invalidateStore } from '../singleton.js';

function renderEdgeFrontmatter(fm) {
  const lines = [`type: ${fm.type}`];
  for (const key of ['sources', 'targets']) {
    const v = fm[key];
    lines.push(v === 'any' ? `${key}: any` : `${key}: [${v.join(', ')}]`);
  }
  return lines.join('\n');
}

export async function dropEntityType({ worktreeRoot, io, name, confirm }) {
  if (confirm !== true) throw new Error(`drop requires confirm: true`);
  const p = memoryPaths('foundry');
  const schema = await loadSchema('foundry', io);
  if (!schema.entities[name]) throw new Error(`entity type '${name}' not declared`);

  await io.unlink(p.entityTypeFile(name));
  await io.unlink(p.relationFile(name));

  for (const edgeName of Object.keys({ ...schema.edges })) {
    const edgeFile = p.edgeTypeFile(edgeName);
    if (!(await io.exists(edgeFile))) continue;
    const edgeText = await io.readFile(edgeFile);
    const m = edgeText.match(/^---\n([\s\S]*?)\n---/);
    if (!m) continue;
    const fm = yaml.load(m[1]) ?? {};

    let cascadeDrop = false;
    for (const key of ['sources', 'targets']) {
      if (fm[key] === 'any') continue;
      if (!Array.isArray(fm[key])) continue;
      const filtered = fm[key].filter((t) => t !== name);
      if (filtered.length === 0 && fm[key].includes(name)) cascadeDrop = true;
      fm[key] = filtered.length > 0 ? filtered : fm[key];
    }

    if (cascadeDrop) {
      await io.unlink(edgeFile);
      await io.unlink(p.relationFile(edgeName));
      delete schema.edges[edgeName];
      continue;
    }

    // Update edge type file & rows if any reference changed.
    const body = edgeText.replace(/^---\n[\s\S]*?\n---\r?\n?/, '');
    await io.writeFile(edgeFile, `---\n${renderEdgeFrontmatter(fm)}\n---\n${body.startsWith('\n') ? '' : '\n'}${body}`);
    schema.edges[edgeName].frontmatterHash = hashFrontmatter({ type: edgeName, sources: fm.sources, targets: fm.targets });

    const relFile = p.relationFile(edgeName);
    if (await io.exists(relFile)) {
      const rows = parseEdgeRows(await io.readFile(relFile));
      const kept = rows.filter((r) => r.from_type !== name && r.to_type !== name);
      await io.writeFile(relFile, serialiseEdgeRows(kept));
    }
  }

  delete schema.entities[name];
  bumpVersion(schema);
  await writeSchema('foundry', schema, io);

  invalidateStore(worktreeRoot);
  return { dropped: name };
}
