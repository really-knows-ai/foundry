# Flow Memory — Plan 1: Foundation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the on-disk layout and pure-Node primitives for flow memory: config loading, `schema.json`, deterministic NDJSON serialisation, entity/edge type file loading with frontmatter-drift detection, and the `init-memory` skill. No Cozo, no tools, no cycle integration — those come in later plans.

**Architecture:** All memory logic lives in `scripts/lib/memory/` as pure, synchronous-or-async ESM modules that accept an injected `io` adapter (matching the existing `scripts/lib/config.js` pattern). Tests use an in-memory `io` mock. The plugin is not touched in this plan — everything here is library code plus one authoring skill.

**Tech Stack:** Node ≥18.3, ESM, `node:test`, `node:assert/strict`, `js-yaml` (already a dep), `minimatch` (already a dep). No new npm dependencies in this plan.

**Spec reference:** `MEMORY.md` §§3, 4, 6, 9.1 (`init-memory` only), 10.1, 11.1.

---

## File Structure

**Created in this plan:**

- `scripts/lib/memory/config.js` — loads and validates `foundry/memory/config.md`.
- `scripts/lib/memory/schema.js` — reads, writes, versions `foundry/memory/schema.json`.
- `scripts/lib/memory/ndjson.js` — deterministic serialise/parse for entity and edge NDJSON.
- `scripts/lib/memory/types.js` — loads entity and edge type files; validates required sections; produces a vocabulary.
- `scripts/lib/memory/drift.js` — detects hand-edits to type-file frontmatter against `schema.json` (Posture A).
- `scripts/lib/memory/paths.js` — single source of truth for memory directory layout.
- `skills/init-memory/SKILL.md` — guided workflow to scaffold `foundry/memory/`.
- `tests/lib/memory/config.test.js`
- `tests/lib/memory/schema.test.js`
- `tests/lib/memory/ndjson.test.js`
- `tests/lib/memory/types.test.js`
- `tests/lib/memory/drift.test.js`

**Not touched in this plan:**

- `.opencode/plugins/foundry.js` — left alone. No tools are exposed from this plan.
- `scripts/lib/config.js` — left alone.
- `package.json` — no new dependencies.

---

## Task 1: Memory path constants

**Files:**
- Create: `scripts/lib/memory/paths.js`
- Test: `tests/lib/memory/paths.test.js`

Centralise all relative paths under `foundry/memory/` so later modules don't drift.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/memory/paths.test.js`:

```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { memoryPaths } from '../../../scripts/lib/memory/paths.js';

describe('memoryPaths', () => {
  it('produces canonical paths under foundry/memory', () => {
    const p = memoryPaths('foundry');
    assert.equal(p.root, 'foundry/memory');
    assert.equal(p.config, 'foundry/memory/config.md');
    assert.equal(p.schema, 'foundry/memory/schema.json');
    assert.equal(p.entitiesDir, 'foundry/memory/entities');
    assert.equal(p.edgesDir, 'foundry/memory/edges');
    assert.equal(p.relationsDir, 'foundry/memory/relations');
    assert.equal(p.db, 'foundry/memory/memory.db');
  });

  it('resolves per-type file paths', () => {
    const p = memoryPaths('foundry');
    assert.equal(p.entityTypeFile('class'), 'foundry/memory/entities/class.md');
    assert.equal(p.edgeTypeFile('calls'), 'foundry/memory/edges/calls.md');
    assert.equal(p.relationFile('class'), 'foundry/memory/relations/class.ndjson');
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

`node --test tests/lib/memory/paths.test.js` → FAIL (module not found).

- [ ] **Step 3: Implement**

Create `scripts/lib/memory/paths.js`:

```js
import { join } from 'path';

export function memoryPaths(foundryDir) {
  const root = join(foundryDir, 'memory');
  const entitiesDir = join(root, 'entities');
  const edgesDir = join(root, 'edges');
  const relationsDir = join(root, 'relations');
  return {
    root,
    config: join(root, 'config.md'),
    schema: join(root, 'schema.json'),
    entitiesDir,
    edgesDir,
    relationsDir,
    db: join(root, 'memory.db'),
    entityTypeFile: (name) => join(entitiesDir, `${name}.md`),
    edgeTypeFile: (name) => join(edgesDir, `${name}.md`),
    relationFile: (name) => join(relationsDir, `${name}.ndjson`),
  };
}
```

- [ ] **Step 4: Run test, verify it passes**

`node --test tests/lib/memory/paths.test.js` → PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/memory/paths.js tests/lib/memory/paths.test.js
git commit -m "feat(memory): add path constants for foundry/memory layout"
```

---

## Task 2: Config loader

**Files:**
- Create: `scripts/lib/memory/config.js`
- Test: `tests/lib/memory/config.test.js`

Parse `foundry/memory/config.md` (YAML frontmatter + optional prose body). Apply defaults. Validate shape.

- [ ] **Step 1: Write the failing test**

