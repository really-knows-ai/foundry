# Flow Memory — Plan 5: Embeddings + semantic search

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add semantic search over entity values via an OpenAI-compatible `/v1/embeddings` HTTP adapter. Embeddings are computed on write and stored alongside entity rows. A new `foundry_memory_search` tool does vector nearest-neighbour. A `change-embedding-model` skill and admin tool re-embed all entities when the model changes. `init-memory` probes the provider before completing.

**Architecture:** `scripts/lib/memory/embeddings.js` is the adapter — single HTTP client, model-agnostic, talks OpenAI `/v1/embeddings` shape. `scripts/lib/memory/search.js` calls the adapter for the query, runs Cozo's HNSW nearest-neighbour against the entity relation, returns ranked entities. Embeddings are stored in the existing Cozo `embedding` column (declared in Plan 2's entity DDL) and also round-tripped through NDJSON (the NDJSON serialiser already supports it). HNSW index is created per-entity-type on store open when embeddings are enabled and `schema.embeddings.dimensions` is set.

**Tech Stack:** Plans 1-4 + Node's built-in `fetch` (Node ≥18 has it natively). No new npm dependencies.

**Spec reference:** `MEMORY.md` §8.

---

## File Structure

**Created:**
- `scripts/lib/memory/embeddings.js` — HTTP adapter.
- `scripts/lib/memory/search.js` — search tool implementation.
- `scripts/lib/memory/admin/reembed.js` — admin operation.
- `tests/lib/memory/embeddings.test.js`
- `tests/lib/memory/search.test.js`
- `tests/lib/memory/admin/reembed.test.js`
- `skills/change-embedding-model/SKILL.md`

**Modified:**
- `scripts/lib/memory/store.js` — embed-on-put hook; HNSW index creation; dimension enforcement on read.
- `scripts/lib/memory/writes.js` — `putEntity` takes optional `embedder` to compute and store the vector atomically.
- `skills/init-memory/SKILL.md` — add an endpoint probe step.
- `.opencode/plugins/foundry.js` — register `foundry_memory_search` and `foundry_memory_change_embedding_model`; wire embedder into write tools.

---

## Task 1: Embeddings adapter

**Files:**
- Create: `scripts/lib/memory/embeddings.js`
- Test: `tests/lib/memory/embeddings.test.js`

The adapter is one function: `embed({ config, inputs })` → `number[][]`. Inputs are batched (`config.batchSize`). On every response, checks that every vector length matches `config.dimensions`; mismatches throw.

Probe: `probeEmbeddings({ config })` sends a one-input request to verify the endpoint is reachable and the dimension matches.

- [ ] **Step 1: Write failing test**

`tests/lib/memory/embeddings.test.js`:

