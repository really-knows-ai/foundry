import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore, closeStore } from '../../../src/scripts/lib/memory/store.js';
import { putEntity } from '../../../src/scripts/lib/memory/writes.js';
import { search } from '../../../src/scripts/lib/memory/search.js';

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
    mkdirSync(join(root, 'foundry-memory/relations'), { recursive: true });
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

  it('returns global top-k across all types (k-amplification is intentional)', async () => {
    // This test documents the k-amplification behavior: with N entity types and
    // k requested results, the implementation fetches k results from each type
    // (N×k total), then returns the global top-k. This is necessary to get
    // semantically correct results when the top matches are spread across types.
    //
    // Setup: 3 types, k=2, but distribute best matches across types
    const embedder = charEmbedder(4);
    
    // Add a third type with entities
    await putEntity(store, { type: 'table', name: 't2', value: 'almond' }, vocab, { embedder });
    
    // Query for 'alpha' with k=2
    // Expected: both 'alpha' entities (a1 from class, t1 from table) should be
    // in top-2, even though we're searching across 2 types. If we only fetched
    // k/N=1 per type, we might miss one of them.
    const out = await search({ store, query_text: 'alpha', k: 2, embedder });
    
    assert.equal(out.length, 2, 'should return exactly k=2 results');
    
    // Both perfect matches should be in the results
    const names = out.map((r) => r.name).sort();
    assert.ok(names.includes('a1'), 'should include class entity a1');
    assert.ok(names.includes('t1'), 'should include table entity t1');
    
    // Both should have distance 0 (perfect match for char embedder)
    assert.equal(out[0].distance, 0, 'top result should be perfect match');
    assert.equal(out[1].distance, 0, 'second result should be perfect match');
  });
});