`tests/lib/memory/config.test.js`:

```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadMemoryConfig, DEFAULT_CONFIG } from '../../../scripts/lib/memory/config.js';

function mockIO(files) {
  return {
    exists: async (p) => p in files,
    readFile: async (p) => {
      if (!(p in files)) throw new Error(`Not found: ${p}`);
      return files[p];
    },
  };
}

describe('loadMemoryConfig', () => {
  it('returns disabled config when file missing', async () => {
    const cfg = await loadMemoryConfig('foundry', mockIO({}));
    assert.equal(cfg.enabled, false);
    assert.equal(cfg.present, false);
  });

  it('parses frontmatter and applies defaults', async () => {
    const text = `---\nenabled: true\n---\n\n# notes\n`;
    const cfg = await loadMemoryConfig('foundry', mockIO({ 'foundry/memory/config.md': text }));
    assert.equal(cfg.enabled, true);
    assert.equal(cfg.validation, 'strict');
    assert.equal(cfg.embeddings.enabled, DEFAULT_CONFIG.embeddings.enabled);
    assert.equal(cfg.embeddings.baseURL, DEFAULT_CONFIG.embeddings.baseURL);
    assert.equal(cfg.embeddings.model, DEFAULT_CONFIG.embeddings.model);
  });

  it('user config overrides defaults but keeps unspecified keys', async () => {
    const text = `---\nenabled: true\nvalidation: lax\nembeddings:\n  model: all-minilm\n  dimensions: 384\n---\n`;
    const cfg = await loadMemoryConfig('foundry', mockIO({ 'foundry/memory/config.md': text }));
    assert.equal(cfg.validation, 'lax');
    assert.equal(cfg.embeddings.model, 'all-minilm');
    assert.equal(cfg.embeddings.dimensions, 384);
    assert.equal(cfg.embeddings.baseURL, DEFAULT_CONFIG.embeddings.baseURL);
    assert.equal(cfg.embeddings.batchSize, DEFAULT_CONFIG.embeddings.batchSize);
  });

  it('rejects unknown validation mode', async () => {
    const text = `---\nenabled: true\nvalidation: weird\n---\n`;
    await assert.rejects(
      () => loadMemoryConfig('foundry', mockIO({ 'foundry/memory/config.md': text })),
      /validation.*must be/i,
    );
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

`node --test tests/lib/memory/config.test.js` → FAIL.

- [ ] **Step 3: Implement**

`scripts/lib/memory/config.js`:

```js
import yaml from 'js-yaml';
import { memoryPaths } from './paths.js';

export const DEFAULT_CONFIG = Object.freeze({
  enabled: false,
  present: false,
  validation: 'strict',
  embeddings: Object.freeze({
    enabled: true,
    baseURL: 'http://localhost:11434/v1',
    model: 'nomic-embed-text',
    dimensions: 768,
    apiKey: null,
    batchSize: 64,
    timeoutMs: 30000,
  }),
});

function parseFrontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  const parsed = yaml.load(m[1]);
  return parsed && typeof parsed === 'object' ? parsed : {};
}

function mergeEmbeddings(userE) {
  const base = { ...DEFAULT_CONFIG.embeddings };
  if (!userE || typeof userE !== 'object') return base;
  for (const key of Object.keys(base)) {
    if (key in userE && userE[key] !== undefined) base[key] = userE[key];
  }
  return base;
}

function validate(cfg) {
  if (!['strict', 'lax'].includes(cfg.validation)) {
    throw new Error(`memory config: validation must be 'strict' or 'lax', got ${JSON.stringify(cfg.validation)}`);
  }
  const e = cfg.embeddings;
  if (typeof e.enabled !== 'boolean') throw new Error('memory config: embeddings.enabled must be boolean');
  if (e.enabled) {
    if (typeof e.baseURL !== 'string' || !e.baseURL) throw new Error('memory config: embeddings.baseURL required');
    if (typeof e.model !== 'string' || !e.model) throw new Error('memory config: embeddings.model required');
    if (!Number.isInteger(e.dimensions) || e.dimensions <= 0) throw new Error('memory config: embeddings.dimensions must be positive integer');
    if (!Number.isInteger(e.batchSize) || e.batchSize <= 0) throw new Error('memory config: embeddings.batchSize must be positive integer');
  }
}

export async function loadMemoryConfig(foundryDir, io) {
  const p = memoryPaths(foundryDir);
  if (!(await io.exists(p.config))) {
    return { ...DEFAULT_CONFIG, embeddings: { ...DEFAULT_CONFIG.embeddings } };
  }
  const text = await io.readFile(p.config);
  const fm = parseFrontmatter(text);
  const cfg = {
    present: true,
    enabled: fm.enabled === true,
    validation: fm.validation ?? DEFAULT_CONFIG.validation,
    embeddings: mergeEmbeddings(fm.embeddings),
  };
  validate(cfg);
  return cfg;
}
```

- [ ] **Step 4: Run test, verify it passes**

`node --test tests/lib/memory/config.test.js` → PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/memory/config.js tests/lib/memory/config.test.js
git commit -m "feat(memory): add config loader with defaults and validation"
```

---

## Task 3: Schema.json read/write and version bumping

**Files:**
- Create: `scripts/lib/memory/schema.js`
- Test: `tests/lib/memory/schema.test.js`

`schema.json` is the authoritative record of: schema version, declared entity types, declared edge types (with sources/targets), the last-applied frontmatter of each type (for drift detection), and embedding model + dimensions.

- [ ] **Step 1: Write the failing test**

`tests/lib/memory/schema.test.js`:

```js
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
    // Object key order in JSON.stringify respects insertion order; we sort on write.
    assert.deepEqual(Object.keys(reparsed.entities), ['alpha', 'zeta']);
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
```

- [ ] **Step 2: Run test, verify it fails**

- [ ] **Step 3: Implement**

`scripts/lib/memory/schema.js`:

```js
import { createHash } from 'node:crypto';
import { memoryPaths } from './paths.js';

export function emptySchema() {
  return { version: 1, entities: {}, edges: {}, embeddings: null };
}

export async function loadSchema(foundryDir, io) {
  const p = memoryPaths(foundryDir);
  if (!(await io.exists(p.schema))) return emptySchema();
  const text = await io.readFile(p.schema);
  const parsed = JSON.parse(text);
  return {
    version: parsed.version ?? 1,
    entities: parsed.entities ?? {},
    edges: parsed.edges ?? {},
    embeddings: parsed.embeddings ?? null,
  };
}

function sortedKeys(obj) {
  const out = {};
  for (const k of Object.keys(obj).sort()) out[k] = obj[k];
  return out;
}

function normaliseForWrite(schema) {
  return {
    version: schema.version,
    entities: sortedKeys(schema.entities),
    edges: sortedKeys(schema.edges),
    embeddings: schema.embeddings,
  };
}

export async function writeSchema(foundryDir, schema, io) {
  const p = memoryPaths(foundryDir);
  if (!(await io.exists(p.root))) await io.mkdir(p.root);
  const out = normaliseForWrite(schema);
  const text = JSON.stringify(out, null, 2) + '\n';
  await io.writeFile(p.schema, text);
}

export function bumpVersion(schema) {
  schema.version = (schema.version ?? 0) + 1;
  return schema.version;
}

function canonicalise(value) {
  if (Array.isArray(value)) return value.map(canonicalise);
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value).sort()) out[k] = canonicalise(value[k]);
    return out;
  }
  return value;
}

