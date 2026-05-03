
import { memoryPaths } from '../paths.js';
import { loadSchema, writeSchema, bumpVersion } from '../schema.js';
import { invalidateStore } from '../singleton.js';
import { withLiveMemoryDb, dropLiveEdgeType } from './live-store.js';

export async function dropEdgeType({ worktreeRoot, io, name, confirm }) {
  const foundryDir = 'foundry';
  const p = memoryPaths(foundryDir);
  const schema = await loadSchema(foundryDir, io);
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
  await writeSchema(foundryDir, schema, io);

  try {
    await withLiveMemoryDb({ worktreeRoot, io }, async (db) => {
      await dropLiveEdgeType(db, name);
    });
  } finally {
    invalidateStore(worktreeRoot);
  }
  return { dropped: name };
}
