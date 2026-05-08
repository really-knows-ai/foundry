import { openStore, closeStore, syncStore } from '../store.js';
import { loadSchema, writeSchema, bumpVersion } from '../schema.js';
import { entRelName } from '../cozo.js';
import { putEntity } from '../writes.js';
import { invalidateStore } from '../singleton.js';

function assertEmbedder(embedder) {
  if (!embedder) throw new Error('reembed requires an embedder');
}

function assertDimensions(newDimensions) {
  if (!Number.isInteger(newDimensions) || newDimensions <= 0) {
    throw new Error('newDimensions must be positive integer');
  }
}

function assertDbPath(dbAbsolutePath) {
  if (!dbAbsolutePath) throw new Error('reembed requires dbAbsolutePath');
}

function assertRawIO(rawIO) {
  if (!rawIO) throw new Error('reembed requires rawIO for absolute path operations');
}

function validateReembedParams(opts) {
  assertEmbedder(opts.embedder);
  assertDimensions(opts.newDimensions);
  assertDbPath(opts.dbAbsolutePath);
  assertRawIO(opts.rawIO);
}

function assertVectorLength(v, expected) {
  const len = Array.isArray(v) ? v.length : 'n/a';
  if (!Array.isArray(v) || v.length !== expected) {
    throw new Error(`reembed: vector length ${len} != expected ${expected}`);
  }
}

async function harvestRows(foundryDir, schema, io, dbPath) {
  const entityTypes = Object.keys(schema.entities);
  const store = await openStore({
    foundryDir, schema, io, dbAbsolutePath: dbPath,
  });
  const rowsByType = {};
  try {
    for (const type of entityTypes) {
      const rel = entRelName(type);
      const res = await store.db.run(
        `?[name, value] := *${rel}{name, value}`,
      );
      rowsByType[type] = res.rows.map(([name, value]) => ({ name, value }));
    }
  } finally {
    closeStore(store);
  }
  return { rowsByType, entityTypes };
}

async function embedChunk(store, chunk, vectors, dims, vocab) {
  for (let j = 0; j < chunk.length; j++) {
    assertVectorLength(vectors[j], dims);
    const entry = {
      type: chunk[j].type,
      name: chunk[j].name,
      value: chunk[j].value,
    };
    await putEntity(store, entry, vocab, {
      embedder: async () => [vectors[j]],
    });
  }
}

async function processBatch(opts) {
  const chunk = opts.rows
    .slice(opts.start, opts.start + opts.batchSize)
    .map((r) => ({ ...r, type: opts.type }));
  const vectors = await opts.embedder(chunk.map((r) => r.value));
  await embedChunk(
    opts.store, chunk, vectors, opts.dims, opts.vocab,
  );
}

async function embedType(store, type, rows, opts) {
  for (let i = 0; i < rows.length; i += opts.batchSize) {
    await processBatch({
      store, rows, start: i,
      batchSize: opts.batchSize, type,
      embedder: opts.embedder,
      dims: opts.newDimensions,
      vocab: opts.vocab,
    });
  }
}

async function buildStagingDb(opts) {
  const vocab = {
    entities: opts.newSchema.entities,
    edges: opts.newSchema.edges,
  };
  const stagingStore = await openStore({
    foundryDir: opts.foundryDir,
    schema: opts.newSchema,
    io: opts.io,
    dbAbsolutePath: opts.stagingPath,
  });

  const embedOpts = {
    batchSize: opts.batchSize,
    embedder: opts.embedder,
    newDimensions: opts.newDimensions,
    vocab,
  };

  try {
    for (const type of opts.entityTypes) {
      const rows = opts.rowsByType[type] ?? [];
      await embedType(stagingStore, type, rows, embedOpts);
    }
  } catch (err) {
    try { closeStore(stagingStore); } catch { /* best effort */ }
    throw err;
  }

  closeStore(stagingStore);
}

async function swapDatabases(opts) {
  await writeSchema(opts.foundryDir, opts.newSchema, opts.io);
  renameDbFiles(opts.stagingPath, opts.dbAbsolutePath, opts.rawIO);
}

async function refreshStore(opts) {
  const reopened = await openStore({
    foundryDir: opts.foundryDir,
    schema: opts.newSchema,
    io: opts.io,
    dbAbsolutePath: opts.dbAbsolutePath,
  });
  try {
    await syncStore({ store: reopened, io: opts.io });
  } finally {
    closeStore(reopened);
  }
  invalidateStore(opts.worktreeRoot);
}

async function runPipeline(opts) {
  const buildOpts = {
    stagingPath: opts.stagingPath,
    newSchema: opts.newSchema,
    io: opts.io,
    foundryDir: opts.foundryDir,
    entityTypes: opts.entityTypes,
    rowsByType: opts.rowsByType,
    embedder: opts.embedder,
    batchSize: opts.batchSize,
    newDimensions: opts.newDimensions,
  };
  await buildStagingDb(buildOpts);

  const swapOpts = {
    stagingPath: opts.stagingPath,
    dbAbsolutePath: opts.dbAbsolutePath,
    foundryDir: opts.foundryDir,
    newSchema: opts.newSchema,
    io: opts.io,
    rawIO: opts.rawIO,
  };
  await swapDatabases(swapOpts);

  await refreshStore({
    foundryDir: opts.foundryDir,
    newSchema: opts.newSchema,
    io: opts.io,
    dbAbsolutePath: opts.dbAbsolutePath,
    worktreeRoot: opts.worktreeRoot,
  });
}

function withCleanup(stagingPath, rawIO, fn) {
  return fn().catch((err) => {
    unlinkDbFiles(stagingPath, rawIO);
    throw err;
  });
}

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
  validateReembedParams({
    embedder, newDimensions, dbAbsolutePath, rawIO,
  });

  const foundryDir = 'foundry';
  const oldSchema = await loadSchema(foundryDir, io);
  const { rowsByType, entityTypes } = await harvestRows(
    foundryDir, oldSchema, io, dbAbsolutePath,
  );

  const stagingPath = `${dbAbsolutePath}.reembed-tmp`;
  unlinkDbFiles(stagingPath, rawIO);

  const newSchema = {
    ...oldSchema,
    embeddings: { model: newModel, dimensions: newDimensions },
  };
  bumpVersion(newSchema);

  await withCleanup(stagingPath, rawIO, () => runPipeline({
    stagingPath, newSchema, io, foundryDir,
    entityTypes, rowsByType, embedder, batchSize,
    newDimensions, dbAbsolutePath, rawIO, worktreeRoot,
  }));

  return {
    model: newModel,
    dimensions: newDimensions,
    types: entityTypes.length,
  };
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

function tryUnlinkIfExists(rawIO, path) {
  if (rawIO.exists(path)) {
    try { rawIO.unlink(path); } catch { /* ignore */ }
  }
}

function tryRenameIfExists(rawIO, src, dest) {
  if (rawIO.exists(src)) {
    try {
      rawIO.rename(src, dest);
    } catch {
      try { rawIO.unlink(src); } catch { /* ignore */ }
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
  tryUnlinkIfExists(rawIO, toPath + '-wal');
  tryUnlinkIfExists(rawIO, toPath + '-shm');
  rawIO.rename(fromPath, toPath);
  tryRenameIfExists(rawIO, fromPath + '-wal', toPath + '-wal');
  tryRenameIfExists(rawIO, fromPath + '-shm', toPath + '-shm');
}
