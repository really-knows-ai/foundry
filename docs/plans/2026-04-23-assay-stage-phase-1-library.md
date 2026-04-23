# Phase 1 — Core Library Plumbing

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the pure-function primitives that the assay stage needs. All library code, no plugin or orchestration wiring. Every module is independently unit-testable with injectable I/O.

**Architecture:** All new code lives under `scripts/lib/assay/` except the `memoryPaths` extension (which stays in `scripts/lib/memory/paths.js`). Modules compose upward: `paths` → `loader` → `permissions`, plus `parse-jsonl` and `spawn-with-timeout` as leaves, all combined by `runAssay`.

**Tech Stack:** Node ≥18.3 stdlib only. `js-yaml` (already a repo dep) for extractor frontmatter. `node:child_process.spawn` + `AbortController` for timeouts (no existing helper — we introduce one). `node:test` + `node:assert/strict` for tests.

**Files produced:**

- Create: `scripts/lib/assay/loader.js`
- Create: `scripts/lib/assay/permissions.js`
- Create: `scripts/lib/assay/parse-jsonl.js`
- Create: `scripts/lib/assay/spawn-with-timeout.js`
- Create: `scripts/lib/assay/run.js`
- Modify: `scripts/lib/memory/paths.js`
- Create: `tests/lib/assay/loader.test.js`
- Create: `tests/lib/assay/permissions.test.js`
- Create: `tests/lib/assay/parse-jsonl.test.js`
- Create: `tests/lib/assay/spawn-with-timeout.test.js`
- Create: `tests/lib/assay/run.test.js`
- Modify: `tests/lib/memory/paths.test.js` (if it exists — check in Task 1)

---

## Task 1: Extend `memoryPaths` with extractor locations

**Files:**
- Modify: `scripts/lib/memory/paths.js`
- Modify or Create: `tests/lib/memory/paths.test.js`

**Context:** `memoryPaths(foundryDir)` returns path strings for every memory-subtree artefact. Extractors live under `foundry/memory/extractors/`, so they belong in this helper alongside entity types and edge types. This is the smallest possible first task and lets every subsequent task import a single known-good path helper.

- [ ] **Step 1: Check for existing paths test file**

Run: `ls tests/lib/memory/paths.test.js 2>/dev/null || echo MISSING`

If `MISSING`, create the file in step 2. Otherwise modify it.

- [ ] **Step 2: Write the failing test**

If creating from scratch, put at `tests/lib/memory/paths.test.js`:

```javascript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { memoryPaths } from '../../../scripts/lib/memory/paths.js';

describe('memoryPaths', () => {
  it('returns the extractors directory', () => {
    const p = memoryPaths('foundry');
    assert.equal(p.extractorsDir, 'foundry/memory/extractors');
  });

  it('returns the extractor file for a given name', () => {
    const p = memoryPaths('foundry');
    assert.equal(p.extractorFile('java-symbols'), 'foundry/memory/extractors/java-symbols.md');
  });
});
```

If the file already exists, append those two `it` blocks inside the existing `describe('memoryPaths', ...)`.

- [ ] **Step 3: Run tests to verify failure**

Run: `node --test tests/lib/memory/paths.test.js`
Expected: FAIL on both new tests — `p.extractorsDir is undefined` and `p.extractorFile is not a function`.

- [ ] **Step 4: Extend `memoryPaths`**

Replace `scripts/lib/memory/paths.js` with:

```javascript
import { join } from 'node:path';

export function memoryPaths(foundryDir) {
  const root = join(foundryDir, 'memory');
  const entitiesDir = join(root, 'entities');
  const edgesDir = join(root, 'edges');
  const relationsDir = join(root, 'relations');
  const extractorsDir = join(root, 'extractors');
  return {
    root,
    config: join(root, 'config.md'),
    schema: join(root, 'schema.json'),
    entitiesDir,
    edgesDir,
    relationsDir,
    extractorsDir,
    db: join(root, 'memory.db'),
    entityTypeFile: (name) => join(entitiesDir, `${name}.md`),
    edgeTypeFile: (name) => join(edgesDir, `${name}.md`),
    relationFile: (name) => join(relationsDir, `${name}.ndjson`),
    extractorFile: (name) => join(extractorsDir, `${name}.md`),
  };
}
```

- [ ] **Step 5: Run tests to verify pass**

Run: `node --test tests/lib/memory/paths.test.js`
Expected: PASS on all tests.

- [ ] **Step 6: Run the full suite to check nothing broke**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add scripts/lib/memory/paths.js tests/lib/memory/paths.test.js
git commit -m "feat(memory): add extractorsDir and extractorFile to memoryPaths"
```

---

## Task 2: Extractor file loader

**Files:**
- Create: `scripts/lib/assay/loader.js`
- Create: `tests/lib/assay/loader.test.js`

**Context:** An extractor is defined in markdown at `foundry/memory/extractors/<name>.md` with frontmatter `{ command, memory: { write: [...] }, timeout? }` and a prose body. The loader reads the file, parses it, normalises defaults, and returns a typed object. It is the only module that knows about extractor file layout — everything else downstream consumes the parsed shape.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/assay/loader.test.js`:

```javascript
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadExtractor, listExtractors } from '../../../scripts/lib/assay/loader.js';
import { diskIO } from '../memory/_helpers.js';

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'assay-loader-'));
  mkdirSync(join(root, 'foundry/memory/extractors'), { recursive: true });
  return root;
}

describe('loadExtractor', () => {
  let root;
  before(() => {
    root = setup();
    writeFileSync(join(root, 'foundry/memory/extractors/java-symbols.md'),
`---
command: scripts/extract-java.sh
memory:
  write: [class, method]
timeout: 30s
---

# java-symbols

