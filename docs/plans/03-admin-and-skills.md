# Flow Memory — Plan 3: Schema admin tools + authoring skills

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the full schema lifecycle through OpenCode: admin tools that create, rename, drop, reset, dump, validate, and vacuum memory, plus nine user-facing skills that drive those tools. After this plan, no hand-editing of type-file frontmatter or `schema.json` is required.

**Architecture:** Admin operations live in `scripts/lib/memory/admin/` (one file per operation for clear blast radius). Each admin operation mutates schema + type files + relation files atomically from the user's perspective — all writes happen via the `io` adapter; failures mid-operation raise and leave no partial state when possible. After every admin operation, the singleton cache is invalidated and a sync runs.

**Tech Stack:** Plan 1 + Plan 2 primitives. No new npm dependencies.

**Spec reference:** `MEMORY.md` §§4.6, 9.

---

## File Structure

**Created:**
- `scripts/lib/memory/admin/create-entity-type.js`
- `scripts/lib/memory/admin/create-edge-type.js`
- `scripts/lib/memory/admin/rename-entity-type.js`
- `scripts/lib/memory/admin/rename-edge-type.js`
- `scripts/lib/memory/admin/drop-entity-type.js`
- `scripts/lib/memory/admin/drop-edge-type.js`
- `scripts/lib/memory/admin/reset.js`
- `scripts/lib/memory/admin/dump.js`
- `scripts/lib/memory/admin/validate.js`
- `scripts/lib/memory/admin/vacuum.js`
- `tests/lib/memory/admin/*.test.js` (one per admin file)
- `skills/add-memory-entity-type/SKILL.md`
- `skills/add-memory-edge-type/SKILL.md`
- `skills/rename-memory-entity-type/SKILL.md`
- `skills/rename-memory-edge-type/SKILL.md`
- `skills/drop-memory-entity-type/SKILL.md`
- `skills/drop-memory-edge-type/SKILL.md`
- `skills/reset-memory/SKILL.md`

**Modified:**
- `.opencode/plugins/foundry.js` — registers admin tools.

---

## Shared helper: invalidation + sync

Every admin operation ends with: dispose singleton for the worktree, then re-open the store (if desired by the caller). We expose a helper.

**Task 0: Add `invalidateStore` to singleton**

- [ ] **Step 1: Extend singleton with invalidation**

In `scripts/lib/memory/singleton.js`, add:

```js
export function invalidateStore(worktreeRoot) {
  const ctx = stores.get(worktreeRoot);
  if (ctx) {
    try { closeStore(ctx.store); } catch { /* ignore */ }
    stores.delete(worktreeRoot);
  }
}
```

Import `closeStore` from `./store.js` at the top of the file if not already imported.

- [ ] **Step 2: Test**

Append to `tests/lib/memory/singleton.test.js`:

```js
it('invalidateStore clears and reopens fresh', async () => {
  const r = mkdtempSync(join(tmpdir(), 'inv-'));
  mkdirSync(join(r, 'foundry/memory'), { recursive: true });
  writeFileSync(join(r, 'foundry/memory/config.md'), '---\nenabled: true\n---\n');
  writeFileSync(join(r, 'foundry/memory/schema.json'), '{"version":1,"entities":{},"edges":{},"embeddings":null}\n');
  const { invalidateStore } = await import('../../../scripts/lib/memory/singleton.js');
  const s1 = await getOrOpenStore({ worktreeRoot: r, io: diskIO(r) });
  invalidateStore(r);
  const s2 = await getOrOpenStore({ worktreeRoot: r, io: diskIO(r) });
  assert.notStrictEqual(s1, s2);
  rmSync(r, { recursive: true, force: true });
});
```

Run: PASS.

- [ ] **Step 3: Commit**

```bash
git add scripts/lib/memory/singleton.js tests/lib/memory/singleton.test.js
git commit -m "feat(memory): add invalidateStore for admin operations"
```

---

## Task 1: Admin — create entity type

**Files:**
- Create: `scripts/lib/memory/admin/create-entity-type.js`
- Test: `tests/lib/memory/admin/create-entity-type.test.js`

Operation:
1. Validate name is a safe identifier (`/^[a-z][a-z0-9_]*$/`).
2. Reject if already exists (in schema or on disk).
3. Write entity type file with provided `body`.
4. Create empty relation NDJSON file.
5. Add to schema: `schema.entities[name] = { frontmatterHash: hash({type: name}) }`, `bumpVersion`, `writeSchema`.
6. Invalidate store singleton.

- [ ] **Step 1: Write failing test**

`tests/lib/memory/admin/create-entity-type.test.js`:

```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEntityType } from '../../../../scripts/lib/memory/admin/create-entity-type.js';

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

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'cet-'));
  mkdirSync(join(root, 'foundry/memory/entities'), { recursive: true });
  mkdirSync(join(root, 'foundry/memory/edges'), { recursive: true });
  mkdirSync(join(root, 'foundry/memory/relations'), { recursive: true });
  writeFileSync(join(root, 'foundry/memory/config.md'), '---\nenabled: true\n---\n');
  writeFileSync(join(root, 'foundry/memory/schema.json'), '{"version":1,"entities":{},"edges":{},"embeddings":null}\n');
  return root;
}

describe('createEntityType', () => {
  it('creates type file, empty relation file, and updates schema', async () => {
    const root = setup();
    await createEntityType({ worktreeRoot: root, io: diskIO(root), name: 'class', body: 'A Java class body, non-empty.' });
    assert.ok(existsSync(join(root, 'foundry/memory/entities/class.md')));
    assert.ok(existsSync(join(root, 'foundry/memory/relations/class.ndjson')));
    assert.equal(readFileSync(join(root, 'foundry/memory/relations/class.ndjson'), 'utf-8'), '');
    const schema = JSON.parse(readFileSync(join(root, 'foundry/memory/schema.json'), 'utf-8'));
    assert.ok(schema.entities.class);
    assert.equal(schema.version, 2);
    rmSync(root, { recursive: true, force: true });
  });

  it('rejects invalid name', async () => {
    const root = setup();
    await assert.rejects(
      () => createEntityType({ worktreeRoot: root, io: diskIO(root), name: 'BadName', body: 'body' }),
      /identifier/i,
    );
    rmSync(root, { recursive: true, force: true });
  });

  it('rejects empty body', async () => {
    const root = setup();
    await assert.rejects(
      () => createEntityType({ worktreeRoot: root, io: diskIO(root), name: 'class', body: '   ' }),
      /body/i,
    );
    rmSync(root, { recursive: true, force: true });
  });

  it('rejects duplicate', async () => {
    const root = setup();
    await createEntityType({ worktreeRoot: root, io: diskIO(root), name: 'class', body: 'body' });
    await assert.rejects(
      () => createEntityType({ worktreeRoot: root, io: diskIO(root), name: 'class', body: 'body' }),
      /exists/i,
    );
    rmSync(root, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run, fail.**

- [ ] **Step 3: Implement**

`scripts/lib/memory/admin/create-entity-type.js`:

```js
import { memoryPaths } from '../paths.js';
import { loadSchema, writeSchema, bumpVersion, hashFrontmatter } from '../schema.js';
import { invalidateStore } from '../singleton.js';

const IDENT = /^[a-z][a-z0-9_]*$/;

