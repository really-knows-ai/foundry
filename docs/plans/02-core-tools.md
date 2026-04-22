# Flow Memory — Plan 2: Core read/write tools

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce the Cozo-on-SQLite backend, wire NDJSON ↔ Cozo round-tripping, expose cycle-facing write and read tools through the OpenCode plugin, and implement the auto-sync trigger for direct out-of-cycle writes. Permission scoping by cycle is stubbed (passes through) and fully wired in Plan 4. No embeddings in this plan.

**Architecture:** `scripts/lib/memory/cozo.js` owns the `CozoDb` handle and relation DDL. `writes.js`, `reads.js`, `query.js` are thin, test-driven wrappers over Cozo. `store.js` orchestrates lifecycle (open on first use, close on plugin dispose, checkpoint+export on sync). The plugin registers seven tools (`put`, `relate`, `unrelate`, `get`, `list`, `neighbours`, `query`). Tests use a real in-process Cozo on a temp SQLite file.

**Tech Stack:** Everything from P1, plus `cozo-node` (CommonJS; imported via `createRequire`). Node ≥18.3.

**Spec reference:** `MEMORY.md` §§6, 7, 10.2.

---

## File Structure

**Created:**
- `scripts/lib/memory/cozo.js` — open/close, checkpoint, relation DDL from schema.
- `scripts/lib/memory/store.js` — high-level lifecycle: load from NDJSON on first open, export to NDJSON on sync.
- `scripts/lib/memory/writes.js` — `put`, `relate`, `unrelate` with validation.
- `scripts/lib/memory/reads.js` — `get`, `list`, `neighbours`.
- `scripts/lib/memory/query.js` — Datalog read-only query.
- `scripts/lib/memory/validate.js` — write-time argument validation.
- `tests/lib/memory/cozo.test.js`
- `tests/lib/memory/store.test.js`
- `tests/lib/memory/writes.test.js`
- `tests/lib/memory/reads.test.js`
- `tests/lib/memory/query.test.js`
- `tests/lib/memory/validate.test.js`

**Modified:**
- `package.json` — adds `cozo-node`.
- `.opencode/plugins/foundry.js` — registers seven memory tools.
- `tests/plugin/memory-tools.test.js` — plugin-level tests for tool registration and basic round-trip.

---

## Task 1: Add `cozo-node` dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install**

```bash
npm install cozo-node@^0.7
```

- [ ] **Step 2: Verify import works**

Create `tests/lib/memory/cozo-smoke.test.js`:

```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { CozoDb } = require('cozo-node');

describe('cozo-node smoke test', () => {
  it('opens a sqlite-backed db and runs trivial query', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cozo-smoke-'));
    const db = new CozoDb('sqlite', join(dir, 'test.db'));
    try {
      const res = await db.run('?[x] := x = 1');
      assert.equal(res.rows[0][0], 1);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
```

Run: `node --test tests/lib/memory/cozo-smoke.test.js` → PASS.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json tests/lib/memory/cozo-smoke.test.js
git commit -m "build(memory): add cozo-node dependency"
```

---

## Task 2: Cozo wrapper — open, close, checkpoint, DDL

**Files:**
- Create: `scripts/lib/memory/cozo.js`
- Test: `tests/lib/memory/cozo.test.js`

Responsibilities:
- Open a Cozo handle against `foundry/memory/memory.db` (sqlite backend).
- Create stored relations driven by `schema.json` (one relation per entity type, one per edge type).
- Checkpoint WAL on demand.
- Drop a relation (needed later when dropping a type).

Cozo relation shape for entities: `:create ent_<type> { name: String => value: String, embedding: <F32; N>? }`. For this plan embeddings are deferred — we model `embedding: List?` (optional, nullable) so the column exists but is unused.

Cozo relation shape for edges: `:create edge_<type> { from_type: String, from_name: String, to_type: String, to_name: String }`. All four form the key.

- [ ] **Step 1: Write the failing test**

`tests/lib/memory/cozo.test.js`:

```js
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openMemoryDb, createEntityRelation, createEdgeRelation, dropRelation, listRelations, checkpoint, closeMemoryDb } from '../../../scripts/lib/memory/cozo.js';