Walks the Java source tree.
`);
    writeFileSync(join(root, 'foundry/memory/extractors/no-timeout.md'),
`---
command: scripts/x.sh
memory:
  write: [file]
---

# no-timeout
`);
    writeFileSync(join(root, 'foundry/memory/extractors/bad-missing-command.md'),
`---
memory:
  write: [class]
---
`);
    writeFileSync(join(root, 'foundry/memory/extractors/bad-empty-write.md'),
`---
command: scripts/y.sh
memory:
  write: []
---
`);
  });
  after(() => rmSync(root, { recursive: true, force: true }));

  it('parses frontmatter, body, and defaults timeout to 60000ms', async () => {
    const io = diskIO(root);
    const ext = await loadExtractor('foundry', 'java-symbols', io);
    assert.equal(ext.name, 'java-symbols');
    assert.equal(ext.command, 'scripts/extract-java.sh');
    assert.deepEqual(ext.memoryWrite, ['class', 'method']);
    assert.equal(ext.timeoutMs, 30_000);
    assert.match(ext.body, /Walks the Java source tree/);
  });

  it('applies the 60s default when timeout is absent', async () => {
    const io = diskIO(root);
    const ext = await loadExtractor('foundry', 'no-timeout', io);
    assert.equal(ext.timeoutMs, 60_000);
  });

  it('rejects missing command', async () => {
    const io = diskIO(root);
    await assert.rejects(
      () => loadExtractor('foundry', 'bad-missing-command', io),
      /command.*required/i,
    );
  });

  it('rejects empty memory.write', async () => {
    const io = diskIO(root);
    await assert.rejects(
      () => loadExtractor('foundry', 'bad-empty-write', io),
      /memory\.write.*non-empty/i,
    );
  });

  it('throws a clear error when the file does not exist', async () => {
    const io = diskIO(root);
    await assert.rejects(
      () => loadExtractor('foundry', 'missing', io),
      /extractor not found/i,
    );
  });
});

describe('listExtractors', () => {
  let root;
  before(() => {
    root = setup();
    writeFileSync(join(root, 'foundry/memory/extractors/a.md'),
      `---\ncommand: x\nmemory:\n  write: [t]\n---\n`);
    writeFileSync(join(root, 'foundry/memory/extractors/b.md'),
      `---\ncommand: y\nmemory:\n  write: [t]\n---\n`);
    writeFileSync(join(root, 'foundry/memory/extractors/not-md.txt'), 'ignore');
  });
  after(() => rmSync(root, { recursive: true, force: true }));

  it('returns extractor names without extension, sorted, only .md files', async () => {
    const io = diskIO(root);
    const names = await listExtractors('foundry', io);
    assert.deepEqual(names, ['a', 'b']);
  });

  it('returns [] when the directory does not exist', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'assay-empty-'));
    const io = diskIO(tmp);
    const names = await listExtractors('foundry', io);
    assert.deepEqual(names, []);
    rmSync(tmp, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `node --test tests/lib/assay/loader.test.js`
Expected: FAIL with `Cannot find module '.../scripts/lib/assay/loader.js'`.

- [ ] **Step 3: Implement the loader**

Create `scripts/lib/assay/loader.js`:

```javascript
import yaml from 'js-yaml';
import { memoryPaths } from '../memory/paths.js';

const IDENT = /^[a-z][a-z0-9_-]*$/;

function parseTimeout(v) {
  if (v === undefined || v === null) return 60_000;
  if (typeof v === 'number') {
    if (!Number.isFinite(v) || v <= 0) throw new Error(`timeout must be a positive number (ms) or duration string`);
    return v;
  }
  if (typeof v !== 'string') throw new Error(`timeout must be a duration string (e.g. "30s") or a number of ms`);
  const m = v.trim().match(/^(\d+)(ms|s|m)?$/);
  if (!m) throw new Error(`timeout: unrecognised duration '${v}' (expected e.g. "500ms", "30s", "2m")`);
  const n = Number(m[1]);
  const unit = m[2] ?? 'ms';
  if (unit === 'ms') return n;
  if (unit === 's') return n * 1000;
  if (unit === 'm') return n * 60_000;
  throw new Error(`timeout: impossible unit ${unit}`);
}

function splitFrontmatter(text) {
  const lines = text.split(/\r?\n/);
  if (lines[0] !== '---') throw new Error(`missing frontmatter: file must start with '---'`);
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---') { end = i; break; }
  }
  if (end === -1) throw new Error(`missing frontmatter: no closing '---'`);
  const fmText = lines.slice(1, end).join('\n');
  const body = lines.slice(end + 1).join('\n').replace(/^\s+/, '');
  const fm = yaml.load(fmText) ?? {};
  if (typeof fm !== 'object' || Array.isArray(fm)) throw new Error(`frontmatter must be a mapping`);
  return { fm, body };
}

export async function loadExtractor(foundryDir, name, io) {
  if (!IDENT.test(name)) throw new Error(`invalid extractor name '${name}' (expected lowercase identifier)`);
  const p = memoryPaths(foundryDir);
  const path = p.extractorFile(name);
  if (!(await io.exists(path))) throw new Error(`extractor not found: ${name} (expected at ${path})`);
  const text = await io.readFile(path);
  const { fm, body } = splitFrontmatter(text);
  if (typeof fm.command !== 'string' || !fm.command.trim()) {
    throw new Error(`extractor '${name}': 'command' is required and must be a non-empty string`);
  }
  const writeList = fm?.memory?.write;
  if (!Array.isArray(writeList) || writeList.length === 0) {
    throw new Error(`extractor '${name}': 'memory.write' is required and must be a non-empty array of entity type names`);
  }
  for (const t of writeList) {
    if (typeof t !== 'string' || !IDENT.test(t)) {
      throw new Error(`extractor '${name}': memory.write entry '${t}' is not a valid entity type identifier`);
    }
  }
  const timeoutMs = parseTimeout(fm.timeout);
  return {
    name,
    command: fm.command,
    memoryWrite: writeList,
    timeoutMs,
    body: body,
  };
}

