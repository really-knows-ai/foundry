import { memoryPaths } from '../paths.js';
import { loadSchema, writeSchema, bumpVersion, hashFrontmatter } from '../schema.js';
import { parseEdgeRows, serialiseEdgeRows } from '../ndjson.js';
import { invalidateStore } from '../singleton.js';
import { parseFrontmatter } from '../frontmatter.js';

function renderEdgeFrontmatter(fm) {
  const lines = [`type: ${fm.type}`];
  for (const key of ['sources', 'targets']) {
    const v = fm[key];
    lines.push(v === 'any' ? `${key}: any` : `${key}: [${v.join(', ')}]`);
  }
  return lines.join('\n');
}

/**
 * Analyse a prospective drop without mutating anything. Returns the same shape
 * regardless of whether the caller is previewing or about to confirm, so the
 * destructive path can reuse the decisions.
 */
async function analyseEntityDrop({ io, p, name, schema }) {
  const entityRelFile = p.relationFile(name);
  let entityRows = 0;
  if (await io.exists(entityRelFile)) {
    const text = await io.readFile(entityRelFile);
    // Entity NDJSON: count non-empty lines.
    entityRows = text.split('\n').filter((l) => l.trim() !== '').length;
  }

  const affectedEdges = [];
  for (const edgeName of Object.keys(schema.edges)) {
    const edgeFile = p.edgeTypeFile(edgeName);
    if (!(await io.exists(edgeFile))) continue;
    const edgeText = await io.readFile(edgeFile);
    const parsed = parseFrontmatter(edgeText, { filename: edgeFile });
    if (!parsed.hasFrontmatter) continue;
    const fm = parsed.frontmatter;

    // Mirror the destructive path's decision rules.
    let wouldCascade = false;
    const nextFm = { ...fm };
    for (const key of ['sources', 'targets']) {
      if (fm[key] === 'any') continue;
      if (!Array.isArray(fm[key])) continue;
      const filtered = fm[key].filter((t) => t !== name);
      if (filtered.length === 0 && fm[key].includes(name)) wouldCascade = true;
      nextFm[key] = filtered.length > 0 ? filtered : fm[key];
    }

    if (wouldCascade) {
      affectedEdges.push({ name: edgeName, action: 'cascadeDrop' });
      continue;
    }

    // References name but survives — count rows that would be pruned.
    const referencesName =
      (Array.isArray(fm.sources) && fm.sources.includes(name)) ||
      (Array.isArray(fm.targets) && fm.targets.includes(name));
    if (!referencesName) continue;

    const relFile = p.relationFile(edgeName);
    let rowsAffected = 0;
    if (await io.exists(relFile)) {
      const rows = parseEdgeRows(await io.readFile(relFile));
      rowsAffected = rows.filter((r) => r.from_type === name || r.to_type === name).length;
    }
    affectedEdges.push({ name: edgeName, action: 'prune', rowsAffected, nextFm });
  }

  return { entityRows, affectedEdges };
}

export async function dropEntityType({ worktreeRoot, io, name, confirm }) {
  const p = memoryPaths('foundry');
  const schema = await loadSchema('foundry', io);
  if (!schema.entities[name]) throw new Error(`entity type '${name}' not declared`);

  const analysis = await analyseEntityDrop({ io, p, name, schema });

  if (confirm !== true) {
    return {
      requiresConfirm: true,
      preview: {
        type: 'entity',
        name,
        entityRows: analysis.entityRows,
        affectedEdges: analysis.affectedEdges.map((e) => {
          const base = { name: e.name, action: e.action };
          if (e.action === 'prune') base.rowsAffected = e.rowsAffected;
          return base;
        }),
      },
    };
  }

  await io.unlink(p.entityTypeFile(name));
  await io.unlink(p.relationFile(name));

  for (const edge of analysis.affectedEdges) {
    const edgeFile = p.edgeTypeFile(edge.name);
    if (edge.action === 'cascadeDrop') {
      await io.unlink(edgeFile);
      await io.unlink(p.relationFile(edge.name));
      delete schema.edges[edge.name];
      continue;
    }

    // Prune: rewrite edge file with filtered sources/targets, rewrite rows.
    const edgeText = await io.readFile(edgeFile);
    const parsed = parseFrontmatter(edgeText, { filename: edgeFile });
    const body = parsed.body;
    const nextFm = edge.nextFm;
    await io.writeFile(
      edgeFile,
      `---\n${renderEdgeFrontmatter(nextFm)}\n---\n${body.startsWith('\n') ? '' : '\n'}${body}`,
    );
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

  delete schema.entities[name];
  bumpVersion(schema);
  await writeSchema('foundry', schema, io);

  invalidateStore(worktreeRoot);
  return { dropped: name };
}
