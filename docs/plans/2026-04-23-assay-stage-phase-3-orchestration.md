# Phase 3 — Orchestration Wiring

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `assay` stage participate in Foundry's cycle lifecycle: scheduled automatically when a cycle opts in, dispatched by `foundry_orchestrate`, routed through `sort.js`, and subject to a cycle-load-time permission check that surfaces bad extractor configs with clear errors.

**Architecture:** Three small, contained changes to existing files. `synthesizeStages` gains an `assay` parameter that inserts `assay:<cycleId>` at index 0 when set. `runOrchestrate`'s setup block validates the `assay:` frontmatter block (memory must be enabled, every listed extractor must exist, each extractor's `memoryWrite` must be ⊆ cycle's `memory.write`) and echoes the block into WORK.md's frontmatter. `sort.js`'s `isDispatchableRoute` regex grows an `assay` branch; `determineRoute` gains a `lastBase === 'assay'` handler that routes to forge.

**Depends on:** Phases 1–2. Uses `loadExtractor` from Phase 1 and `foundry_assay_run` (registered Phase 2) for dispatch.

**Files produced:**

- Modify: `scripts/orchestrate.js`
- Modify: `scripts/sort.js`
- Modify or Create: `tests/orchestrate.test.js` (append new describe blocks)
- Modify or Create: `tests/sort.test.js` (append new describe blocks)
- Create: `tests/plugin/assay-orchestration.test.js`

---

## Task 1: `synthesizeStages` accepts an `assay` parameter

**Files:**
- Modify: `scripts/orchestrate.js`
- Modify: `tests/orchestrate.test.js`

**Context:** The current signature of `synthesizeStages` is at `scripts/orchestrate.js:39`:

```javascript
export function synthesizeStages({ cycleId, hasValidation, humanAppraise }) {
  const stages = [`forge:${cycleId}`];
  if (hasValidation) stages.push(`quench:${cycleId}`);
  stages.push(`appraise:${cycleId}`);
  if (humanAppraise) stages.push(`human-appraise:${cycleId}`);
  return stages;
}
```

We add an `assay` boolean that prepends `assay:<cycleId>` at index 0. Callers outside of `runOrchestrate` use default `false` so existing behaviour is unchanged.

- [ ] **Step 1: Write the failing test**

Append to `tests/orchestrate.test.js` inside an appropriate `describe('synthesizeStages', ...)` block (or create one if it doesn't exist):

```javascript
import { synthesizeStages } from '../scripts/orchestrate.js';

describe('synthesizeStages with assay', () => {
  it('prepends assay:<cycleId> when assay is true', () => {
    const out = synthesizeStages({ cycleId: 'c', hasValidation: true, humanAppraise: false, assay: true });
    assert.deepEqual(out, ['assay:c', 'forge:c', 'quench:c', 'appraise:c']);
  });

  it('omits assay by default', () => {
    const out = synthesizeStages({ cycleId: 'c', hasValidation: false, humanAppraise: false });
    assert.deepEqual(out, ['forge:c', 'appraise:c']);
  });

  it('works alongside human-appraise', () => {
    const out = synthesizeStages({ cycleId: 'c', hasValidation: false, humanAppraise: true, assay: true });
    assert.deepEqual(out, ['assay:c', 'forge:c', 'appraise:c', 'human-appraise:c']);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `node --test tests/orchestrate.test.js`
Expected: FAIL with `assay:c` missing from output.

- [ ] **Step 3: Update the function**

In `scripts/orchestrate.js:39-45`, replace the function with:

```javascript
export function synthesizeStages({ cycleId, hasValidation, humanAppraise, assay = false }) {
  const stages = [];
  if (assay) stages.push(`assay:${cycleId}`);
  stages.push(`forge:${cycleId}`);
  if (hasValidation) stages.push(`quench:${cycleId}`);
  stages.push(`appraise:${cycleId}`);
  if (humanAppraise) stages.push(`human-appraise:${cycleId}`);
  return stages;
}
```

- [ ] **Step 4: Run test to verify pass**

Run: `node --test tests/orchestrate.test.js`
Expected: PASS on the three new tests and all pre-existing ones.

- [ ] **Step 5: Commit**

```bash
git add scripts/orchestrate.js tests/orchestrate.test.js
git commit -m "feat(orchestrate): synthesizeStages accepts assay flag"
```

---

## Task 2: Cycle setup validates and propagates `assay:` frontmatter

**Files:**
- Modify: `scripts/orchestrate.js`
- Modify: `tests/orchestrate.test.js` (or `tests/orchestrate-integration.test.js`)

**Context:** The setup block of `runOrchestrate` runs once per cycle (see `scripts/orchestrate.js:273-287`). It reads `cfm` (cycle frontmatter) and writes a derived `newFm` to `WORK.md`. We:

1. Validate `cfm.assay` shape if present.
2. If `cfm.assay.extractors` is a non-empty array, require memory to be enabled, load each extractor (Phase 1's `loadExtractor`), and verify the permission relationship.
3. Pass `assay: true` to `synthesizeStages` when extractors are opted in.
4. Copy `cfm.assay` onto `newFm.assay` so `sort.js` and the dispatch prompt can see it.
5. On any validation failure, return a `violation(...)` with a clear error message — this matches how other cycle-load errors are surfaced.

Key reference: `cfm.memory?.write` is the cycle's declared entity-type write permissions (from existing memory code). `resolvePermissions` (in `scripts/lib/memory/permissions.js`) produces a `{writeTypes: Set}` from it — we build the same shape ad-hoc here for the extractor check.

- [ ] **Step 1: Confirm the loader import path from `scripts/orchestrate.js`**

Run: `head -20 scripts/orchestrate.js`
Check the existing `import` lines to match your relative path style. Extractor loader will need to be added.

- [ ] **Step 2: Write the failing test**

Append to `tests/orchestrate.test.js` (or create an integration test using the existing patterns — consult `tests/orchestrate-integration.test.js` for fixture patterns). Example:

```javascript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runOrchestrate } from '../scripts/orchestrate.js';

