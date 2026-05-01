import { openStore, closeStore, syncStore } from '../store.js';
import { loadSchema, writeSchema, bumpVersion } from '../schema.js';
import { entRelName } from '../cozo.js';
import { putEntity } from '../writes.js';
import { invalidateStore } from '../singleton.js';
import { existsSync, renameSync, unlinkSync } from 'node:fs';

/**
 * Atomic re-embedding via a staging DB.
 *
 * Re-embedding builds the new state in a sibling staging DB. The original
 * `memory.db` and on-disk schema remain untouched until every entity has been
 * re-embedded successfully, at which point we swap atomically: rename the
 * staging DB over the live DB, write the new schema, and refresh NDJSON.
 *
 * On any failure — provider error, unexpected vector length, Cozo error —
 * the staging DB is closed and unlinked and the original state is preserved.
 */
export async function reembed({
  worktreeRoot,
  io,
  dbAbsolutePath,
  newModel,
  newDimensions,
  embedder,
  batchSize = 64,
}) {
  if (!embedder) throw new Error('reembed requires an embedder');
  if (!Number.isInteger(newDimensions) || newDimensions <= 0) {
    throw new Error('newDimensions must be positive integer');
  }
  if (!dbAbsolutePath) throw new Error('reembed requires dbAbsolutePath');

  const oldSchema = await loadSchema('foundry', io);
  const entityTypes = Object.keys(oldSchema.entities);

  // Phase 1: harvest existing rows from the live store. The live DB stays
  // read-only during this phase.
  const oldStore = await openStore({
    foundryDir: 'foundry',
    schema: oldSchema,
    io,
    dbAbsolutePath,
  });
  const rowsByType = {};
  try {
    for (const type of entityTypes) {
      const rel = entRelName(type);
      const res = await oldStore.db.run(`?[name, value] := *${rel}{name, value}`);
      rowsByType[type] = res.rows.map(([name, value]) => ({ name, value }));
    }
  } finally {
    closeStore(oldStore);
  }

  // Phase 2: build the new state in a staging DB sibling to the live one.
  // Durable state changes only after the embedding loop completes cleanly.
  const stagingPath = `${dbAbsolutePath}.reembed-tmp`;
  unlinkDbFiles(stagingPath); // clean up any stale prior run

  const newSchema = {
    ...oldSchema,
    embeddings: { model: newModel, dimensions: newDimensions },
  };
  bumpVersion(newSchema);
  const vocabulary = { entities: newSchema.entities, edges: newSchema.edges };

  let stagingStore;
  try {
    stagingStore = await openStore({
      foundryDir: 'foundry',
      schema: newSchema,
      io,
      dbAbsolutePath: stagingPath,
    });

    for (const type of entityTypes) {
      const rows = rowsByType[type] ?? [];
      for (let i = 0; i < rows.length; i += batchSize) {
        const chunk = rows.slice(i, i + batchSize);
        const vectors = await embedder(chunk.map((r) => r.value));
        for (let j = 0; j < chunk.length; j++) {
          const v = vectors[j];
          if (!Array.isArray(v) || v.length !== newDimensions) {
            throw new Error(
              `reembed: vector length ${Array.isArray(v) ? v.length : 'n/a'} != expected ${newDimensions}`,
            );
          }
          await putEntity(
            stagingStore,
            { type, name: chunk[j].name, value: chunk[j].value },
            vocabulary,
            { embedder: async () => [v] },
          );
        }
      }
    }
  } catch (err) {
    // Failure before swap: close and unlink the staging DB, preserve
    // original state.
    if (stagingStore) {
      try { closeStore(stagingStore); } catch { /* closing best effort */ }
    }
    unlinkDbFiles(stagingPath);
    throw err;
  }

  // Phase 3: atomic swap. Close the staging DB so sqlite flushes WAL, then
  // rename the files over the live paths. `writeSchema` is last so that if
  // the rename fails the on-disk schema still matches the live DB.
  closeStore(stagingStore);

  try {
    renameDbFiles(stagingPath, dbAbsolutePath);
    await writeSchema('foundry', newSchema, io);
  } catch (err) {
    // Rename failed — original files may be partially replaced. Best-effort
    // cleanup of staging siblings; surface the error.
    unlinkDbFiles(stagingPath);
    throw err;
  }

  invalidateStore(worktreeRoot);

  // Phase 4: refresh NDJSON from the newly-swapped DB so the on-disk source
  // of truth reflects the new vectors.
  const reopened = await openStore({
    foundryDir: 'foundry',
    schema: newSchema,
    io,
    dbAbsolutePath,
  });
  try {
    await syncStore({ store: reopened, io });
  } finally {
    closeStore(reopened);
  }

  return { model: newModel, dimensions: newDimensions, types: entityTypes.length };
}

/**
 * Remove a Cozo sqlite DB file and its WAL/SHM sidecars if present.
 * Operates on absolute filesystem paths (reembed works outside the IO
 * shim's foundry-relative tree).
 */
function unlinkDbFiles(dbPath) {
  for (const suffix of ['', '-wal', '-shm']) {
    const p = dbPath + suffix;
    try {
      if (existsSync(p)) unlinkSync(p);
    } catch {
      // best-effort cleanup
    }
  }
}

/**
 * Atomically move a Cozo sqlite DB plus its WAL/SHM sidecars into place.
 *
 * Sqlite treats the main DB file as the authoritative name; WAL/SHM files
 * are recreated on next open. We still move them when present so that a
 * subsequent open picks up any pending state.
 */
function renameDbFiles(fromPath, toPath) {
  // Remove target sidecars first; the main file is overwritten by rename.
  for (const suffix of ['-wal', '-shm']) {
    const t = toPath + suffix;
    try { if (existsSync(t)) unlinkSync(t); } catch { /* ignore */ }
  }
  renameSync(fromPath, toPath);
  for (const suffix of ['-wal', '-shm']) {
    const src = fromPath + suffix;
    if (existsSync(src)) {
      try {
        renameSync(src, toPath + suffix);
      } catch {
        // non-critical; sqlite will recreate these
        try { unlinkSync(src); } catch { /* ignore */ }
      }
    }
  }
}