describe('cozo wrapper', () => {
  let dir, db;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'cozo-w-'));
    db = openMemoryDb(join(dir, 'memory.db'));
  });
  after(() => {
    closeMemoryDb(db);
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates an entity relation', async () => {
    await createEntityRelation(db, 'class');
    const rels = await listRelations(db);
    assert.ok(rels.includes('ent_class'));
  });

  it('creates an edge relation', async () => {
    await createEdgeRelation(db, 'calls');
    const rels = await listRelations(db);
    assert.ok(rels.includes('edge_calls'));
  });

  it('is idempotent: creating same relation twice does not error', async () => {
    await createEntityRelation(db, 'class');
    await createEntityRelation(db, 'class');
  });

  it('drops a relation', async () => {
    await createEntityRelation(db, 'temp');
    await dropRelation(db, 'ent_temp');
    const rels = await listRelations(db);
    assert.ok(!rels.includes('ent_temp'));
  });

  it('checkpoints without error', async () => {
    await checkpoint(db);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

- [ ] **Step 3: Implement**

`scripts/lib/memory/cozo.js`:

```js
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { CozoDb } = require('cozo-node');

export function openMemoryDb(dbPath) {
  return new CozoDb('sqlite', dbPath);
}

export function closeMemoryDb(db) {
  if (db && typeof db.close === 'function') db.close();
}

function entRelName(type) { return `ent_${type}`; }
function edgeRelName(type) { return `edge_${type}`; }

async function relationExists(db, name) {
  const res = await db.run('::relations');
  return res.rows.some((r) => r[0] === name);
}

export async function listRelations(db) {
  const res = await db.run('::relations');
  return res.rows.map((r) => r[0]);
}

export async function createEntityRelation(db, type) {
  const name = entRelName(type);
  if (await relationExists(db, name)) return;
  // value: String (4KB limit enforced at write time in JS).
  // embedding: Nullable list of Float, populated by Plan 5.
  await db.run(`:create ${name} { name: String => value: String, embedding: List? default null }`);
}

export async function createEdgeRelation(db, type) {
  const name = edgeRelName(type);
  if (await relationExists(db, name)) return;
  await db.run(`:create ${name} { from_type: String, from_name: String, to_type: String, to_name: String }`);
}

export async function dropRelation(db, relationName) {
  await db.run(`::remove ${relationName}`);
}

export async function checkpoint(db) {
  // Cozo's sqlite backend: WAL checkpoint via pragma passthrough.
  // `::checkpoint` is the system op.
  try {
    await db.run('::checkpoint');
  } catch (err) {
    // Older cozo versions may not expose ::checkpoint; SQLite's own WAL autocheckpoint is acceptable.
    if (!/unknown system op/i.test(String(err))) throw err;
  }
}

export { entRelName, edgeRelName };
```

- [ ] **Step 4: Run test, verify it passes**

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/memory/cozo.js tests/lib/memory/cozo.test.js
git commit -m "feat(memory): cozo wrapper with entity/edge relation DDL"
```

---

## Task 3: Store lifecycle — load from NDJSON on open, export on sync

**Files:**
- Create: `scripts/lib/memory/store.js`
- Test: `tests/lib/memory/store.test.js`

Responsibilities:
- `openStore({ foundryDir, schema, io })`: opens Cozo, ensures every declared relation exists, imports committed NDJSON rows into Cozo.
- `syncStore({ store, io })`: checkpoints Cozo, dumps every relation to deterministic NDJSON, writes `schema.json` if version changed.
- `closeStore(store)`: closes Cozo handle.

The store is a plain object: `{ db, foundryDir, schema }`.

- [ ] **Step 1: Write the failing test**

`tests/lib/memory/store.test.js`:

```js
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
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
    readDir: async (p) => { try { return (await import('node:fs')).readdirSync(abs(p)); } catch { return []; } },
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
    const store = await openStore({ foundryDir: 'foundry', schema, io });
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
    const store = await openStore({ foundryDir: 'foundry', schema, io });
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
    const io = diskIO(root);
    const store = await openStore({ foundryDir: 'foundry', schema, io });
    await store.db.run(':put ent_class { name => value } [["com.Bar", "Another"], ["com.Aaa", "First"]]');
    await syncStore({ store, io });

    const ndjson = readFileSync(join(root, 'foundry/memory/relations/class.ndjson'), 'utf-8');
    // Sorted by name: Aaa before Bar.
    assert.match(ndjson, /^{"name":"com.Aaa","value":"First"}\n{"name":"com.Bar","value":"Another"}\n$/);
    closeStore(store);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

- [ ] **Step 3: Implement**

`scripts/lib/memory/store.js`:

```js
import { join } from 'path';
import { memoryPaths } from './paths.js';
import { openMemoryDb, closeMemoryDb, createEntityRelation, createEdgeRelation, checkpoint, entRelName, edgeRelName } from './cozo.js';
import { serialiseEntityRows, serialiseEdgeRows, parseEntityRows, parseEdgeRows } from './ndjson.js';

export async function openStore({ foundryDir, schema, io }) {
  const p = memoryPaths(foundryDir);
  if (!(await io.exists(p.root))) await io.mkdir(p.root);
  if (!(await io.exists(p.relationsDir))) await io.mkdir(p.relationsDir);

  const db = openMemoryDb(require('path').join(require('path').resolve(), p.db));
  // Note: Cozo's sqlite backend wants an absolute-or-cwd-relative path; callers pass io with a
  // worktree context, so we resolve relative to cwd. Plugin callers pass context.worktree to
  // makeStore (see plugin wiring in Task 9) which chdir is NOT performed — we use absolute path.
  // The plugin uses `openStoreForWorktree` which constructs absolute path explicitly.

  // Actually: to avoid cwd coupling here, accept dbAbsolutePath in opts. Callers resolve.
  // Rewrite below: receive dbAbsolutePath via opts (plugin supplies it; tests supply it).
  closeMemoryDb(db);
  throw new Error('openStore must be called with dbAbsolutePath; see openStore below');
}
```

Realised mid-write: `openStore` should accept `dbAbsolutePath` rather than re-deriving from `foundryDir`+paths, because tests and the plugin both already know the absolute path. Rewrite:

```js
import { join } from 'path';
import { memoryPaths } from './paths.js';
import { openMemoryDb, closeMemoryDb, createEntityRelation, createEdgeRelation, checkpoint, entRelName, edgeRelName } from './cozo.js';
import { serialiseEntityRows, serialiseEdgeRows, parseEntityRows, parseEdgeRows } from './ndjson.js';

async function importRelation(db, relName, rows, kind) {
  if (rows.length === 0) return;
  if (kind === 'entity') {
    const data = rows.map((r) => `["${escape(r.name)}", "${escape(r.value)}"]`).join(', ');
    await db.run(`:put ${relName} { name => value } [${data}]`);
  } else {
    const data = rows.map((r) => `["${escape(r.from_type)}", "${escape(r.from_name)}", "${escape(r.to_type)}", "${escape(r.to_name)}"]`).join(', ');
    await db.run(`:put ${relName} { from_type, from_name, to_type, to_name } [${data}]`);
  }
}

function escape(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

async function exportEntityRelation(db, type) {
  const res = await db.run(`?[name, value] := *ent_${type}{name, value}`);
  return res.rows.map(([name, value]) => ({ name, value }));
}

async function exportEdgeRelation(db, type) {
  const res = await db.run(`?[ft, fn, tt, tn] := *edge_${type}{from_type: ft, from_name: fn, to_type: tt, to_name: tn}`);
  return res.rows.map(([ft, fn, tt, tn]) => ({ from_type: ft, from_name: fn, to_type: tt, to_name: tn }));
}

export async function openStore({ foundryDir, schema, io, dbAbsolutePath }) {
  const p = memoryPaths(foundryDir);
  if (!(await io.exists(p.root))) await io.mkdir(p.root);
  if (!(await io.exists(p.relationsDir))) await io.mkdir(p.relationsDir);

  const db = openMemoryDb(dbAbsolutePath);

  for (const type of Object.keys(schema.entities)) {
    await createEntityRelation(db, type);
    const file = p.relationFile(type);
    if (await io.exists(file)) {
      const text = await io.readFile(file);
      const rows = parseEntityRows(text);
      await importRelation(db, entRelName(type), rows, 'entity');
    }
  }
  for (const type of Object.keys(schema.edges)) {
    await createEdgeRelation(db, type);
    const file = p.relationFile(type);
    if (await io.exists(file)) {
      const text = await io.readFile(file);
      const rows = parseEdgeRows(text);
      await importRelation(db, edgeRelName(type), rows, 'edge');
    }
  }

  return { db, foundryDir, schema, paths: p };
}

export async function syncStore({ store, io }) {
  const { db, schema, paths: p } = store;
  await checkpoint(db);
  for (const type of Object.keys(schema.entities)) {
    const rows = await exportEntityRelation(db, type);
    await io.writeFile(p.relationFile(type), serialiseEntityRows(rows));
  }
  for (const type of Object.keys(schema.edges)) {
    const rows = await exportEdgeRelation(db, type);
    await io.writeFile(p.relationFile(type), serialiseEdgeRows(rows));
  }
}

export function closeStore(store) {
  closeMemoryDb(store.db);
}
```

Update the test to pass `dbAbsolutePath` (add `dbAbsolutePath: join(root, 'foundry/memory/memory.db')` to each `openStore` call).

- [ ] **Step 4: Run test, verify it passes**

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/memory/store.js tests/lib/memory/store.test.js
git commit -m "feat(memory): store lifecycle with NDJSON import/export"
```

---

## Task 4: Write-time validation

**Files:**
- Create: `scripts/lib/memory/validate.js`
- Test: `tests/lib/memory/validate.test.js`

Pure functions that validate a write request against the loaded `vocabulary`. Callers (write tools) invoke these before touching Cozo.

- [ ] **Step 1: Write the failing test**

`tests/lib/memory/validate.test.js`:

```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateEntityWrite, validateEdgeWrite, MAX_VALUE_BYTES } from '../../../scripts/lib/memory/validate.js';

const vocab = {
  entities: { class: {}, method: {} },
  edges: { calls: { sources: ['class', 'method'], targets: ['class', 'method'] }, references: { sources: 'any', targets: 'any' } },
};

describe('validateEntityWrite', () => {
  it('accepts declared type with non-empty name and small value', () => {
    validateEntityWrite({ type: 'class', name: 'x', value: 'ok' }, vocab);
  });

  it('rejects undeclared type', () => {
    assert.throws(() => validateEntityWrite({ type: 'ghost', name: 'x', value: 'v' }, vocab), /not declared/);
  });

  it('rejects empty name', () => {
    assert.throws(() => validateEntityWrite({ type: 'class', name: '', value: 'v' }, vocab), /name/);
  });

  it('rejects non-string value', () => {
    assert.throws(() => validateEntityWrite({ type: 'class', name: 'x', value: 123 }, vocab), /value/);
  });

  it('rejects value over 4KB', () => {
    const big = 'x'.repeat(MAX_VALUE_BYTES + 1);
    assert.throws(() => validateEntityWrite({ type: 'class', name: 'x', value: big }, vocab), /4KB|too large/i);
  });
});

describe('validateEdgeWrite', () => {
  it('accepts declared edge with matching source/target types', () => {
    validateEdgeWrite({ edge_type: 'calls', from_type: 'class', from_name: 'a', to_type: 'method', to_name: 'b' }, vocab);
  });

  it('rejects undeclared edge type', () => {
    assert.throws(() => validateEdgeWrite({ edge_type: 'wat', from_type: 'class', from_name: 'a', to_type: 'method', to_name: 'b' }, vocab), /not declared/);
  });

  it('rejects from_type outside sources list', () => {
    assert.throws(() => validateEdgeWrite({ edge_type: 'calls', from_type: 'table', from_name: 'a', to_type: 'method', to_name: 'b' }, vocab), /source/);
  });

  it('rejects to_type outside targets list', () => {
    assert.throws(() => validateEdgeWrite({ edge_type: 'calls', from_type: 'class', from_name: 'a', to_type: 'table', to_name: 'b' }, vocab), /target/);
  });

  it("allows 'any' source/target on narrative edges", () => {
    validateEdgeWrite({ edge_type: 'references', from_type: 'class', from_name: 'a', to_type: 'table', to_name: 'b' }, vocab);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

- [ ] **Step 3: Implement**

`scripts/lib/memory/validate.js`:

```js
export const MAX_VALUE_BYTES = 4096;

function byteLen(s) {
  return Buffer.byteLength(s, 'utf8');
}

export function validateEntityWrite({ type, name, value }, vocabulary) {
  if (!vocabulary.entities[type]) {
    throw new Error(`entity type '${type}' is not declared`);
  }
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error(`entity name must be a non-empty string`);
  }
  if (typeof value !== 'string') {
    throw new Error(`entity value must be a string`);
  }
  if (byteLen(value) > MAX_VALUE_BYTES) {
    throw new Error(`entity value is too large: ${byteLen(value)} bytes exceeds 4KB limit`);
  }
}

export function validateEdgeWrite({ edge_type, from_type, from_name, to_type, to_name }, vocabulary) {
  const edge = vocabulary.edges[edge_type];
  if (!edge) {
    throw new Error(`edge type '${edge_type}' is not declared`);
  }
  if (!vocabulary.entities[from_type]) {
    throw new Error(`edge source type '${from_type}' is not a declared entity type`);
  }
  if (!vocabulary.entities[to_type]) {
    throw new Error(`edge target type '${to_type}' is not a declared entity type`);
  }
  if (edge.sources !== 'any' && !edge.sources.includes(from_type)) {
    throw new Error(`edge '${edge_type}' does not permit source type '${from_type}' (allowed: ${edge.sources.join(', ')})`);
  }
  if (edge.targets !== 'any' && !edge.targets.includes(to_type)) {
    throw new Error(`edge '${edge_type}' does not permit target type '${to_type}' (allowed: ${edge.targets.join(', ')})`);
  }
  for (const [k, v] of Object.entries({ from_name, to_name })) {
    if (typeof v !== 'string' || v.length === 0) throw new Error(`${k} must be a non-empty string`);
  }
}
```

- [ ] **Step 4: Run test, verify it passes**

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/memory/validate.js tests/lib/memory/validate.test.js
git commit -m "feat(memory): write-time validation for entities and edges"
```

---

## Task 5: Write tools — put, relate, unrelate

**Files:**
- Create: `scripts/lib/memory/writes.js`
- Test: `tests/lib/memory/writes.test.js`

Each write:
1. Validates (Task 4).
2. Upserts into Cozo (`:put` for entities and edges; `:rm` for unrelate).
3. Does NOT sync here — sync is orchestrated by the caller (plugin tool body or cycle finaliser). This keeps the library pure and the trigger policy in the plugin layer.

- [ ] **Step 1: Write the failing test**

`tests/lib/memory/writes.test.js`:

```js
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore, closeStore } from '../../../scripts/lib/memory/store.js';
import { putEntity, relate, unrelate } from '../../../scripts/lib/memory/writes.js';

const vocab = {
  entities: { class: {}, method: {} },
  edges: { calls: { sources: ['class', 'method'], targets: ['class', 'method'] } },
};
const schema = {
  version: 1,
  entities: { class: { frontmatterHash: '_' }, method: { frontmatterHash: '_' } },
  edges: { calls: { frontmatterHash: '_' } },
  embeddings: null,
};

function diskIO(root) {
  const { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } = require('node:fs');
  const abs = (p) => join(root, p);
  return {
    exists: async (p) => existsSync(abs(p)),
    readFile: async (p) => readFileSync(abs(p), 'utf-8'),
    writeFile: async (p, c) => { mkdirSync(join(abs(p), '..'), { recursive: true }); writeFileSync(abs(p), c, 'utf-8'); },
    readDir: async (p) => { try { return readdirSync(abs(p)); } catch { return []; } },
    mkdir: async (p) => mkdirSync(abs(p), { recursive: true }),
  };
}

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
```

- [ ] **Step 2: Run test, verify it fails**

- [ ] **Step 3: Implement**

`scripts/lib/memory/writes.js`:

```js
import { entRelName, edgeRelName } from './cozo.js';
import { validateEntityWrite, validateEdgeWrite } from './validate.js';

function cozoStringLit(s) {
  return '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n') + '"';
}

export async function putEntity(store, { type, name, value }, vocabulary) {
  validateEntityWrite({ type, name, value }, vocabulary);
  const rel = entRelName(type);
  const row = `[${cozoStringLit(name)}, ${cozoStringLit(value)}]`;
  await store.db.run(`:put ${rel} { name => value } [${row}]`);
}

export async function relate(store, { edge_type, from_type, from_name, to_type, to_name }, vocabulary) {
  validateEdgeWrite({ edge_type, from_type, from_name, to_type, to_name }, vocabulary);
  const rel = edgeRelName(edge_type);
  const row = `[${cozoStringLit(from_type)}, ${cozoStringLit(from_name)}, ${cozoStringLit(to_type)}, ${cozoStringLit(to_name)}]`;
  await store.db.run(`:put ${rel} { from_type, from_name, to_type, to_name } [${row}]`);
}

export async function unrelate(store, { edge_type, from_type, from_name, to_type, to_name }, vocabulary) {
  validateEdgeWrite({ edge_type, from_type, from_name, to_type, to_name }, vocabulary);
  const rel = edgeRelName(edge_type);
  const row = `[${cozoStringLit(from_type)}, ${cozoStringLit(from_name)}, ${cozoStringLit(to_type)}, ${cozoStringLit(to_name)}]`;
  await store.db.run(`:rm ${rel} { from_type, from_name, to_type, to_name } [${row}]`);
}
```

- [ ] **Step 4: Run test, verify it passes**

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/memory/writes.js tests/lib/memory/writes.test.js
git commit -m "feat(memory): write tools (put, relate, unrelate)"
```

---

## Task 6: Read tools — get, list, neighbours

**Files:**
- Create: `scripts/lib/memory/reads.js`
- Test: `tests/lib/memory/reads.test.js`

- [ ] **Step 1: Write the failing test**

`tests/lib/memory/reads.test.js`:

```js
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore, closeStore } from '../../../scripts/lib/memory/store.js';
import { putEntity, relate } from '../../../scripts/lib/memory/writes.js';
import { getEntity, listEntities, neighbours } from '../../../scripts/lib/memory/reads.js';

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

function diskIO(root) {
  const fs = require('node:fs');
  const abs = (p) => join(root, p);
  return {
    exists: async (p) => fs.existsSync(abs(p)),
    readFile: async (p) => fs.readFileSync(abs(p), 'utf-8'),
    writeFile: async (p, c) => { fs.mkdirSync(join(abs(p), '..'), { recursive: true }); fs.writeFileSync(abs(p), c, 'utf-8'); },
    readDir: async (p) => { try { return fs.readdirSync(abs(p)); } catch { return []; } },
    mkdir: async (p) => fs.mkdirSync(abs(p), { recursive: true }),
  };
}

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
```

- [ ] **Step 2: Run test, verify it fails**

- [ ] **Step 3: Implement**

`scripts/lib/memory/reads.js`:

```js
import { entRelName, edgeRelName } from './cozo.js';

function cozoLit(s) {
  return '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

export async function getEntity(store, { type, name }) {
  const rel = entRelName(type);
  const res = await store.db.run(`?[v] := *${rel}{name: ${cozoLit(name)}, value: v}`);
  if (res.rows.length === 0) return null;
  return { type, name, value: res.rows[0][0] };
}

export async function listEntities(store, { type }) {
  const rel = entRelName(type);
  const res = await store.db.run(`?[n, v] := *${rel}{name: n, value: v}`);
  return res.rows.map(([name, value]) => ({ type, name, value }));
}

export async function neighbours(store, { type, name, depth = 1, edge_types }, vocabulary) {
  const edgeTypes = edge_types && edge_types.length > 0
    ? edge_types.filter((t) => vocabulary.edges[t])
    : Object.keys(vocabulary.edges);

  const visited = new Map(); // `${type}/${name}` -> {type, name, value}
  const edgesOut = [];
  const frontier = new Map();
  frontier.set(`${type}/${name}`, { type, name });

  // Seed the start entity's value.
  const start = await getEntity(store, { type, name });
  if (start) visited.set(`${type}/${name}`, start);
  else visited.set(`${type}/${name}`, { type, name, value: null });

  for (let d = 0; d < depth; d++) {
    const nextFrontier = new Map();
    for (const et of edgeTypes) {
      const rel = edgeRelName(et);
      for (const [, node] of frontier) {
        // Outgoing
        {
          const res = await store.db.run(
            `?[tt, tn] := *${rel}{from_type: ${cozoLit(node.type)}, from_name: ${cozoLit(node.name)}, to_type: tt, to_name: tn}`,
          );
          for (const [tt, tn] of res.rows) {
            edgesOut.push({ edge_type: et, from_type: node.type, from_name: node.name, to_type: tt, to_name: tn });
            const key = `${tt}/${tn}`;
            if (!visited.has(key)) nextFrontier.set(key, { type: tt, name: tn });
          }
        }
        // Incoming
        {
          const res = await store.db.run(
            `?[ft, fn] := *${rel}{from_type: ft, from_name: fn, to_type: ${cozoLit(node.type)}, to_name: ${cozoLit(node.name)}}`,
          );
          for (const [ft, fn] of res.rows) {
            edgesOut.push({ edge_type: et, from_type: ft, from_name: fn, to_type: node.type, to_name: node.name });
            const key = `${ft}/${fn}`;
            if (!visited.has(key)) nextFrontier.set(key, { type: ft, name: fn });
          }
        }
      }
    }
    // Resolve values for new frontier nodes and advance.
    for (const [key, node] of nextFrontier) {
      if (visited.has(key)) continue;
      const ent = await getEntity(store, node);
      visited.set(key, ent ?? { ...node, value: null });
    }
    frontier.clear();
    for (const [k, v] of nextFrontier) frontier.set(k, v);
    if (frontier.size === 0) break;
  }

  // Dedupe edges on composite key.
  const edgeKey = (e) => [e.edge_type, e.from_type, e.from_name, e.to_type, e.to_name].join('\u0000');
  const seen = new Set();
  const edges = [];
  for (const e of edgesOut) {
    const k = edgeKey(e);
    if (seen.has(k)) continue;
    seen.add(k);
    edges.push(e);
  }

  return { entities: [...visited.values()], edges };
}
```

- [ ] **Step 4: Run test, verify it passes**

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/memory/reads.js tests/lib/memory/reads.test.js
git commit -m "feat(memory): read tools (get, list, neighbours)"
```

---

## Task 7: Datalog query tool (read-only)

**Files:**
- Create: `scripts/lib/memory/query.js`
- Test: `tests/lib/memory/query.test.js`

Exposes arbitrary Cozo queries. Enforces read-only by rejecting inputs that contain system ops or write-assert tokens (`:put`, `:rm`, `:create`, `::remove`, `:replace`, `:ensure`, `:ensure_not`). Returns rows as arrays of structured records using `headers` from Cozo's response.

- [ ] **Step 1: Write the failing test**

`tests/lib/memory/query.test.js`:

```js
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore, closeStore } from '../../../scripts/lib/memory/store.js';
import { putEntity } from '../../../scripts/lib/memory/writes.js';
import { runQuery } from '../../../scripts/lib/memory/query.js';

const vocab = { entities: { class: {} }, edges: {} };
const schema = { version: 1, entities: { class: {} }, edges: {}, embeddings: null };

function diskIO(root) {
  const fs = require('node:fs');
  const abs = (p) => join(root, p);
  return {
    exists: async (p) => fs.existsSync(abs(p)),
    readFile: async (p) => fs.readFileSync(abs(p), 'utf-8'),
    writeFile: async (p, c) => { fs.mkdirSync(join(abs(p), '..'), { recursive: true }); fs.writeFileSync(abs(p), c, 'utf-8'); },
    readDir: async (p) => { try { return fs.readdirSync(abs(p)); } catch { return []; } },
    mkdir: async (p) => fs.mkdirSync(abs(p), { recursive: true }),
  };
}

describe('query', () => {
  let root, store;
  before(async () => {
    root = mkdtempSync(join(tmpdir(), 'q-'));
    mkdirSync(join(root, 'foundry/memory/relations'), { recursive: true });
    store = await openStore({ foundryDir: 'foundry', schema, io: diskIO(root), dbAbsolutePath: join(root, 'memory.db') });
    await putEntity(store, { type: 'class', name: 'com.A', value: 'va' }, vocab);
  });
  after(() => { closeStore(store); rmSync(root, { recursive: true, force: true }); });

  it('returns structured rows on read', async () => {
    const out = await runQuery(store, '?[n, v] := *ent_class{name: n, value: v}');
    assert.equal(out.rows.length, 1);
    assert.deepEqual(out.rows[0], { n: 'com.A', v: 'va' });
  });

  it('rejects writes', async () => {
    await assert.rejects(() => runQuery(store, ':put ent_class { name => value } [["x", "y"]]'), /read-only/i);
    await assert.rejects(() => runQuery(store, ':rm ent_class { name } [["com.A"]]'), /read-only/i);
    await assert.rejects(() => runQuery(store, ':create bad { a: Int }'), /read-only/i);
  });

  it('surfaces cozo errors clearly', async () => {
    await assert.rejects(() => runQuery(store, '?[x] := *nonexistent{x}'), /nonexistent|not found|error/i);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

- [ ] **Step 3: Implement**

`scripts/lib/memory/query.js`:

```js
const WRITE_TOKENS = /(^|\s)(:put|:rm|:create|:replace|:ensure|:ensure_not|::remove)(\s|$)/;

export async function runQuery(store, query) {
  if (typeof query !== 'string') throw new Error('query must be a string');
  if (WRITE_TOKENS.test(query)) {
    throw new Error('query is read-only; write assertions (:put, :rm, :create, etc.) are not permitted');
  }
  let res;
  try {
    res = await store.db.run(query);
  } catch (err) {
    throw new Error(`query error: ${err.message ?? err}`);
  }
  const headers = res.headers ?? [];
  const rows = res.rows.map((row) => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = row[i]; });
    return obj;
  });
  return { headers, rows };
}
```

- [ ] **Step 4: Run test, verify it passes**

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/memory/query.js tests/lib/memory/query.test.js
git commit -m "feat(memory): read-only Datalog query tool"
```

---

## Task 8: Singleton store accessor for plugin use

**Files:**
- Create: `scripts/lib/memory/singleton.js`
- Test: `tests/lib/memory/singleton.test.js`

The plugin needs one store per worktree, opened lazily on first memory-tool invocation. Provide `getOrOpenStore({ worktreeRoot, io })` and `disposeStores()`.

- [ ] **Step 1: Write the failing test**

`tests/lib/memory/singleton.test.js`:

```js
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getOrOpenStore, disposeStores } from '../../../scripts/lib/memory/singleton.js';

function diskIO(root) {
  const fs = require('node:fs');
  const abs = (p) => join(root, p);
  return {
    exists: async (p) => fs.existsSync(abs(p)),
    readFile: async (p) => fs.readFileSync(abs(p), 'utf-8'),
    writeFile: async (p, c) => { fs.mkdirSync(join(abs(p), '..'), { recursive: true }); fs.writeFileSync(abs(p), c, 'utf-8'); },
    readDir: async (p) => { try { return fs.readdirSync(abs(p)); } catch { return []; } },
    mkdir: async (p) => fs.mkdirSync(abs(p), { recursive: true }),
  };
}

describe('singleton store', () => {
  let root;
  after(() => { disposeStores(); if (root) rmSync(root, { recursive: true, force: true }); });

  it('opens once and reuses', async () => {
    root = mkdtempSync(join(tmpdir(), 'sing-'));
    mkdirSync(join(root, 'foundry/memory/entities'), { recursive: true });
    mkdirSync(join(root, 'foundry/memory/edges'), { recursive: true });
    mkdirSync(join(root, 'foundry/memory/relations'), { recursive: true });
    writeFileSync(join(root, 'foundry/memory/config.md'), '---\nenabled: true\n---\n');
    writeFileSync(join(root, 'foundry/memory/schema.json'), '{"version":1,"entities":{},"edges":{},"embeddings":null}\n');

    const s1 = await getOrOpenStore({ worktreeRoot: root, io: diskIO(root) });
    const s2 = await getOrOpenStore({ worktreeRoot: root, io: diskIO(root) });
    assert.strictEqual(s1, s2);
  });

  it('throws if memory not enabled', async () => {
    const r2 = mkdtempSync(join(tmpdir(), 'sing2-'));
    mkdirSync(join(r2, 'foundry/memory'), { recursive: true });
    writeFileSync(join(r2, 'foundry/memory/config.md'), '---\nenabled: false\n---\n');
    writeFileSync(join(r2, 'foundry/memory/schema.json'), '{"version":1,"entities":{},"edges":{},"embeddings":null}\n');
    await assert.rejects(() => getOrOpenStore({ worktreeRoot: r2, io: diskIO(r2) }), /not enabled/i);
    rmSync(r2, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

- [ ] **Step 3: Implement**

`scripts/lib/memory/singleton.js`:

```js
import { join } from 'path';
import { loadMemoryConfig } from './config.js';
import { loadSchema } from './schema.js';
import { loadVocabulary } from './types.js';
import { detectDrift } from './drift.js';
import { openStore, closeStore } from './store.js';
import { memoryPaths } from './paths.js';

const stores = new Map(); // worktreeRoot -> { store, vocabulary, config, schema }

export async function getOrOpenStore({ worktreeRoot, io }) {
  if (stores.has(worktreeRoot)) return stores.get(worktreeRoot).store;

  const config = await loadMemoryConfig('foundry', io);
  if (!config.enabled) {
    throw new Error('memory is not enabled in foundry/memory/config.md');
  }
  const schema = await loadSchema('foundry', io);
  const vocabulary = await loadVocabulary('foundry', io);
  const drift = detectDrift({ vocabulary, schema });
  if (drift.hasDrift) {
    const msg = drift.items
      .map((d) => `  - [${d.typeFamily}] ${d.typeName}: ${d.message} → use skill: ${d.suggestedSkill}`)
      .join('\n');
    throw new Error(`memory schema drift detected; refusing to open store:\n${msg}`);
  }

  const dbAbsolutePath = join(worktreeRoot, memoryPaths('foundry').db);
  const store = await openStore({ foundryDir: 'foundry', schema, io, dbAbsolutePath });
  stores.set(worktreeRoot, { store, vocabulary, config, schema });
  return store;
}

export function getContext(worktreeRoot) {
  return stores.get(worktreeRoot) ?? null;
}

export function disposeStores() {
  for (const [, ctx] of stores) closeStore(ctx.store);
  stores.clear();
}
```

- [ ] **Step 4: Run test, verify it passes**

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/memory/singleton.js tests/lib/memory/singleton.test.js
git commit -m "feat(memory): singleton store accessor with drift enforcement"
```

---

## Task 9: Register seven memory tools in the plugin

**Files:**
- Modify: `.opencode/plugins/foundry.js`
- Create: `tests/plugin/memory-tools.test.js`

Register in `plugin.tool`:
- `foundry_memory_put`
- `foundry_memory_relate`
- `foundry_memory_unrelate`
- `foundry_memory_get`
- `foundry_memory_list`
- `foundry_memory_neighbours`
- `foundry_memory_query`

Each tool body:
1. Calls `getOrOpenStore({ worktreeRoot: context.worktree, io: makeIO(context.worktree) })`.
2. Resolves vocabulary from `getContext(context.worktree).vocabulary`.
3. Invokes the appropriate library function.
4. For write tools: after a successful write, if `context.cycle` is falsy (direct human/LLM call outside a cycle), calls `syncStore`.
5. Returns `JSON.stringify(result)` (existing convention).

- [ ] **Step 1: Write the failing plugin test**

`tests/plugin/memory-tools.test.js`:

```js
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FoundryPlugin } from '../../.opencode/plugins/foundry.js';
import { disposeStores } from '../../scripts/lib/memory/singleton.js';

async function bootPlugin(worktree) {
  const p = await FoundryPlugin({ directory: worktree });
  return p;
}

function setupWorktree() {
  const root = mkdtempSync(join(tmpdir(), 'plug-mem-'));
  mkdirSync(join(root, 'foundry/memory/entities'), { recursive: true });
  mkdirSync(join(root, 'foundry/memory/edges'), { recursive: true });
  mkdirSync(join(root, 'foundry/memory/relations'), { recursive: true });
  writeFileSync(join(root, 'foundry/memory/config.md'), '---\nenabled: true\n---\n');
  writeFileSync(join(root, 'foundry/memory/entities/class.md'),
    '---\ntype: class\n---\n\n# class\nA class.\n');
  writeFileSync(join(root, 'foundry/memory/edges/calls.md'),
    '---\ntype: calls\nsources: [class]\ntargets: [class]\n---\n\n# calls\nCall edge.\n');
  const { hashFrontmatter } = require('../../scripts/lib/memory/schema.js');
  const schema = {
    version: 1,
    entities: { class: { frontmatterHash: hashFrontmatter({ type: 'class' }) } },
    edges: { calls: { frontmatterHash: hashFrontmatter({ type: 'calls', sources: ['class'], targets: ['class'] }) } },
    embeddings: null,
  };
  writeFileSync(join(root, 'foundry/memory/schema.json'), JSON.stringify(schema, null, 2) + '\n');
  return root;
}

describe('plugin memory tools', () => {
  let root, plugin;
  before(async () => {
    root = setupWorktree();
    plugin = await bootPlugin(root);
  });
  after(() => { disposeStores(); rmSync(root, { recursive: true, force: true }); });

  it('registers all seven memory tools', () => {
    for (const name of [
      'foundry_memory_put', 'foundry_memory_relate', 'foundry_memory_unrelate',
      'foundry_memory_get', 'foundry_memory_list', 'foundry_memory_neighbours', 'foundry_memory_query',
    ]) {
      assert.ok(plugin.tool[name], `missing tool: ${name}`);
    }
  });

  it('put + get round-trips through the plugin, and syncs NDJSON when no cycle is active', async () => {
    const ctx = { worktree: root };
    await plugin.tool.foundry_memory_put.execute({ type: 'class', name: 'com.Foo', value: 'hello' }, ctx);
    const got = JSON.parse(await plugin.tool.foundry_memory_get.execute({ type: 'class', name: 'com.Foo' }, ctx));
    assert.equal(got.value, 'hello');

    // Sync trigger: committed NDJSON should reflect the write.
    const nd = readFileSync(join(root, 'foundry/memory/relations/class.ndjson'), 'utf-8');
    assert.match(nd, /com\.Foo/);
  });

  it('relate + neighbours work via the plugin', async () => {
    const ctx = { worktree: root };
    await plugin.tool.foundry_memory_put.execute({ type: 'class', name: 'com.Bar', value: 'bar' }, ctx);
    await plugin.tool.foundry_memory_relate.execute({
      from_type: 'class', from_name: 'com.Foo', edge_type: 'calls', to_type: 'class', to_name: 'com.Bar',
    }, ctx);
    const out = JSON.parse(await plugin.tool.foundry_memory_neighbours.execute({ type: 'class', name: 'com.Foo', depth: 1 }, ctx));
    assert.equal(out.edges.length, 1);
  });

  it('query rejects write queries', async () => {
    const ctx = { worktree: root };
    const out = await plugin.tool.foundry_memory_query.execute({ datalog: ':put ent_class { name => value } [["x","y"]]' }, ctx);
    assert.match(out, /error.*read-only/i);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

- [ ] **Step 3: Edit `.opencode/plugins/foundry.js`**

Add imports near the top (after existing imports):

```js
import { getOrOpenStore, getContext } from '../../scripts/lib/memory/singleton.js';
import { syncStore } from '../../scripts/lib/memory/store.js';
import { putEntity, relate as memRelate, unrelate as memUnrelate } from '../../scripts/lib/memory/writes.js';
import { getEntity, listEntities, neighbours as memNeighbours } from '../../scripts/lib/memory/reads.js';
import { runQuery } from '../../scripts/lib/memory/query.js';
```

Add helper near `makeIO`:

```js
async function withStore(context) {
  const io = makeIO(context.worktree);
  const store = await getOrOpenStore({ worktreeRoot: context.worktree, io });
  const ctx = getContext(context.worktree);
  return { io, store, vocabulary: ctx.vocabulary, syncIfOutOfCycle: async () => {
    if (!context.cycle) await syncStore({ store, io });
  }};
}

function errorJson(err) {
  return JSON.stringify({ error: err.message ?? String(err) });
}
```

In the `tool:` block, after existing entries, add:

```js
      foundry_memory_put: tool({
        description: 'Upsert an entity into flow memory. Value must be ≤4KB.',
        args: {
          type: tool.schema.string().describe('Entity type (must be declared)'),
          name: tool.schema.string().describe('Entity name (unique within type)'),
          value: tool.schema.string().describe('Free-text intrinsic description (≤4KB)'),
        },
        async execute(args, context) {
          try {
            const { store, vocabulary, syncIfOutOfCycle } = await withStore(context);
            await putEntity(store, args, vocabulary);
            await syncIfOutOfCycle();
            return JSON.stringify({ ok: true });
          } catch (err) { return errorJson(err); }
        },
      }),

      foundry_memory_relate: tool({
        description: 'Upsert an edge between two entities.',
        args: {
          from_type: tool.schema.string(),
          from_name: tool.schema.string(),
          edge_type: tool.schema.string(),
          to_type: tool.schema.string(),
          to_name: tool.schema.string(),
        },
        async execute(args, context) {
          try {
            const { store, vocabulary, syncIfOutOfCycle } = await withStore(context);
            await memRelate(store, args, vocabulary);
            await syncIfOutOfCycle();
            return JSON.stringify({ ok: true });
          } catch (err) { return errorJson(err); }
        },
      }),

      foundry_memory_unrelate: tool({
        description: 'Delete an edge between two entities.',
        args: {
          from_type: tool.schema.string(),
          from_name: tool.schema.string(),
          edge_type: tool.schema.string(),
          to_type: tool.schema.string(),
          to_name: tool.schema.string(),
        },
        async execute(args, context) {
          try {
            const { store, vocabulary, syncIfOutOfCycle } = await withStore(context);
            await memUnrelate(store, args, vocabulary);
            await syncIfOutOfCycle();
            return JSON.stringify({ ok: true });
          } catch (err) { return errorJson(err); }
        },
      }),

      foundry_memory_get: tool({
        description: 'Fetch a single entity by composite key (type, name).',
        args: {
          type: tool.schema.string(),
          name: tool.schema.string(),
        },
        async execute(args, context) {
          try {
            const { store } = await withStore(context);
            const ent = await getEntity(store, args);
            return JSON.stringify(ent);
          } catch (err) { return errorJson(err); }
        },
      }),

      foundry_memory_list: tool({
        description: 'List all entities of a given type.',
        args: {
          type: tool.schema.string(),
        },
        async execute(args, context) {
          try {
            const { store } = await withStore(context);
            const out = await listEntities(store, args);
            return JSON.stringify(out);
          } catch (err) { return errorJson(err); }
        },
      }),

      foundry_memory_neighbours: tool({
        description: 'Bounded graph traversal from an entity. Returns entities and edges within `depth` hops.',
        args: {
          type: tool.schema.string(),
          name: tool.schema.string(),
          depth: tool.schema.number().optional().describe('Default 1'),
          edge_types: tool.schema.array(tool.schema.string()).optional().describe('Restrict traversal to named edges'),
        },
        async execute(args, context) {
          try {
            const { store, vocabulary } = await withStore(context);
            const out = await memNeighbours(store, args, vocabulary);
            return JSON.stringify(out);
          } catch (err) { return errorJson(err); }
        },
      }),

      foundry_memory_query: tool({
        description: 'Arbitrary read-only Cozo Datalog query. Rejects :put, :rm, :create, ::remove. Returns {headers, rows}.',
        args: {
          datalog: tool.schema.string().describe('Cozo Datalog query (read-only)'),
        },
        async execute(args, context) {
          try {
            const { store } = await withStore(context);
            const out = await runQuery(store, args.datalog);
            return JSON.stringify(out);
          } catch (err) { return errorJson(err); }
        },
      }),
```

- [ ] **Step 4: Run test, verify it passes**

- [ ] **Step 5: Commit**

```bash
git add .opencode/plugins/foundry.js tests/plugin/memory-tools.test.js
git commit -m "feat(memory): register seven memory tools in OpenCode plugin"
```

---

## Task 10: Full suite + manual smoke

- [ ] **Step 1: Run full test suite**

```bash
npm test
```

Expected: all previous tests pass plus ~60 new memory tests.

- [ ] **Step 2: Manual smoke test**

In a scratch worktree:
1. Run `init-memory` skill (from P1).
2. Hand-author `foundry/memory/entities/class.md` and `foundry/memory/edges/calls.md` using the structure from Task 9's plugin test.
3. Manually add their hashes to `foundry/memory/schema.json` (authoring skills ship in P3).
4. In OpenCode, invoke `foundry_memory_put` with type=class, name=com.Foo, value=hello.
5. Verify `foundry/memory/relations/class.ndjson` contains the expected line.
6. Invoke `foundry_memory_query` with `?[n] := *ent_class{name: n}` and verify the response includes `com.Foo`.

---

## Definition of Done for Plan 2

- Seven tools registered and reachable via the OpenCode plugin.
- Round-trip: `put` → NDJSON export (auto, out of cycle) → store re-open → `get` sees the value.
- Read-only enforcement on `foundry_memory_query`.
- All tests pass.
- No cycle permission filtering yet (Plan 4).
- No embeddings yet (Plan 5).

## What this plan deliberately does NOT do

- Permission scoping by cycle — every caller sees everything. Added in Plan 4.
- Prompt rendering into cycle bodies — Plan 4.
- Embedding computation on write — Plan 5.
- `foundry_memory_search` tool — Plan 5.
- Authoring skills (hand-editing type files is required until Plan 3 ships).

## Handoff to Plan 3

Plan 3 ("Schema admin + authoring skills") adds admin tools (`create/rename/drop_entity_type`, etc.) and thin skill wrappers. It depends on:
- `scripts/lib/memory/cozo.js` (uses `dropRelation`, `createEntityRelation`, `createEdgeRelation`).
- `scripts/lib/memory/schema.js` (uses `bumpVersion`, `writeSchema`, `hashFrontmatter`).
- `scripts/lib/memory/ndjson.js` (uses parsers/serialisers to rewrite relations on rename).
- `scripts/lib/memory/singleton.js` (admin tools invalidate the cached store after mutating schema).