export async function createEntityType({ worktreeRoot, io, name, body }) {
  if (!IDENT.test(name)) throw new Error(`invalid identifier: '${name}' (expected lowercase snake_case)`);
  if (typeof body !== 'string' || !body.trim()) throw new Error(`body must be a non-empty string`);

  const p = memoryPaths('foundry');
  const schema = await loadSchema('foundry', io);

  if (schema.entities[name]) throw new Error(`entity type '${name}' already exists in schema`);
  if (schema.edges[name]) throw new Error(`'${name}' is already declared as an edge type`);
  if (await io.exists(p.entityTypeFile(name))) throw new Error(`entity type file already exists on disk`);

  const frontmatter = { type: name };
  const fileContent = `---\ntype: ${name}\n---\n\n${body.trim()}\n`;
  await io.writeFile(p.entityTypeFile(name), fileContent);
  await io.writeFile(p.relationFile(name), '');

  schema.entities[name] = { frontmatterHash: hashFrontmatter(frontmatter) };
  bumpVersion(schema);
  await writeSchema('foundry', schema, io);

  invalidateStore(worktreeRoot);
  return { type: name };
}
```

- [ ] **Step 4: Run, pass.**

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/memory/admin/create-entity-type.js tests/lib/memory/admin/create-entity-type.test.js
git commit -m "feat(memory): admin tool to create entity type"
```

---

## Task 2: Admin — create edge type

**Files:**
- Create: `scripts/lib/memory/admin/create-edge-type.js`
- Test: `tests/lib/memory/admin/create-edge-type.test.js`

Same shape as Task 1, plus validates that every entry in `sources`/`targets` is either `'any'` or a declared entity type.

- [ ] **Step 1: Write failing test**

`tests/lib/memory/admin/create-edge-type.test.js`:

```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEntityType } from '../../../../scripts/lib/memory/admin/create-entity-type.js';
import { createEdgeType } from '../../../../scripts/lib/memory/admin/create-edge-type.js';

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

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'cdt-'));
  mkdirSync(join(root, 'foundry/memory/entities'), { recursive: true });
  mkdirSync(join(root, 'foundry/memory/edges'), { recursive: true });
  mkdirSync(join(root, 'foundry/memory/relations'), { recursive: true });
  writeFileSync(join(root, 'foundry/memory/config.md'), '---\nenabled: true\n---\n');
  writeFileSync(join(root, 'foundry/memory/schema.json'), '{"version":1,"entities":{},"edges":{},"embeddings":null}\n');
  return root;
}

describe('createEdgeType', () => {
  it('creates edge with declared sources/targets', async () => {
    const root = setup();
    const io = diskIO(root);
    await createEntityType({ worktreeRoot: root, io, name: 'class', body: 'class body' });
    await createEdgeType({ worktreeRoot: root, io, name: 'calls', sources: ['class'], targets: ['class'], body: 'calls body' });
    const schema = JSON.parse(readFileSync(join(root, 'foundry/memory/schema.json'), 'utf-8'));
    assert.ok(schema.edges.calls);
    assert.ok(existsSync(join(root, 'foundry/memory/relations/calls.ndjson')));
    rmSync(root, { recursive: true, force: true });
  });

  it("accepts 'any' as wildcard", async () => {
    const root = setup();
    const io = diskIO(root);
    await createEntityType({ worktreeRoot: root, io, name: 'class', body: 'b' });
    await createEdgeType({ worktreeRoot: root, io, name: 'refs', sources: 'any', targets: 'any', body: 'b' });
    rmSync(root, { recursive: true, force: true });
  });

  it('rejects sources referencing undeclared entity type', async () => {
    const root = setup();
    const io = diskIO(root);
    await assert.rejects(
      () => createEdgeType({ worktreeRoot: root, io, name: 'calls', sources: ['ghost'], targets: ['class'], body: 'b' }),
      /not declared/i,
    );
    rmSync(root, { recursive: true, force: true });
  });

  it('rejects edge name colliding with entity type', async () => {
    const root = setup();
    const io = diskIO(root);
    await createEntityType({ worktreeRoot: root, io, name: 'class', body: 'b' });
    await assert.rejects(
      () => createEdgeType({ worktreeRoot: root, io, name: 'class', sources: ['class'], targets: ['class'], body: 'b' }),
      /already declared/i,
    );
    rmSync(root, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run, fail.**

- [ ] **Step 3: Implement**

`scripts/lib/memory/admin/create-edge-type.js`:

```js
import { memoryPaths } from '../paths.js';
import { loadSchema, writeSchema, bumpVersion, hashFrontmatter } from '../schema.js';
import { invalidateStore } from '../singleton.js';

const IDENT = /^[a-z][a-z0-9_]*$/;

function normaliseList(v, key) {
  if (v === 'any') return 'any';
  if (!Array.isArray(v) || v.length === 0 || !v.every((s) => typeof s === 'string' && s)) {
    throw new Error(`'${key}' must be 'any' or a non-empty list of entity type names`);
  }
  return [...v];
}

function renderFrontmatter(fm) {
  const lines = [`type: ${fm.type}`];
  for (const key of ['sources', 'targets']) {
    const v = fm[key];
    lines.push(v === 'any' ? `${key}: any` : `${key}: [${v.join(', ')}]`);
  }
  return lines.join('\n');
}

export async function createEdgeType({ worktreeRoot, io, name, sources, targets, body }) {
  if (!IDENT.test(name)) throw new Error(`invalid identifier: '${name}'`);
  if (typeof body !== 'string' || !body.trim()) throw new Error(`body must be non-empty`);
  const srcs = normaliseList(sources, 'sources');
  const tgts = normaliseList(targets, 'targets');

  const p = memoryPaths('foundry');
  const schema = await loadSchema('foundry', io);

  if (schema.edges[name]) throw new Error(`edge type '${name}' already exists`);
  if (schema.entities[name]) throw new Error(`'${name}' is already declared as an entity type`);
  if (await io.exists(p.edgeTypeFile(name))) throw new Error(`edge type file already exists on disk`);

  for (const list of [srcs, tgts]) {
    if (list === 'any') continue;
    for (const t of list) {
      if (!schema.entities[t]) throw new Error(`entity type '${t}' is not declared`);
    }
  }

  const frontmatter = { type: name, sources: srcs, targets: tgts };
  const fileContent = `---\n${renderFrontmatter(frontmatter)}\n---\n\n${body.trim()}\n`;
  await io.writeFile(p.edgeTypeFile(name), fileContent);
  await io.writeFile(p.relationFile(name), '');

  schema.edges[name] = { frontmatterHash: hashFrontmatter(frontmatter) };
  bumpVersion(schema);
  await writeSchema('foundry', schema, io);

  invalidateStore(worktreeRoot);
  return { type: name, sources: srcs, targets: tgts };
}
```

- [ ] **Step 4: Run, pass.**

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/memory/admin/create-edge-type.js tests/lib/memory/admin/create-edge-type.test.js
git commit -m "feat(memory): admin tool to create edge type"
```

---

## Task 3: Admin — rename entity type (with data migration)

**Files:**
- Create: `scripts/lib/memory/admin/rename-entity-type.js`
- Test: `tests/lib/memory/admin/rename-entity-type.test.js`

Operation (atomic in effect — writes to a staging set then swaps):
1. Reject if `from` missing or `to` already exists.
2. Read `from` entity type file; rewrite its `type` frontmatter; write to `to` file; delete `from` file.
3. Move `relations/<from>.ndjson` to `relations/<to>.ndjson`.
4. For every edge type whose `sources` or `targets` list contains `from`, update its frontmatter and file, and rewrite its relation file to replace `from_type`/`to_type` references.
5. Update schema.json: delete `entities[from]`, add `entities[to]`, update every edge's `frontmatterHash` that changed.
6. Bump version, write schema.
7. Invalidate store.

Because we're not inside a transaction, partial failure can leave inconsistency. Strategy: compute all changes in memory, then apply in a sequence that leaves the tree loadable by drift detection if anything breaks (schema write last). A future improvement could use a tmp dir + rename.

- [ ] **Step 1: Write failing test**

`tests/lib/memory/admin/rename-entity-type.test.js`:

