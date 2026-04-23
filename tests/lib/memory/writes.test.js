import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore, closeStore } from '../../../scripts/lib/memory/store.js';
import { putEntity, relate, unrelate } from '../../../scripts/lib/memory/writes.js';

import { diskIO } from './_helpers.js';

const vocab = {
  entities: { class: {}, method: {} },
  edges: { calls: { sources: ['class'], targets: ['class', 'method'] } },
};
const schema = {
  version: 1,
  entities: { class: { frontmatterHash: '_' }, method: { frontmatterHash: '_' } },
  edges: { calls: { frontmatterHash: '_' } },
  embeddings: null,
};


describe('writes', () => {
  let root, store;
  before(async () => {
    root = mkdtempSync(join(tmpdir(), 'writes-'));
    mkdirSync(join(root, 'foundry/memory/relations'), { recursive: true });
    store = await openStore({ foundryDir: 'foundry', schema, io: diskIO(root), dbAbsolutePath: join(root, 'memory.db') });
  });
  after(() => {
    closeStore(store);
    rmSync(root, { recursive: true, force: true });
  });

  it('putEntity upserts', async () => {
    await putEntity(store, { type: 'class', name: 'com.A', value: 'first' }, vocab);
    await putEntity(store, { type: 'class', name: 'com.A', value: 'updated' }, vocab);
    const res = await store.db.run('?[v] := *ent_class{name: "com.A", value: v}');
    assert.equal(res.rows[0][0], 'updated');
  });

  it('relate upserts an edge; re-relating is a no-op', async () => {
    await putEntity(store, { type: 'method', name: 'com.A.m', value: 'm' }, vocab);
    await relate(store, { edge_type: 'calls', from_type: 'class', from_name: 'com.A', to_type: 'method', to_name: 'com.A.m' }, vocab);
    await relate(store, { edge_type: 'calls', from_type: 'class', from_name: 'com.A', to_type: 'method', to_name: 'com.A.m' }, vocab);
    const res = await store.db.run('?[ft, fn, tt, tn] := *edge_calls{from_type: ft, from_name: fn, to_type: tt, to_name: tn}');
    assert.equal(res.rows.length, 1);
  });

  it('unrelate removes the edge', async () => {
    await unrelate(store, { edge_type: 'calls', from_type: 'class', from_name: 'com.A', to_type: 'method', to_name: 'com.A.m' }, vocab);
    const res = await store.db.run('?[ft] := *edge_calls{from_type: ft}');
    assert.equal(res.rows.length, 0);
  });

  it('put rejects oversize value', async () => {
    await assert.rejects(
      () => putEntity(store, { type: 'class', name: 'com.Big', value: 'x'.repeat(5000) }, vocab),
      /too large|4KB/i,
    );
  });

  it('relate rejects type not in edge sources', async () => {
    await assert.rejects(
      () => relate(store, { edge_type: 'calls', from_type: 'method', from_name: 'x', to_type: 'method', to_name: 'y' }, vocab),
      /source/,
    );
  });
});
