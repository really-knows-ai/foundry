import { memoryPaths } from '../paths.js';
import { loadSchema, writeSchema, bumpVersion } from '../schema.js';
import { invalidateStore } from '../singleton.js';

export async function dropEdgeType({ worktreeRoot, io, name, confirm }) {
  const p = memoryPaths('foundry');
  const schema = await loadSchema('foundry', io);
  if (!schema.edges[name]) throw new Error(`edge type '${name}' not declared`);

  if (confirm !== true) {
    let rows = 0;
    const relFile = p.relationFile(name);
    if (await io.exists(relFile)) {
      const text = await io.readFile(relFile);
      rows = text.split('\n').filter((l) => l.trim() !== '').length;
    }
    return {
      requiresConfirm: true,
      preview: { type: 'edge', name, rows },
    };
  }

  await io.unlink(p.edgeTypeFile(name));
  await io.unlink(p.relationFile(name));
  delete schema.edges[name];
  bumpVersion(schema);
  await writeSchema('foundry', schema, io);

  invalidateStore(worktreeRoot);
  return { dropped: name };
}