```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEntityType } from '../../../../scripts/lib/memory/admin/create-entity-type.js';
import { createEdgeType } from '../../../../scripts/lib/memory/admin/create-edge-type.js';
import { renameEntityType } from '../../../../scripts/lib/memory/admin/rename-entity-type.js';

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

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'ren-e-'));
  mkdirSync(join(root, 'foundry/memory/entities'), { recursive: true });
  mkdirSync(join(root, 'foundry/memory/edges'), { recursive: true });
  mkdirSync(join(root, 'foundry/memory/relations'), { recursive: true });
  writeFileSync(join(root, 'foundry/memory/config.md'), '---\nenabled: true\n---\n');
  writeFileSync(join(root, 'foundry/memory/schema.json'), '{"version":1,"entities":{},"edges":{},"embeddings":null}\n');
  return root;
}

describe('renameEntityType', () => {
  it('renames entity and rewrites dependent edge rows and frontmatter', async () => {
    const root = setup();
    const io = diskIO(root);
    await createEntityType({ worktreeRoot: root, io, name: 'klass', body: 'b' });
    await createEntityType({ worktreeRoot: root, io, name: 'method', body: 'b' });
    await createEdgeType({ worktreeRoot: root, io, name: 'calls', sources: ['klass', 'method'], targets: ['klass', 'method'], body: 'b' });

    // Seed data manually.
    writeFileSync(join(root, 'foundry/memory/relations/klass.ndjson'), '{"name":"com.A","value":"va"}\n');
    writeFileSync(join(root, 'foundry/memory/relations/calls.ndjson'),
      '{"from_name":"com.A","from_type":"klass","to_name":"com.A","to_type":"klass"}\n');

    await renameEntityType({ worktreeRoot: root, io, from: 'klass', to: 'class' });

    assert.ok(!existsSync(join(root, 'foundry/memory/entities/klass.md')));
    assert.ok(existsSync(join(root, 'foundry/memory/entities/class.md')));
    assert.ok(readFileSync(join(root, 'foundry/memory/entities/class.md'), 'utf-8').includes('type: class'));

    assert.ok(!existsSync(join(root, 'foundry/memory/relations/klass.ndjson')));
    const entRows = readFileSync(join(root, 'foundry/memory/relations/class.ndjson'), 'utf-8');
    assert.match(entRows, /com\.A/);

    const edgeText = readFileSync(join(root, 'foundry/memory/relations/calls.ndjson'), 'utf-8');
    assert.match(edgeText, /"from_type":"class"/);
    assert.match(edgeText, /"to_type":"class"/);

    const callsMd = readFileSync(join(root, 'foundry/memory/edges/calls.md'), 'utf-8');
    assert.match(callsMd, /sources: \[class, method\]/);
    assert.match(callsMd, /targets: \[class, method\]/);

    const schema = JSON.parse(readFileSync(join(root, 'foundry/memory/schema.json'), 'utf-8'));
    assert.ok(schema.entities.class);
    assert.ok(!schema.entities.klass);
    rmSync(root, { recursive: true, force: true });
  });

  it('rejects rename to existing name', async () => {
    const root = setup();
    const io = diskIO(root);
    await createEntityType({ worktreeRoot: root, io, name: 'a', body: 'b' });
    await createEntityType({ worktreeRoot: root, io, name: 'b', body: 'b' });
    await assert.rejects(() => renameEntityType({ worktreeRoot: root, io, from: 'a', to: 'b' }), /exists/i);
    rmSync(root, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run, fail.**

- [ ] **Step 3: Implement**

`scripts/lib/memory/admin/rename-entity-type.js`:

```js
import { memoryPaths } from '../paths.js';
import { loadSchema, writeSchema, bumpVersion, hashFrontmatter } from '../schema.js';
import { parseEdgeRows, serialiseEdgeRows, parseEntityRows, serialiseEntityRows } from '../ndjson.js';
import { invalidateStore } from '../singleton.js';

const IDENT = /^[a-z][a-z0-9_]*$/;

function renderEdgeFrontmatter(fm) {
  const lines = [`type: ${fm.type}`];
  for (const key of ['sources', 'targets']) {
    const v = fm[key];
    lines.push(v === 'any' ? `${key}: any` : `${key}: [${v.join(', ')}]`);
  }
  return lines.join('\n');
}

export async function renameEntityType({ worktreeRoot, io, from, to }) {
  if (!IDENT.test(to)) throw new Error(`invalid identifier: '${to}'`);
  if (from === to) throw new Error(`from and to are identical`);

  const p = memoryPaths('foundry');
  const schema = await loadSchema('foundry', io);
  if (!schema.entities[from]) throw new Error(`entity type '${from}' not declared`);
  if (schema.entities[to] || schema.edges[to]) throw new Error(`'${to}' already exists`);

  // Rewrite entity type file.
  const oldFile = p.entityTypeFile(from);
  const text = await io.readFile(oldFile);
  const newText = text.replace(/^---\n([\s\S]*?)\n---/, (_, fm) => {
    const replaced = fm.replace(/^type:\s*.+$/m, `type: ${to}`);
    return `---\n${replaced}\n---`;
  });
  await io.writeFile(p.entityTypeFile(to), newText);
  await io.unlink(oldFile);

  // Rewrite entity relation file.
  const oldRel = p.relationFile(from);
  if (await io.exists(oldRel)) {
    const rows = parseEntityRows(await io.readFile(oldRel));
    await io.writeFile(p.relationFile(to), serialiseEntityRows(rows));
    await io.unlink(oldRel);
  } else {
    await io.writeFile(p.relationFile(to), '');
  }

  // Update every edge type that mentions `from` and rewrite that edge's relation rows.
  for (const edgeName of Object.keys(schema.edges)) {
    const edgeFile = p.edgeTypeFile(edgeName);
    const edgeText = await io.readFile(edgeFile);
    const m = edgeText.match(/^---\n([\s\S]*?)\n---/);
    if (!m) continue;
    const yaml = await import('js-yaml');
    const fm = yaml.load(m[1]) ?? {};
    let changed = false;
    for (const key of ['sources', 'targets']) {
      if (fm[key] === 'any') continue;
      if (Array.isArray(fm[key]) && fm[key].includes(from)) {
        fm[key] = fm[key].map((x) => (x === from ? to : x));
        changed = true;
      }
    }
    if (changed) {
      const body = edgeText.replace(/^---\n[\s\S]*?\n---\r?\n?/, '');
      await io.writeFile(edgeFile, `---\n${renderEdgeFrontmatter(fm)}\n---\n${body.startsWith('\n') ? '' : '\n'}${body}`);
      schema.edges[edgeName].frontmatterHash = hashFrontmatter({ type: edgeName, sources: fm.sources, targets: fm.targets });
    }

    // Rewrite edge rows that reference the renamed type.
    const relFile = p.relationFile(edgeName);
    if (await io.exists(relFile)) {
      const rows = parseEdgeRows(await io.readFile(relFile));
      let rowsChanged = false;
      const newRows = rows.map((r) => {
        let nr = r;
        if (r.from_type === from) { nr = { ...nr, from_type: to }; rowsChanged = true; }
        if (r.to_type === from) { nr = { ...nr, to_type: to }; rowsChanged = true; }
        return nr;
      });
      if (rowsChanged) await io.writeFile(relFile, serialiseEdgeRows(newRows));
    }
  }

  // Schema updates.
  schema.entities[to] = { frontmatterHash: hashFrontmatter({ type: to }) };
  delete schema.entities[from];
  bumpVersion(schema);
  await writeSchema('foundry', schema, io);

  invalidateStore(worktreeRoot);
  return { from, to };
}
```

- [ ] **Step 4: Run, pass.**

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/memory/admin/rename-entity-type.js tests/lib/memory/admin/rename-entity-type.test.js
git commit -m "feat(memory): admin tool to rename entity type with data migration"
```

---

## Task 4: Admin — rename edge type

**Files:**
- Create: `scripts/lib/memory/admin/rename-edge-type.js`
- Test: `tests/lib/memory/admin/rename-edge-type.test.js`

