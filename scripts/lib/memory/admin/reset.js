import { memoryPaths } from '../paths.js';
import { loadSchema, writeSchema, bumpVersion } from '../schema.js';
import { invalidateStore } from '../singleton.js';

export async function resetMemory({ worktreeRoot, io, confirm }) {
  if (confirm !== true) throw new Error(`reset requires confirm: true`);
  const p = memoryPaths('foundry');
  const schema = await loadSchema('foundry', io);

  for (const name of [...Object.keys(schema.entities), ...Object.keys(schema.edges)]) {
    await io.writeFile(p.relationFile(name), '');
  }
  // Delete the live DB so it's re-imported empty on next open.
  await io.unlink(p.db);
  await io.unlink(p.db + '-wal');
  await io.unlink(p.db + '-shm');

  bumpVersion(schema);
  await writeSchema('foundry', schema, io);
  invalidateStore(worktreeRoot);
  return { reset: true };
}