export function hashFrontmatter(fm) {
  const canon = JSON.stringify(canonicalise(fm ?? {}));
  return createHash('sha256').update(canon).digest('hex');
}
```

- [ ] **Step 4: Run test, verify it passes**

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/memory/schema.js tests/lib/memory/schema.test.js
git commit -m "feat(memory): add schema.json read/write with stable hashing"
```

---

## Task 4: Deterministic NDJSON serialisation

**Files:**
- Create: `scripts/lib/memory/ndjson.js`
- Test: `tests/lib/memory/ndjson.test.js`

Pure functions: given an array of rows, produce canonical NDJSON. Given NDJSON text, produce rows.

Determinism rules (enforced in code):
1. Rows sorted by primary key.
2. Object keys sorted alphabetically.
3. Floats serialised with a fixed formatter (we use `Number.prototype.toString`; reject `NaN`/`Infinity`).
4. Unix `\n` line endings, UTF-8, no trailing whitespace, one trailing newline on non-empty files.

- [ ] **Step 1: Write the failing test**

`tests/lib/memory/ndjson.test.js`:

```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  serialiseEntityRows,
  parseEntityRows,
  serialiseEdgeRows,
  parseEdgeRows,
} from '../../../scripts/lib/memory/ndjson.js';

describe('serialiseEntityRows', () => {
  it('sorts by name and produces one line per row with trailing newline', () => {
    const rows = [
      { name: 'b', value: 'vb' },
      { name: 'a', value: 'va' },
    ];
    const text = serialiseEntityRows(rows);
    assert.equal(text, '{"name":"a","value":"va"}\n{"name":"b","value":"vb"}\n');
  });

  it('returns empty string for empty array', () => {
    assert.equal(serialiseEntityRows([]), '');
  });

  it('sorts JSON keys alphabetically regardless of input order', () => {
    const rows = [{ value: 'v', name: 'a' }];
    assert.equal(serialiseEntityRows(rows), '{"name":"a","value":"v"}\n');
  });

  it('preserves embeddings array verbatim', () => {
    const rows = [{ name: 'a', value: 'v', embedding: [0.1, 0.2, 0.3] }];
    const text = serialiseEntityRows(rows);
    assert.equal(text, '{"embedding":[0.1,0.2,0.3],"name":"a","value":"v"}\n');
  });

  it('rejects non-finite numbers in embeddings', () => {
    assert.throws(
      () => serialiseEntityRows([{ name: 'a', value: 'v', embedding: [NaN] }]),
      /non-finite/i,
    );
  });

  it('round-trips through parse', () => {
    const rows = [{ name: 'a', value: 'hello "world"\nline2' }];
    const parsed = parseEntityRows(serialiseEntityRows(rows));
    assert.deepEqual(parsed, rows);
  });
});

describe('serialiseEdgeRows', () => {
  it('sorts by (from_type, from_name, to_type, to_name)', () => {
    const rows = [
      { from_type: 'class', from_name: 'B', to_type: 'table', to_name: 'x' },
      { from_type: 'class', from_name: 'A', to_type: 'table', to_name: 'x' },
    ];
    const text = serialiseEdgeRows(rows);
    const lines = text.trim().split('\n').map(JSON.parse);
    assert.equal(lines[0].from_name, 'A');
    assert.equal(lines[1].from_name, 'B');
  });

  it('round-trips', () => {
    const rows = [{ from_type: 'a', from_name: 'x', to_type: 'b', to_name: 'y' }];
    assert.deepEqual(parseEdgeRows(serialiseEdgeRows(rows)), rows);
  });
});

describe('parseEntityRows', () => {
  it('handles empty and whitespace-only input', () => {
    assert.deepEqual(parseEntityRows(''), []);
    assert.deepEqual(parseEntityRows('\n\n'), []);
  });

  it('throws on malformed line with line number', () => {
    assert.throws(() => parseEntityRows('{"name":"a"}\nnotjson\n'), /line 2/);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

- [ ] **Step 3: Implement**

`scripts/lib/memory/ndjson.js`:

```js
function assertFiniteNumbers(value, path) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`NDJSON: non-finite number at ${path}`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertFiniteNumbers(v, `${path}[${i}]`));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) assertFiniteNumbers(v, `${path}.${k}`);
  }
}

