import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore, syncStore, closeStore } from '../../../scripts/lib/memory/store.js';
import { hashFrontmatter } from '../../../scripts/lib/memory/schema.js';


import { diskIO } from './_helpers.js';

describe('store lifecycle', () => {
  let root;
  before(() => {
    root = mkdtempSync(join(tmpdir(), 'mem-store-'));
    mkdirSync(join(root, 'foundry/memory/entities'), { recursive: true });
    mkdirSync(join(root, 'foundry/memory/edges'), { recursive: true });
    mkdirSync(join(root, 'foundry/memory/relations'), { recursive: true });
  });
  after(() => rmSync(root, { recursive: true, force: true }));

  it('opens with empty schema, creates no relations, syncs without error', async () => {
    const io = diskIO(root);
    const schema = { version: 1, entities: {}, edges: {}, embeddings: null };
    const store = await openStore({ foundryDir: 'foundry', schema, io, dbAbsolutePath: join(root, 'foundry/memory/memory.db') });
    await syncStore({ store, io });
    closeStore(store);
  });

  it('creates declared relations and imports existing NDJSON rows', async () => {
    const classFm = { type: 'class' };
    const schema = {
      version: 1,
      entities: { class: { frontmatterHash: hashFrontmatter(classFm) } },
      edges: {},
      embeddings: null,
    };
    writeFileSync(join(root, 'foundry/memory/relations/class.ndjson'),
      '{"name":"com.Foo","value":"A class"}\n');

    const io = diskIO(root);
    const store = await openStore({ foundryDir: 'foundry', schema, io, dbAbsolutePath: join(root, 'foundry/memory/memory.db') });
    const res = await store.db.run('?[n, v] := *ent_class{name: n, value: v}');
    assert.equal(res.rows.length, 1);
    assert.equal(res.rows[0][0], 'com.Foo');
    assert.equal(res.rows[0][1], 'A class');
    closeStore(store);
  });

  it('exports rows deterministically on sync', async () => {
    const classFm = { type: 'class' };
    const schema = {
      version: 1,
      entities: { class: { frontmatterHash: hashFrontmatter(classFm) } },
      edges: {},
      embeddings: null,
    };
    // Use a fresh tmp dir + db to avoid state leaking from the previous test.
    const localRoot = mkdtempSync(join(tmpdir(), 'mem-store-3-'));
    try {
      mkdirSync(join(localRoot, 'foundry/memory/relations'), { recursive: true });
      const io = diskIO(localRoot);
      const store = await openStore({ foundryDir: 'foundry', schema, io, dbAbsolutePath: join(localRoot, 'foundry/memory/memory.db') });
      await store.db.run('?[name, value] <- [["com.Bar", "Another"], ["com.Aaa", "First"]]\n:put ent_class { name => value }');
      await syncStore({ store, io });

      const ndjson = readFileSync(join(localRoot, 'foundry/memory/relations/class.ndjson'), 'utf-8');
      // Sorted by name: Aaa before Bar.
      assert.match(ndjson, /^{"name":"com.Aaa","value":"First"}\n{"name":"com.Bar","value":"Another"}\n$/);
      closeStore(store);
    } finally {
      rmSync(localRoot, { recursive: true, force: true });
    }
  });

  it('drops orphan ent_/edge_ relations not present in the schema on reopen', async () => {
    const localRoot = mkdtempSync(join(tmpdir(), 'mem-store-orphan-'));
    try {
      mkdirSync(join(localRoot, 'foundry/memory/relations'), { recursive: true });
      const io = diskIO(localRoot);
      const dbPath = join(localRoot, 'foundry/memory/memory.db');

      // First open: schema declares `class` and an edge `calls`.
      const schemaA = {
        version: 1,
        entities: { class: { frontmatterHash: hashFrontmatter({ type: 'class' }) } },
        edges: { calls: { frontmatterHash: hashFrontmatter({ type: 'calls', sources: ['class'], targets: ['class'] }) } },
        embeddings: null,
      };
      const storeA = await openStore({ foundryDir: 'foundry', schema: schemaA, io, dbAbsolutePath: dbPath });
      const beforeA = (await storeA.db.run('::relations')).rows.map((r) => r[0]).sort();
      assert.ok(beforeA.includes('ent_class'));
      assert.ok(beforeA.includes('edge_calls'));
      closeStore(storeA);

      // Second open: admin dropped `calls` — schema no longer lists it, but
      // edge_calls still exists in the live db. Reconcile must drop it.
      const schemaB = {
        version: 2,
        entities: { class: { frontmatterHash: hashFrontmatter({ type: 'class' }) } },
        edges: {},
        embeddings: null,
      };
      const storeB = await openStore({ foundryDir: 'foundry', schema: schemaB, io, dbAbsolutePath: dbPath });
      const afterB = (await storeB.db.run('::relations')).rows.map((r) => r[0]);
      assert.ok(afterB.includes('ent_class'), 'declared relation preserved');
      assert.ok(!afterB.includes('edge_calls'), 'orphan relation dropped');
      closeStore(storeB);
    } finally {
      rmSync(localRoot, { recursive: true, force: true });
    }
  });
});
