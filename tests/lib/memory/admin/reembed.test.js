import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore, closeStore } from '../../../../scripts/lib/memory/store.js';
import { putEntity } from '../../../../scripts/lib/memory/writes.js';
import { reembed } from '../../../../scripts/lib/memory/admin/reembed.js';


import { diskIO } from '../_helpers.js';

function fakeEmbedder(dim, signature) {
  return async (inputs) => inputs.map((s) => {
    const v = new Array(dim).fill(0);
    v[0] = signature;
    v[1] = s.length;
    return v;
  });
}

describe('reembed', () => {
  let root;
  after(() => { if (root) rmSync(root, { recursive: true, force: true }); });

  it('leaves schema + DB + NDJSON untouched when embedder fails mid-flight', async () => {
    const root2 = mkdtempSync(join(tmpdir(), 'reemb-fail-'));
    try {
      mkdirSync(join(root2, 'foundry/memory/entities'), { recursive: true });
      mkdirSync(join(root2, 'foundry/memory/edges'), { recursive: true });
      mkdirSync(join(root2, 'foundry-memory/relations'), { recursive: true });
      writeFileSync(join(root2, 'foundry/memory/config.md'), '---\nenabled: true\n---\n');
      const initialSchema = {
        version: 1,
        entities: { class: {} },
        edges: {},
        embeddings: { model: 'old', dimensions: 3 },
      };
      writeFileSync(
        join(root2, 'foundry/memory/schema.json'),
        JSON.stringify(initialSchema, null, 2) + '\n',
      );
      const io = diskIO(root2);
      const dbAbsolutePath = join(root2, 'memory.db');

      // Seed: two entities with old-dim vectors.
      let store = await openStore({ foundryDir: 'foundry', schema: initialSchema, io, dbAbsolutePath });
      await putEntity(
        store,
        { type: 'class', name: 'com.A', value: 'alpha' },
        { entities: { class: {} }, edges: {} },
        { embedder: fakeEmbedder(3, 1) },
      );
      await putEntity(
        store,
        { type: 'class', name: 'com.B', value: 'bravo' },
        { entities: { class: {} }, edges: {} },
        { embedder: fakeEmbedder(3, 1) },
      );
      closeStore(store);

      // Persist to NDJSON so we have an on-disk baseline to compare against.
      store = await openStore({ foundryDir: 'foundry', schema: initialSchema, io, dbAbsolutePath });
      const { syncStore } = await import('../../../../scripts/lib/memory/store.js');
      await syncStore({ store, io });
      closeStore(store);

      const ndjsonPath = join(root2, 'foundry-memory/relations/class.ndjson');
      const schemaPath = join(root2, 'foundry/memory/schema.json');
      const schemaBefore = readFileSync(schemaPath, 'utf-8');
      const ndjsonBefore = readFileSync(ndjsonPath, 'utf-8');
      const dbBefore = readFileSync(dbAbsolutePath);

      // Embedder that throws on first call — simulates provider failure mid-flight.
      const failingEmbedder = async () => {
        throw new Error('provider 500');
      };

      let reembedError;
      try {
        await reembed({
          worktreeRoot: root2,
          io,
          dbAbsolutePath,
          newModel: 'new',
          newDimensions: 5,
          embedder: failingEmbedder,
        });
      } catch (err) {
        reembedError = err;
      }
      assert.ok(reembedError, 'reembed must reject when embedder fails');

      // Schema must not be bumped or mutated on failure.
      assert.equal(readFileSync(schemaPath, 'utf-8'), schemaBefore,
        'schema.json must be unchanged after embedder failure');

      // NDJSON (source of truth) must not be mutated.
      assert.equal(readFileSync(ndjsonPath, 'utf-8'), ndjsonBefore,
        'NDJSON must be unchanged after embedder failure');

      // Original DB must still exist and be usable under the old schema.
      assert.ok(fs.existsSync(dbAbsolutePath), 'memory.db must still exist');
      const dbAfter = readFileSync(dbAbsolutePath);
      assert.equal(dbAfter.length, dbBefore.length,
        'memory.db byte length must match pre-reembed state');

      // Re-open with the old schema and confirm both rows survive at old dim.
      store = await openStore({ foundryDir: 'foundry', schema: initialSchema, io, dbAbsolutePath });
      const res = await store.db.run('?[n, e] := *ent_class{name: n, embedding: e}');
      assert.equal(res.rows.length, 2);
      for (const [, e] of res.rows) {
        assert.equal(e.length, 3, 'embedding must still be old-dim');
      }
      closeStore(store);

      // No stray temp DB should remain behind.
      const siblings = fs.readdirSync(root2).filter((f) => f.startsWith('memory.db'));
      assert.deepEqual(
        siblings.filter((f) => f !== 'memory.db' && !/^memory\.db-(wal|shm)$/.test(f)),
        [],
        `no temp DB should remain; found: ${siblings.join(', ')}`,
      );
    } finally {
      rmSync(root2, { recursive: true, force: true });
    }
  });

  it('re-embeds all entities with new dimension and updates schema', async () => {
    root = mkdtempSync(join(tmpdir(), 'reemb-'));
    mkdirSync(join(root, 'foundry/memory/entities'), { recursive: true });
    mkdirSync(join(root, 'foundry/memory/edges'), { recursive: true });
    mkdirSync(join(root, 'foundry-memory/relations'), { recursive: true });
    writeFileSync(join(root, 'foundry/memory/config.md'), '---\nenabled: true\n---\n');
    const initialSchema = {
      version: 1,
      entities: { class: {} },
      edges: {},
      embeddings: { model: 'old', dimensions: 3 },
    };
    writeFileSync(join(root, 'foundry/memory/schema.json'), JSON.stringify(initialSchema, null, 2) + '\n');
    const io = diskIO(root);

    // Seed with old-model vectors.
    let store = await openStore({ foundryDir: 'foundry', schema: initialSchema, io, dbAbsolutePath: join(root, 'memory.db') });
    await putEntity(store, { type: 'class', name: 'com.A', value: 'alpha' }, { entities: { class: {} }, edges: {} }, { embedder: fakeEmbedder(3, 1) });
    closeStore(store);

    // Reembed with new model (dim 5, signature 2).
    await reembed({
      worktreeRoot: root,
      io,
      dbAbsolutePath: join(root, 'memory.db'),
      newModel: 'new',
      newDimensions: 5,
      embedder: fakeEmbedder(5, 2),
    });

    // Re-open and verify the row has the new vector.
    const freshSchema = JSON.parse(readFileSync(join(root, 'foundry/memory/schema.json'), 'utf-8'));
    assert.equal(freshSchema.embeddings.dimensions, 5);
    assert.equal(freshSchema.embeddings.model, 'new');

    store = await openStore({ foundryDir: 'foundry', schema: freshSchema, io, dbAbsolutePath: join(root, 'memory.db') });
    const res = await store.db.run('?[e] := *ent_class{embedding: e}');
    assert.equal(res.rows[0][0].length, 5);
    assert.equal(res.rows[0][0][0], 2);
    closeStore(store);
  });
});