Simpler than Task 3 — only the edge's own files and schema entry move. Edge rows themselves carry `from_type`/`to_type` but NOT `edge_type`, so no row rewriting needed.

- [ ] **Step 1: Write failing test**

`tests/lib/memory/admin/rename-edge-type.test.js`:

```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEntityType } from '../../../../scripts/lib/memory/admin/create-entity-type.js';
import { createEdgeType } from '../../../../scripts/lib/memory/admin/create-edge-type.js';
import { renameEdgeType } from '../../../../scripts/lib/memory/admin/rename-edge-type.js';

function diskIO(root) { /* same as Task 3 */
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

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'ren-ed-'));
  mkdirSync(join(root, 'foundry/memory/entities'), { recursive: true });
  mkdirSync(join(root, 'foundry/memory/edges'), { recursive: true });
  mkdirSync(join(root, 'foundry/memory/relations'), { recursive: true });
  writeFileSync(join(root, 'foundry/memory/config.md'), '---\nenabled: true\n---\n');
  writeFileSync(join(root, 'foundry/memory/schema.json'), '{"version":1,"entities":{},"edges":{},"embeddings":null}\n');
  return root;
}

describe('renameEdgeType', () => {
  it('moves files and updates schema', async () => {
    const root = setup();
    const io = diskIO(root);
    await createEntityType({ worktreeRoot: root, io, name: 'class', body: 'b' });
    await createEdgeType({ worktreeRoot: root, io, name: 'calls', sources: ['class'], targets: ['class'], body: 'b' });
    writeFileSync(join(root, 'foundry/memory/relations/calls.ndjson'),
      '{"from_name":"com.A","from_type":"class","to_name":"com.B","to_type":"class"}\n');

    await renameEdgeType({ worktreeRoot: root, io, from: 'calls', to: 'invokes' });

    assert.ok(!existsSync(join(root, 'foundry/memory/edges/calls.md')));
    assert.ok(existsSync(join(root, 'foundry/memory/edges/invokes.md')));
    assert.ok(readFileSync(join(root, 'foundry/memory/edges/invokes.md'), 'utf-8').includes('type: invokes'));
    assert.ok(existsSync(join(root, 'foundry/memory/relations/invokes.ndjson')));
    const schema = JSON.parse(readFileSync(join(root, 'foundry/memory/schema.json'), 'utf-8'));
    assert.ok(schema.edges.invokes);
    assert.ok(!schema.edges.calls);
    rmSync(root, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run, fail.**

- [ ] **Step 3: Implement**

`scripts/lib/memory/admin/rename-edge-type.js`:

```js
import yaml from 'js-yaml';
import { memoryPaths } from '../paths.js';
import { loadSchema, writeSchema, bumpVersion, hashFrontmatter } from '../schema.js';
import { invalidateStore } from '../singleton.js';

const IDENT = /^[a-z][a-z0-9_]*$/;

function renderEdgeFrontmatter(fm) {
  const lines = [`type: ${fm.type}`];
  for (const key of ['sources', 'targets']) {
    const v = fm[key];
    lines.push(v === 'any' ? `${key}: any` : `${key}: [${v.join(', ')}]`);
  }
  return lines.join('\n');
}

export async function renameEdgeType({ worktreeRoot, io, from, to }) {
  if (!IDENT.test(to)) throw new Error(`invalid identifier: '${to}'`);
  if (from === to) throw new Error(`from and to identical`);

  const p = memoryPaths('foundry');
  const schema = await loadSchema('foundry', io);
  if (!schema.edges[from]) throw new Error(`edge type '${from}' not declared`);
  if (schema.edges[to] || schema.entities[to]) throw new Error(`'${to}' already exists`);

  const oldFile = p.edgeTypeFile(from);
  const text = await io.readFile(oldFile);
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  if (!m) throw new Error(`edge type file lacks frontmatter`);
  const fm = yaml.load(m[1]) ?? {};
  fm.type = to;
  const body = text.replace(/^---\n[\s\S]*?\n---\r?\n?/, '');
  await io.writeFile(p.edgeTypeFile(to), `---\n${renderEdgeFrontmatter(fm)}\n---\n${body.startsWith('\n') ? '' : '\n'}${body}`);
  await io.unlink(oldFile);

  const oldRel = p.relationFile(from);
  if (await io.exists(oldRel)) {
    const rel = await io.readFile(oldRel);
    await io.writeFile(p.relationFile(to), rel);
    await io.unlink(oldRel);
  } else {
    await io.writeFile(p.relationFile(to), '');
  }

  schema.edges[to] = { frontmatterHash: hashFrontmatter({ type: to, sources: fm.sources, targets: fm.targets }) };
  delete schema.edges[from];
  bumpVersion(schema);
  await writeSchema('foundry', schema, io);

  invalidateStore(worktreeRoot);
  return { from, to };
}
```

- [ ] **Step 4: Run, pass.**

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/memory/admin/rename-edge-type.js tests/lib/memory/admin/rename-edge-type.test.js
git commit -m "feat(memory): admin tool to rename edge type"
```

---

## Task 5: Admin — drop entity type (cascades to edges)

**Files:**
- Create: `scripts/lib/memory/admin/drop-entity-type.js`
- Test: `tests/lib/memory/admin/drop-entity-type.test.js`

Destructive. Requires `confirm: true`. Deletes:
1. `entities/<type>.md`
2. `relations/<type>.ndjson`
3. For every edge type whose `sources` or `targets` mentions this entity: remove the entity from those lists; if either list becomes empty, drop the entire edge (cascade).
4. For every edge type: strip rows where `from_type` or `to_type` equals this entity.
5. Schema update.

- [ ] **Step 1: Write failing test**

`tests/lib/memory/admin/drop-entity-type.test.js`:

```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEntityType } from '../../../../scripts/lib/memory/admin/create-entity-type.js';
import { createEdgeType } from '../../../../scripts/lib/memory/admin/create-edge-type.js';
import { dropEntityType } from '../../../../scripts/lib/memory/admin/drop-entity-type.js';

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

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'drop-e-'));
  mkdirSync(join(root, 'foundry/memory/entities'), { recursive: true });
  mkdirSync(join(root, 'foundry/memory/edges'), { recursive: true });
  mkdirSync(join(root, 'foundry/memory/relations'), { recursive: true });
  writeFileSync(join(root, 'foundry/memory/config.md'), '---\nenabled: true\n---\n');
  writeFileSync(join(root, 'foundry/memory/schema.json'), '{"version":1,"entities":{},"edges":{},"embeddings":null}\n');
  return root;
}

describe('dropEntityType', () => {
  it('requires confirm: true', async () => {
    const root = setup();
    const io = diskIO(root);
    await createEntityType({ worktreeRoot: root, io, name: 'class', body: 'b' });
    await assert.rejects(() => dropEntityType({ worktreeRoot: root, io, name: 'class', confirm: false }), /confirm/);
    rmSync(root, { recursive: true, force: true });
  });

  it('drops type, relation file, cascades edge-source adjustment', async () => {
    const root = setup();
    const io = diskIO(root);
    await createEntityType({ worktreeRoot: root, io, name: 'class', body: 'b' });
    await createEntityType({ worktreeRoot: root, io, name: 'method', body: 'b' });
    await createEdgeType({ worktreeRoot: root, io, name: 'calls', sources: ['class', 'method'], targets: ['class', 'method'], body: 'b' });
    writeFileSync(join(root, 'foundry/memory/relations/calls.ndjson'),
      '{"from_name":"a","from_type":"class","to_name":"b","to_type":"method"}\n' +
      '{"from_name":"a","from_type":"method","to_name":"b","to_type":"method"}\n');

    await dropEntityType({ worktreeRoot: root, io, name: 'class', confirm: true });

    assert.ok(!existsSync(join(root, 'foundry/memory/entities/class.md')));
    assert.ok(!existsSync(join(root, 'foundry/memory/relations/class.ndjson')));
    const callsMd = readFileSync(join(root, 'foundry/memory/edges/calls.md'), 'utf-8');
    assert.match(callsMd, /sources: \[method\]/);
    assert.match(callsMd, /targets: \[method\]/);
    const callsRel = readFileSync(join(root, 'foundry/memory/relations/calls.ndjson'), 'utf-8');
    assert.doesNotMatch(callsRel, /"class"/);
    rmSync(root, { recursive: true, force: true });
  });

  it('cascades to drop entire edge type if its sources or targets becomes empty', async () => {
    const root = setup();
    const io = diskIO(root);
    await createEntityType({ worktreeRoot: root, io, name: 'class', body: 'b' });
    await createEntityType({ worktreeRoot: root, io, name: 'table', body: 'b' });
    await createEdgeType({ worktreeRoot: root, io, name: 'writes', sources: ['class'], targets: ['table'], body: 'b' });

    await dropEntityType({ worktreeRoot: root, io, name: 'class', confirm: true });

    assert.ok(!existsSync(join(root, 'foundry/memory/edges/writes.md')));
    const schema = JSON.parse(readFileSync(join(root, 'foundry/memory/schema.json'), 'utf-8'));
    assert.ok(!schema.edges.writes);
    rmSync(root, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run, fail.**

- [ ] **Step 3: Implement**

`scripts/lib/memory/admin/drop-entity-type.js`:

```js
import yaml from 'js-yaml';
import { memoryPaths } from '../paths.js';
import { loadSchema, writeSchema, bumpVersion, hashFrontmatter } from '../schema.js';
import { parseEdgeRows, serialiseEdgeRows } from '../ndjson.js';
import { invalidateStore } from '../singleton.js';