function canonicalise(value) {
  if (Array.isArray(value)) return value.map(canonicalise);
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value).sort()) out[k] = canonicalise(value[k]);
    return out;
  }
  return value;
}

function serialiseLine(row) {
  assertFiniteNumbers(row, 'row');
  return JSON.stringify(canonicalise(row));
}

function compareEntity(a, b) {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

const EDGE_KEY_ORDER = ['from_type', 'from_name', 'to_type', 'to_name'];
function compareEdge(a, b) {
  for (const k of EDGE_KEY_ORDER) {
    if (a[k] < b[k]) return -1;
    if (a[k] > b[k]) return 1;
  }
  return 0;
}

export function serialiseEntityRows(rows) {
  if (rows.length === 0) return '';
  const sorted = [...rows].sort(compareEntity);
  return sorted.map(serialiseLine).join('\n') + '\n';
}

export function serialiseEdgeRows(rows) {
  if (rows.length === 0) return '';
  const sorted = [...rows].sort(compareEdge);
  return sorted.map(serialiseLine).join('\n') + '\n';
}

function parseLines(text) {
  const out = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '') continue;
    try {
      out.push(JSON.parse(line));
    } catch (err) {
      throw new Error(`NDJSON: invalid JSON at line ${i + 1}: ${err.message}`);
    }
  }
  return out;
}

export const parseEntityRows = parseLines;
export const parseEdgeRows = parseLines;
```

- [ ] **Step 4: Run test, verify it passes**

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/memory/ndjson.js tests/lib/memory/ndjson.test.js
git commit -m "feat(memory): add deterministic NDJSON serialisation for entities and edges"
```

---

## Task 5: Type file loader (entities and edges)

**Files:**
- Create: `scripts/lib/memory/types.js`
- Test: `tests/lib/memory/types.test.js`

Loads `foundry/memory/entities/*.md` and `foundry/memory/edges/*.md`. For each: parses frontmatter, checks non-empty body, validates required fields. Produces a `vocabulary` object keyed by type name.

Required entity frontmatter: `type: <string>` matching filename stem.
Required edge frontmatter: `type`, `sources` (list or `'any'`), `targets` (list or `'any'`).
Body must be non-empty (§4.2, §4.3). Empty body → load failure.

- [ ] **Step 1: Write the failing test**

`tests/lib/memory/types.test.js`:

```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadVocabulary } from '../../../scripts/lib/memory/types.js';

function mockIO(files = {}, dirs = {}) {
  return {
    exists: async (p) => p in files || p in dirs,
    readFile: async (p) => files[p],
    readDir: async (p) => dirs[p] ?? [],
  };
}

const CLASS_MD = `---
type: class
---

# class

A Java class observed in the current source tree.

## Name
Fully-qualified dot-notation name.

## Value
Intrinsic description. Relationships live in edges.

## Relationships
- has method
`;

const CALLS_MD = `---
type: calls
sources: [class, method]
targets: [class, method]
---

# calls