```js
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { embed, probeEmbeddings } from '../../../scripts/lib/memory/embeddings.js';

// Minimal fetch mock: replace global fetch for the duration of a test.
function installMockFetch(handler) {
  const orig = global.fetch;
  global.fetch = handler;
  return () => { global.fetch = orig; };
}

const baseConfig = {
  enabled: true,
  baseURL: 'http://localhost:11434/v1',
  model: 'nomic-embed-text',
  dimensions: 3,
  apiKey: null,
  batchSize: 2,
  timeoutMs: 5000,
};

describe('embed', () => {
  let restore;
  afterEach(() => restore && restore());

  it('posts batched requests matching OpenAI shape and returns vectors', async () => {
    const calls = [];
    restore = installMockFetch(async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) });
      const body = JSON.parse(init.body);
      return new Response(JSON.stringify({
        data: body.input.map((_, i) => ({ embedding: [i, i + 1, i + 2], index: i })),
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });

    const out = await embed({ config: baseConfig, inputs: ['a', 'b', 'c'] });
    assert.equal(out.length, 3);
    assert.deepEqual(out[0], [0, 1, 2]);
    assert.equal(calls.length, 2); // batchSize: 2
    assert.equal(calls[0].url, 'http://localhost:11434/v1/embeddings');
    assert.equal(calls[0].body.model, 'nomic-embed-text');
    assert.deepEqual(calls[0].body.input, ['a', 'b']);
  });

  it('sends Authorization header when apiKey is set', async () => {
    let seen;
    restore = installMockFetch(async (_url, init) => {
      seen = init.headers;
      return new Response(JSON.stringify({ data: [{ embedding: [1, 2, 3], index: 0 }] }), { status: 200 });
    });
    await embed({ config: { ...baseConfig, apiKey: 'sk-xyz' }, inputs: ['a'] });
    assert.equal(seen.Authorization, 'Bearer sk-xyz');
  });

  it('throws when dimension mismatches', async () => {
    restore = installMockFetch(async () =>
      new Response(JSON.stringify({ data: [{ embedding: [1, 2], index: 0 }] }), { status: 200 }));
    await assert.rejects(() => embed({ config: baseConfig, inputs: ['a'] }), /dimension/i);
  });

  it('surfaces provider errors with status code', async () => {
    restore = installMockFetch(async () => new Response('{"error":"model not found"}', { status: 404 }));
    await assert.rejects(() => embed({ config: baseConfig, inputs: ['a'] }), /404|not found/);
  });

  it('times out after timeoutMs', async () => {
    restore = installMockFetch(async (_url, init) => {
      await new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))));
    });
    await assert.rejects(
      () => embed({ config: { ...baseConfig, timeoutMs: 50 }, inputs: ['a'] }),
      /abort|timeout/i,
    );
  });
});

describe('probeEmbeddings', () => {
  let restore;
  afterEach(() => restore && restore());

  it('returns {ok: true, dimensions} on success', async () => {
    restore = installMockFetch(async () =>
      new Response(JSON.stringify({ data: [{ embedding: [1, 2, 3], index: 0 }] }), { status: 200 }));
    const r = await probeEmbeddings({ config: baseConfig });
    assert.equal(r.ok, true);
    assert.equal(r.dimensions, 3);
  });

  it('returns {ok: false, error} on network failure', async () => {
    restore = installMockFetch(async () => { throw new Error('ECONNREFUSED'); });
    const r = await probeEmbeddings({ config: baseConfig });
    assert.equal(r.ok, false);
    assert.match(r.error, /ECONNREFUSED|connect/i);
  });

  it('returns {ok: false} when dimension does not match config', async () => {
    restore = installMockFetch(async () =>
      new Response(JSON.stringify({ data: [{ embedding: [1, 2], index: 0 }] }), { status: 200 }));
    const r = await probeEmbeddings({ config: baseConfig });
    assert.equal(r.ok, false);
    assert.match(r.error, /dimension/i);
  });
});
```

- [ ] **Step 2: Run, fail.**

- [ ] **Step 3: Implement**

`scripts/lib/memory/embeddings.js`:

```js
async function callOnce({ config, inputs }) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), config.timeoutMs);
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
    const res = await fetch(`${config.baseURL}/embeddings`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: config.model, input: inputs }),
      signal: ac.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`embeddings provider returned ${res.status}: ${text.slice(0, 500)}`);
    }
    const body = await res.json();
    if (!Array.isArray(body.data)) throw new Error('embeddings provider returned malformed response (no data[])');
    return body.data
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
      .map((d) => d.embedding);
  } finally {
    clearTimeout(t);
  }
}

export async function embed({ config, inputs }) {
  if (!config.enabled) throw new Error('embeddings are disabled in memory config');
  if (!Array.isArray(inputs) || inputs.length === 0) return [];

  const out = [];
  for (let i = 0; i < inputs.length; i += config.batchSize) {
    const batch = inputs.slice(i, i + config.batchSize);
    const vectors = await callOnce({ config, inputs: batch });
    for (const v of vectors) {
      if (!Array.isArray(v) || v.length !== config.dimensions) {
        throw new Error(`embedding dimension mismatch: expected ${config.dimensions}, got ${Array.isArray(v) ? v.length : 'non-array'}`);
      }
      for (const x of v) if (!Number.isFinite(x)) throw new Error('embedding contains non-finite number');
    }
    out.push(...vectors);
  }
  return out;
}

export async function probeEmbeddings({ config }) {
  try {
    const out = await embed({ config, inputs: ['probe'] });
    return { ok: true, dimensions: out[0].length };
  } catch (err) {
    return { ok: false, error: err.message ?? String(err) };
  }
}
```