function renderEdgeFrontmatter(fm) {
  const lines = [`type: ${fm.type}`];
  for (const key of ['sources', 'targets']) {
    const v = fm[key];
    lines.push(v === 'any' ? `${key}: any` : `${key}: [${v.join(', ')}]`);
  }
  return lines.join('\n');
}

export async function dropEntityType({ worktreeRoot, io, name, confirm }) {
  if (confirm !== true) throw new Error(`drop requires confirm: true`);
  const p = memoryPaths('foundry');
  const schema = await loadSchema('foundry', io);
  if (!schema.entities[name]) throw new Error(`entity type '${name}' not declared`);

  await io.unlink(p.entityTypeFile(name));
  await io.unlink(p.relationFile(name));

  for (const edgeName of Object.keys({ ...schema.edges })) {
    const edgeFile = p.edgeTypeFile(edgeName);
    if (!(await io.exists(edgeFile))) continue;
    const edgeText = await io.readFile(edgeFile);
    const m = edgeText.match(/^---\n([\s\S]*?)\n---/);
    if (!m) continue;
    const fm = yaml.load(m[1]) ?? {};

    let cascadeDrop = false;
    for (const key of ['sources', 'targets']) {
      if (fm[key] === 'any') continue;
      if (!Array.isArray(fm[key])) continue;
      const filtered = fm[key].filter((t) => t !== name);
      if (filtered.length === 0 && fm[key].includes(name)) cascadeDrop = true;
      fm[key] = filtered.length > 0 ? filtered : fm[key];
    }

    if (cascadeDrop) {
      await io.unlink(edgeFile);
      await io.unlink(p.relationFile(edgeName));
      delete schema.edges[edgeName];
      continue;
    }

    // Update edge type file & rows if any reference changed.
    const body = edgeText.replace(/^---\n[\s\S]*?\n---\r?\n?/, '');
    await io.writeFile(edgeFile, `---\n${renderEdgeFrontmatter(fm)}\n---\n${body.startsWith('\n') ? '' : '\n'}${body}`);
    schema.edges[edgeName].frontmatterHash = hashFrontmatter({ type: edgeName, sources: fm.sources, targets: fm.targets });

    const relFile = p.relationFile(edgeName);
    if (await io.exists(relFile)) {
      const rows = parseEdgeRows(await io.readFile(relFile));
      const kept = rows.filter((r) => r.from_type !== name && r.to_type !== name);
      await io.writeFile(relFile, serialiseEdgeRows(kept));
    }
  }

  delete schema.entities[name];
  bumpVersion(schema);
  await writeSchema('foundry', schema, io);

  invalidateStore(worktreeRoot);
  return { dropped: name };
}
```

- [ ] **Step 4: Run, pass.**

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/memory/admin/drop-entity-type.js tests/lib/memory/admin/drop-entity-type.test.js
git commit -m "feat(memory): admin tool to drop entity type with edge cascade"
```

---

## Task 6: Admin — drop edge type

**Files:**
- Create: `scripts/lib/memory/admin/drop-edge-type.js`
- Test: `tests/lib/memory/admin/drop-edge-type.test.js`

Straightforward: delete edge type file, delete its relation file, remove from schema.

- [ ] **Step 1: Write failing test**

`tests/lib/memory/admin/drop-edge-type.test.js`:

```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEntityType } from '../../../../scripts/lib/memory/admin/create-entity-type.js';
import { createEdgeType } from '../../../../scripts/lib/memory/admin/create-edge-type.js';
import { dropEdgeType } from '../../../../scripts/lib/memory/admin/drop-edge-type.js';

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

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'drop-ed-'));
  mkdirSync(join(root, 'foundry/memory/entities'), { recursive: true });
  mkdirSync(join(root, 'foundry/memory/edges'), { recursive: true });
  mkdirSync(join(root, 'foundry/memory/relations'), { recursive: true });
  writeFileSync(join(root, 'foundry/memory/config.md'), '---\nenabled: true\n---\n');
  writeFileSync(join(root, 'foundry/memory/schema.json'), '{"version":1,"entities":{},"edges":{},"embeddings":null}\n');
  return root;
}

describe('dropEdgeType', () => {
  it('requires confirm', async () => {
    const root = setup();
    const io = diskIO(root);
    await createEntityType({ worktreeRoot: root, io, name: 'class', body: 'b' });
    await createEdgeType({ worktreeRoot: root, io, name: 'calls', sources: ['class'], targets: ['class'], body: 'b' });
    await assert.rejects(() => dropEdgeType({ worktreeRoot: root, io, name: 'calls', confirm: false }), /confirm/);
    rmSync(root, { recursive: true, force: true });
  });

  it('drops edge type and relation', async () => {
    const root = setup();
    const io = diskIO(root);
    await createEntityType({ worktreeRoot: root, io, name: 'class', body: 'b' });
    await createEdgeType({ worktreeRoot: root, io, name: 'calls', sources: ['class'], targets: ['class'], body: 'b' });
    await dropEdgeType({ worktreeRoot: root, io, name: 'calls', confirm: true });
    assert.ok(!existsSync(join(root, 'foundry/memory/edges/calls.md')));
    assert.ok(!existsSync(join(root, 'foundry/memory/relations/calls.ndjson')));
    const schema = JSON.parse(readFileSync(join(root, 'foundry/memory/schema.json'), 'utf-8'));
    assert.ok(!schema.edges.calls);
    rmSync(root, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run, fail.**

- [ ] **Step 3: Implement**

`scripts/lib/memory/admin/drop-edge-type.js`:

```js
import { memoryPaths } from '../paths.js';
import { loadSchema, writeSchema, bumpVersion } from '../schema.js';
import { invalidateStore } from '../singleton.js';

