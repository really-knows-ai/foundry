# Phase 2 — Plugin Tools

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface Phase 1's library to the LLM as two plugin tools: `foundry_assay_run` (executes extractors during an active `assay` stage) and `foundry_extractor_create` (authors new extractor definitions).

**Architecture:** Both tools live in `.opencode/plugins/foundry.js`. `foundry_assay_run` is stage-guarded (only runs during an `assay` stage) and on failure writes a `#validation` feedback row against `WORK.md` itself before returning. `foundry_extractor_create` delegates to a new admin module at `scripts/lib/memory/admin/create-extractor.js`, mirroring the `create-entity-type.js` pattern. Neither tool needs orchestration wiring — that comes in Phase 3.

**Depends on:** Phase 1 (`scripts/lib/assay/*`).

**Files produced:**

- Create: `scripts/lib/memory/admin/create-extractor.js`
- Create: `tests/lib/memory/admin/create-extractor.test.js`
- Modify: `.opencode/plugins/foundry.js` (add two tool registrations)
- Create: `tests/plugin/assay-tools.test.js`

---

## Task 1: `createExtractor` admin helper

**Files:**
- Create: `scripts/lib/memory/admin/create-extractor.js`
- Create: `tests/lib/memory/admin/create-extractor.test.js`

**Context:** Mirrors `scripts/lib/memory/admin/create-entity-type.js`. Writes `foundry/memory/extractors/<name>.md` with populated frontmatter. Validates: name is a valid identifier, command is a non-empty string, `memoryWrite` is non-empty and every entry is a declared entity type in the project schema, the file does not already exist. Returns `{ path }`.

Note: unlike entity-type creation, this does NOT touch `schema.json` — extractors do not create Cozo relations. It does NOT call `invalidateStore` either — extractor definitions are read on demand, not cached in the memory singleton.

- [ ] **Step 1: Confirm the admin directory exists**

Run: `ls scripts/lib/memory/admin/`
Expected output includes `create-entity-type.js`, `create-edge-type.js`. If `admin/` is missing, something is wrong — abort and report.

- [ ] **Step 2: Write the failing test**

Create `tests/lib/memory/admin/create-extractor.test.js`:

