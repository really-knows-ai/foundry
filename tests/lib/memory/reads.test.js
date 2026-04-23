import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore, closeStore } from '../../../scripts/lib/memory/store.js';
import { putEntity, relate } from '../../../scripts/lib/memory/writes.js';
import { getEntity, listEntities, neighbours } from '../../../scripts/lib/memory/reads.js';

import { diskIO } from './_helpers.js';

const vocab = {
  entities: { class: {}, method: {}, table: {} },
  edges: {
    calls: { sources: ['class', 'method'], targets: ['class', 'method'] },
    writes: { sources: ['class', 'method'], targets: ['table'] },
  },
};
const schema = {
  version: 1,
  entities: { class: {}, method: {}, table: {} },
  edges: { calls: {}, writes: {} },
  embeddings: null,
};


describe('reads', () => {
  let root, store;
  before(async () => {
    root = mkdtempSync(join(tmpdir(), 'reads-'));
    mkdirSync(join(root, 'foundry/memory/relations'), { recursive: true });
    store = await openStore({ foundryDir: 'foundry', schema, io: diskIO(root), dbAbsolutePath: join(root, 'memory.db') });
    await putEntity(store, { type: 'class', name: 'com.A', value: 'va' }, vocab);
    await putEntity(store, { type: 'class', name: 'com.B', value: 'vb' }, vocab);
    await putEntity(store, { type: 'method', name: 'com.A.m1', value: 'm1' }, vocab);
    await putEntity(store, { type: 'table', name: 'ORDERS', value: 'orders table' }, vocab);
    await relate(store, { edge_type: 'calls', from_type: 'class', from_name: 'com.A', to_type: 'method', to_name: 'com.A.m1' }, vocab);
    await relate(store, { edge_type: 'writes', from_type: 'method', from_name: 'com.A.m1', to_type: 'table', to_name: 'ORDERS' }, vocab);
  });
  after(() => { closeStore(store); rmSync(root, { recursive: true, force: true }); });

  it('getEntity returns entity or null', async () => {
    assert.deepEqual(await getEntity(store, { type: 'class', name: 'com.A' }), { type: 'class', name: 'com.A', value: 'va' });
    assert.equal(await getEntity(store, { type: 'class', name: 'nope' }), null);
  });

  it('listEntities returns all rows for a type', async () => {
    const out = await listEntities(store, { type: 'class' });
    assert.equal(out.length, 2);
    assert.deepEqual(out.map((r) => r.name).sort(), ['com.A', 'com.B']);
  });

  it('neighbours depth=1 returns directly connected entities and edges', async () => {
    const result = await neighbours(store, { type: 'class', name: 'com.A', depth: 1 }, vocab);
    const names = result.entities.map((e) => `${e.type}/${e.name}`).sort();
    assert.deepEqual(names, ['class/com.A', 'method/com.A.m1']);
    assert.equal(result.edges.length, 1);
    assert.equal(result.edges[0].edge_type, 'calls');
  });

  it('neighbours depth=2 includes transitively reachable entities', async () => {
    const result = await neighbours(store, { type: 'class', name: 'com.A', depth: 2 }, vocab);
    const names = result.entities.map((e) => `${e.type}/${e.name}`).sort();
    assert.deepEqual(names, ['class/com.A', 'method/com.A.m1', 'table/ORDERS']);
  });

  it('neighbours with edge_types filter restricts to named edges', async () => {
    const result = await neighbours(store, { type: 'class', name: 'com.A', depth: 2, edge_types: ['calls'] }, vocab);
    const names = result.entities.map((e) => `${e.type}/${e.name}`).sort();
    assert.deepEqual(names, ['class/com.A', 'method/com.A.m1']);
  });
});