function buildProject({ withMemory, cycleFm }) {
  const root = mkdtempSync(join(tmpdir(), 'orch-assay-'));
  mkdirSync(join(root, 'foundry/cycles'), { recursive: true });
  mkdirSync(join(root, 'foundry/artefacts/doc'), { recursive: true });
  writeFileSync(join(root, 'foundry/cycles/c.md'),
    `---\n${cycleFm}\n---\n\n# c\n`);
  writeFileSync(join(root, 'foundry/artefacts/doc/definition.md'),
    `---\ntype: doc\nfile-patterns: [out/**]\n---\n\n# doc\n`);
  if (withMemory) {
    mkdirSync(join(root, 'foundry/memory/entities'), { recursive: true });
    mkdirSync(join(root, 'foundry/memory/extractors'), { recursive: true });
    writeFileSync(join(root, 'foundry/memory/config.md'), '---\nenabled: true\n---\n');
    writeFileSync(join(root, 'foundry/memory/schema.json'),
      JSON.stringify({ version: 1, entities: { class: {} }, edges: {}, embeddings: null }));
    writeFileSync(join(root, 'foundry/memory/entities/class.md'), '---\ntype: class\n---\n');
    writeFileSync(join(root, 'foundry/memory/extractors/java.md'),
      `---\ncommand: x\nmemory:\n  write: [class]\n---\n\n# java\n`);
  }
  writeFileSync(join(root, 'WORK.md'), '---\nflow: f\ncycle: c\n---\n\n# Goal\n\ntest\n');
  return root;
}