Call-site relationship observed in current source.
`;

describe('loadVocabulary', () => {
  it('loads an empty vocabulary when memory dir is absent', async () => {
    const vocab = await loadVocabulary('foundry', mockIO());
    assert.deepEqual(vocab.entities, {});
    assert.deepEqual(vocab.edges, {});
  });

  it('loads entity and edge type files', async () => {
    const io = mockIO(
      {
        'foundry/memory/entities/class.md': CLASS_MD,
        'foundry/memory/edges/calls.md': CALLS_MD,
      },
      {
        'foundry/memory': ['entities', 'edges'],
        'foundry/memory/entities': ['class.md'],
        'foundry/memory/edges': ['calls.md'],
      },
    );
    const vocab = await loadVocabulary('foundry', io);
    assert.equal(vocab.entities.class.type, 'class');
    assert.ok(vocab.entities.class.body.length > 0);
    assert.equal(vocab.edges.calls.type, 'calls');
    assert.deepEqual(vocab.edges.calls.sources, ['class', 'method']);
    assert.deepEqual(vocab.edges.calls.targets, ['class', 'method']);
  });

  it('rejects entity type with empty body', async () => {
    const text = `---\ntype: class\n---\n\n`;
    const io = mockIO(
      { 'foundry/memory/entities/class.md': text },
      { 'foundry/memory': ['entities'], 'foundry/memory/entities': ['class.md'], 'foundry/memory/edges': [] },
    );
    await assert.rejects(() => loadVocabulary('foundry', io), /empty body/i);
  });

  it('rejects entity type where frontmatter.type does not match filename stem', async () => {
    const text = `---\ntype: klass\n---\n\nbody\n`;
    const io = mockIO(
      { 'foundry/memory/entities/class.md': text },
      { 'foundry/memory': ['entities'], 'foundry/memory/entities': ['class.md'], 'foundry/memory/edges': [] },
    );
    await assert.rejects(() => loadVocabulary('foundry', io), /does not match filename/i);
  });

  it('accepts edge with any as sources or targets', async () => {
    const text = `---\ntype: references\nsources: any\ntargets: any\n---\n\nbody\n`;
    const io = mockIO(
      { 'foundry/memory/edges/references.md': text },
      { 'foundry/memory': ['edges'], 'foundry/memory/entities': [], 'foundry/memory/edges': ['references.md'] },
    );
    const vocab = await loadVocabulary('foundry', io);
    assert.equal(vocab.edges.references.sources, 'any');
    assert.equal(vocab.edges.references.targets, 'any');
  });

  it('rejects edge missing sources', async () => {
    const text = `---\ntype: calls\ntargets: [class]\n---\n\nbody\n`;
    const io = mockIO(
      { 'foundry/memory/edges/calls.md': text },
      { 'foundry/memory': ['edges'], 'foundry/memory/entities': [], 'foundry/memory/edges': ['calls.md'] },
    );
    await assert.rejects(() => loadVocabulary('foundry', io), /sources/);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

- [ ] **Step 3: Implement**

`scripts/lib/memory/types.js`:

```js
import yaml from 'js-yaml';
import { join, basename, extname } from 'path';
import { memoryPaths } from './paths.js';

function splitFrontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\r?\n?([\s\S]*)$/);
  if (!m) return { frontmatter: {}, body: text.trim() };
  const fm = yaml.load(m[1]);
  return { frontmatter: fm && typeof fm === 'object' ? fm : {}, body: (m[2] ?? '').trim() };
}

function validateEntity(filename, parsed) {
  const stem = basename(filename, extname(filename));
  const fm = parsed.frontmatter;
  if (!fm.type || typeof fm.type !== 'string') {
    throw new Error(`entity type ${filename}: missing frontmatter 'type'`);
  }
  if (fm.type !== stem) {
    throw new Error(`entity type ${filename}: frontmatter type '${fm.type}' does not match filename stem '${stem}'`);
  }
  if (!parsed.body) {
    throw new Error(`entity type ${filename}: empty body is not allowed`);
  }
}

function validateEdge(filename, parsed) {
  const stem = basename(filename, extname(filename));
  const fm = parsed.frontmatter;
  if (!fm.type || typeof fm.type !== 'string') {
    throw new Error(`edge type ${filename}: missing frontmatter 'type'`);
  }
  if (fm.type !== stem) {
    throw new Error(`edge type ${filename}: frontmatter type '${fm.type}' does not match filename stem '${stem}'`);
  }
  for (const key of ['sources', 'targets']) {
    const v = fm[key];
    if (v === undefined) throw new Error(`edge type ${filename}: missing frontmatter '${key}'`);
    if (v === 'any') continue;
    if (!Array.isArray(v) || v.length === 0 || !v.every((s) => typeof s === 'string' && s)) {
      throw new Error(`edge type ${filename}: '${key}' must be 'any' or a non-empty list of strings`);
    }
  }
  if (!parsed.body) {
    throw new Error(`edge type ${filename}: empty body is not allowed`);
  }
}

