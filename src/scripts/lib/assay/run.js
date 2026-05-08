import { loadExtractor } from './loader.js';
import { parseExtractorOutput } from './parse-jsonl.js';
import { spawnWithTimeout as defaultSpawn } from './spawn-with-timeout.js';
import {
  checkEntityRowAgainstExtractor,
  checkEdgeRowAgainstExtractor,
} from './permissions.js';

function spawnFailureReason(spawnResult) {
  if (spawnResult.timedOut) return 'timedOut';
  if (spawnResult.tooMuchOutput) return 'tooMuchOutput';
  if (!spawnResult.ok) return 'exited';
  return null;
}

function spawnFailureMessage(reason, ext, spawnResult) {
  if (reason === 'timedOut') {
    return `extractor timed out after ${ext.timeoutMs}ms`;
  }
  if (reason === 'tooMuchOutput') {
    return 'extractor produced too much output'
      + ' (stdout >50MB or stderr >1MB)';
  }
  const detail = spawnResult.signal
    ? `signal ${spawnResult.signal} (exit code ${spawnResult.exitCode})`
    : `exit code ${spawnResult.exitCode}`;
  return `extractor exited with ${detail}`;
}

async function loadAndRunExtractor({
  foundryDir, name, cwd, io, spawn, perExtractor,
}) {
  const startedAt = Date.now();
  let ext;
  try {
    ext = await loadExtractor(foundryDir, name, io);
  } catch (err) {
    return { abort: abort(perExtractor, name,
      `failed to load extractor: ${err.message}`) };
  }

  const spawnResult = await spawn({
    command: ext.command,
    cwd,
    timeoutMs: ext.timeoutMs,
  });

  const reason = spawnFailureReason(spawnResult);
  if (reason) {
    const msg = spawnFailureMessage(reason, ext, spawnResult);
    return { abort: abort(perExtractor, name, msg, spawnResult.stderr) };
  }

  let rows;
  try {
    rows = parseExtractorOutput(spawnResult.stdout);
  } catch (err) {
    return { abort: abort(perExtractor, name, err.message,
      spawnResult.stderr) };
  }

  return { ext, rows, spawnResult, startedAt };
}

function validateEntityRow({ ext, row, vocabulary, perExtractor, name, stderr }) {
  const r = checkEntityRowAgainstExtractor(ext, row.type);
  if (!r.ok) return abort(perExtractor, name, r.error, stderr);
  if (!vocabulary.entities?.[row.type]) {
    return abort(perExtractor, name,
      `entity type '${row.type}' not declared in project vocabulary`, stderr);
  }
  return null;
}

function validateEdgeRow({ row, ext, vocabulary, perExtractor, name, stderr }) {
  const r = checkEdgeRowAgainstExtractor(ext, {
    edge_type: row.edge_type,
    from_type: row.from_type,
    to_type: row.to_type,
  }, vocabulary);
  if (!r.ok) return abort(perExtractor, name, r.error, stderr);
  return null;
}

function validateRows({ ext, rows, vocabulary, perExtractor, name, spawnResult }) {
  const stderr = spawnResult.stderr;
  for (const row of rows) {
    const error = row.kind === 'entity'
      ? validateEntityRow({ ext, row, vocabulary, perExtractor, name, stderr })
      : validateEdgeRow({ row, ext, vocabulary, perExtractor, name, stderr });
    if (error) return error;
  }
  return null;
}

async function upsertEntityRow(row, store, vocabulary, putEntity, writeEmbedder) {
  await putEntity(
    store,
    { type: row.type, name: row.name, value: row.value },
    vocabulary,
    writeEmbedder ? { embedder: writeEmbedder } : undefined,
  );
}

async function upsertEdgeRow(row, store, vocabulary, relate) {
  await relate(store, {
    edge_type: row.edge_type,
    from_type: row.from_type, from_name: row.from_name,
    to_type: row.to_type,     to_name: row.to_name,
  }, vocabulary);
}

async function upsertRows({
  rows, store, vocabulary, putEntity, relate,
  writeEmbedder, perExtractor, name, spawnResult,
}) {
  let rowsUpserted = 0;
  for (const row of rows) {
    try {
      if (row.kind === 'entity') {
        await upsertEntityRow(row, store, vocabulary, putEntity, writeEmbedder);
      } else {
        await upsertEdgeRow(row, store, vocabulary, relate);
      }
      rowsUpserted += 1;
    } catch (err) {
      return { abort: abort(perExtractor, name,
        `upsert failed: ${err.message}`, spawnResult.stderr) };
    }
  }
  return { rowsUpserted };
}

async function syncStoreIfNeeded({
  syncStore, store, io, perExtractor, name, rowsUpserted, spawnResult,
}) {
  if (!syncStore) return null;
  try {
    await syncStore({ store, io });
  } catch (err) {
    return abort(perExtractor, name,
      `memory sync failed after upserting ${rowsUpserted} rows:`
      + ` ${err.message}`, spawnResult.stderr);
  }
  return null;
}

async function processExtractor({
  foundryDir, name, cwd, io, spawn, store, vocabulary,
  putEntity, relate, writeEmbedder, syncStore, perExtractor,
}) {
  const loadResult = await loadAndRunExtractor({
    foundryDir, name, cwd, io, spawn, perExtractor,
  });
  if (loadResult.abort) return loadResult;

  const { ext, rows, spawnResult, startedAt } = loadResult;

  const validationError = validateRows({
    ext, rows, vocabulary, perExtractor, name, spawnResult,
  });
  if (validationError) return { abort: validationError };

  const upsertResult = await upsertRows({
    rows, store, vocabulary, putEntity, relate,
    writeEmbedder, perExtractor, name, spawnResult,
  });
  if (upsertResult.abort) return upsertResult;

  const syncError = await syncStoreIfNeeded({
    syncStore, store, io, perExtractor, name,
    rowsUpserted: upsertResult.rowsUpserted, spawnResult,
  });
  if (syncError) return { abort: syncError };

  perExtractor.push({
    name,
    rowsUpserted: upsertResult.rowsUpserted,
    durationMs: Date.now() - startedAt,
  });
  return { summary: perExtractor[perExtractor.length - 1] };
}

export async function runAssay({
  foundryDir,
  cwd,
  io,
  extractors,
  store,
  vocabulary,
  putEntity,
  relate,
  writeEmbedder,
  syncStore,
  spawn = defaultSpawn,
}) {
  const perExtractor = [];

  for (const name of extractors) {
    const result = await processExtractor({
      foundryDir, name, cwd, io, spawn, store, vocabulary,
      putEntity, relate, writeEmbedder, syncStore, perExtractor,
    });
    if (result.abort) return result.abort;
  }

  return { ok: true, perExtractor };
}

function abort(perExtractor, failedExtractor, reason, stderr) {
  return {
    ok: false,
    aborted: true,
    failedExtractor,
    reason,
    stderr: stderr ?? '',
    perExtractor,
  };
}