describe('runOrchestrate setup with assay', () => {
  it('synthesises assay:c in the stage list when extractors are opted in', async () => {
    const root = buildProject({
      withMemory: true,
      cycleFm: `output: doc\nmemory:\n  read: [class]\n  write: [class]\nassay:\n  extractors: [java]`,
    });
    // Use the same io + mint + finalize pattern as other orchestrate tests — copy from
    // tests/orchestrate-integration.test.js if needed.
    // After setup, WORK.md's frontmatter should contain 'assay:c' in stages and an
    // `assay:` block equal to cfm.assay.
    // ... (fill in the harness; the key assertion:)
    // assert.ok(workMd.includes('- assay:c'));
    // assert.ok(workMd.includes('assay:'));
    rmSync(root, { recursive: true, force: true });
  });

  it('rejects assay when memory is not enabled', async () => {
    const root = buildProject({
      withMemory: false,
      cycleFm: `output: doc\nassay:\n  extractors: [java]`,
    });
    // Harness should return a violation referencing init-memory.
    rmSync(root, { recursive: true, force: true });
  });

  it('rejects assay when an extractor writes types not in the cycles memory.write', async () => {
    const root = buildProject({
      withMemory: true,
      cycleFm: `output: doc\nmemory:\n  read: [class]\n  write: [other]\nassay:\n  extractors: [java]`,
    });
    // Violation should mention 'java' and 'class'.
    rmSync(root, { recursive: true, force: true });
  });

  it('rejects assay when an extractor does not exist', async () => {
    const root = buildProject({
      withMemory: true,
      cycleFm: `output: doc\nmemory:\n  read: [class]\n  write: [class]\nassay:\n  extractors: [missing]`,
    });
    // Violation should mention 'missing'.
    rmSync(root, { recursive: true, force: true });
  });
});
```

> **Test-harness note.** `runOrchestrate` takes `cwd`, `cycleDef`, `git`, `mint`, `finalize`, `now`, `lastResult`, and `io`. See `tests/orchestrate-integration.test.js` for a fully wired invocation. Copy one of its `beforeEach` setups rather than inventing a new harness — mint and finalize stubs are the tricky bits.

- [ ] **Step 3: Run test to verify failure**

Run: `node --test tests/orchestrate.test.js`
Expected: FAIL — the setup block does not yet recognise `assay:`.

- [ ] **Step 4: Add the import**

Near the top of `scripts/orchestrate.js`, add:

```javascript
import { loadExtractor } from './lib/assay/loader.js';
```

- [ ] **Step 5: Extend the setup block**

In `scripts/orchestrate.js`, inside `runOrchestrate`, between the `const validation = await getValidation(...)` line (current line 259) and the `let stages;` line (current line 261), insert:

```javascript
    // Validate and normalise the cycle's `assay:` opt-in, if present.
    const assayBlock = cfm.assay;
    let assayExtractors = null;
    if (assayBlock !== undefined && assayBlock !== null) {
      if (typeof assayBlock !== 'object' || Array.isArray(assayBlock)) {
        return violation(`cycle ${cycleId}: 'assay' must be a mapping (got ${typeof assayBlock})`, ['WORK.md']);
      }
      const list = assayBlock.extractors;
      if (!Array.isArray(list) || list.length === 0) {
        return violation(`cycle ${cycleId}: 'assay.extractors' must be a non-empty array`, ['WORK.md']);
      }

      // Memory must be enabled.
      const memoryEnabled = await io.exists('foundry/memory/config.md');
      if (!memoryEnabled) {
        return violation(`cycle ${cycleId}: 'assay:' requires memory to be enabled (run the init-memory skill first)`, ['WORK.md']);
      }

      // Build the cycle's write-types set.
      const cycleWrite = cfm.memory?.write;
      if (!Array.isArray(cycleWrite)) {
        return violation(`cycle ${cycleId}: 'assay:' requires the cycle to declare memory.write`, ['WORK.md']);
      }
      const cycleWriteSet = new Set(cycleWrite);

      // Load each extractor and check its memory.write ⊆ cycle.memory.write.
      const loaded = [];
      for (const name of list) {
        let ext;
        try { ext = await loadExtractor(foundryDir, name, io); }
        catch (err) { return violation(`cycle ${cycleId}: ${err.message}`, ['WORK.md']); }
        const missing = ext.memoryWrite.filter((t) => !cycleWriteSet.has(t));
        if (missing.length > 0) {
          return violation(
            `cycle ${cycleId}: extractor '${name}' writes types not permitted by the cycle's memory.write: ${missing.join(', ')}`,
            ['WORK.md'],
          );
        }
        loaded.push(ext);
      }
      assayExtractors = list;
    }
```

- [ ] **Step 6: Pass `assay` to `synthesizeStages` and echo onto WORK frontmatter**

In the same file, replace the `synthesizeStages({...})` call (current lines 274-278) with:

```javascript
      stages = synthesizeStages({
        cycleId,
        hasValidation: !!validation && validation.length > 0,
        humanAppraise: cfm['human-appraise'] === true,
        assay: !!assayExtractors,
      });
```

And after the existing `if (cfm.models) newFm.models = cfm.models;` line (current line 287), add:

```javascript
    if (assayExtractors) newFm.assay = { extractors: assayExtractors };