export async function listExtractors(foundryDir, io) {
  const p = memoryPaths(foundryDir);
  if (!(await io.exists(p.extractorsDir))) return [];
  const entries = await io.readdir(p.extractorsDir);
  return entries
    .filter((f) => f.endsWith('.md'))
    .map((f) => f.slice(0, -3))
    .sort();
}
```

- [ ] **Step 4: Run test to verify pass**

Run: `node --test tests/lib/assay/loader.test.js`
Expected: PASS on all tests.

- [ ] **Step 5: Run full suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/assay/loader.js tests/lib/assay/loader.test.js
git commit -m "feat(assay): add extractor loader with frontmatter parsing and timeout normalisation"
```

---

## Task 3: Assay permissions module

**Files:**
- Create: `scripts/lib/assay/permissions.js`
- Create: `tests/lib/assay/permissions.test.js`

**Context:** Two gate functions:

1. **Cycle-load gate** — `checkExtractorAgainstCycle(extractor, cyclePerms)` verifies every entity type in the extractor's `memory.write` is also in the cycle's `memory.write`. Called at cycle load time in Phase 3.
2. **Row-runtime gate** — `checkEntityRowAgainstExtractor(extractor, rowType)` and `checkEdgeRowAgainstExtractor(extractor, edgeDef)` verify individual rows emitted by the extractor are within its declared scope. Called per-row at runtime in `runAssay`.

The edge rule mirrors the existing `scripts/lib/memory/permissions.js` rule: an edge is permitted if either endpoint's entity type is in the extractor's `memory.write`. This requires knowing the edge's `sources`/`targets` declaration from the project vocabulary.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/assay/permissions.test.js`:

```javascript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkExtractorAgainstCycle,
  checkEntityRowAgainstExtractor,
  checkEdgeRowAgainstExtractor,
} from '../../../scripts/lib/assay/permissions.js';

const extractor = {
  name: 'java-symbols',
  memoryWrite: ['class', 'method'],
};

const vocabulary = {
  entities: { class: {}, method: {}, file: {} },
  edges: {
    'defined-in': { sources: ['method'], targets: ['class'] },
    'imports':    { sources: ['file'],   targets: ['file'] },
    'any-edge':   { sources: 'any',      targets: 'any' },
  },
};

describe('checkExtractorAgainstCycle', () => {
  it('passes when extractor.memoryWrite ⊆ cycle.memory.write', () => {
    const r = checkExtractorAgainstCycle(extractor, { writeTypes: new Set(['class', 'method', 'documentation-section']) });
    assert.equal(r.ok, true);
  });

  it('fails listing every missing type', () => {
    const r = checkExtractorAgainstCycle(extractor, { writeTypes: new Set(['documentation-section']) });
    assert.equal(r.ok, false);
    assert.match(r.error, /java-symbols/);
    assert.match(r.error, /class/);
    assert.match(r.error, /method/);
  });
});

describe('checkEntityRowAgainstExtractor', () => {
  it('permits a row whose type is in memoryWrite', () => {
    assert.equal(checkEntityRowAgainstExtractor(extractor, 'class').ok, true);
  });

  it('rejects a row whose type is outside memoryWrite', () => {
    const r = checkEntityRowAgainstExtractor(extractor, 'file');
    assert.equal(r.ok, false);
    assert.match(r.error, /'file'.*not.*memory\.write/);
  });
});

describe('checkEdgeRowAgainstExtractor', () => {
  it('permits an edge when at least one endpoint type is in memoryWrite', () => {
    // defined-in: sources=[method], targets=[class]. method ∈ extractor.memoryWrite. OK.
    const r = checkEdgeRowAgainstExtractor(extractor, {
      edge_type: 'defined-in', from_type: 'method', to_type: 'class',
    }, vocabulary);
    assert.equal(r.ok, true);
  });

  it('rejects an edge when neither endpoint is in memoryWrite', () => {
    // imports: sources=[file], targets=[file]. file ∉ memoryWrite.
    const r = checkEdgeRowAgainstExtractor(extractor, {
      edge_type: 'imports', from_type: 'file', to_type: 'file',
    }, vocabulary);
    assert.equal(r.ok, false);
    assert.match(r.error, /imports/);
    assert.match(r.error, /neither endpoint/i);
  });

  it('rejects an edge whose edge_type is not in the vocabulary', () => {
    const r = checkEdgeRowAgainstExtractor(extractor, {
      edge_type: 'unknown', from_type: 'class', to_type: 'method',
    }, vocabulary);
    assert.equal(r.ok, false);
    assert.match(r.error, /edge type 'unknown'.*not declared/i);
  });

  it('rejects an entity type not in the vocabulary', () => {
    // (caller should pre-validate, but defensive check)
    const r = checkEdgeRowAgainstExtractor(extractor, {
      edge_type: 'defined-in', from_type: 'bogus', to_type: 'class',
    }, vocabulary);
    assert.equal(r.ok, false);
    assert.match(r.error, /from_type 'bogus'/);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `node --test tests/lib/assay/permissions.test.js`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement the permissions module**

Create `scripts/lib/assay/permissions.js`:

```javascript
// Extractor-level permission checks. Two scopes:
//   1. Cycle-load: extractor.memoryWrite ⊆ cycle.memory.write
//   2. Runtime per-row: a given entity or edge row is within the extractor's scope.
//
// The edge rule mirrors scripts/lib/memory/permissions.js: an edge is permitted
// if either of its endpoint entity types is in the extractor's memoryWrite.

