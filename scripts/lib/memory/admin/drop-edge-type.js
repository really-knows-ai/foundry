import { memoryPaths } from '../paths.js';
import { loadSchema, writeSchema, bumpVersion } from '../schema.js';
import { invalidateStore } from '../singleton.js';

export async function dropEdgeType({ worktreeRoot, io, name, confirm }) {
  if (confirm !== true) throw new Error(`drop requires confirm: true`);
  const p = memoryPaths('foundry');
  const schema = await loadSchema('foundry', io);
  if (!schema.edges[name]) throw new Error(`edge type '${name}' not declared`);

  await io.unlink(p.edgeTypeFile(name));
  await io.unlink(p.relationFile(name));
  delete schema.edges[name];
  bumpVersion(schema);
  await writeSchema('foundry', schema, io);

  invalidateStore(worktreeRoot);
  return { dropped: name };
}