export async function dropEdgeType({ worktreeRoot, io, name, confirm }) {
  if (confirm !== true) throw new Error(`drop requires confirm: true`);
  const p = memoryPaths('foundry');
  const schema = await loadSchema('foundry', io);
  if (!schema.edges[name]) throw new Error(`edge type '${name}' not declared`);

  await io.unlink(p.edgeTypeFile(name));
  await io.unlink(p.relationFile(name));
  delete schema.edges[name];
  bumpVersion(schema);
  await writeSchema('foundry', schema, io);

  invalidateStore(worktreeRoot);
  return { dropped: name };
}
```

- [ ] **Step 4: Run, pass.**

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/memory/admin/drop-edge-type.js tests/lib/memory/admin/drop-edge-type.test.js
git commit -m "feat(memory): admin tool to drop edge type"
```

---

## Task 7: Admin — reset (purge all data, keep types)

**Files:**
- Create: `scripts/lib/memory/admin/reset.js`
- Test: `tests/lib/memory/admin/reset.test.js`

Truncates every relation file to empty; does not touch type files or `schema.json` entries. Requires `confirm: true`.

- [ ] **Step 1: Write failing test**

`tests/lib/memory/admin/reset.test.js`:

```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEntityType } from '../../../../scripts/lib/memory/admin/create-entity-type.js';
import { resetMemory } from '../../../../scripts/lib/memory/admin/reset.js';

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

describe('resetMemory', () => {
  it('empties relation files and keeps types', async () => {
    const root = mkdtempSync(join(tmpdir(), 'reset-'));
    mkdirSync(join(root, 'foundry/memory/entities'), { recursive: true });
    mkdirSync(join(root, 'foundry/memory/edges'), { recursive: true });
    mkdirSync(join(root, 'foundry/memory/relations'), { recursive: true });
    writeFileSync(join(root, 'foundry/memory/config.md'), '---\nenabled: true\n---\n');
    writeFileSync(join(root, 'foundry/memory/schema.json'), '{"version":1,"entities":{},"edges":{},"embeddings":null}\n');
    const io = diskIO(root);
    await createEntityType({ worktreeRoot: root, io, name: 'class', body: 'b' });
    writeFileSync(join(root, 'foundry/memory/relations/class.ndjson'), '{"name":"com.A","value":"v"}\n');

    await resetMemory({ worktreeRoot: root, io, confirm: true });

    assert.equal(readFileSync(join(root, 'foundry/memory/relations/class.ndjson'), 'utf-8'), '');
    const schema = JSON.parse(readFileSync(join(root, 'foundry/memory/schema.json'), 'utf-8'));
    assert.ok(schema.entities.class);
    rmSync(root, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run, fail.**

- [ ] **Step 3: Implement**

`scripts/lib/memory/admin/reset.js`:

```js
import { memoryPaths } from '../paths.js';
import { loadSchema, writeSchema, bumpVersion } from '../schema.js';
import { invalidateStore } from '../singleton.js';

export async function resetMemory({ worktreeRoot, io, confirm }) {
  if (confirm !== true) throw new Error(`reset requires confirm: true`);
  const p = memoryPaths('foundry');
  const schema = await loadSchema('foundry', io);

  for (const name of [...Object.keys(schema.entities), ...Object.keys(schema.edges)]) {
    await io.writeFile(p.relationFile(name), '');
  }
  // Delete the live DB so it's re-imported empty on next open.
  await io.unlink(p.db);
  await io.unlink(p.db + '-wal');
  await io.unlink(p.db + '-shm');

  bumpVersion(schema);
  await writeSchema('foundry', schema, io);
  invalidateStore(worktreeRoot);
  return { reset: true };
}
```

- [ ] **Step 4: Run, pass.**

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/memory/admin/reset.js tests/lib/memory/admin/reset.test.js
git commit -m "feat(memory): admin tool to reset memory data"
```

---

## Task 8: Admin — dump, validate, vacuum

**Files:**
- Create: `scripts/lib/memory/admin/dump.js`
- Create: `scripts/lib/memory/admin/validate.js`
- Create: `scripts/lib/memory/admin/vacuum.js`
- Test: `tests/lib/memory/admin/dump.test.js`
- Test: `tests/lib/memory/admin/validate.test.js`

`dump`: returns a human-readable snapshot of `{type?, name?}` scope. Pure read. No invalidation.
`validate`: runs all load-time checks (config loads, schema loads, vocabulary loads, no drift) and returns a report.
`vacuum`: runs `::compact` on Cozo (or SQLite `VACUUM` passthrough via Cozo).

- [ ] **Step 1: Write failing tests**

`tests/lib/memory/admin/dump.test.js`:

```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { dumpMemory } from '../../../../scripts/lib/memory/admin/dump.js';

describe('dumpMemory (unit, with mock store)', () => {
  it('dumps single entity', async () => {
    const store = { db: { run: async (q) => {
      if (/ent_class/.test(q)) return { rows: [['com.A', 'va']], headers: ['name', 'value'] };
      return { rows: [] };
    }}};
    const out = await dumpMemory({ store, vocabulary: { entities: { class: {} }, edges: {} }, type: 'class', name: 'com.A' });
    assert.match(out, /com\.A/);
    assert.match(out, /va/);
  });
});
```

`tests/lib/memory/admin/validate.test.js`:

```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateMemory } from '../../../../scripts/lib/memory/admin/validate.js';

function diskIO(root) {
  const fs = require('node:fs');
  const abs = (p) => join(root, p);
  return {
    exists: async (p) => fs.existsSync(abs(p)),
    readFile: async (p) => fs.readFileSync(abs(p), 'utf-8'),
    writeFile: async (p, c) => fs.writeFileSync(abs(p), c, 'utf-8'),
    readDir: async (p) => { try { return fs.readdirSync(abs(p)); } catch { return []; } },
    mkdir: async (p) => fs.mkdirSync(abs(p), { recursive: true }),
  };
}

describe('validateMemory', () => {
  it('clean project: no issues', async () => {
    const root = mkdtempSync(join(tmpdir(), 'val-'));
    mkdirSync(join(root, 'foundry/memory/entities'), { recursive: true });
    mkdirSync(join(root, 'foundry/memory/edges'), { recursive: true });
    writeFileSync(join(root, 'foundry/memory/config.md'), '---\nenabled: true\n---\n');
    writeFileSync(join(root, 'foundry/memory/schema.json'), '{"version":1,"entities":{},"edges":{},"embeddings":null}\n');
    const report = await validateMemory({ io: diskIO(root) });
    assert.equal(report.ok, true);
    assert.equal(report.issues.length, 0);
    rmSync(root, { recursive: true, force: true });
  });

  it('reports drift', async () => {
    const root = mkdtempSync(join(tmpdir(), 'val-d-'));
    mkdirSync(join(root, 'foundry/memory/entities'), { recursive: true });
    mkdirSync(join(root, 'foundry/memory/edges'), { recursive: true });
    writeFileSync(join(root, 'foundry/memory/config.md'), '---\nenabled: true\n---\n');
    writeFileSync(join(root, 'foundry/memory/entities/ghost.md'), '---\ntype: ghost\n---\n\nBody.\n');
    writeFileSync(join(root, 'foundry/memory/schema.json'), '{"version":1,"entities":{},"edges":{},"embeddings":null}\n');
    const report = await validateMemory({ io: diskIO(root) });
    assert.equal(report.ok, false);
    assert.ok(report.issues.some((i) => i.kind === 'unknown-type'));
    rmSync(root, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run, fail.**

- [ ] **Step 3: Implement**

`scripts/lib/memory/admin/dump.js`:

```js
import { listEntities, getEntity, neighbours } from '../reads.js';