export function checkExtractorAgainstCycle(extractor, cyclePerms) {
  const missing = extractor.memoryWrite.filter((t) => !cyclePerms.writeTypes.has(t));
  if (missing.length === 0) return { ok: true };
  return {
    ok: false,
    error: `extractor '${extractor.name}' declares memory.write types not permitted by the cycle: ${missing.join(', ')}`,
  };
}

export function checkEntityRowAgainstExtractor(extractor, entityType) {
  if (extractor.memoryWrite.includes(entityType)) return { ok: true };
  return {
    ok: false,
    error: `extractor '${extractor.name}': entity type '${entityType}' is not in memory.write (${extractor.memoryWrite.join(', ')})`,
  };
}

export function checkEdgeRowAgainstExtractor(extractor, edge, vocabulary) {
  const edgeDef = vocabulary.edges?.[edge.edge_type];
  if (!edgeDef) {
    return { ok: false, error: `extractor '${extractor.name}': edge type '${edge.edge_type}' not declared in project vocabulary` };
  }
  if (!vocabulary.entities?.[edge.from_type]) {
    return { ok: false, error: `extractor '${extractor.name}': edge '${edge.edge_type}' from_type '${edge.from_type}' not declared in project vocabulary` };
  }
  if (!vocabulary.entities?.[edge.to_type]) {
    return { ok: false, error: `extractor '${extractor.name}': edge '${edge.edge_type}' to_type '${edge.to_type}' not declared in project vocabulary` };
  }
  const writable = new Set(extractor.memoryWrite);
  if (writable.has(edge.from_type) || writable.has(edge.to_type)) return { ok: true };
  return {
    ok: false,
    error: `extractor '${extractor.name}': edge '${edge.edge_type}' has neither endpoint in memory.write (${extractor.memoryWrite.join(', ')})`,
  };
}
```

- [ ] **Step 4: Run test to verify pass**

Run: `node --test tests/lib/assay/permissions.test.js`
Expected: PASS.

- [ ] **Step 5: Run full suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/assay/permissions.js tests/lib/assay/permissions.test.js
git commit -m "feat(assay): add extractor permission checks (cycle-scope + per-row)"
```

---

## Task 4: Extractor JSONL parser

**Files:**
- Create: `scripts/lib/assay/parse-jsonl.js`
- Create: `tests/lib/assay/parse-jsonl.test.js`

**Context:** Extractor stdout is line-delimited JSON. Each non-blank, non-`#` line is parsed as a JSON object and validated against a per-`kind` schema. Unknown `kind` values, unknown top-level fields, and schema violations produce descriptive errors that include the 1-indexed line number. Entity `value` length is enforced against the existing memory limit (4096 bytes) — we import `MAX_VALUE_BYTES` from `scripts/lib/memory/validate.js` to keep the source of truth in one place.

The parser is pure: input string → array of typed rows, or throw with line context. It does NOT check project vocabulary or extractor permissions — those are separate concerns handled by `permissions.js`.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/assay/parse-jsonl.test.js`:

```javascript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseExtractorOutput } from '../../../scripts/lib/assay/parse-jsonl.js';

