import { openStore, closeStore, syncStore } from '../store.js';
import { loadSchema, writeSchema, bumpVersion } from '../schema.js';
import { entRelName } from '../cozo.js';
import { putEntity } from '../writes.js';
import { invalidateStore } from '../singleton.js';

/**
 * Atomic re-embedding via a staging DB.
 *
 * Builds the new state in a sibling staging DB while the original `memory.db`
 * and on-disk schema remain untouched. After every entity is re-embedded
 * successfully, we swap atomically: rename the staging DB over the live DB,
 * write the new schema, and refresh NDJSON.
 *
 * On any failure — provider error, unexpected vector length, Cozo error —
 * the staging DB is closed and unlinked and the original state is preserved.
 */
export async function reembed({
  worktreeRoot,
  io,
  rawIO,
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
  if (!rawIO) throw new Error('reembed requires rawIO for absolute path operations');

  const foundryDir = 'foundry';
  const oldSchema = await loadSchema(foundryDir, io);
  const entityTypes = Object.keys(oldSchema.entities);

  // Phase 1: harvest existing rows from the live store. The live DB stays
  // read-only during this phase.
  const oldStore = await openStore({
    foundryDir,
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
  unlinkDbFiles(stagingPath, rawIO); // clean up any stale prior run

  const newSchema = {
    ...oldSchema,
    embeddings: { model: newModel, dimensions: newDimensions },
  };
  bumpVersion(newSchema);
  const vocabulary = { entities: newSchema.entities, edges: newSchema.edges };

  let stagingStore;
  try {
    stagingStore = await openStore({
      foundryDir,
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
    unlinkDbFiles(stagingPath, rawIO);
    throw err;
  }

  // Phase 3: atomic swap. Close the staging DB so sqlite flushes WAL, then
  // write the new schema and rename the DB files over the live paths.
  // Writing schema first ensures that if it fails, the DB remains untouched.
  // If rename fails after schema is written, the mismatch will be detected on
  // next openStore with a clear error.
  closeStore(stagingStore);

  try {
    await writeSchema(foundryDir, newSchema, io);
    renameDbFiles(stagingPath, dbAbsolutePath, rawIO);
  } catch (err) {
    // Best-effort cleanup of staging siblings; surface the error.
    unlinkDbFiles(stagingPath, rawIO);
    throw err;
  }

  invalidateStore(worktreeRoot);

  // Phase 4: refresh NDJSON from the newly-swapped DB so the on-disk source
  // of truth reflects the new vectors.
  const reopened = await openStore({
    foundryDir,
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
function unlinkDbFiles(dbPath, rawIO) {
  for (const suffix of ['', '-wal', '-shm']) {
    const p = dbPath + suffix;
    try {
      if (rawIO.exists(p)) rawIO.unlink(p);
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
function renameDbFiles(fromPath, toPath, rawIO) {
  // Remove target sidecars first; the main file is overwritten by rename.
  for (const suffix of ['-wal', '-shm']) {
    const t = toPath + suffix;
    try { if (rawIO.exists(t)) rawIO.unlink(t); } catch { /* ignore */ }
  }
  rawIO.rename(fromPath, toPath);
  for (const suffix of ['-wal', '-shm']) {
    const src = fromPath + suffix;
    if (rawIO.exists(src)) {
      try {
        rawIO.rename(src, toPath + suffix);
      } catch {
        // non-critical; sqlite will recreate these
        try { rawIO.unlink(src); } catch { /* ignore */ }
      }
    }
  }
}