export async function dumpMemory({ store, vocabulary, type, name, depth = 1 }) {
  const lines = [];
  if (type && name) {
    const ent = await getEntity(store, { type, name });
    if (!ent) return `(no entity found: ${type}/${name})`;
    lines.push(`# ${type}/${name}`);
    lines.push('');
    lines.push(ent.value);
    lines.push('');
    const nbrs = await neighbours(store, { type, name, depth }, vocabulary);
    if (nbrs.edges.length > 0) {
      lines.push(`## Edges`);
      for (const e of nbrs.edges) {
        lines.push(`- ${e.from_type}/${e.from_name} --${e.edge_type}--> ${e.to_type}/${e.to_name}`);
      }
    }
    return lines.join('\n');
  }
  if (type) {
    const rows = await listEntities(store, { type });
    lines.push(`# entities of type '${type}' (${rows.length})`);
    for (const r of rows) lines.push(`- ${r.name}`);
    return lines.join('\n');
  }
  // Summary.
  lines.push(`# memory summary`);
  for (const t of Object.keys(vocabulary.entities)) {
    const rows = await listEntities(store, { type: t });
    lines.push(`- entity ${t}: ${rows.length} rows`);
  }
  return lines.join('\n');
}
```

`scripts/lib/memory/admin/validate.js`:

```js
import { loadMemoryConfig } from '../config.js';
import { loadSchema } from '../schema.js';
import { loadVocabulary } from '../types.js';
import { detectDrift } from '../drift.js';

export async function validateMemory({ io }) {
  const issues = [];
  try {
    const config = await loadMemoryConfig('foundry', io);
    if (!config.present) issues.push({ kind: 'missing-config', message: 'foundry/memory/config.md missing' });
    const schema = await loadSchema('foundry', io);
    const vocab = await loadVocabulary('foundry', io);
    const drift = detectDrift({ vocabulary: vocab, schema });
    for (const item of drift.items) issues.push(item);
  } catch (err) {
    issues.push({ kind: 'load-error', message: err.message });
  }
  return { ok: issues.length === 0, issues };
}
```

`scripts/lib/memory/admin/vacuum.js`:

```js
export async function vacuumMemory({ store }) {
  try {
    await store.db.run('::compact');
  } catch (err) {
    if (!/unknown system op/i.test(String(err))) throw err;
    // Cozo builds without ::compact silently succeed.
  }
  return { ok: true };
}
```

- [ ] **Step 4: Run, pass.**

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/memory/admin/dump.js scripts/lib/memory/admin/validate.js scripts/lib/memory/admin/vacuum.js tests/lib/memory/admin/dump.test.js tests/lib/memory/admin/validate.test.js
git commit -m "feat(memory): admin tools for dump, validate, vacuum"
```

---

## Task 9: Register admin tools in the plugin

**Files:**
- Modify: `.opencode/plugins/foundry.js`

Register eight admin tools. They are not scoped by cycle — they are operator-level.

- [ ] **Step 1: Add imports**

```js
import { createEntityType as admCreateEntity } from '../../scripts/lib/memory/admin/create-entity-type.js';
import { createEdgeType as admCreateEdge } from '../../scripts/lib/memory/admin/create-edge-type.js';
import { renameEntityType as admRenameEntity } from '../../scripts/lib/memory/admin/rename-entity-type.js';
import { renameEdgeType as admRenameEdge } from '../../scripts/lib/memory/admin/rename-edge-type.js';
import { dropEntityType as admDropEntity } from '../../scripts/lib/memory/admin/drop-entity-type.js';
import { dropEdgeType as admDropEdge } from '../../scripts/lib/memory/admin/drop-edge-type.js';
import { resetMemory as admReset } from '../../scripts/lib/memory/admin/reset.js';
import { validateMemory as admValidate } from '../../scripts/lib/memory/admin/validate.js';
import { dumpMemory as admDump } from '../../scripts/lib/memory/admin/dump.js';
import { vacuumMemory as admVacuum } from '../../scripts/lib/memory/admin/vacuum.js';
```

- [ ] **Step 2: Register tools**

Add inside `plugin.tool`:

```js
      foundry_memory_create_entity_type: tool({
        description: 'Create a new entity type with a prose body brief.',
        args: {
          name: tool.schema.string(),
          body: tool.schema.string(),
        },
        async execute(args, context) {
          try {
            const io = makeIO(context.worktree);
            const out = await admCreateEntity({ worktreeRoot: context.worktree, io, ...args });
            return JSON.stringify(out);
          } catch (err) { return errorJson(err); }
        },
      }),
      foundry_memory_create_edge_type: tool({
        description: 'Create a new edge type.',
        args: {
          name: tool.schema.string(),
          sources: tool.schema.union([tool.schema.literal('any'), tool.schema.array(tool.schema.string())]),
          targets: tool.schema.union([tool.schema.literal('any'), tool.schema.array(tool.schema.string())]),
          body: tool.schema.string(),
        },
        async execute(args, context) {
          try {
            const io = makeIO(context.worktree);
            const out = await admCreateEdge({ worktreeRoot: context.worktree, io, ...args });
            return JSON.stringify(out);
          } catch (err) { return errorJson(err); }
        },
      }),
      foundry_memory_rename_entity_type: tool({
        description: 'Rename an entity type and cascade updates to edges and rows.',
        args: { from: tool.schema.string(), to: tool.schema.string() },
        async execute(args, context) {
          try {
            const io = makeIO(context.worktree);
            const out = await admRenameEntity({ worktreeRoot: context.worktree, io, ...args });
            return JSON.stringify(out);
          } catch (err) { return errorJson(err); }
        },
      }),
      foundry_memory_rename_edge_type: tool({
        description: 'Rename an edge type.',
        args: { from: tool.schema.string(), to: tool.schema.string() },
        async execute(args, context) {
          try {
            const io = makeIO(context.worktree);
            const out = await admRenameEdge({ worktreeRoot: context.worktree, io, ...args });
            return JSON.stringify(out);
          } catch (err) { return errorJson(err); }
        },
      }),
      foundry_memory_drop_entity_type: tool({
        description: 'Destructive. Delete an entity type and cascade to affected edges. Requires confirm: true.',
        args: { name: tool.schema.string(), confirm: tool.schema.boolean() },
        async execute(args, context) {
          try {
            const io = makeIO(context.worktree);
            const out = await admDropEntity({ worktreeRoot: context.worktree, io, ...args });
            return JSON.stringify(out);
          } catch (err) { return errorJson(err); }
        },
      }),
      foundry_memory_drop_edge_type: tool({
        description: 'Destructive. Delete an edge type. Requires confirm: true.',
        args: { name: tool.schema.string(), confirm: tool.schema.boolean() },
        async execute(args, context) {
          try {
            const io = makeIO(context.worktree);
            const out = await admDropEdge({ worktreeRoot: context.worktree, io, ...args });
            return JSON.stringify(out);
          } catch (err) { return errorJson(err); }
        },
      }),
      foundry_memory_reset: tool({
        description: 'Destructive. Purge all memory data (keeps type definitions). Requires confirm: true.',
        args: { confirm: tool.schema.boolean() },
        async execute(args, context) {
          try {
            const io = makeIO(context.worktree);
            const out = await admReset({ worktreeRoot: context.worktree, io, ...args });
            return JSON.stringify(out);
          } catch (err) { return errorJson(err); }
        },
      }),
      foundry_memory_validate: tool({
        description: 'Run load-time and drift checks; returns a report.',
        args: {},
        async execute(_args, context) {
          try {
            const io = makeIO(context.worktree);
            return JSON.stringify(await admValidate({ io }));
          } catch (err) { return errorJson(err); }
        },
      }),
      foundry_memory_dump: tool({
        description: 'Human-readable snapshot of memory. Optional type + name.',
        args: {
          type: tool.schema.string().optional(),
          name: tool.schema.string().optional(),
          depth: tool.schema.number().optional(),
        },
        async execute(args, context) {
          try {
            const { store, vocabulary } = await withStore(context);
            return await admDump({ store, vocabulary, ...args });
          } catch (err) { return errorJson(err); }
        },
      }),
      foundry_memory_vacuum: tool({
        description: 'Compact the Cozo database.',
        args: {},
        async execute(_args, context) {
          try {
            const { store } = await withStore(context);
            return JSON.stringify(await admVacuum({ store }));
          } catch (err) { return errorJson(err); }
        },
      }),
```