async function loadDir(dir, io) {
  if (!(await io.exists(dir))) return [];
  const entries = await io.readDir(dir);
  return entries.filter((e) => e.endsWith('.md') && e !== '.gitkeep').sort();
}

export async function loadVocabulary(foundryDir, io) {
  const p = memoryPaths(foundryDir);
  const vocab = { entities: {}, edges: {} };

  for (const file of await loadDir(p.entitiesDir, io)) {
    const text = await io.readFile(join(p.entitiesDir, file));
    const parsed = splitFrontmatter(text);
    validateEntity(file, parsed);
    const { type } = parsed.frontmatter;
    vocab.entities[type] = {
      type,
      body: parsed.body,
      frontmatter: parsed.frontmatter,
      file: join(p.entitiesDir, file),
    };
  }

  for (const file of await loadDir(p.edgesDir, io)) {
    const text = await io.readFile(join(p.edgesDir, file));
    const parsed = splitFrontmatter(text);
    validateEdge(file, parsed);
    const { type, sources, targets } = parsed.frontmatter;
    vocab.edges[type] = {
      type,
      sources,
      targets,
      body: parsed.body,
      frontmatter: parsed.frontmatter,
      file: join(p.edgesDir, file),
    };
  }

  return vocab;
}
```

- [ ] **Step 4: Run test, verify it passes**

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/memory/types.js tests/lib/memory/types.test.js
git commit -m "feat(memory): add entity and edge type file loader with validation"
```

---

## Task 6: Frontmatter drift detection (Posture A)

**Files:**
- Create: `scripts/lib/memory/drift.js`
- Test: `tests/lib/memory/drift.test.js`

Compares current frontmatter hash of each loaded type against the last-applied hash recorded in `schema.json`. Produces a list of drift items. Clients (later: the plugin boot path) decide how to surface them. This module does not throw; it returns a structured report.

- [ ] **Step 1: Write the failing test**

`tests/lib/memory/drift.test.js`:

```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { detectDrift } from '../../../scripts/lib/memory/drift.js';
import { hashFrontmatter } from '../../../scripts/lib/memory/schema.js';

const fm = { type: 'class' };
const hash = hashFrontmatter(fm);

describe('detectDrift', () => {
  it('reports no drift when hashes match', () => {
    const report = detectDrift({
      vocabulary: { entities: { class: { frontmatter: fm } }, edges: {} },
      schema: { entities: { class: { frontmatterHash: hash } }, edges: {} },
    });
    assert.equal(report.hasDrift, false);
    assert.deepEqual(report.items, []);
  });

  it('reports frontmatter-mismatch when hash differs', () => {
    const report = detectDrift({
      vocabulary: { entities: { class: { frontmatter: { type: 'class', extra: 'x' } } }, edges: {} },
      schema: { entities: { class: { frontmatterHash: hash } }, edges: {} },
    });
    assert.equal(report.hasDrift, true);
    assert.equal(report.items[0].kind, 'frontmatter-mismatch');
    assert.equal(report.items[0].typeFamily, 'entity');
    assert.equal(report.items[0].typeName, 'class');
    assert.match(report.items[0].suggestedSkill, /rename-memory-entity-type|drop-memory-entity-type/);
  });

  it('reports unknown-type for on-disk types not in schema', () => {
    const report = detectDrift({
      vocabulary: { entities: { ghost: { frontmatter: { type: 'ghost' } } }, edges: {} },
      schema: { entities: {}, edges: {} },
    });
    assert.equal(report.items[0].kind, 'unknown-type');
    assert.equal(report.items[0].typeName, 'ghost');
    assert.match(report.items[0].suggestedSkill, /add-memory-entity-type/);
  });

  it('reports missing-file for schema types with no file on disk', () => {
    const report = detectDrift({
      vocabulary: { entities: {}, edges: {} },
      schema: { entities: { class: { frontmatterHash: hash } }, edges: {} },
    });
    assert.equal(report.items[0].kind, 'missing-file');
    assert.equal(report.items[0].typeName, 'class');
    assert.match(report.items[0].suggestedSkill, /drop-memory-entity-type|rename-memory-entity-type/);
  });

  it('checks edges the same way', () => {
    const edgeFm = { type: 'calls', sources: 'any', targets: 'any' };
    const edgeHash = hashFrontmatter(edgeFm);
    const report = detectDrift({
      vocabulary: { entities: {}, edges: { calls: { frontmatter: { ...edgeFm, sources: ['class'] } } } },
      schema: { entities: {}, edges: { calls: { frontmatterHash: edgeHash } } },
    });
    assert.equal(report.items[0].typeFamily, 'edge');
    assert.equal(report.items[0].kind, 'frontmatter-mismatch');
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

- [ ] **Step 3: Implement**

`scripts/lib/memory/drift.js`:

```js
import { hashFrontmatter } from './schema.js';