describe('parseExtractorOutput', () => {
  it('parses entity and edge rows', () => {
    const text = [
      '{"kind":"entity","type":"class","name":"Foo","value":"x"}',
      '{"kind":"edge","from":{"type":"method","name":"Foo.bar"},"edge":"defined-in","to":{"type":"class","name":"Foo"}}',
    ].join('\n');
    const rows = parseExtractorOutput(text);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].kind, 'entity');
    assert.equal(rows[0].type, 'class');
    assert.equal(rows[0].name, 'Foo');
    assert.equal(rows[0].value, 'x');
    assert.equal(rows[1].kind, 'edge');
    assert.equal(rows[1].edge_type, 'defined-in');
    assert.equal(rows[1].from_type, 'method');
    assert.equal(rows[1].from_name, 'Foo.bar');
    assert.equal(rows[1].to_type, 'class');
    assert.equal(rows[1].to_name, 'Foo');
  });

  it('skips blank lines and comment lines', () => {
    const text = [
      '# a comment',
      '',
      '{"kind":"entity","type":"class","name":"A","value":"v"}',
      '   ',
      '# trailing',
    ].join('\n');
    const rows = parseExtractorOutput(text);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].name, 'A');
  });

  it('reports bad JSON with line number', () => {
    const text = [
      '{"kind":"entity","type":"class","name":"A","value":"v"}',
      'not json',
    ].join('\n');
    assert.throws(() => parseExtractorOutput(text), /line 2/);
  });

  it('rejects unknown kind', () => {
    assert.throws(
      () => parseExtractorOutput('{"kind":"bogus"}'),
      /unknown kind 'bogus' at line 1/,
    );
  });

  it('rejects unknown top-level fields on entity', () => {
    assert.throws(
      () => parseExtractorOutput('{"kind":"entity","type":"class","name":"A","value":"v","extra":1}'),
      /unknown field.*extra/,
    );
  });

  it('rejects unknown top-level fields on edge', () => {
    assert.throws(
      () => parseExtractorOutput('{"kind":"edge","from":{"type":"c","name":"A"},"edge":"e","to":{"type":"c","name":"B"},"x":1}'),
      /unknown field.*x/,
    );
  });

  it('requires entity fields', () => {
    assert.throws(() => parseExtractorOutput('{"kind":"entity","type":"class","name":"A"}'), /value.*required/);
    assert.throws(() => parseExtractorOutput('{"kind":"entity","type":"class","value":"v"}'), /name.*required/);
    assert.throws(() => parseExtractorOutput('{"kind":"entity","name":"A","value":"v"}'), /type.*required/);
  });

  it('requires edge fields', () => {
    assert.throws(() => parseExtractorOutput('{"kind":"edge","edge":"e","to":{"type":"c","name":"B"}}'), /from/);
    assert.throws(() => parseExtractorOutput('{"kind":"edge","from":{"type":"c","name":"A"},"to":{"type":"c","name":"B"}}'), /edge.*required/);
    assert.throws(() => parseExtractorOutput('{"kind":"edge","from":{"type":"c","name":"A"},"edge":"e"}'), /to/);
    assert.throws(() => parseExtractorOutput('{"kind":"edge","from":{"type":"c"},"edge":"e","to":{"type":"c","name":"B"}}'), /from\.name/);
  });

  it('rejects oversize entity value', () => {
    const big = 'x'.repeat(5000);
    assert.throws(
      () => parseExtractorOutput(`{"kind":"entity","type":"class","name":"A","value":"${big}"}`),
      /value.*4096|too large/i,
    );
  });

  it('returns an empty array for empty input', () => {
    assert.deepEqual(parseExtractorOutput(''), []);
    assert.deepEqual(parseExtractorOutput('\n\n# only comments\n'), []);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `node --test tests/lib/assay/parse-jsonl.test.js`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement the parser**

Create `scripts/lib/assay/parse-jsonl.js`:

```javascript
import { MAX_VALUE_BYTES } from '../memory/validate.js';

const ENTITY_FIELDS = new Set(['kind', 'type', 'name', 'value']);
const EDGE_FIELDS = new Set(['kind', 'from', 'edge', 'to']);

function checkFields(obj, allowed, lineNo, kind) {
  for (const k of Object.keys(obj)) {
    if (!allowed.has(k)) {
      throw new Error(`extractor output line ${lineNo}: unknown field '${k}' on ${kind} row`);
    }
  }
}

function req(obj, key, lineNo, kind) {
  if (obj[key] === undefined || obj[key] === null || obj[key] === '') {
    throw new Error(`extractor output line ${lineNo}: ${kind}.${key} is required`);
  }
}

function parseEntityRow(obj, lineNo) {
  checkFields(obj, ENTITY_FIELDS, lineNo, 'entity');
  req(obj, 'type', lineNo, 'entity');
  req(obj, 'name', lineNo, 'entity');
  if (typeof obj.value !== 'string') {
    throw new Error(`extractor output line ${lineNo}: entity.value is required and must be a string`);
  }
  const bytes = Buffer.byteLength(obj.value, 'utf-8');
  if (bytes > MAX_VALUE_BYTES) {
    throw new Error(`extractor output line ${lineNo}: entity.value is ${bytes} bytes (max ${MAX_VALUE_BYTES}, too large)`);
  }
  return { kind: 'entity', type: obj.type, name: obj.name, value: obj.value };
}

function parseEdgeRow(obj, lineNo) {
  checkFields(obj, EDGE_FIELDS, lineNo, 'edge');
  if (!obj.from || typeof obj.from !== 'object') {
    throw new Error(`extractor output line ${lineNo}: edge.from is required and must be an object {type,name}`);
  }
  if (!obj.to || typeof obj.to !== 'object') {
    throw new Error(`extractor output line ${lineNo}: edge.to is required and must be an object {type,name}`);
  }
  req(obj.from, 'type', lineNo, 'edge.from');
  req(obj.from, 'name', lineNo, 'edge.from');
  req(obj.to, 'type', lineNo, 'edge.to');
  req(obj.to, 'name', lineNo, 'edge.to');
  req(obj, 'edge', lineNo, 'edge');
  return {
    kind: 'edge',
    edge_type: obj.edge,
    from_type: obj.from.type,
    from_name: obj.from.name,
    to_type: obj.to.type,
    to_name: obj.to.name,
  };
}

export function parseExtractorOutput(text) {
  if (!text) return [];
  const lines = text.split(/\r?\n/);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    let obj;
    try {
      obj = JSON.parse(trimmed);
    } catch (err) {
      throw new Error(`extractor output line ${i + 1}: invalid JSON (${err.message})`);
    }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
      throw new Error(`extractor output line ${i + 1}: expected a JSON object`);
    }
    const kind = obj.kind;
    if (kind === 'entity') out.push(parseEntityRow(obj, i + 1));
    else if (kind === 'edge') out.push(parseEdgeRow(obj, i + 1));
    else throw new Error(`extractor output line ${i + 1}: unknown kind '${kind}'`);
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify pass**

Run: `node --test tests/lib/assay/parse-jsonl.test.js`
Expected: PASS.

- [ ] **Step 5: Run full suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/assay/parse-jsonl.js tests/lib/assay/parse-jsonl.test.js
git commit -m "feat(assay): add extractor JSONL parser with line-indexed errors"
```

---

## Task 5: Subprocess spawn-with-timeout helper

**Files:**
- Create: `scripts/lib/assay/spawn-with-timeout.js`
- Create: `tests/lib/assay/spawn-with-timeout.test.js`

**Context:** No existing helper for spawning subprocesses with a timeout. We need one: run a command (with shell), capture stdout and stderr, enforce a timeout by sending SIGTERM then SIGKILL, return `{ok, exitCode, signal, stdout, stderr, timedOut}`. Never throws (caller inspects result). This module is the only place in the codebase that spawns user-supplied commands, so it's also the natural place to document the security posture (shell: false, argv model).

**Design choice:** use `execFile` with `shell: true` so extractor authors can write either an executable path (most common) or a shell command. This matches the feel of `validation.md` commands. The `command` field in the extractor frontmatter is passed as-is to the shell.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/assay/spawn-with-timeout.test.js`:

```javascript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnWithTimeout } from '../../../scripts/lib/assay/spawn-with-timeout.js';

function scriptDir() {
  return mkdtempSync(join(tmpdir(), 'swt-'));
}

function writeScript(dir, name, body) {
  const p = join(dir, name);
  writeFileSync(p, body);
  chmodSync(p, 0o755);
  return p;
}

describe('spawnWithTimeout', () => {
  it('captures stdout on zero-exit success', async () => {
    const d = scriptDir();
    const p = writeScript(d, 'hi.sh', '#!/bin/sh\necho hello\n');
    const r = await spawnWithTimeout({ command: p, cwd: d, timeoutMs: 5000 });
    assert.equal(r.ok, true);
    assert.equal(r.exitCode, 0);
    assert.equal(r.timedOut, false);
    assert.match(r.stdout, /hello/);
    rmSync(d, { recursive: true, force: true });
  });

  it('captures stderr and reports non-zero exit', async () => {
    const d = scriptDir();
    const p = writeScript(d, 'err.sh', '#!/bin/sh\necho oops >&2\nexit 7\n');
    const r = await spawnWithTimeout({ command: p, cwd: d, timeoutMs: 5000 });
    assert.equal(r.ok, false);
    assert.equal(r.exitCode, 7);
    assert.equal(r.timedOut, false);
    assert.match(r.stderr, /oops/);
    rmSync(d, { recursive: true, force: true });
  });

  it('kills a process that exceeds the timeout', async () => {
    const d = scriptDir();
    const p = writeScript(d, 'sleep.sh', '#!/bin/sh\nsleep 10\n');
    const start = Date.now();
    const r = await spawnWithTimeout({ command: p, cwd: d, timeoutMs: 150 });
    const elapsed = Date.now() - start;
    assert.equal(r.ok, false);
    assert.equal(r.timedOut, true);
    assert.ok(elapsed < 3000, `took too long: ${elapsed}ms`);
    rmSync(d, { recursive: true, force: true });
  });

  it('accepts shell syntax in the command string', async () => {
    const d = scriptDir();
    const r = await spawnWithTimeout({ command: 'echo one && echo two', cwd: d, timeoutMs: 5000 });
    assert.equal(r.ok, true);
    assert.match(r.stdout, /one/);
    assert.match(r.stdout, /two/);
    rmSync(d, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `node --test tests/lib/assay/spawn-with-timeout.test.js`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement the helper**

Create `scripts/lib/assay/spawn-with-timeout.js`:

```javascript
import { spawn } from 'node:child_process';

// Runs a command (via /bin/sh -c) with a hard timeout. Never throws.
// Returns:
//   { ok, exitCode, signal, stdout, stderr, timedOut }
//
// On timeout: sends SIGTERM immediately; if the process is still alive 500ms
// later, sends SIGKILL. `timedOut: true` in the result.
//
// Security: this intentionally uses a shell, matching how `foundry_validate_run`
// expands validation commands today. Extractors are project-authored and
// committed to the repo; they are trusted code paths, not untrusted input.
export async function spawnWithTimeout({ command, cwd, timeoutMs, env }) {
  return await new Promise((resolve) => {
    const child = spawn('/bin/sh', ['-c', command], {
      cwd,
      env: env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;

    child.stdout.on('data', (b) => { stdout += b.toString('utf-8'); });
    child.stderr.on('data', (b) => { stderr += b.toString('utf-8'); });

    const softTimer = setTimeout(() => {
      timedOut = true;
      try { child.kill('SIGTERM'); } catch {}
      setTimeout(() => {
        if (!settled) { try { child.kill('SIGKILL'); } catch {} }
      }, 500);
    }, timeoutMs);

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(softTimer);
      resolve({
        ok: false,
        exitCode: null,
        signal: null,
        stdout,
        stderr: stderr + (stderr.endsWith('\n') || stderr === '' ? '' : '\n') + `spawn error: ${err.message}`,
        timedOut,
      });
    });

    child.on('close', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(softTimer);
      const ok = !timedOut && code === 0;
      resolve({ ok, exitCode: code, signal, stdout, stderr, timedOut });
    });
  });
}
```

- [ ] **Step 4: Run test to verify pass**

Run: `node --test tests/lib/assay/spawn-with-timeout.test.js`
Expected: PASS (all four tests; the timeout test should complete in well under 3 seconds).

- [ ] **Step 5: Run full suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/assay/spawn-with-timeout.js tests/lib/assay/spawn-with-timeout.test.js
git commit -m "feat(assay): add spawn-with-timeout subprocess helper"
```

---

## Task 6: `runAssay` composition

**Files:**
- Create: `scripts/lib/assay/run.js`
- Create: `tests/lib/assay/run.test.js`

**Context:** Compose Tasks 2–5 into a single orchestration function. For each extractor in a list (sequentially):

1. Load the extractor definition.
2. Spawn its command.
3. Parse stdout as JSONL.
4. For each row, run the permission check against `extractor.memoryWrite` (and the project vocabulary for edges).
5. Upsert into the memory store via the existing `putEntity` / `relate` library calls.
6. On any failure, stop immediately and return `{ok:false, aborted:true, failedExtractor, reason, stderr?}`. Prior extractors' writes are NOT rolled back (per spec: tight per-extractor transaction scope; partial commits are intentional).
7. On success, return `{ok:true, perExtractor:[{name, rowsUpserted, durationMs}]}`.

This function is the beating heart of the assay stage. It takes every concrete dependency as a parameter so tests can substitute fakes:

- `io` — the memory IO shim.
- `store` — the opened Cozo store.
- `vocabulary` — the project memory vocabulary.
- `putEntity`, `relate` — the upsert functions (default-imported from `scripts/lib/memory/writes.js`, but injectable).
- `spawn` — the spawn helper (injectable so we can fake subprocess output in tests).
- `cwd` — the worktree root, passed to subprocesses.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/assay/run.test.js`:

```javascript
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runAssay } from '../../../scripts/lib/assay/run.js';
import { diskIO } from '../memory/_helpers.js';

function setupProject() {
  const root = mkdtempSync(join(tmpdir(), 'assay-run-'));
  mkdirSync(join(root, 'foundry/memory/extractors'), { recursive: true });
  return root;
}

function writeExtractor(root, name, { command, write, timeout }) {
  const fm = { command, memory: { write } };
  if (timeout) fm.timeout = timeout;
  const yamlLines = [
    '---',
    `command: ${command}`,
    'memory:',
    `  write: [${write.join(', ')}]`,
    ...(timeout ? [`timeout: ${timeout}`] : []),
    '---',
    '',
    `# ${name}`,
    '',
  ].join('\n');
  writeFileSync(join(root, `foundry/memory/extractors/${name}.md`), yamlLines);
}

const vocabulary = {
  entities: { class: {}, method: {} },
  edges: { 'defined-in': { sources: ['method'], targets: ['class'] } },
};

function makeFakes() {
  const entities = [];
  const edges = [];
  return {
    store: {},
    putEntity: async (_store, row) => { entities.push(row); },
    relate: async (_store, row) => { edges.push(row); },
    entities, edges,
  };
}

describe('runAssay', () => {
  it('runs multiple extractors in order and upserts rows', async () => {
    const root = setupProject();
    writeExtractor(root, 'a', { command: 'anything-a', write: ['class'] });
    writeExtractor(root, 'b', { command: 'anything-b', write: ['method'] });
    const fakes = makeFakes();
    const callOrder = [];
    const fakeSpawn = async ({ command }) => {
      callOrder.push(command);
      if (command === 'anything-a') {
        return { ok: true, exitCode: 0, timedOut: false, stdout:
          '{"kind":"entity","type":"class","name":"C1","value":"v1"}\n',
          stderr: '' };
      }
      return { ok: true, exitCode: 0, timedOut: false, stdout:
        '{"kind":"entity","type":"method","name":"M1","value":"v"}\n' +
        '{"kind":"edge","from":{"type":"method","name":"M1"},"edge":"defined-in","to":{"type":"class","name":"C1"}}\n',
        stderr: '' };
    };
    const res = await runAssay({
      foundryDir: 'foundry',
      cwd: root,
      io: diskIO(root),
      extractors: ['a', 'b'],
      store: fakes.store,
      vocabulary,
      putEntity: fakes.putEntity,
      relate: fakes.relate,
      spawn: fakeSpawn,
    });
    assert.equal(res.ok, true);
    assert.equal(res.perExtractor.length, 2);
    assert.deepEqual(callOrder, ['anything-a', 'anything-b']);
    assert.equal(fakes.entities.length, 2);
    assert.equal(fakes.edges.length, 1);
    rmSync(root, { recursive: true, force: true });
  });

  it('aborts on non-zero exit from an extractor, returning the failed extractor name and stderr', async () => {
    const root = setupProject();
    writeExtractor(root, 'broken', { command: 'x', write: ['class'] });
    const fakes = makeFakes();
    const res = await runAssay({
      foundryDir: 'foundry', cwd: root, io: diskIO(root),
      extractors: ['broken'], store: fakes.store, vocabulary,
      putEntity: fakes.putEntity, relate: fakes.relate,
      spawn: async () => ({ ok: false, exitCode: 2, timedOut: false, stdout: '', stderr: 'kaboom' }),
    });
    assert.equal(res.ok, false);
    assert.equal(res.aborted, true);
    assert.equal(res.failedExtractor, 'broken');
    assert.match(res.reason, /exit code 2/);
    assert.match(res.stderr, /kaboom/);
    rmSync(root, { recursive: true, force: true });
  });

  it('aborts on timeout', async () => {
    const root = setupProject();
    writeExtractor(root, 'slow', { command: 'x', write: ['class'] });
    const fakes = makeFakes();
    const res = await runAssay({
      foundryDir: 'foundry', cwd: root, io: diskIO(root),
      extractors: ['slow'], store: fakes.store, vocabulary,
      putEntity: fakes.putEntity, relate: fakes.relate,
      spawn: async () => ({ ok: false, exitCode: null, timedOut: true, stdout: '', stderr: '' }),
    });
    assert.equal(res.ok, false);
    assert.equal(res.aborted, true);
    assert.match(res.reason, /timed out/i);
    rmSync(root, { recursive: true, force: true });
  });

  it('aborts on bad JSONL', async () => {
    const root = setupProject();
    writeExtractor(root, 'junky', { command: 'x', write: ['class'] });
    const fakes = makeFakes();
    const res = await runAssay({
      foundryDir: 'foundry', cwd: root, io: diskIO(root),
      extractors: ['junky'], store: fakes.store, vocabulary,
      putEntity: fakes.putEntity, relate: fakes.relate,
      spawn: async () => ({ ok: true, exitCode: 0, timedOut: false, stdout: 'not json\n', stderr: '' }),
    });
    assert.equal(res.ok, false);
    assert.equal(res.aborted, true);
    assert.match(res.reason, /invalid JSON/);
    rmSync(root, { recursive: true, force: true });
  });

  it('aborts on permission violation (entity type outside memoryWrite)', async () => {
    const root = setupProject();
    writeExtractor(root, 'sneaky', { command: 'x', write: ['class'] });
    const fakes = makeFakes();
    const res = await runAssay({
      foundryDir: 'foundry', cwd: root, io: diskIO(root),
      extractors: ['sneaky'], store: fakes.store, vocabulary,
      putEntity: fakes.putEntity, relate: fakes.relate,
      spawn: async () => ({ ok: true, exitCode: 0, timedOut: false,
        stdout: '{"kind":"entity","type":"method","name":"M","value":"v"}\n', stderr: '' }),
    });
    assert.equal(res.ok, false);
    assert.equal(res.aborted, true);
    assert.match(res.reason, /'method'.*not.*memory\.write/);
    // No entities should have been upserted at all.
    assert.equal(fakes.entities.length, 0);
    rmSync(root, { recursive: true, force: true });
  });

  it('preserves prior extractors writes when a later one fails', async () => {
    const root = setupProject();
    writeExtractor(root, 'good', { command: 'g', write: ['class'] });
    writeExtractor(root, 'bad',  { command: 'b', write: ['method'] });
    const fakes = makeFakes();
    const res = await runAssay({
      foundryDir: 'foundry', cwd: root, io: diskIO(root),
      extractors: ['good', 'bad'], store: fakes.store, vocabulary,
      putEntity: fakes.putEntity, relate: fakes.relate,
      spawn: async ({ command }) => command === 'g'
        ? { ok: true, exitCode: 0, timedOut: false, stdout: '{"kind":"entity","type":"class","name":"Good","value":"v"}\n', stderr: '' }
        : { ok: false, exitCode: 1, timedOut: false, stdout: '', stderr: 'boom' },
    });
    assert.equal(res.ok, false);
    assert.equal(res.failedExtractor, 'bad');
    // "good" ran and committed; the returned perExtractor includes its count.
    assert.equal(fakes.entities.length, 1);
    assert.equal(fakes.entities[0].name, 'Good');
    rmSync(root, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `node --test tests/lib/assay/run.test.js`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement `runAssay`**

Create `scripts/lib/assay/run.js`:

```javascript
import { loadExtractor } from './loader.js';
import { parseExtractorOutput } from './parse-jsonl.js';
import { spawnWithTimeout as defaultSpawn } from './spawn-with-timeout.js';
import {
  checkEntityRowAgainstExtractor,
  checkEdgeRowAgainstExtractor,
} from './permissions.js';

export async function runAssay({
  foundryDir,
  cwd,
  io,
  extractors,
  store,
  vocabulary,
  putEntity,
  relate,
  spawn = defaultSpawn,
}) {
  const perExtractor = [];

  for (const name of extractors) {
    const startedAt = Date.now();
    let ext;
    try {
      ext = await loadExtractor(foundryDir, name, io);
    } catch (err) {
      return abort(perExtractor, name, `failed to load extractor: ${err.message}`);
    }

    const spawnResult = await spawn({
      command: ext.command,
      cwd,
      timeoutMs: ext.timeoutMs,
    });

    if (spawnResult.timedOut) {
      return abort(perExtractor, name, `extractor timed out after ${ext.timeoutMs}ms`, spawnResult.stderr);
    }
    if (!spawnResult.ok) {
      return abort(perExtractor, name, `extractor exited with exit code ${spawnResult.exitCode}`, spawnResult.stderr);
    }

    let rows;
    try {
      rows = parseExtractorOutput(spawnResult.stdout);
    } catch (err) {
      return abort(perExtractor, name, err.message, spawnResult.stderr);
    }

    // Validate every row before performing any writes for this extractor.
    for (const row of rows) {
      if (row.kind === 'entity') {
        const r = checkEntityRowAgainstExtractor(ext, row.type);
        if (!r.ok) return abort(perExtractor, name, r.error, spawnResult.stderr);
        if (!vocabulary.entities?.[row.type]) {
          return abort(perExtractor, name, `entity type '${row.type}' not declared in project vocabulary`, spawnResult.stderr);
        }
      } else {
        const r = checkEdgeRowAgainstExtractor(ext, {
          edge_type: row.edge_type,
          from_type: row.from_type,
          to_type: row.to_type,
        }, vocabulary);
        if (!r.ok) return abort(perExtractor, name, r.error, spawnResult.stderr);
      }
    }

    // Upsert. Any throw here aborts with the row's details.
    let rowsUpserted = 0;
    for (const row of rows) {
      try {
        if (row.kind === 'entity') {
          await putEntity(store, { type: row.type, name: row.name, value: row.value }, vocabulary);
        } else {
          await relate(store, {
            edge_type: row.edge_type,
            from_type: row.from_type, from_name: row.from_name,
            to_type: row.to_type,     to_name: row.to_name,
          }, vocabulary);
        }
        rowsUpserted += 1;
      } catch (err) {
        return abort(perExtractor, name, `upsert failed: ${err.message}`, spawnResult.stderr);
      }
    }

    perExtractor.push({
      name,
      rowsUpserted,
      durationMs: Date.now() - startedAt,
    });
  }

  return { ok: true, perExtractor };
}

function abort(perExtractor, failedExtractor, reason, stderr) {
  return {
    ok: false,
    aborted: true,
    failedExtractor,
    reason,
    stderr: stderr ?? '',
    perExtractor,
  };
}
```

- [ ] **Step 4: Run test to verify pass**

Run: `node --test tests/lib/assay/run.test.js`
Expected: PASS on all six tests.

- [ ] **Step 5: Run full suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/assay/run.js tests/lib/assay/run.test.js
git commit -m "feat(assay): add runAssay composition with strict failure semantics"
```

---

## Phase 1 exit criteria

- [ ] `scripts/lib/assay/{loader,permissions,parse-jsonl,spawn-with-timeout,run}.js` exist.
- [ ] `memoryPaths` exposes `extractorsDir` and `extractorFile(name)`.
- [ ] Every module has a co-located unit test; `node --test tests/lib/assay/` passes.
- [ ] `npm test` across the whole repo passes.
- [ ] No changes to `.opencode/plugins/foundry.js`, `scripts/orchestrate.js`, `scripts/sort.js`, or any skill yet.

Proceed to [Phase 2](./2026-04-23-assay-stage-phase-2-plugin-tools.md).