```javascript
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createExtractor } from '../../../../scripts/lib/memory/admin/create-extractor.js';
import { diskIO } from '../_helpers.js';

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'create-ext-'));
  mkdirSync(join(root, 'foundry/memory/entities'), { recursive: true });
  mkdirSync(join(root, 'foundry/memory/edges'), { recursive: true });
  mkdirSync(join(root, 'foundry/memory/relations'), { recursive: true });
  writeFileSync(join(root, 'foundry/memory/entities/class.md'),
    '---\ntype: class\n---\n\n# class\n');
  writeFileSync(join(root, 'foundry/memory/entities/method.md'),
    '---\ntype: method\n---\n\n# method\n');
  writeFileSync(join(root, 'foundry/memory/schema.json'), JSON.stringify({
    version: 1,
    entities: { class: {}, method: {} },
    edges: {},
    embeddings: null,
  }, null, 2));
  return root;
}

describe('createExtractor', () => {
  let root;
  before(() => { root = setup(); });
  after(() => rmSync(root, { recursive: true, force: true }));

  it('writes an extractor file with populated frontmatter', async () => {
    const io = diskIO(root);
    const out = await createExtractor({
      worktreeRoot: root,
      io,
      name: 'java-symbols',
      command: 'scripts/extract-java.sh',
      memoryWrite: ['class', 'method'],
      body: 'Extracts classes and methods.',
    });
    assert.equal(out.path, 'foundry/memory/extractors/java-symbols.md');
    const text = readFileSync(join(root, out.path), 'utf-8');
    assert.match(text, /command: scripts\/extract-java\.sh/);
    assert.match(text, /write:\s*\[\s*class,\s*method\s*\]/);
    assert.match(text, /Extracts classes and methods/);
  });

  it('accepts an optional timeout', async () => {
    const io = diskIO(root);
    await createExtractor({
      worktreeRoot: root, io,
      name: 'with-timeout',
      command: 'x',
      memoryWrite: ['class'],
      timeout: '30s',
      body: 'x',
    });
    const text = readFileSync(join(root, 'foundry/memory/extractors/with-timeout.md'), 'utf-8');
    assert.match(text, /timeout: 30s/);
  });

  it('rejects invalid identifiers', async () => {
    const io = diskIO(root);
    await assert.rejects(
      () => createExtractor({ worktreeRoot: root, io, name: 'Bad Name', command: 'x', memoryWrite: ['class'], body: 'x' }),
      /invalid identifier/i,
    );
  });

  it('rejects empty body', async () => {
    const io = diskIO(root);
    await assert.rejects(
      () => createExtractor({ worktreeRoot: root, io, name: 'empty-body', command: 'x', memoryWrite: ['class'], body: '' }),
      /body.*non-empty/i,
    );
  });

  it('rejects empty memoryWrite', async () => {
    const io = diskIO(root);
    await assert.rejects(
      () => createExtractor({ worktreeRoot: root, io, name: 'nowrite', command: 'x', memoryWrite: [], body: 'x' }),
      /memoryWrite.*non-empty/i,
    );
  });

  it('rejects memoryWrite entries that are not declared entity types', async () => {
    const io = diskIO(root);
    await assert.rejects(
      () => createExtractor({ worktreeRoot: root, io, name: 'bogus-type', command: 'x', memoryWrite: ['class', 'not-a-type'], body: 'x' }),
      /not-a-type.*not declared/i,
    );
  });

  it('rejects duplicate extractor names', async () => {
    const io = diskIO(root);
    await createExtractor({ worktreeRoot: root, io, name: 'dup', command: 'x', memoryWrite: ['class'], body: 'x' });
    await assert.rejects(
      () => createExtractor({ worktreeRoot: root, io, name: 'dup', command: 'y', memoryWrite: ['class'], body: 'y' }),
      /already exists/i,
    );
  });

  it('creates the extractors directory on first use', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'first-ext-'));
    mkdirSync(join(tmp, 'foundry/memory/entities'), { recursive: true });
    writeFileSync(join(tmp, 'foundry/memory/entities/class.md'), '---\ntype: class\n---\n');
    writeFileSync(join(tmp, 'foundry/memory/schema.json'), JSON.stringify({ version: 1, entities: { class: {} }, edges: {}, embeddings: null }));
    const io = diskIO(tmp);
    await createExtractor({ worktreeRoot: tmp, io, name: 'a', command: 'x', memoryWrite: ['class'], body: 'b' });
    assert.ok(existsSync(join(tmp, 'foundry/memory/extractors/a.md')));
    rmSync(tmp, { recursive: true, force: true });
  });
});
```

- [ ] **Step 3: Run test to verify failure**

Run: `node --test tests/lib/memory/admin/create-extractor.test.js`
Expected: FAIL with module-not-found.

- [ ] **Step 4: Implement the admin helper**

Create `scripts/lib/memory/admin/create-extractor.js`:

