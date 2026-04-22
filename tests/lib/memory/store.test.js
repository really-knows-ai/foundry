import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore, syncStore, closeStore } from '../../../scripts/lib/memory/store.js';
import { hashFrontmatter } from '../../../scripts/lib/memory/schema.js';

function diskIO(root) {
  const abs = (p) => join(root, p);
  return {
    exists: async (p) => existsSync(abs(p)),
    readFile: async (p) => readFileSync(abs(p), 'utf-8'),
    writeFile: async (p, c) => { mkdirSync(join(abs(p), '..'), { recursive: true }); writeFileSync(abs(p), c, 'utf-8'); },
    readDir: async (p) => { try { return readdirSync(abs(p)); } catch { return []; } },
    mkdir: async (p) => { mkdirSync(abs(p), { recursive: true }); },
  };
}

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
});
