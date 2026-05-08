
import { memoryPaths } from '../paths.js';
import { loadSchema, writeSchema, bumpVersion } from '../schema.js';
import { invalidateStore } from '../singleton.js';

export async function resetMemory({ worktreeRoot, io, confirm }) {
  if (confirm !== true) throw new Error(`reset requires confirm: true`);
  const foundryDir = 'foundry';
  const p = memoryPaths(foundryDir);
  const schema = await loadSchema(foundryDir, io);

  for (const name of [...Object.keys(schema.entities), ...Object.keys(schema.edges)]) {
    await io.writeFile(p.relationFile(name), '');
  }
  // Delete the live DB so it's re-imported empty on next open.
  for (const suffix of ['', '-wal', '-shm']) {
    if (await io.exists(p.db + suffix)) await io.unlink(p.db + suffix);
  }

  bumpVersion(schema);
  await writeSchema(foundryDir, schema, io);
  invalidateStore(worktreeRoot);
  return { reset: true };
}
