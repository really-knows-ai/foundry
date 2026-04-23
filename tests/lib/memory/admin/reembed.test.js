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

  it('re-embeds all entities with new dimension and updates schema', async () => {
    root = mkdtempSync(join(tmpdir(), 'reemb-'));
    mkdirSync(join(root, 'foundry/memory/entities'), { recursive: true });
    mkdirSync(join(root, 'foundry/memory/edges'), { recursive: true });
    mkdirSync(join(root, 'foundry/memory/relations'), { recursive: true });
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