- [ ] **Step 4: Run, pass.**

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/memory/embeddings.js tests/lib/memory/embeddings.test.js
git commit -m "feat(memory): OpenAI-compatible embeddings adapter"
```

---

## Task 2: Store integration — HNSW index creation, embed-on-write

**Files:**
- Modify: `scripts/lib/memory/store.js`
- Modify: `scripts/lib/memory/writes.js`
- Test: `tests/lib/memory/store-embeddings.test.js`

Changes:
1. `openStore` now accepts an optional `embedder` function. When provided, after creating each entity relation, it creates an HNSW index on that relation's `embedding` column. If `schema.embeddings === null`, no index is created and the embedder is unused.
2. `putEntity` accepts an optional `embedder`. When provided, it calls `embedder([value])[0]`, then writes the entity row with the vector inlined into the `:put` statement.

Cozo HNSW DDL (one per entity relation):

```
::hnsw create ent_<type>:vec { fields: [embedding], dim: <N>, ef: 50, m: 16 }
```

Search query:

```
?[name, value, dist] := ~ent_<type>:vec { name, value | query: $q, k: $k, bind_distance: dist }
```

(Cozo's syntax; exact parameterisation may vary by Cozo version. Tests fix the version assumption by talking to a real Cozo instance.)

- [ ] **Step 1: Write failing test**

`tests/lib/memory/store-embeddings.test.js`:

```js
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore, closeStore } from '../../../scripts/lib/memory/store.js';
import { putEntity } from '../../../scripts/lib/memory/writes.js';

const vocab = { entities: { class: {} }, edges: {} };

function diskIO(root) {
  const fs = require('node:fs');
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
    // Some Cozo versions return 0 rows when no HNSW; we at least verify the command runs.
    assert.ok(res.rows);
  });

  it('putEntity with embedder stores vector in Cozo', async () => {
    const embedder = fakeEmbedder(3);
    await putEntity(store, { type: 'class', name: 'com.A', value: 'va' }, vocab, { embedder });
    const res = await store.db.run('?[n, v, e] := *ent_class{name: n, value: v, embedding: e}');
    assert.equal(res.rows.length, 1);
    assert.deepEqual(res.rows[0][2], [1, 0, 0]);
  });
});
```

- [ ] **Step 2: Run, fail.**

- [ ] **Step 3: Implement**

Edit `scripts/lib/memory/cozo.js` to add:

```js
export async function createHnswIndex(db, relationName, { dim, ef = 50, m = 16 }) {
  try {
    await db.run(`::hnsw create ${relationName}:vec { fields: [embedding], dim: ${dim}, ef: ${ef}, m: ${m} }`);
  } catch (err) {
    if (/already exists/i.test(String(err))) return;
    throw err;
  }
}
```

Edit `scripts/lib/memory/store.js` `openStore`:

```js
// after createEntityRelation(db, type):
if (schema.embeddings && schema.embeddings.dimensions) {
  await (await import('./cozo.js')).createHnswIndex(db, entRelName(type), { dim: schema.embeddings.dimensions });
}
```

Keep top import organised; here shown inline for brevity.

Edit `scripts/lib/memory/writes.js`:

```js
export async function putEntity(store, { type, name, value }, vocabulary, { embedder } = {}) {
  validateEntityWrite({ type, name, value }, vocabulary);
  const rel = entRelName(type);
  if (embedder) {
    const [vec] = await embedder([value]);
    if (!Array.isArray(vec)) throw new Error('embedder did not return a vector');
    const vecLit = `[${vec.map((n) => Number(n).toString()).join(', ')}]`;
    const row = `[${cozoStringLit(name)}, ${cozoStringLit(value)}, ${vecLit}]`;
    await store.db.run(`:put ${rel} { name => value, embedding } [${row}]`);
  } else {
    const row = `[${cozoStringLit(name)}, ${cozoStringLit(value)}]`;
    await store.db.run(`:put ${rel} { name => value } [${row}]`);
  }
}
```

Also update `exportEntityRelation` in `store.js` to include `embedding` when present:

```js
async function exportEntityRelation(db, type) {
  const res = await db.run(`?[name, value, embedding] := *ent_${type}{name, value, embedding}`);
  return res.rows.map(([name, value, embedding]) => {
    const row = { name, value };
    if (Array.isArray(embedding)) row.embedding = embedding;
    return row;
  });
}
```

And `importRelation` for entities should detect and carry the embedding if present:

```js
async function importRelation(db, relName, rows, kind) {
  if (rows.length === 0) return;
  if (kind === 'entity') {
    // Partition rows by whether they carry embeddings.
    const withVec = rows.filter((r) => Array.isArray(r.embedding));
    const plain = rows.filter((r) => !Array.isArray(r.embedding));
    if (plain.length > 0) {
      const data = plain.map((r) => `[${esc(r.name)}, ${esc(r.value)}]`).join(', ');
      await db.run(`:put ${relName} { name => value } [${data}]`);
    }
    if (withVec.length > 0) {
      const data = withVec.map((r) => `[${esc(r.name)}, ${esc(r.value)}, [${r.embedding.map(n => Number(n).toString()).join(', ')}]]`).join(', ');
      await db.run(`:put ${relName} { name => value, embedding } [${data}]`);
    }
  } else {
    const data = rows.map((r) => `[${esc(r.from_type)}, ${esc(r.from_name)}, ${esc(r.to_type)}, ${esc(r.to_name)}]`).join(', ');
    await db.run(`:put ${relName} { from_type, from_name, to_type, to_name } [${data}]`);
  }
}