function compareFamily({ family, loaded, recorded }) {
  const items = [];
  const loadedNames = new Set(Object.keys(loaded));
  const recordedNames = new Set(Object.keys(recorded));

  for (const name of loadedNames) {
    if (!recordedNames.has(name)) {
      items.push({
        kind: 'unknown-type',
        typeFamily: family,
        typeName: name,
        message: `${family} type '${name}' exists on disk but is not recorded in schema.json`,
        suggestedSkill: `add-memory-${family}-type`,
      });
      continue;
    }
    const currentHash = hashFrontmatter(loaded[name].frontmatter);
    if (currentHash !== recorded[name].frontmatterHash) {
      items.push({
        kind: 'frontmatter-mismatch',
        typeFamily: family,
        typeName: name,
        message: `${family} type '${name}' frontmatter was modified outside of a skill`,
        suggestedSkill: `rename-memory-${family}-type or drop-memory-${family}-type`,
      });
    }
  }

  for (const name of recordedNames) {
    if (!loadedNames.has(name)) {
      items.push({
        kind: 'missing-file',
        typeFamily: family,
        typeName: name,
        message: `${family} type '${name}' is recorded in schema.json but its file is missing on disk`,
        suggestedSkill: `drop-memory-${family}-type or rename-memory-${family}-type`,
      });
    }
  }

  return items;
}

export function detectDrift({ vocabulary, schema }) {
  const items = [
    ...compareFamily({ family: 'entity', loaded: vocabulary.entities, recorded: schema.entities }),
    ...compareFamily({ family: 'edge', loaded: vocabulary.edges, recorded: schema.edges }),
  ];
  return { hasDrift: items.length > 0, items };
}
```

- [ ] **Step 4: Run test, verify it passes**

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/memory/drift.js tests/lib/memory/drift.test.js
git commit -m "feat(memory): add frontmatter drift detection (Posture A)"
```

---

## Task 7: `init-memory` skill

**Files:**
- Create: `skills/init-memory/SKILL.md`

The skill is a human-facing authored workflow. It has no tests (skills are prose). It does three things:

1. Verifies `foundry/` exists (memory requires Foundry initialised).
2. Scaffolds `foundry/memory/` with empty `entities/`, `edges/`, `relations/` directories, a starter `config.md`, a seed `schema.json`, and appends `.gitignore` entries for `memory.db` and its SQLite sidecars.
3. Stops without probing the embedding endpoint — endpoint probing is Plan 5's job. Plan 1 produces an initialised project that can hold memory; it does not yet talk to any provider.

- [ ] **Step 1: Write the skill**

`skills/init-memory/SKILL.md`:

````markdown
---
name: init-memory
type: atomic
description: Initialize flow memory by creating the foundry/memory/ directory structure
---

# Initialize Flow Memory

Scaffold `foundry/memory/` in the current project. This prepares the directory for
entity types, edge types, committed NDJSON relations, and a gitignored Cozo database.

## Prerequisites

- `foundry/` must already exist. If it does not, stop and tell the user to run `init-foundry` first.
- `foundry/memory/` must not already exist. If it does, stop and tell the user.

## Steps

1. **Verify preconditions**
   - If `foundry/` is missing: stop with the message "Run `init-foundry` first."
   - If `foundry/memory/` exists: stop with the message "Memory is already initialised."

2. **Create the directory tree**

   ```
   foundry/memory/
     entities/.gitkeep
     edges/.gitkeep
     relations/.gitkeep
   ```

3. **Write `foundry/memory/config.md`** with this exact content:

   ```markdown
   ---
   enabled: true
   validation: strict
   embeddings:
     enabled: true
     baseURL: http://localhost:11434/v1
     model: nomic-embed-text
     dimensions: 768
     apiKey: null
     batchSize: 64
     timeoutMs: 30000
   ---

   # Memory configuration

   This project uses Foundry flow memory. Add prose notes here if helpful.

   Embedding provider defaults to a local Ollama instance. The embedding probe
   and semantic-search features are added in a later plan; for now, memory can
   be authored and read as a structural knowledge graph.
   ```

4. **Write `foundry/memory/schema.json`** with this exact content:

   ```json
   {
     "version": 1,
     "entities": {},
     "edges": {},
     "embeddings": null
   }
   ```

   Note: no trailing whitespace, Unix newlines, trailing newline at end of file.

5. **Append `.gitignore` entries** (create `.gitignore` if missing; otherwise append only if entries are not already present):

   ```
   foundry/memory/memory.db
   foundry/memory/memory.db-wal
   foundry/memory/memory.db-shm
   ```

6. **Commit the scaffold**

   ```bash
   git add foundry/memory/ .gitignore
   git commit -m "feat: initialise flow memory"
   ```

7. **Tell the user what is next**

   > Flow memory is scaffolded. Next steps:
   >
   > - Use the `add-memory-entity-type` skill (available in a later plan) to declare entity types such as `class`, `method`, `table`.
   > - Use the `add-memory-edge-type` skill (available in a later plan) to declare edge types such as `calls`, `writes`, `references`.
   > - Memory tools are not wired up yet in this phase.