```javascript
import { memoryPaths } from '../paths.js';
import { loadSchema } from '../schema.js';

const IDENT = /^[a-z][a-z0-9_-]*$/;

export async function createExtractor({ worktreeRoot, io, name, command, memoryWrite, timeout, body }) {
  if (!IDENT.test(name)) throw new Error(`invalid identifier: '${name}' (expected lowercase kebab/snake)`);
  if (typeof command !== 'string' || !command.trim()) throw new Error(`command must be a non-empty string`);
  if (!Array.isArray(memoryWrite) || memoryWrite.length === 0) {
    throw new Error(`memoryWrite must be a non-empty array of entity type names`);
  }
  if (typeof body !== 'string' || !body.trim()) throw new Error(`body must be a non-empty string`);

  const schema = await loadSchema('foundry', io);
  const undeclared = memoryWrite.filter((t) => !schema.entities[t]);
  if (undeclared.length) {
    throw new Error(`memoryWrite includes types not declared in the project vocabulary: ${undeclared.join(', ')} (create them with add-memory-entity-type)`);
  }

  const p = memoryPaths('foundry');
  const path = p.extractorFile(name);
  if (await io.exists(path)) throw new Error(`extractor already exists: ${name} (${path})`);

  // Ensure the extractors directory exists.
  if (!(await io.exists(p.extractorsDir))) {
    await io.mkdir(p.extractorsDir, { recursive: true });
  }

  const writeLine = `  write: [${memoryWrite.join(', ')}]`;
  const timeoutLine = timeout ? `timeout: ${timeout}\n` : '';
  const fileContent =
    `---\n` +
    `command: ${command}\n` +
    `memory:\n` +
    `${writeLine}\n` +
    timeoutLine +
    `---\n\n` +
    `# ${name}\n\n` +
    `${body.trim()}\n`;

  await io.writeFile(path, fileContent);
  return { path };
}
```

- [ ] **Step 5: Check `io.mkdir` supports `{ recursive: true }`**

The `diskIO` helper at `tests/lib/memory/_helpers.js` backs `makeMemoryIO`. Run:

`grep -n "mkdir" scripts/lib/memory/*.js tests/lib/memory/_helpers.js`

If either shim defines `mkdir(path)` without the options arg, this step fails. If needed, extend `_helpers.js` and the plugin's `makeMemoryIO` to accept `{ recursive }`. (Expected: both already use `fs.promises.mkdir(p, { recursive: true })` internally — most Node fs helpers do — but verify.)

- [ ] **Step 6: Run test to verify pass**

Run: `node --test tests/lib/memory/admin/create-extractor.test.js`
Expected: PASS.

- [ ] **Step 7: Run full suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add scripts/lib/memory/admin/create-extractor.js tests/lib/memory/admin/create-extractor.test.js
git commit -m "feat(memory): add createExtractor admin helper"
```

---

## Task 2: Register `foundry_assay_run` tool

**Files:**
- Modify: `.opencode/plugins/foundry.js`
- Create: `tests/plugin/assay-tools.test.js`

**Context:** Register a stage-guarded plugin tool that executes the extractors named in its arguments. On success, returns `{ok:true, perExtractor:[...]}`. On failure, writes a `#validation` feedback row against `WORK.md` summarising the failure, then returns `{ok:false, aborted:true, failedExtractor, reason}`. Parameters: `cycle: string`, `extractors: string[]`.

The tool uses `withStore(context, io)` (already defined in the plugin around line 178) to obtain an opened Cozo store and the project vocabulary, passes them to `runAssay`, and imports `putEntity` and `relate` from `scripts/lib/memory/writes.js`.

- [ ] **Step 1: Locate the registration point**

Run: `grep -n "foundry_validate_run" .opencode/plugins/foundry.js`
Note the line number. Register `foundry_assay_run` directly above or below `foundry_validate_run` — they are conceptually related.

- [ ] **Step 2: Write the failing test**

Create `tests/plugin/assay-tools.test.js`:

```javascript
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FoundryPlugin } from '../../.opencode/plugins/foundry.js';
import { signToken } from '../../scripts/lib/token.js';
import { disposeStores } from '../../scripts/lib/memory/singleton.js';

const GIT_ENV = { ...process.env,
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t',
  GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };

function setupWorktree() {
  const root = mkdtempSync(join(tmpdir(), 'assay-tool-'));
  mkdirSync(join(root, 'foundry/memory/entities'), { recursive: true });
  mkdirSync(join(root, 'foundry/memory/edges'), { recursive: true });
  mkdirSync(join(root, 'foundry/memory/relations'), { recursive: true });
  mkdirSync(join(root, 'foundry/memory/extractors'), { recursive: true });
  mkdirSync(join(root, 'scripts'), { recursive: true });
  writeFileSync(join(root, 'foundry/memory/config.md'), '---\nenabled: true\n---\n');
  writeFileSync(join(root, 'foundry/memory/entities/class.md'), '---\ntype: class\n---\n');
  writeFileSync(join(root, 'foundry/memory/schema.json'), JSON.stringify({
    version: 1, entities: { class: { frontmatterHash: 'x' } }, edges: {}, embeddings: null,
  }, null, 2));
  writeFileSync(join(root, 'foundry/memory/relations/class.ndjson'), '');
  // Git init so stage_begin can resolve baseSha.
  execSync('git init -q', { cwd: root, env: GIT_ENV });
  execSync('git add -A && git commit -q -m init', { cwd: root, env: GIT_ENV });
  return root;
}

function writeExtractor(root, name, { command, write }) {
  writeFileSync(join(root, `foundry/memory/extractors/${name}.md`),
`---
command: ${command}
memory:
  write: [${write.join(', ')}]
---

# ${name}
`);
}

function writeScript(root, rel, body) {
  const p = join(root, rel);
  writeFileSync(p, body);
  chmodSync(p, 0o755);
}

async function beginAssay(plugin, root, cycleId = 'c') {
  const pending = plugin[Symbol.for('foundry.test.pending')];
  const secret = plugin[Symbol.for('foundry.test.secret')];
  const payload = { route: `assay:${cycleId}`, cycle: cycleId, nonce: 'n-assay', exp: Date.now() + 60_000 };
  pending.add(payload.nonce, payload);
  const token = signToken(payload, secret);
  const r = JSON.parse(await plugin.tool.foundry_stage_begin.execute(
    { stage: `assay:${cycleId}`, cycle: cycleId, token }, { worktree: root }));
  if (!r.ok) throw new Error(`begin failed: ${JSON.stringify(r)}`);
}

async function endStage(plugin, root, summary = 'ok') {
  await plugin.tool.foundry_stage_end.execute({ summary }, { worktree: root });
}

describe('foundry_assay_run', () => {
  let root, plugin;
  before(async () => { root = setupWorktree(); plugin = await FoundryPlugin({ directory: root }); });
  after(() => { disposeStores(); rmSync(root, { recursive: true, force: true }); });

  it('executes a simple extractor and upserts entities into memory', async () => {
    writeScript(root, 'scripts/emit-one.sh', `#!/bin/sh
echo '{"kind":"entity","type":"class","name":"com.Hello","value":"hi"}'
`);
    writeExtractor(root, 'one', { command: 'scripts/emit-one.sh', write: ['class'] });

    // WORK.md must exist for feedback-writing; stage_begin does not create it,
    // so lay down a minimal one.
    writeFileSync(join(root, 'WORK.md'), '---\nflow: test\ncycle: c\n---\n\n# Goal\n\ntest\n');

    await beginAssay(plugin, root);
    const res = JSON.parse(await plugin.tool.foundry_assay_run.execute(
      { cycle: 'c', extractors: ['one'] }, { worktree: root }));
    await endStage(plugin, root);

    assert.equal(res.ok, true);
    assert.equal(res.perExtractor.length, 1);
    assert.equal(res.perExtractor[0].name, 'one');
    assert.equal(res.perExtractor[0].rowsUpserted, 1);

    // Confirm the row is readable via the get tool.
    const got = JSON.parse(await plugin.tool.foundry_memory_get.execute(
      { type: 'class', name: 'com.Hello' }, { worktree: root }));
    assert.equal(got.value, 'hi');
  });

  it('aborts on extractor non-zero exit and writes #validation feedback to WORK.md', async () => {
    writeScript(root, 'scripts/fail.sh', `#!/bin/sh\necho err >&2\nexit 3\n`);
    writeExtractor(root, 'bad', { command: 'scripts/fail.sh', write: ['class'] });

    writeFileSync(join(root, 'WORK.md'), '---\nflow: test\ncycle: c\n---\n\n# Goal\n\ntest\n');

    await beginAssay(plugin, root);
    const res = JSON.parse(await plugin.tool.foundry_assay_run.execute(
      { cycle: 'c', extractors: ['bad'] }, { worktree: root }));
    await endStage(plugin, root);

    assert.equal(res.ok, false);
    assert.equal(res.aborted, true);
    assert.equal(res.failedExtractor, 'bad');
    assert.match(res.reason, /exit code 3/);

    const work = readFileSync(join(root, 'WORK.md'), 'utf-8');
    assert.match(work, /#validation/);
    assert.match(work, /assay/);
    assert.match(work, /bad/);
  });

  it('refuses to run outside an assay stage', async () => {
    writeExtractor(root, 'x', { command: 'true', write: ['class'] });
    // No active stage
    const res = JSON.parse(await plugin.tool.foundry_assay_run.execute(
      { cycle: 'c', extractors: ['x'] }, { worktree: root }));
    assert.match(res.error, /requires active assay stage/);
  });
});
```

- [ ] **Step 3: Run test to verify failure**

Run: `node --test tests/plugin/assay-tools.test.js`
Expected: FAIL because `foundry_assay_run` is not registered.

- [ ] **Step 4: Register the tool**

In `.opencode/plugins/foundry.js`:

Add these imports near the other `scripts/lib/...` imports at the top of the file (after the existing memory imports):

```javascript
import { runAssay } from '../../scripts/lib/assay/run.js';
import { putEntity, relate } from '../../scripts/lib/memory/writes.js';
import { addFeedbackItem } from '../../scripts/lib/feedback.js';
```

> If those relative paths don't match the existing memory imports, look at how `putEntity` / other memory functions are already imported and use the same relative convention.

Then register the tool directly below `foundry_validate_run`. Insert:

```javascript
      foundry_assay_run: tool({
        description: 'Run extractors to populate flow memory. Only callable during an active assay stage. Aborts on first failure; writes #validation feedback against WORK.md on abort.',
        args: {
          cycle: tool.schema.string().describe('Cycle name'),
          extractors: tool.schema.array(tool.schema.string()).describe('Extractor names, executed in order'),
        },
        async execute(args, context) {
          const io = makeIO(context.worktree);
          const guard = requireActiveStage(io, { stageBase: 'assay', cycle: args.cycle });
          if (!guard.ok) return JSON.stringify({ error: `foundry_assay_run requires active assay stage for cycle '${args.cycle}'; ${guard.error}` });
          try {
            const memIo = makeMemoryIO(context.worktree);
            const store = await getOrOpenStore({ worktreeRoot: context.worktree, io: memIo });
            const ctx = getContext(context.worktree);
            const res = await runAssay({
              foundryDir: 'foundry',
              cwd: context.worktree,
              io: memIo,
              extractors: args.extractors,
              store,
              vocabulary: ctx.vocabulary,
              putEntity,
              relate,
            });
            if (!res.ok) {
              // Write #validation feedback against WORK.md summarising the failure.
              try {
                const workPath = 'WORK.md';
                if (await memIo.exists(workPath)) {
                  const text = await memIo.readFile(workPath);
                  const msg = `assay aborted on extractor \`${res.failedExtractor}\`: ${res.reason}` +
                    (res.stderr ? ` (stderr: ${res.stderr.trim().slice(0, 500)})` : '');
                  const out = addFeedbackItem(text, 'WORK.md', msg, 'validation');
                  await memIo.writeFile(workPath, out.text);
                }
              } catch (_err) { /* best effort */ }
            }
            return JSON.stringify(res);
          } catch (err) {
            return errorJson(err);
          }
        },
      }),