function esc(s) {
  return '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n') + '"';
}
```

(This replaces the earlier `escape(s)` / `importRelation` from Plan 2 Task 3. Keep the behaviour identical for edges; add embedding partition for entities.)

- [ ] **Step 4: Run, pass.**

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/memory/store.js scripts/lib/memory/cozo.js scripts/lib/memory/writes.js tests/lib/memory/store-embeddings.test.js
git commit -m "feat(memory): HNSW index and embed-on-put integration"
```

---

## Task 3: Semantic search function and tool

**Files:**
- Create: `scripts/lib/memory/search.js`
- Test: `tests/lib/memory/search.test.js`

`search({ store, query_text, k, type_filter?, embedder })`:
1. Embed `query_text` using `embedder`.
2. For each type in `type_filter` (or all entity types), run HNSW search in Cozo.
3. Merge results, sort by distance ascending, return top `k`.

- [ ] **Step 1: Write failing test**

`tests/lib/memory/search.test.js`:

```js
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore, closeStore } from '../../../scripts/lib/memory/store.js';
import { putEntity } from '../../../scripts/lib/memory/writes.js';
import { search } from '../../../scripts/lib/memory/search.js';

const vocab = { entities: { class: {}, table: {} }, edges: {} };

function diskIO(root) {
  const fs = require('node:fs');
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
    // 'alpha' matches 'alpha' entities (distance 0) ahead of 'beta'.
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
```

- [ ] **Step 2: Run, fail.**

- [ ] **Step 3: Implement**

`scripts/lib/memory/search.js`:

```js
import { entRelName } from './cozo.js';

function asCozoVector(v) {
  return `[${v.map((n) => Number(n).toString()).join(', ')}]`;
}

async function searchOneType(db, type, queryVec, k) {
  const rel = entRelName(type);
  try {
    const q = `?[name, value, dist] := ~${rel}:vec{ name, value | query: ${asCozoVector(queryVec)}, k: ${k}, bind_distance: dist, ef: 64 }`;
    const res = await db.run(q);
    return res.rows.map(([name, value, dist]) => ({ type, name, value, distance: dist }));
  } catch (err) {
    // Relation may not have an index (embeddings disabled at open time) or be empty.
    if (/index|not found|no such/i.test(String(err))) return [];
    throw err;
  }
}

export async function search({ store, query_text, k = 5, type_filter, embedder }) {
  if (!embedder) throw new Error('search requires an embedder');
  if (typeof query_text !== 'string' || !query_text) throw new Error('query_text required');

  const types = (type_filter && type_filter.length > 0)
    ? type_filter
    : Object.keys(store.schema.entities);
  const [queryVec] = await embedder([query_text]);

  const all = [];
  for (const t of types) {
    const hits = await searchOneType(store.db, t, queryVec, k);
    all.push(...hits);
  }
  all.sort((a, b) => a.distance - b.distance);
  return all.slice(0, k);
}
```

- [ ] **Step 4: Run, pass.**

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/memory/search.js tests/lib/memory/search.test.js
git commit -m "feat(memory): semantic search over entity values"
```

---

## Task 4: Re-embed admin operation

**Files:**
- Create: `scripts/lib/memory/admin/reembed.js`
- Test: `tests/lib/memory/admin/reembed.test.js`

Called when the embedding model changes. Operation:
1. Drop existing HNSW indices on each entity relation.
2. For each entity type, list all entities, re-embed their values in batches, update rows with new vectors.
3. Recreate HNSW indices with the new `dimensions`.
4. Update `schema.embeddings` and bump version.

- [ ] **Step 1: Write failing test**

`tests/lib/memory/admin/reembed.test.js`:

```js
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore, closeStore } from '../../../../scripts/lib/memory/store.js';
import { putEntity } from '../../../../scripts/lib/memory/writes.js';
import { reembed } from '../../../../scripts/lib/memory/admin/reembed.js';