````

- [ ] **Step 2: Commit**

```bash
git add skills/init-memory/SKILL.md
git commit -m "feat(memory): add init-memory skill"
```

---

## Task 8: Manual integration check

Subagents cannot run this step because it mutates the repo state the user cares about. Assign to human reviewer.

- [ ] **Step 1: Run the skill in a throwaway worktree**

Create a clean temp directory, copy `foundry/` minimal scaffold into it, and execute the `init-memory` skill through OpenCode. Verify:

- `foundry/memory/config.md`, `foundry/memory/schema.json` created with content matching Task 7.
- `foundry/memory/entities/.gitkeep`, `foundry/memory/edges/.gitkeep`, `foundry/memory/relations/.gitkeep` present.
- `.gitignore` contains the three memory sidecar patterns exactly once.
- Git commit landed.

- [ ] **Step 2: Run the full test suite**

```bash
npm test
```

Expected: all tests pass, including 5 new memory test files.

- [ ] **Step 3: Sanity check: config + schema + drift end-to-end on a fake project**

Create `tests/lib/memory/integration.test.js`:

```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadMemoryConfig } from '../../../scripts/lib/memory/config.js';
import { loadSchema, hashFrontmatter, writeSchema } from '../../../scripts/lib/memory/schema.js';
import { loadVocabulary } from '../../../scripts/lib/memory/types.js';
import { detectDrift } from '../../../scripts/lib/memory/drift.js';

function memIO() {
  const store = {};
  const dirs = new Set();
  return {
    store,
    dirs,
    exists: async (p) => p in store || dirs.has(p),
    readFile: async (p) => store[p],
    writeFile: async (p, c) => { store[p] = c; },
    readDir: async (p) => {
      const prefix = p + '/';
      const names = new Set();
      for (const key of Object.keys(store)) {
        if (key.startsWith(prefix)) {
          const rest = key.slice(prefix.length);
          names.add(rest.split('/')[0]);
        }
      }
      return [...names];
    },
    mkdir: async (p) => { dirs.add(p); },
  };
}

describe('memory foundation integration', () => {
  it('scaffolded project loads cleanly with no drift', async () => {
    const io = memIO();
    io.store['foundry/memory/config.md'] = '---\nenabled: true\n---\n';
    io.store['foundry/memory/entities/class.md'] =
      '---\ntype: class\n---\n\n# class\nBody.\n';
    io.store['foundry/memory/edges/calls.md'] =
      '---\ntype: calls\nsources: [class]\ntargets: [class]\n---\n\n# calls\nBody.\n';

    const cfg = await loadMemoryConfig('foundry', io);
    assert.equal(cfg.enabled, true);

    const vocab = await loadVocabulary('foundry', io);
    const schema = {
      version: 1,
      entities: { class: { frontmatterHash: hashFrontmatter(vocab.entities.class.frontmatter) } },
      edges: { calls: { frontmatterHash: hashFrontmatter(vocab.edges.calls.frontmatter) } },
      embeddings: null,
    };
    await writeSchema('foundry', schema, io);
    const reloaded = await loadSchema('foundry', io);
    const report = detectDrift({ vocabulary: vocab, schema: reloaded });
    assert.equal(report.hasDrift, false);
  });
});
```

Run it:

```bash
node --test tests/lib/memory/integration.test.js
```

Expected: PASS.

- [ ] **Step 4: Commit the integration test**

```bash
git add tests/lib/memory/integration.test.js
git commit -m "test(memory): foundation integration round-trip"
```

---

## Definition of Done for Plan 1

- Six library modules exist under `scripts/lib/memory/`, each with its own unit test file.
- One integration test exercises config → vocabulary → schema → drift round-trip.
- `init-memory` skill scaffolds the directory tree and commits.
- `npm test` passes.
- Zero changes to `.opencode/plugins/foundry.js`.
- Zero new runtime dependencies in `package.json`.

## What this plan deliberately does NOT do

- No Cozo dependency and no database I/O.
- No memory tools exposed through the OpenCode plugin.
- No embedding HTTP calls (default config mentions Ollama, but no code talks to it yet).
- No authoring skills for entity/edge types (those ship in Plan 3).
- No cycle integration (Plan 4).
- No semantic search (Plan 5).

## Handoff to Plan 2

Plan 2 ("Core read/write tools") picks up here. It will:

- Add `cozo-node` as a dependency.
- Add `scripts/lib/memory/cozo.js` (open/close/checkpoint, relation creation driven by `schema.json`).
- Add write tools (`put`, `relate`, `unrelate`) and read tools (`get`, `list`, `neighbours`, `query`).
- Wire sync triggers (direct out-of-cycle write flushes NDJSON).
- Register the tools in `.opencode/plugins/foundry.js`.