```

- [ ] **Step 7: Run test to verify pass**

Run: `node --test tests/orchestrate.test.js`
Expected: PASS on the four new tests and all pre-existing ones.

- [ ] **Step 8: Run full suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 9: Commit**

```bash
git add scripts/orchestrate.js tests/orchestrate.test.js
git commit -m "feat(orchestrate): validate and propagate cycle assay block during setup"
```

---

## Task 3: `sort.js` dispatches `assay` and routes to `forge` afterwards

**Files:**
- Modify: `scripts/sort.js`
- Modify: `tests/sort.test.js`

**Context:** Two small changes:

1. `isDispatchableRoute` regex (line 256) must accept `assay:` as a valid route.
2. `determineRoute` (line 67) must handle `lastBase === 'assay'` by dispatching the first forge stage. (No other changes needed — `findFirst(stages, 'forge')` already skips past the `assay` stage at index 0 because it looks up the first forge entry by base.)

Iteration-0-only behaviour falls out naturally: the assay stage is at `stages[0]` and is only ever reached via the `lastBase === null` path (first entry to the cycle). On every subsequent loop-back, sort routes directly back to forge via `findFirst(stages, 'forge')`, skipping assay.

- [ ] **Step 1: Write the failing test**

Append to `tests/sort.test.js`:

```javascript
describe('determineRoute with assay', () => {
  const stages = ['assay:c', 'forge:c', 'quench:c', 'appraise:c'];

  it('dispatches assay as the first stage when no history exists', () => {
    const route = determineRoute(stages, [], [], 3);
    assert.equal(route, 'assay:c');
  });

  it('dispatches forge after assay completes', () => {
    const history = [{ stage: 'assay:c' }];
    const route = determineRoute(stages, history, [], 3);
    assert.equal(route, 'forge:c');
  });

  it('on a loop-back from appraise, skips assay and dispatches forge', () => {
    const history = [
      { stage: 'assay:c' },
      { stage: 'forge:c' },
      { stage: 'quench:c' },
      { stage: 'appraise:c' },
    ];
    // A rejected item forces a loop-back to forge.
    const feedback = [{ state: 'rejected' }];
    const route = determineRoute(stages, history, feedback, 3);
    assert.equal(route, 'forge:c');
  });

  it('without any assay in stages, behaves exactly as before', () => {
    const base = ['forge:c', 'appraise:c'];
    assert.equal(determineRoute(base, [], [], 3), 'forge:c');
  });
});
```

> If the signature of `determineRoute` in the current codebase differs from `(stages, history, feedback, maxIterations)`, re-read `scripts/sort.js` around line 67 and adjust the call sites accordingly. Do not change `determineRoute`'s signature.

- [ ] **Step 2: Run tests to verify failure**

Run: `node --test tests/sort.test.js`
Expected: FAIL on the new tests — either 'blocked' returned or the assay route is not recognised.

- [ ] **Step 3: Extend the dispatch regex**

In `scripts/sort.js:255-257`, replace:

```javascript
function isDispatchableRoute(route) {
  return typeof route === 'string' && /^(forge|quench|appraise|human-appraise):/.test(route);
}
```

with:

```javascript
function isDispatchableRoute(route) {
  return typeof route === 'string' && /^(assay|forge|quench|appraise|human-appraise):/.test(route);
}
```

- [ ] **Step 4: Add the `lastBase === 'assay'` handler**

In `scripts/sort.js`, inside `determineRoute` (around line 74 where `lastBase === null` is handled), add after the `lastBase === null` guard and before the `lastBase === 'forge'` check:

```javascript
  if (lastBase === 'assay') {
    return findFirst(stages, 'forge') ?? 'blocked';
  }
```

Full resulting snippet for clarity (lines 74-94 after edit):

```javascript
  if (lastBase === null) return stages[0];

  if (lastBase === 'assay') {
    return findFirst(stages, 'forge') ?? 'blocked';
  }

  if (lastBase === 'forge') {
    const next = nextInRoute(stages, lastEntry);
    return next ?? 'done';
  }
  // ... existing branches unchanged
```

- [ ] **Step 5: Run tests to verify pass**

Run: `node --test tests/sort.test.js`
Expected: PASS on all new and existing tests.

- [ ] **Step 6: Run full suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add scripts/sort.js tests/sort.test.js
git commit -m "feat(sort): route assay as first stage; transition to forge afterwards"
```

---

## Task 4: End-to-end orchestration test

**Files:**
- Create: `tests/plugin/assay-orchestration.test.js`

**Context:** A plugin-level test that exercises the full dispatch path: a cycle declaring `assay.extractors`, booted through `FoundryPlugin`, driven through `foundry_orchestrate` to verify the first dispatch is `assay:<cycle>`. Does NOT yet run the extractor (that requires the assay stage skill from Phase 4) — verifies only that orchestration produces a dispatchable assay route.