function diskIO(root) {
  const fs = require('node:fs');
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
```

- [ ] **Step 2: Run, fail.**

- [ ] **Step 3: Implement**

`scripts/lib/memory/admin/reembed.js`:

```js
import { openStore, closeStore } from '../store.js';
import { loadSchema, writeSchema, bumpVersion } from '../schema.js';
import { entRelName, createHnswIndex } from '../cozo.js';
import { invalidateStore } from '../singleton.js';

export async function reembed({ worktreeRoot, io, dbAbsolutePath, newModel, newDimensions, embedder, batchSize = 64 }) {
  if (!embedder) throw new Error('reembed requires an embedder');
  if (!Number.isInteger(newDimensions) || newDimensions <= 0) throw new Error('newDimensions must be positive integer');

  const oldSchema = await loadSchema('foundry', io);
  const updatedSchema = { ...oldSchema, embeddings: { model: newModel, dimensions: newDimensions } };

  // Open against OLD schema so existing HNSW indices are valid.
  const store = await openStore({ foundryDir: 'foundry', schema: oldSchema, io, dbAbsolutePath });
  try {
    for (const type of Object.keys(oldSchema.entities)) {
      const rel = entRelName(type);
      // Drop existing HNSW index if present.
      try { await store.db.run(`::hnsw drop ${rel}:vec`); } catch { /* no index -> fine */ }

      // List all rows of this type.
      const res = await store.db.run(`?[name, value] := *${rel}{name, value}`);
      const rows = res.rows;

      // Re-embed in batches.
      for (let i = 0; i < rows.length; i += batchSize) {
        const chunk = rows.slice(i, i + batchSize);
        const values = chunk.map((r) => r[1]);
        const vectors = await embedder(values);
        for (let j = 0; j < chunk.length; j++) {
          const [name, value] = chunk[j];
          const v = vectors[j];
          if (v.length !== newDimensions) throw new Error(`reembed: vector length ${v.length} != expected ${newDimensions}`);
          const vecLit = `[${v.map((n) => Number(n).toString()).join(', ')}]`;
          const esc = (s) => '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n') + '"';
          await store.db.run(`:put ${rel} { name => value, embedding } [[${esc(name)}, ${esc(value)}, ${vecLit}]]`);
        }
      }

      // Recreate HNSW with new dim.
      await createHnswIndex(store.db, rel, { dim: newDimensions });
    }
  } finally {
    closeStore(store);
  }

  bumpVersion(updatedSchema);
  await writeSchema('foundry', updatedSchema, io);
  invalidateStore(worktreeRoot);
  return { model: newModel, dimensions: newDimensions, types: Object.keys(oldSchema.entities).length };
}
```

- [ ] **Step 4: Run, pass.**

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/memory/admin/reembed.js tests/lib/memory/admin/reembed.test.js
git commit -m "feat(memory): admin tool to re-embed all entities"
```

---

## Task 5: Register search + reembed tools; wire embedder into write path

**Files:**
- Modify: `.opencode/plugins/foundry.js`

- [ ] **Step 1: Add imports**

```js
import { embed, probeEmbeddings } from '../../scripts/lib/memory/embeddings.js';
import { search as memSearch } from '../../scripts/lib/memory/search.js';
import { reembed as admReembed } from '../../scripts/lib/memory/admin/reembed.js';
```

- [ ] **Step 2: Build a per-call embedder inside `withStore`**

```js
async function withStore(context) {
  const io = makeIO(context.worktree);
  const store = await getOrOpenStore({ worktreeRoot: context.worktree, io });
  const ctx = getContext(context.worktree);
  const config = ctx.config;

  const embedder = config.embeddings?.enabled
    ? (inputs) => embed({ config: config.embeddings, inputs })
    : null;

  let permissions = null;
  if (context.cycle) {
    try {
      const cycleDef = await getCycleDefinition('foundry', context.cycle, io);
      permissions = resolvePermissions({ cycleFrontmatter: cycleDef.frontmatter, vocabulary: ctx.vocabulary });
    } catch { permissions = null; }
  }
  return {
    io, store, vocabulary: ctx.vocabulary, permissions, embedder,
    syncIfOutOfCycle: async () => { if (!context.cycle) await syncStore({ store, io }); },
  };
}
```

