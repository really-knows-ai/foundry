import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore, closeStore } from '../../../scripts/lib/memory/store.js';
import { putEntity } from '../../../scripts/lib/memory/writes.js';
import { search } from '../../../scripts/lib/memory/search.js';

import { diskIO } from './_helpers.js';

const vocab = { entities: { class: {}, table: {} }, edges: {} };


// Deterministic fake embedder: vector depends only on the first char of value.
function charEmbedder(dim) {
  return async (inputs) => inputs.map((s) => {
    const v = new Array(dim).fill(0);
    v[(s.charCodeAt(0) ?? 0) % dim] = 1;
    return v;
  });
}

describe('search', () => {
  let root, store;
  before(async () => {
    root = mkdtempSync(join(tmpdir(), 'search-'));
    mkdirSync(join(root, 'foundry/memory/relations'), { recursive: true });
    store = await openStore({
      foundryDir: 'foundry',
      schema: {
        version: 1,
        entities: { class: {}, table: {} },
        edges: {},
        embeddings: { model: 'fake', dimensions: 4 },
      },
      io: diskIO(root),
      dbAbsolutePath: join(root, 'memory.db'),
    });
    const embedder = charEmbedder(4);
    await putEntity(store, { type: 'class', name: 'a1', value: 'alpha' }, vocab, { embedder });
    await putEntity(store, { type: 'class', name: 'b1', value: 'beta' }, vocab, { embedder });
    await putEntity(store, { type: 'table', name: 't1', value: 'alpha' }, vocab, { embedder });
  });
  after(() => { closeStore(store); rmSync(root, { recursive: true, force: true }); });

  it('returns nearest entities across all types when no filter', async () => {
    const embedder = charEmbedder(4);
    const out = await search({ store, query_text: 'alpha', k: 3, embedder });
    assert.ok(out.length >= 1);
    assert.equal(out[0].value, 'alpha');
  });

  it('restricts to named type_filter', async () => {
    const embedder = charEmbedder(4);
    const out = await search({ store, query_text: 'alpha', k: 5, type_filter: ['class'], embedder });
    for (const row of out) assert.equal(row.type, 'class');
  });

  it('returns [] gracefully when type has no rows', async () => {
    const embedder = charEmbedder(4);
    const out = await search({ store, query_text: 'x', k: 5, type_filter: ['nonexistent'], embedder });
    assert.deepEqual(out, []);
  });
});
