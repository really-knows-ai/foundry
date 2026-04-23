import { loadExtractor } from './loader.js';
import { parseExtractorOutput } from './parse-jsonl.js';
import { spawnWithTimeout as defaultSpawn } from './spawn-with-timeout.js';
import {
  checkEntityRowAgainstExtractor,
  checkEdgeRowAgainstExtractor,
} from './permissions.js';

export async function runAssay({
  foundryDir,
  cwd,
  io,
  extractors,
  store,
  vocabulary,
  putEntity,
  relate,
  spawn = defaultSpawn,
}) {
  const perExtractor = [];

  for (const name of extractors) {
    const startedAt = Date.now();
    let ext;
    try {
      ext = await loadExtractor(foundryDir, name, io);
    } catch (err) {
      return abort(perExtractor, name, `failed to load extractor: ${err.message}`);
    }

    const spawnResult = await spawn({
      command: ext.command,
      cwd,
      timeoutMs: ext.timeoutMs,
    });

    if (spawnResult.timedOut) {
      return abort(perExtractor, name, `extractor timed out after ${ext.timeoutMs}ms`, spawnResult.stderr);
    }
    if (!spawnResult.ok) {
      return abort(perExtractor, name, `extractor exited with exit code ${spawnResult.exitCode}`, spawnResult.stderr);
    }

    let rows;
    try {
      rows = parseExtractorOutput(spawnResult.stdout);
    } catch (err) {
      return abort(perExtractor, name, err.message, spawnResult.stderr);
    }

    // Validate every row before performing any writes for this extractor.
    for (const row of rows) {
      if (row.kind === 'entity') {
        const r = checkEntityRowAgainstExtractor(ext, row.type);
        if (!r.ok) return abort(perExtractor, name, r.error, spawnResult.stderr);
        if (!vocabulary.entities?.[row.type]) {
          return abort(perExtractor, name, `entity type '${row.type}' not declared in project vocabulary`, spawnResult.stderr);
        }
      } else {
        const r = checkEdgeRowAgainstExtractor(ext, {
          edge_type: row.edge_type,
          from_type: row.from_type,
          to_type: row.to_type,
        }, vocabulary);
        if (!r.ok) return abort(perExtractor, name, r.error, spawnResult.stderr);
      }
    }

    // Upsert. Any throw here aborts with the row's details.
    let rowsUpserted = 0;
    for (const row of rows) {
      try {
        if (row.kind === 'entity') {
          await putEntity(store, { type: row.type, name: row.name, value: row.value }, vocabulary);
        } else {
          await relate(store, {
            edge_type: row.edge_type,
            from_type: row.from_type, from_name: row.from_name,
            to_type: row.to_type,     to_name: row.to_name,
          }, vocabulary);
        }
        rowsUpserted += 1;
      } catch (err) {
        return abort(perExtractor, name, `upsert failed: ${err.message}`, spawnResult.stderr);
      }
    }

    perExtractor.push({
      name,
      rowsUpserted,
      durationMs: Date.now() - startedAt,
    });
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
