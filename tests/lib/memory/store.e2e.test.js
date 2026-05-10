import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore, syncStore, closeStore } from '../../../src/scripts/lib/memory/store.js';
import { hashFrontmatter } from '../../../src/scripts/lib/memory/schema.js';


import { diskIO } from './_helpers.js';

describe('store lifecycle', () => {
  let root;
  before(() => {
    root = mkdtempSync(join(tmpdir(), 'mem-store-'));
    mkdirSync(join(root, 'foundry/memory/entities'), { recursive: true });
    mkdirSync(join(root, 'foundry/memory/edges'), { recursive: true });
    mkdirSync(join(root, 'foundry-memory/relations'), { recursive: true });
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
    writeFileSync(join(root, 'foundry-memory/relations/class.ndjson'),
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
      mkdirSync(join(localRoot, 'foundry-memory/relations'), { recursive: true });
      const io = diskIO(localRoot);
      const store = await openStore({ foundryDir: 'foundry', schema, io, dbAbsolutePath: join(localRoot, 'foundry/memory/memory.db') });
      await store.db.run('?[name, value] <- [["com.Bar", "Another"], ["com.Aaa", "First"]]\n:put ent_class { name => value }');
      await syncStore({ store, io });

      const ndjson = readFileSync(join(localRoot, 'foundry-memory/relations/class.ndjson'), 'utf-8');
      // Sorted by name: Aaa before Bar.
      assert.match(ndjson, /^{"name":"com.Aaa","value":"First"}\n{"name":"com.Bar","value":"Another"}\n$/);
      closeStore(store);
    } finally {
      rmSync(localRoot, { recursive: true, force: true });
    }
  });

  it('closes the db handle when an NDJSON import throws mid-init (entity)', async () => {
    const localRoot = mkdtempSync(join(tmpdir(), 'mem-store-crash-ent-'));
    try {
      mkdirSync(join(localRoot, 'foundry-memory/relations'), { recursive: true });
      const dbPath = join(localRoot, 'foundry/memory/memory.db');
      const schema = {
        version: 1,
        entities: { class: { frontmatterHash: hashFrontmatter({ type: 'class' }) } },
        edges: {},
        embeddings: null,
      };
      // NDJSON file exists so importRelation is reached.
      writeFileSync(join(localRoot, 'foundry-memory/relations/class.ndjson'),
        '{"name":"com.Foo","value":"A class"}\n');

      // Wrap diskIO so readFile throws specifically for the entity NDJSON.
      // This fires AFTER openMemoryDb has created the sqlite handle but
      // BEFORE openStore returns — the exact hazard window.
      const baseIO = diskIO(localRoot);
      const faultyIO = {
        ...baseIO,
        readFile: async (p) => {
          if (p.endsWith('relations/class.ndjson')) {
            throw new Error('simulated disk failure (entity)');
          }
          return baseIO.readFile(p);
        },
      };

      // Spy on the Cozo module so we can assert the db handle was closed
      // after the failure. In-process cozo-node tolerates concurrent handles
      // on the same sqlite file, so resource cleanup cannot be observed via
      // a second open — we have to observe the close call directly.
      const realCozo = await import('../../../src/scripts/lib/memory/cozo.js');
      const closed = [];
      const cozoSpy = {
        ...realCozo,
        closeMemoryDb: (db) => {
          closed.push(db);
          realCozo.closeMemoryDb(db);
        },
      };

      let err;
      try {
        await openStore({ foundryDir: 'foundry', schema, io: faultyIO, dbAbsolutePath: dbPath, cozo: cozoSpy });
      } catch (e) {
        err = e;
      }
      assert.ok(err, 'openStore should have thrown');
      assert.equal(closed.length, 1, 'closeMemoryDb called exactly once on failure');
      assert.ok(closed[0] && typeof closed[0].close === 'function', 'closed the db handle, not something else');

      // Sanity check: reopening the same path with clean io still works.
      const store2 = await openStore({ foundryDir: 'foundry', schema, io: diskIO(localRoot), dbAbsolutePath: dbPath });
      closeStore(store2);
    } finally {
      rmSync(localRoot, { recursive: true, force: true });
    }
  });

  it('closes the db handle when an NDJSON import throws mid-init (edge)', async () => {
    const localRoot = mkdtempSync(join(tmpdir(), 'mem-store-crash-edge-'));
    try {
      mkdirSync(join(localRoot, 'foundry-memory/relations'), { recursive: true });
      const dbPath = join(localRoot, 'foundry/memory/memory.db');
      const schema = {
        version: 1,
        entities: { class: { frontmatterHash: hashFrontmatter({ type: 'class' }) } },
        edges: { calls: { frontmatterHash: hashFrontmatter({ type: 'calls', sources: ['class'], targets: ['class'] }) } },
        embeddings: null,
      };
      writeFileSync(join(localRoot, 'foundry-memory/relations/calls.ndjson'),
        '{"from_type":"class","from_name":"A","to_type":"class","to_name":"B"}\n');

      const baseIO = diskIO(localRoot);
      const faultyIO = {
        ...baseIO,
        readFile: async (p) => {
          if (p.endsWith('relations/calls.ndjson')) {
            throw new Error('simulated disk failure (edge)');
          }
          return baseIO.readFile(p);
        },
      };

      const realCozo = await import('../../../src/scripts/lib/memory/cozo.js');
      const closed = [];
      const cozoSpy = {
        ...realCozo,
        closeMemoryDb: (db) => {
          closed.push(db);
          realCozo.closeMemoryDb(db);
        },
      };

      let err;
      try {
        await openStore({ foundryDir: 'foundry', schema, io: faultyIO, dbAbsolutePath: dbPath, cozo: cozoSpy });
      } catch (e) {
        err = e;
      }
      assert.ok(err, 'openStore should have thrown');
      assert.equal(closed.length, 1, 'closeMemoryDb called exactly once on failure');
    } finally {
      rmSync(localRoot, { recursive: true, force: true });
    }
  });

  it('does not double-close on the happy path', async () => {
    const localRoot = mkdtempSync(join(tmpdir(), 'mem-store-happy-'));
    try {
      mkdirSync(join(localRoot, 'foundry-memory/relations'), { recursive: true });
      const schema = {
        version: 1,
        entities: { class: { frontmatterHash: hashFrontmatter({ type: 'class' }) } },
        edges: {},
        embeddings: null,
      };

      const realCozo = await import('../../../src/scripts/lib/memory/cozo.js');
      const closed = [];
      const cozoSpy = {
        ...realCozo,
        closeMemoryDb: (db) => {
          closed.push(db);
          realCozo.closeMemoryDb(db);
        },
      };

      // Successful open must NOT invoke the failure-path close.
      const store = await openStore({
        foundryDir: 'foundry',
        schema,
        io: diskIO(localRoot),
        dbAbsolutePath: join(localRoot, 'foundry/memory/memory.db'),
        cozo: cozoSpy,
      });
      assert.equal(closed.length, 0, 'no failure-path close on successful open');
      closeStore(store);
    } finally {
      rmSync(localRoot, { recursive: true, force: true });
    }
  });

  it('drops orphan ent_/edge_ relations not present in the schema on reopen', async () => {
    const localRoot = mkdtempSync(join(tmpdir(), 'mem-store-orphan-'));
    try {
      mkdirSync(join(localRoot, 'foundry-memory/relations'), { recursive: true });
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

  it('rejects NDJSON with NUL in entity name during import', async () => {
    const localRoot = mkdtempSync(join(tmpdir(), 'mem-store-nul-name-'));
    try {
      mkdirSync(join(localRoot, 'foundry-memory/relations'), { recursive: true });
      const schema = {
        version: 1,
        entities: { class: { frontmatterHash: hashFrontmatter({ type: 'class' }) } },
        edges: {},
        embeddings: null,
      };
      // Corrupted NDJSON with NUL in name field.
      writeFileSync(join(localRoot, 'foundry-memory/relations/class.ndjson'),
        '{"name":"com.Foo\\u0000Bar","value":"A class"}\n');
      
      const io = diskIO(localRoot);
      await assert.rejects(
        () => openStore({ foundryDir: 'foundry', schema, io, dbAbsolutePath: join(localRoot, 'foundry/memory/memory.db') }),
        /must not contain NUL/,
      );
    } finally {
      rmSync(localRoot, { recursive: true, force: true });
    }
  });

  it('rejects NDJSON with NUL in entity value during import', async () => {
    const localRoot = mkdtempSync(join(tmpdir(), 'mem-store-nul-value-'));
    try {
      mkdirSync(join(localRoot, 'foundry-memory/relations'), { recursive: true });
      const schema = {
        version: 1,
        entities: { class: { frontmatterHash: hashFrontmatter({ type: 'class' }) } },
        edges: {},
        embeddings: null,
      };
      // Corrupted NDJSON with NUL in value field.
      writeFileSync(join(localRoot, 'foundry-memory/relations/class.ndjson'),
        '{"name":"com.Foo","value":"corrupted\\u0000value"}\n');
      
      const io = diskIO(localRoot);
      await assert.rejects(
        () => openStore({ foundryDir: 'foundry', schema, io, dbAbsolutePath: join(localRoot, 'foundry/memory/memory.db') }),
        /must not contain NUL/,
      );
    } finally {
      rmSync(localRoot, { recursive: true, force: true });
    }
  });

  it('rejects NDJSON with NUL in edge names during import', async () => {
    const localRoot = mkdtempSync(join(tmpdir(), 'mem-store-nul-edge-'));
    try {
      mkdirSync(join(localRoot, 'foundry-memory/relations'), { recursive: true });
      const schema = {
        version: 1,
        entities: { class: { frontmatterHash: hashFrontmatter({ type: 'class' }) } },
        edges: { calls: { frontmatterHash: hashFrontmatter({ type: 'calls', sources: ['class'], targets: ['class'] }) } },
        embeddings: null,
      };
      // Corrupted NDJSON with NUL in from_name field.
      writeFileSync(join(localRoot, 'foundry-memory/relations/calls.ndjson'),
        '{"from_type":"class","from_name":"A\\u0000B","to_type":"class","to_name":"C"}\n');
      
      const io = diskIO(localRoot);
      await assert.rejects(
        () => openStore({ foundryDir: 'foundry', schema, io, dbAbsolutePath: join(localRoot, 'foundry/memory/memory.db') }),
        /must not contain NUL/,
      );
    } finally {
      rmSync(localRoot, { recursive: true, force: true });
    }
  });
});

