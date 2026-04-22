import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore, closeStore } from '../../../scripts/lib/memory/store.js';
import { putEntity } from '../../../scripts/lib/memory/writes.js';

const vocab = { entities: { class: {} }, edges: {} };

function diskIO(root) {
  const abs = (p) => join(root, p);
  return {
    exists: async (p) => fs.existsSync(abs(p)),
    readFile: async (p) => fs.readFileSync(abs(p), 'utf-8'),
    writeFile: async (p, c) => { fs.mkdirSync(join(abs(p), '..'), { recursive: true }); fs.writeFileSync(abs(p), c, 'utf-8'); },
    readDir: async (p) => { try { return fs.readdirSync(abs(p)); } catch { return []; } },
    mkdir: async (p) => fs.mkdirSync(abs(p), { recursive: true }),
    unlink: async (p) => { if (fs.existsSync(abs(p))) fs.unlinkSync(abs(p)); },
  };
}

function fakeEmbedder(dim) {
  let i = 0;
  return async (inputs) => inputs.map(() => {
    const v = new Array(dim).fill(0);
    v[i++ % dim] = 1;
    return v;
  });
}

describe('store with embeddings', () => {
  let root, store;
  before(async () => {
    root = mkdtempSync(join(tmpdir(), 'emb-'));
    mkdirSync(join(root, 'foundry/memory/relations'), { recursive: true });
    const schema = {
      version: 1,
      entities: { class: {} },
      edges: {},
      embeddings: { model: 'fake', dimensions: 3 },
    };
    store = await openStore({
      foundryDir: 'foundry',
      schema,
      io: diskIO(root),
      dbAbsolutePath: join(root, 'memory.db'),
    });
  });
  after(() => { closeStore(store); rmSync(root, { recursive: true, force: true }); });

  it('creates HNSW index on entity relation when embeddings enabled', async () => {
    const res = await store.db.run('::indices ent_class');
    // At least one HNSW index row should exist; name should be 'vec'.
    const names = res.rows.map((r) => r[0]);
    assert.ok(names.includes('vec'), `expected 'vec' index, got ${JSON.stringify(names)}`);
  });

  it('putEntity with embedder stores vector in Cozo', async () => {
    const embedder = fakeEmbedder(3);
    await putEntity(store, { type: 'class', name: 'com.A', value: 'va' }, vocab, { embedder });
    const res = await store.db.run('?[n, v, e] := *ent_class{name: n, value: v, embedding: e}');
    assert.equal(res.rows.length, 1);
    assert.deepEqual(res.rows[0][2], [1, 0, 0]);
  });
});

describe('store without embeddings (back-compat)', () => {
  let root, store;
  before(async () => {
    root = mkdtempSync(join(tmpdir(), 'noemb-'));
    mkdirSync(join(root, 'foundry/memory/relations'), { recursive: true });
    const schema = { version: 1, entities: { class: {} }, edges: {} };
    store = await openStore({
      foundryDir: 'foundry',
      schema,
      io: diskIO(root),
      dbAbsolutePath: join(root, 'memory.db'),
    });
  });
  after(() => { closeStore(store); rmSync(root, { recursive: true, force: true }); });

  it('putEntity without embedder still works', async () => {
    await putEntity(store, { type: 'class', name: 'com.A', value: 'va' }, vocab);
    const res = await store.db.run('?[n, v] := *ent_class{name: n, value: v}');
    assert.equal(res.rows.length, 1);
    assert.equal(res.rows[0][1], 'va');
  });
});