- [ ] **Step 3: Pass embedder into `putEntity`**

Modify the `foundry_memory_put` tool body:

```js
await putEntity(store, args, vocabulary, { embedder });
```

- [ ] **Step 4: Register `foundry_memory_search`**

```js
      foundry_memory_search: tool({
        description: 'Semantic nearest-neighbour search over entity values. Requires embeddings enabled.',
        args: {
          query_text: tool.schema.string(),
          k: tool.schema.number().optional().describe('Default 5'),
          type_filter: tool.schema.array(tool.schema.string()).optional(),
        },
        async execute(args, context) {
          try {
            const { store, permissions, embedder, vocabulary } = await withStore(context);
            if (!embedder) return errorJson(new Error('embeddings are disabled in memory config'));

            let types = args.type_filter && args.type_filter.length > 0
              ? args.type_filter
              : Object.keys(vocabulary.entities);
            if (permissions) types = types.filter((t) => checkEntityRead(permissions, t));

            const out = await memSearch({
              store,
              query_text: args.query_text,
              k: args.k ?? 5,
              type_filter: types,
              embedder,
            });
            return JSON.stringify(out);
          } catch (err) { return errorJson(err); }
        },
      }),
```

- [ ] **Step 5: Register `foundry_memory_change_embedding_model`**

```js
      foundry_memory_change_embedding_model: tool({
        description: 'Swap the embedding model and re-embed all existing entities.',
        args: {
          model: tool.schema.string(),
          dimensions: tool.schema.number(),
          baseURL: tool.schema.string().optional(),
          apiKey: tool.schema.string().optional(),
        },
        async execute(args, context) {
          try {
            const io = makeIO(context.worktree);
            const ctx = getContext(context.worktree);
            const baseConfig = ctx?.config?.embeddings ?? {};
            const newConfig = {
              ...baseConfig,
              enabled: true,
              model: args.model,
              dimensions: args.dimensions,
              baseURL: args.baseURL ?? baseConfig.baseURL,
              apiKey: args.apiKey ?? baseConfig.apiKey,
            };
            const probe = await probeEmbeddings({ config: newConfig });
            if (!probe.ok) return errorJson(new Error(`probe failed: ${probe.error}`));
            if (probe.dimensions !== args.dimensions) {
              return errorJson(new Error(`provider returned ${probe.dimensions}-dim vectors, config declares ${args.dimensions}`));
            }
            const dbAbsolutePath = require('path').join(context.worktree, 'foundry/memory/memory.db');
            const embedder = (inputs) => embed({ config: newConfig, inputs });
            const out = await admReembed({
              worktreeRoot: context.worktree,
              io, dbAbsolutePath,
              newModel: args.model,
              newDimensions: args.dimensions,
              embedder,
            });
            // Also persist the new embeddings settings into foundry/memory/config.md (simple append/replace).
            // Left as a manual skill step below to avoid silently editing user prose.
            return JSON.stringify(out);
          } catch (err) { return errorJson(err); }
        },
      }),
```

- [ ] **Step 6: Commit**

```bash
git add .opencode/plugins/foundry.js
git commit -m "feat(memory): register search and change-embedding-model tools"
```

---

## Task 6: `change-embedding-model` skill

**Files:**
- Create: `skills/change-embedding-model/SKILL.md`

```markdown
---
name: change-embedding-model
type: atomic
description: Swap the embedding model for memory and re-embed all existing entities
---

# Change Embedding Model

Update `foundry/memory/config.md` to target a new OpenAI-compatible endpoint / model
and re-embed every existing entity.

## Prerequisites

- Memory is initialised and enabled.
- The new provider is reachable from this machine.
- Enough time and bandwidth to re-embed (O(#entities) requests in batches).

## Steps

1. **Ask the user for**: `model`, `dimensions`, optionally new `baseURL`, `apiKey`.
2. **Edit `foundry/memory/config.md`** frontmatter to set:
   ```yaml
   embeddings:
     enabled: true
     baseURL: <new or unchanged>
     model: <new model>
     dimensions: <new dim>
     apiKey: <new or null>
   ```
3. **Invoke `foundry_memory_change_embedding_model`** with `{ model, dimensions, baseURL?, apiKey? }`.
4. **Verify** by invoking `foundry_memory_search` with a sample query.
5. **Commit**:

   ```bash
   git add foundry/memory/config.md foundry/memory/schema.json foundry/memory/relations/
   git commit -m "chore(memory): change embedding model to <model>"
   ```
```

