import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadSchema, emptySchema, writeSchema, bumpVersion, hashFrontmatter } from '../../../scripts/lib/memory/schema.js';

function mockIO(files = {}) {
  const store = { ...files };
  return {
    store,
    exists: async (p) => p in store,
    readFile: async (p) => store[p],
    writeFile: async (p, content) => { store[p] = content; },
    mkdir: async () => {},
  };
}

describe('emptySchema', () => {
  it('creates a v1 schema with empty registries', () => {
    const s = emptySchema();
    assert.equal(s.version, 1);
    assert.deepEqual(s.entities, {});
    assert.deepEqual(s.edges, {});
    assert.equal(s.embeddings, null);
  });
});

describe('loadSchema', () => {
  it('returns empty schema when file missing', async () => {
    const io = mockIO();
    const s = await loadSchema('foundry', io);
    assert.equal(s.version, 1);
  });

  it('parses existing schema.json', async () => {
    const io = mockIO({
      'foundry/memory/schema.json': JSON.stringify({
        version: 3,
        entities: { class: { frontmatterHash: 'abc' } },
        edges: {},
        embeddings: { model: 'nomic-embed-text', dimensions: 768 },
      }, null, 2) + '\n',
    });
    const s = await loadSchema('foundry', io);
    assert.equal(s.version, 3);
    assert.equal(s.entities.class.frontmatterHash, 'abc');
    assert.equal(s.embeddings.dimensions, 768);
  });
});

describe('writeSchema', () => {
  it('writes sorted, stable JSON with trailing newline', async () => {
    const io = mockIO();
    const s = {
      version: 2,
      entities: { zeta: { frontmatterHash: 'z' }, alpha: { frontmatterHash: 'a' } },
      edges: {},
      embeddings: null,
    };
    await writeSchema('foundry', s, io);
    const written = io.store['foundry/memory/schema.json'];
    assert.match(written, /\n$/);
    const reparsed = JSON.parse(written);
    assert.deepEqual(Object.keys(reparsed.entities), ['alpha', 'zeta']);
  });

  it('deep-canonicalises nested keys (stable across insertion order)', async () => {
    const io1 = mockIO();
    const io2 = mockIO();
    // Same logical schema, different insertion order at every nesting level.
    const a = {
      version: 2,
      entities: {
        zeta: { z: 1, a: 2 },
        alpha: { frontmatterHash: 'a', meta: { y: 1, x: 2 } },
      },
      edges: { calls: { frontmatterHash: 'c' } },
      embeddings: { model: 'm', dimensions: 8 },
    };
    const b = {
      version: 2,
      entities: {
        alpha: { meta: { x: 2, y: 1 }, frontmatterHash: 'a' },
        zeta: { a: 2, z: 1 },
      },
      edges: { calls: { frontmatterHash: 'c' } },
      embeddings: { dimensions: 8, model: 'm' },
    };
    await writeSchema('foundry', a, io1);
    await writeSchema('foundry', b, io2);
    assert.equal(
      io1.store['foundry/memory/schema.json'],
      io2.store['foundry/memory/schema.json'],
    );
  });
});

describe('bumpVersion', () => {
  it('increments and returns the new version', () => {
    const s = emptySchema();
    const before = s.version;
    bumpVersion(s);
    assert.equal(s.version, before + 1);
  });
});

describe('hashFrontmatter', () => {
  it('is stable across equivalent object orderings', () => {
    const a = hashFrontmatter({ type: 'class', kind: 'entity' });
    const b = hashFrontmatter({ kind: 'entity', type: 'class' });
    assert.equal(a, b);
  });

  it('differs when values change', () => {
    const a = hashFrontmatter({ type: 'class' });
    const b = hashFrontmatter({ type: 'method' });
    assert.notEqual(a, b);
  });
});