```

> If `getOrOpenStore`, `getContext`, `makeMemoryIO`, `requireActiveStage`, and `errorJson` are not already imported in the file scope at the point of insertion, add whichever is missing. Cross-reference the existing `foundry_memory_put` tool (search the file for `foundry_memory_put:`) — it uses all of these and is the canonical template.

- [ ] **Step 5: Extend `foundry_feedback_add` stage allow-list**

Foundry's feedback-add tool restricts which tags are permitted in which stage. Open `.opencode/plugins/foundry.js` and locate the registration of `foundry_feedback_add` (around line 574). Inside its `execute`, find the block that checks `stageBase`. There will be a mapping like:

```javascript
if (stageBase === 'forge') { /* allow:   */ }
else if (stageBase === 'quench') { /* allow: validation */ }
else if (stageBase === 'appraise') { /* allow: law:* */ }
...
```

Add an `assay` branch that allows only the `validation` tag:

```javascript
else if (stageBase === 'assay') {
  if (args.tag !== 'validation') {
    return JSON.stringify({ error: `foundry_feedback_add during assay stage only accepts tag 'validation'; got '${args.tag}'` });
  }
}
```

Place it alongside the other branches. This allows the tool call above to write `#validation` feedback during the assay stage. (Direct `addFeedbackItem` calls in the plugin bypass this tool-level check, so this step is defensive: it makes skill-initiated feedback possible too, should we need it in Phase 4.)