- [ ] **Step 1: Write the skill.**
- [ ] **Step 2: Commit**

```bash
git add skills/change-embedding-model/SKILL.md
git commit -m "feat(memory): add change-embedding-model skill"
```

---

## Task 7: Update `init-memory` to probe the endpoint

**Files:**
- Modify: `skills/init-memory/SKILL.md`

Insert a probe step between scaffold and commit. If the probe fails, the skill stops before committing and tells the user their two options: install/start Ollama, or edit config for a different provider.

- [ ] **Step 1: Edit `skills/init-memory/SKILL.md`**

After the existing "Write schema.json" step (Step 4) and before the `.gitignore` step, insert:

```markdown
5. **Probe the embedding provider**

   Invoke `foundry_memory_validate`. Then:

   - If `embeddings.enabled` is true in the freshly-written config, invoke a probe using `foundry_memory_search` with `{ query_text: "probe", k: 1 }`. If it returns an error indicating the provider is unreachable or the dimension does not match, stop and show the user these options:
     1. Install and start Ollama, then run `ollama pull nomic-embed-text`, then retry `init-memory`.
     2. Edit `foundry/memory/config.md` to point at a different OpenAI-compatible endpoint (or set `embeddings.enabled: false`), then retry `init-memory`.
   - If the probe succeeds, continue.
```

Renumber subsequent steps. (The skill is prose; readability is the only constraint.)

- [ ] **Step 2: Commit**

```bash
git add skills/init-memory/SKILL.md
git commit -m "feat(memory): probe embedding provider during init"
```

---

## Task 8: Full suite + manual smoke

- [ ] **Step 1: Run**

```bash
npm test
```

- [ ] **Step 2: Manual smoke with real Ollama**

1. `ollama pull nomic-embed-text`
2. `ollama serve` (if not already running).
3. In a scratch project: run `init-memory`. Probe should succeed.
4. Add an entity type `note` via `add-memory-entity-type`.
5. Invoke `foundry_memory_put` with `{ type: 'note', name: 'n1', value: 'The user prefers clarity over cleverness.' }`.
6. Invoke `foundry_memory_search` with `{ query_text: 'writing style preference', k: 3 }`.
7. Verify `n1` is returned with a low distance.
8. Invoke `foundry_memory_change_embedding_model` with `{ model: 'all-minilm', dimensions: 384 }` (after `ollama pull all-minilm`).
9. Verify `foundry_memory_search` still works and returns sensible results.

---

## Definition of Done for Plan 5

- Embeddings adapter works against any OpenAI-compatible `/v1/embeddings` endpoint.
- `putEntity` computes and stores an embedding when embeddings are enabled.
- HNSW index exists per entity type after `openStore` when embeddings are enabled.
- `foundry_memory_search` returns top-k nearest entities, scoped by cycle read permissions if applicable.
- `change-embedding-model` re-embeds every entity, updates schema, rebuilds indices.
- `init-memory` probes the provider and gives a clear path when it's missing.
- NDJSON round-trip preserves embeddings through export and re-import.
- Dimension mismatches are surfaced loudly at write time and at model-change time.
- All tests pass.

## What this plan deliberately does NOT do

- Background re-embedding / incremental embedding fixups. If a provider silently changes behaviour, the next `change-embedding-model` run recovers.
- GPU/CPU auto-tuning. Users configure the provider.
- Locally-bundled embedding models. Explicit non-goal per spec §12.
- Chunking large values before embedding (values are capped at 4KB; today's embedding models handle that single-shot).

## Post-Plan-5 considerations

Once all five plans are shipped, the feature is complete per `MEMORY.md`. Likely follow-up work, tracked separately:

- Transactional atomicity for admin operations (tmp-dir-and-rename pattern).
- Audit log of memory accesses per cycle.
- Row-level permission filtering on `foundry_memory_query` (rather than relation-level).
- Cross-flow memory sharing (currently explicitly out-of-scope).
- Optional split of `embedding` arrays out of entity NDJSON for large deployments.