- [ ] **Step 1: Write the failing test**

Create `tests/plugin/assay-orchestration.test.js`:

```javascript
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FoundryPlugin } from '../../.opencode/plugins/foundry.js';
import { disposeStores } from '../../scripts/lib/memory/singleton.js';

const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME:'t', GIT_AUTHOR_EMAIL:'t@t', GIT_COMMITTER_NAME:'t', GIT_COMMITTER_EMAIL:'t@t' };

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'assay-orch-'));
  mkdirSync(join(root, 'foundry/cycles'), { recursive: true });
  mkdirSync(join(root, 'foundry/artefacts/doc'), { recursive: true });
  mkdirSync(join(root, 'foundry/memory/entities'), { recursive: true });
  mkdirSync(join(root, 'foundry/memory/extractors'), { recursive: true });
  mkdirSync(join(root, 'foundry/memory/relations'), { recursive: true });
  writeFileSync(join(root, 'foundry/memory/config.md'), '---\nenabled: true\n---\n');
  writeFileSync(join(root, 'foundry/memory/entities/class.md'), '---\ntype: class\n---\n');
  writeFileSync(join(root, 'foundry/memory/relations/class.ndjson'), '');
  writeFileSync(join(root, 'foundry/memory/schema.json'),
    JSON.stringify({ version: 1, entities: { class: { frontmatterHash: 'x' } }, edges: {}, embeddings: null }, null, 2));
  writeFileSync(join(root, 'foundry/memory/extractors/one.md'),
    `---\ncommand: scripts/x.sh\nmemory:\n  write: [class]\n---\n\n# one\n`);
  writeFileSync(join(root, 'foundry/artefacts/doc/definition.md'),
    `---\ntype: doc\nfile-patterns: [out/**]\n---\n\n# doc\n`);
  writeFileSync(join(root, 'foundry/cycles/c.md'),
    `---\noutput: doc\nmemory:\n  read: [class]\n  write: [class]\nassay:\n  extractors: [one]\n---\n\n# c\n`);
  writeFileSync(join(root, 'WORK.md'),
    `---\nflow: test-flow\ncycle: c\n---\n\n# Goal\n\nanything\n`);
  execSync('git init -q', { cwd: root, env: GIT_ENV });
  execSync('git add -A && git commit -q -m init', { cwd: root, env: GIT_ENV });
  return root;
}

describe('foundry_orchestrate + assay', () => {
  let root, plugin;
  before(async () => { root = setup(); plugin = await FoundryPlugin({ directory: root }); });
  after(() => { disposeStores(); rmSync(root, { recursive: true, force: true }); });

  it('dispatches assay as the first stage of the cycle', async () => {
    const res = JSON.parse(await plugin.tool.foundry_orchestrate.execute({}, { worktree: root }));
    assert.equal(res.action, 'dispatch');
    assert.equal(res.stage, 'assay:c');
    assert.match(res.prompt, /assay/);
  });
});
```

- [ ] **Step 2: Run test to verify expected behaviour**

Run: `node --test tests/plugin/assay-orchestration.test.js`
Expected: PASS. (If FAIL, earlier tasks are incomplete — use the failure to diagnose which.)

- [ ] **Step 3: Run full suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add tests/plugin/assay-orchestration.test.js
git commit -m "test(plugin): verify orchestrate dispatches assay before forge"
```

---

## Phase 3 exit criteria

- [ ] `synthesizeStages({..., assay: true})` returns `[assay, forge, ...]`.
- [ ] `runOrchestrate` setup validates `cfm.assay` (memory enabled, extractors exist, permissions ⊆) and echoes `assay` onto `newFm`.
- [ ] `sort.js` dispatchable regex recognises `assay:`; `determineRoute` routes `assay → forge`.
- [ ] `foundry_orchestrate` dispatches `assay:<cycle>` as the first stage when opted in.
- [ ] Iteration-0-only behaviour verified (loop-back from appraise goes to forge, not assay).
- [ ] All new tests pass. `npm test` passes.
- [ ] Nothing user-visible without a skill — the dispatched assay stage prompt exists but there is no skill to receive it yet. That arrives in Phase 4.

Proceed to [Phase 4](./2026-04-23-assay-stage-phase-4-skills.md).