- [ ] **Step 3: Commit**

```bash
git add .opencode/plugins/foundry.js
git commit -m "feat(memory): register schema admin tools in plugin"
```

---

## Task 10: Authoring skills (seven skills)

Each is a thin SKILL.md file. They are prose only — no tests. I include full content for each.

### 10.1 `skills/add-memory-entity-type/SKILL.md`

```markdown
---
name: add-memory-entity-type
type: atomic
description: Create a new entity type in flow memory, with a prose brief for the LLM
---

# Add Memory Entity Type

Declare a new entity type. The prose body becomes part of every cycle's prompt and
decides what the LLM writes into memory.

## Prerequisites

- Memory is initialised (`foundry/memory/` exists; run `init-memory` if not).

## Steps

1. **Ask the user for the type name** (lowercase snake_case, e.g. `class`, `stored_proc`).
2. **Check for conflicts**: invoke `foundry_memory_validate`. If an entity or edge type with this name already exists, stop and tell the user.
3. **Propose a prose body template** for the user to edit. Sections required: Name (naming convention for this type), Value (what goes in the value field, must state that relationships belong in edges), Relationships (informational list of likely edges). Example:

   ```markdown
   # <type>

   Short description of what this entity represents in the subject system.

   ## Name
   Convention for how `name` is formed. Be specific enough to guarantee uniqueness.

   ## Value
   Describe what the `value` string should contain: intrinsic characteristics of
   the entity only. Relationships to other entities belong in edges, not here.

   ## Relationships
   - `<edge>` to `<type>`: brief semantic note
   ```

4. **Confirm the body with the user.** Short bodies (≤100 chars) are a red flag; push back.
5. **Create the type** by invoking `foundry_memory_create_entity_type` with `{ name, body }`.
6. **Commit**:

   ```bash
   git add foundry/memory/entities/<name>.md foundry/memory/relations/<name>.ndjson foundry/memory/schema.json
   git commit -m "feat(memory): add entity type <name>"
   ```

7. **Guidance to the user**: suggest they also add relevant edge types using `add-memory-edge-type`.
```

### 10.2 `skills/add-memory-edge-type/SKILL.md`

```markdown
---
name: add-memory-edge-type
type: atomic
description: Create a new edge type between entity types in flow memory
---

# Add Memory Edge Type

## Prerequisites

- Memory is initialised.
- Entity types referenced in `sources` and `targets` must already exist (or be added first).

## Steps

1. **Ask the user for**: edge name (snake_case), `sources` (list of entity types or `any`), `targets` (list of entity types or `any`), and a prose body describing what the edge represents.
2. **Push back on narrow wording**. A good edge description describes WHEN the edge holds and what it does NOT cover (boundary with related edges).
3. **Invoke `foundry_memory_create_edge_type`** with `{ name, sources, targets, body }`.
4. **Commit**:

   ```bash
   git add foundry/memory/edges/<name>.md foundry/memory/relations/<name>.ndjson foundry/memory/schema.json
   git commit -m "feat(memory): add edge type <name>"
   ```
```

### 10.3 `skills/rename-memory-entity-type/SKILL.md`

```markdown
---
name: rename-memory-entity-type
type: atomic
description: Rename an entity type and migrate all referring edges and rows
---

# Rename Memory Entity Type

## Prerequisites

- The `from` entity type must exist.
- The `to` name must be free (no existing entity or edge).

## Steps

1. Ask the user for `from` and `to`.
2. Warn the user: this rewrites committed NDJSON rows in every edge that references the entity. Preview the change with `foundry_memory_validate` if desired.
3. Invoke `foundry_memory_rename_entity_type` with `{ from, to }`.
4. Commit:

   ```bash
   git add foundry/memory/
   git commit -m "refactor(memory): rename entity type <from> -> <to>"
   ```
```

### 10.4 `skills/rename-memory-edge-type/SKILL.md`

```markdown
---
name: rename-memory-edge-type
type: atomic
description: Rename an edge type (does not touch row data)
---

# Rename Memory Edge Type

## Prerequisites

- The `from` edge type must exist.
- The `to` name must be free.

## Steps

1. Ask the user for `from` and `to`.
2. Invoke `foundry_memory_rename_edge_type` with `{ from, to }`.
3. Commit:

   ```bash
   git add foundry/memory/
   git commit -m "refactor(memory): rename edge type <from> -> <to>"
   ```
```

### 10.5 `skills/drop-memory-entity-type/SKILL.md`

```markdown
---
name: drop-memory-entity-type
type: atomic
description: Delete an entity type; cascades to affected edges
---

# Drop Memory Entity Type

**Destructive.** This deletes all rows of this type and strips or removes any
edges that reference it.

## Steps

1. Ask the user for the type name.
2. Run `foundry_memory_dump` on the type to show them the data that will be deleted.
3. Require explicit "yes, delete it" confirmation.
4. Invoke `foundry_memory_drop_entity_type` with `{ name, confirm: true }`.
5. Commit:

   ```bash
   git add -A foundry/memory/
   git commit -m "refactor(memory): drop entity type <name>"
   ```
```

### 10.6 `skills/drop-memory-edge-type/SKILL.md`

```markdown
---
name: drop-memory-edge-type
type: atomic
description: Delete an edge type and all its rows
---

# Drop Memory Edge Type

**Destructive.** Deletes all edges of this type.

## Steps

1. Ask the user for the edge type name.
2. Confirm.
3. Invoke `foundry_memory_drop_edge_type` with `{ name, confirm: true }`.
4. Commit:

   ```bash
   git add -A foundry/memory/
   git commit -m "refactor(memory): drop edge type <name>"
   ```
```

### 10.7 `skills/reset-memory/SKILL.md`

```markdown
---
name: reset-memory
type: atomic
description: Purge all memory data (entities and edges) while keeping type definitions
---

# Reset Memory

**Destructive.** Empties every relation file and deletes the live `.db`. Type
definitions are preserved.

## Steps

1. Warn the user of the scope.
2. Require explicit confirmation.
3. Invoke `foundry_memory_reset` with `{ confirm: true }`.
4. Commit:

   ```bash
   git add foundry/memory/relations/ foundry/memory/schema.json
   git commit -m "chore(memory): reset memory data"
   ```
```

- [ ] **Step 1: Write all seven SKILL.md files** as above.

- [ ] **Step 2: Commit**

```bash
git add skills/add-memory-entity-type skills/add-memory-edge-type skills/rename-memory-entity-type skills/rename-memory-edge-type skills/drop-memory-entity-type skills/drop-memory-edge-type skills/reset-memory
git commit -m "feat(memory): add seven authoring/maintenance skills"
```

---

## Task 11: Full suite

- [ ] **Step 1: Run**

```bash
npm test
```

Expected: all previous plus ~30 new admin tests pass.

---

## Definition of Done for Plan 3

- Ten admin operations exposed as `foundry_memory_*` tools.
- Seven skills scaffold, rename, drop, and reset memory types.
- Drop-entity cascade is tested for both the "strip from list" and "fully-drop-edge" scenarios.
- Rename-entity rewrites dependent edge rows deterministically.
- Schema version is bumped on every mutation.

## What this plan deliberately does NOT do

- Cycle-scoped permissions (Plan 4).
- Embeddings and embedding-model migration (Plan 5).
- Transactional atomicity of admin operations — partial-failure recovery is left to `foundry_memory_validate` + manual intervention. Addressed in a future plan if it bites.

## Handoff to Plan 4

Plan 4 ("Cycle integration") uses the `getContext` return from `singleton.js` to resolve each cycle's read/write permission sets and apply them to the seven cycle-facing tools from Plan 2. It also renders the vocabulary into cycle prompts and adds the end-of-flow sync trigger.