- [ ] **Step 6: Run test to verify pass**

Run: `node --test tests/plugin/assay-tools.test.js`
Expected: PASS on all three tests.

- [ ] **Step 7: Run full suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add .opencode/plugins/foundry.js tests/plugin/assay-tools.test.js
git commit -m "feat(plugin): add foundry_assay_run stage-guarded tool"
```

---

## Task 3: Register `foundry_extractor_create` tool

**Files:**
- Modify: `.opencode/plugins/foundry.js`
- Modify: `tests/plugin/assay-tools.test.js` (add a new `describe` block)

**Context:** Wrap the admin helper from Task 1. Arguments: `name`, `command`, `memoryWrite: string[]`, `body`, `timeout?: string`. Pattern copied exactly from `foundry_memory_create_entity_type`.

- [ ] **Step 1: Write the failing test**

Append to `tests/plugin/assay-tools.test.js` (after the existing `describe`):

```javascript
describe('foundry_extractor_create', () => {
  let root, plugin;
  before(async () => { root = setupWorktree(); plugin = await FoundryPlugin({ directory: root }); });
  after(() => { disposeStores(); rmSync(root, { recursive: true, force: true }); });

  it('creates an extractor file via the admin helper', async () => {
    const out = JSON.parse(await plugin.tool.foundry_extractor_create.execute({
      name: 'java-symbols',
      command: 'scripts/x.sh',
      memoryWrite: ['class'],
      body: 'brief',
    }, { worktree: root }));
    assert.equal(out.path, 'foundry/memory/extractors/java-symbols.md');
    const text = readFileSync(join(root, out.path), 'utf-8');
    assert.match(text, /command: scripts\/x\.sh/);
  });

  it('returns a structured error for bad input', async () => {
    const out = JSON.parse(await plugin.tool.foundry_extractor_create.execute({
      name: 'Bad',
      command: 'x',
      memoryWrite: ['class'],
      body: 'b',
    }, { worktree: root }));
    assert.match(out.error, /invalid identifier/);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `node --test tests/plugin/assay-tools.test.js`
Expected: FAIL — tool not registered.

- [ ] **Step 3: Register the tool**

In `.opencode/plugins/foundry.js`, near `foundry_memory_create_entity_type` (search for `foundry_memory_create_entity_type:`), add:

```javascript
      foundry_extractor_create: tool({
        description: 'Create a new extractor definition under foundry/memory/extractors/.',
        args: {
          name: tool.schema.string(),
          command: tool.schema.string(),
          memoryWrite: tool.schema.array(tool.schema.string()),
          body: tool.schema.string(),
          timeout: tool.schema.string().optional(),
        },
        async execute(args, context) {
          try {
            const io = makeMemoryIO(context.worktree);
            const { createExtractor } = await import('../../scripts/lib/memory/admin/create-extractor.js');
            const out = await createExtractor({ worktreeRoot: context.worktree, io, ...args });
            return JSON.stringify(out);
          } catch (err) { return errorJson(err); }
        },
      }),
```

> The `await import(...)` pattern matches how other admin helpers are lazy-loaded in this file. If the file uses static imports exclusively for admin helpers (check via `grep "from '../../scripts/lib/memory/admin"` in `foundry.js`), match whichever convention is used.

- [ ] **Step 4: Run test to verify pass**

Run: `node --test tests/plugin/assay-tools.test.js`
Expected: PASS on all 5 tests (3 from Task 2 + 2 new).

- [ ] **Step 5: Run full suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add .opencode/plugins/foundry.js tests/plugin/assay-tools.test.js
git commit -m "feat(plugin): add foundry_extractor_create tool"
```

---

## Phase 2 exit criteria

- [ ] `scripts/lib/memory/admin/create-extractor.js` exists and is unit-tested.
- [ ] `foundry_assay_run` registered, stage-guarded to `assay`, writes `#validation` to `WORK.md` on abort.
- [ ] `foundry_extractor_create` registered and validated against the project vocabulary.
- [ ] `foundry_feedback_add` allows the `validation` tag during an `assay` stage.
- [ ] `tests/plugin/assay-tools.test.js` passes.
- [ ] `npm test` passes across the whole repo.
- [ ] No changes yet to `scripts/orchestrate.js`, `scripts/sort.js`, or any skill. Nothing dispatches the assay stage autonomously — it only runs if a token is minted manually (as in the tests).

Proceed to [Phase 3](./2026-04-23-assay-stage-phase-3-orchestration.md).
