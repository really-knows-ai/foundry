# Phase 3: Plugin Tool API Switch

**Scope:** Rewrite `.opencode/plugins/foundry-tools/feedback-tools.js` to use `scripts/lib/feedback-store.js` (phase 1) with an id-based API. Update `.opencode/plugins/foundry-tools/assay-tools.js` caller. Add plugin end-to-end tests. After this phase, the plugin tools write to `WORK.feedback.yaml` exclusively; `WORK.md` is no longer consulted for feedback state by plugin entrypoints.

**Spec sections covered:** §8 (public API), §8.2 (authorship enforcement in the plugin), §8.3 (dedup plumbed through), §14.4 (plugin tool tests).

**Preconditions:** Phase 1 (feedback-store + transitions + ulid) and Phase 2 (IO shim rename + workfile ## Feedback removal) are committed and green.

**Legacy `scripts/lib/feedback.js` remains in place** with its temporary shim from task 1.4. Sort/orchestrate still import from it. Those callers move in phase 4; do not touch them here.

**Files in this phase:**
- Rewrite: `.opencode/plugins/foundry-tools/feedback-tools.js`
- Modify: `.opencode/plugins/foundry-tools/assay-tools.js`
- Create: `tests/plugin/feedback-tools.test.js`

**Test pattern (authoritative for this phase):**

Plugin tests in this phase instantiate the real plugin via `FoundryPlugin({directory: testDir})` and exercise tools end-to-end; there is **no stub layer**. This matches every existing `tests/plugin/*.test.js` file (e.g. `tests/plugin/assay-tools.test.js`, `tests/plugin/stage-end-failed-flow.test.js`). Do not invent a `toolStub` or reuse any fabricated stub apparatus — none exists in the tree.

Access tools via:
```js
const plugin = await FoundryPlugin({ directory: root });
const raw = await plugin.tool.foundry_feedback_add.execute(args, { worktree: root });
```

**Active-stage file (authoritative):**

The production path is `.foundry/active-stage.json` (see `scripts/lib/state.js` — `const ACTIVE = '.foundry/active-stage.json'`). Payload shape is `{cycle, stage, baseSha}`. Every test that sets up a fake active stage writes that JSON object, not a plain string, not an object with a `flow` key.

**Preflight:**

```bash
# Confirm phase 1+2 artifacts are present.
ls scripts/lib/ulid.js scripts/lib/feedback-store.js
rg -n "io\.rename" .opencode/plugins/foundry-tools/helpers.js
# Expect: helpers.js has io.rename.

# Confirm the active-stage file shape used by real callers.
rg -n "active-stage\.json" scripts/lib/state.js tests/plugin/stage-end-failed-flow.test.js
# Expect: path '.foundry/active-stage.json' and JSON payload {cycle, stage, baseSha}.

# Confirm the real plugin test pattern.
rg -n "FoundryPlugin\(\{ directory:" tests/plugin/ | head -5
# Expect: several hits; that is the pattern to copy.

# Baseline
npm test
```

---

## Task 3.1: Confirm the real plugin-test pattern

**Files:** Read-only inspection. No commits in this task.

- [ ] **Step 1: Read one existing plugin test end-to-end**

Open `tests/plugin/assay-tools.test.js` and/or `tests/plugin/stage-end-failed-flow.test.js`. Note the pattern:

```js
import { FoundryPlugin } from '../../.opencode/plugins/foundry-tools/index.js';
// ...
const plugin = await FoundryPlugin({ directory: root });
await plugin.tool.foundry_assay_run.execute(args, { worktree: root });
```

Note also how they set up `.foundry/active-stage.json` as JSON with `{cycle, stage, baseSha}`.

- [ ] **Step 2: Confirm `FoundryPlugin` export path**

```bash
rg -n "export.*FoundryPlugin\|export default.*FoundryPlugin" .opencode/plugins/foundry-tools/
```

Use that import path verbatim in the new test file.

No commit — this is preparation. The scaffolding in 3.2 uses only the verified pattern; do not invent stubs.

---

## Task 3.2: New `foundry_feedback_add` (RED)

**Files:** Create `tests/plugin/feedback-tools.test.js`.

- [ ] **Step 1: Scaffold the test file with the first failing test**

```js
// tests/plugin/feedback-tools.test.js
import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import { FoundryPlugin } from '../../.opencode/plugins/foundry-tools/index.js';

// ---------------------------------------------------------------------------
// Test harness — real plugin, no stub layer.
// Pattern copied from tests/plugin/assay-tools.test.js and
// tests/plugin/stage-end-failed-flow.test.js. Do not invent stubs.
// ---------------------------------------------------------------------------

/**
 * Write the active-stage JSON file. Production shape is {cycle, stage, baseSha}
 * (see scripts/lib/state.js). baseSha is a dummy in tests; real callers set it.
 */
function writeActiveStage(dir, { cycle = 'write-haiku', stage, baseSha = 'test-sha' }) {
  writeFileSync(
    path.join(dir, '.foundry', 'active-stage.json'),
    JSON.stringify({ cycle, stage, baseSha }),
    'utf-8',
  );
}

function makeWorktree({ stage = 'appraise:write-check', cycle = 'write-haiku', flow = 'creative' } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'fdy-feedback-tools-'));
  mkdirSync(path.join(dir, '.foundry'), { recursive: true });
  writeActiveStage(dir, { cycle, stage });
  writeFileSync(
    path.join(dir, 'WORK.md'),
    `---\nflow: ${flow}\ncycle: ${cycle}\nstages:\n  - ${stage}\n---\n\n# Goal\n\ngo\n\n| File | Type | Cycle | Status |\n|------|------|-------|--------|\n`,
    'utf-8',
  );
  return dir;
}

async function getPlugin(dir) {
  return FoundryPlugin({ directory: dir });
}

// Test-local convenience: returns the tool map from the real plugin. Equivalent
// to `(await FoundryPlugin({directory: dir})).tool`. Used instead of any stub.
async function tools(dir) {
  const plugin = await FoundryPlugin({ directory: dir });
  return plugin.tool;
}

function parseResult(raw) {
  return JSON.parse(raw);
}

let worktree;
afterEach(() => {
  if (worktree) {
    rmSync(worktree, { recursive: true, force: true });
    worktree = null;
  }
});

describe('foundry_feedback_add — id-based API', () => {
  test('writes WORK.feedback.yaml with a new item and returns the id', async () => {
    worktree = makeWorktree();
    const plugin = await getPlugin(worktree);
    const raw = await plugin.tool.foundry_feedback_add.execute(
      { file: 'haiku.md', text: 'too cheerful', tag: 'law:dark' },
      { worktree },
    );
    const res = parseResult(raw);
    assert.equal(res.ok, true);
    assert.equal(typeof res.id, 'string');
    assert.equal(res.id.length, 26);
    assert.equal(res.deduped, false);

    const doc = yaml.load(readFileSync(path.join(worktree, 'WORK.feedback.yaml'), 'utf-8'));
    assert.equal(doc.items.length, 1);
    assert.equal(doc.items[0].id, res.id);
    assert.equal(doc.items[0].source, 'appraise:write-check');
    assert.equal(doc.items[0].history[0].state, 'open');
  });

  test('returns deduped:true when the same (file, tag, text) exists', async () => {
    worktree = makeWorktree();
    const plugin = await getPlugin(worktree);
    const first = parseResult(await plugin.tool.foundry_feedback_add.execute(
      { file: 'haiku.md', text: 'too cheerful', tag: 'law:dark' },
      { worktree },
    ));
    const second = parseResult(await plugin.tool.foundry_feedback_add.execute(
      { file: 'haiku.md', text: 'too cheerful', tag: 'law:dark' },
      { worktree },
    ));
    assert.equal(second.ok, true);
    assert.equal(second.deduped, true);
    assert.equal(second.id, first.id);
  });

  test('rejects forge stage (forge cannot add feedback)', async () => {
    worktree = makeWorktree({ stage: 'forge:write' });
    const plugin = await getPlugin(worktree);
    const raw = await plugin.tool.foundry_feedback_add.execute(
      { file: 'haiku.md', text: 'x', tag: 'hitl' },
      { worktree },
    );
    const res = parseResult(raw);
    assert.ok(res.error);
    assert.match(res.error, /forge/);
  });

  test('rejects when no active stage', async () => {
    worktree = makeWorktree();
    rmSync(path.join(worktree, '.foundry', 'active-stage.json'), { force: true });
    const plugin = await getPlugin(worktree);
    const raw = await plugin.tool.foundry_feedback_add.execute(
      { file: 'haiku.md', text: 'x', tag: 'law:x' },
      { worktree },
    );
    const res = parseResult(raw);
    assert.ok(res.error);
    assert.match(res.error, /active stage/);
  });

  test('per-stage tag allow-list still enforced (quench may only add #validation)', async () => {
    worktree = makeWorktree({ stage: 'quench:check' });
    const plugin = await getPlugin(worktree);
    const raw = await plugin.tool.foundry_feedback_add.execute(
      { file: 'haiku.md', text: 'x', tag: 'law:nope' },
      { worktree },
    );
    const res = parseResult(raw);
    assert.match(res.error, /quench.*validation/);
  });
});
```

The `writeActiveStage(dir, {...})` helper is defined once and reused by every subsequent test in this file (tasks 3.6–3.10). This avoids the twelve-site copy-paste risk flagged in review.

- [ ] **Step 2: Run and confirm failure**

Run: `node --test tests/plugin/feedback-tools.test.js`
Expected failure mode (documented RED reason): the current `foundry_feedback_add` writes to `WORK.md` under a `## Feedback` section. The assertion `readFileSync('WORK.feedback.yaml', 'utf-8')` throws `ENOENT` because the file is never created. Additionally the response shape lacks `id` — the current tool returns `{ok: true, index}`. Both failures are expected; either alone is enough RED signal.

If the failure is *anything else* (e.g. `FoundryPlugin is not a function`, or active-stage not found), **stop and inspect the harness** — it means the import path or active-stage shape is wrong in the test, not a production-code gap.

---

## Task 3.3: Rewrite `foundry_feedback_add` (GREEN)

**Files:** Rewrite the top of `.opencode/plugins/foundry-tools/feedback-tools.js`.

- [ ] **Step 1: Replace imports**

Change the top of the file from:

```js
import { addFeedbackItem, actionFeedbackItem, wontfixFeedbackItem, resolveFeedbackItem, listFeedback } from '../../../scripts/lib/feedback.js';
import { parseFrontmatter } from '../../../scripts/lib/workfile.js';
import { parseArtefactsTable } from '../../../scripts/lib/artefacts.js';
import { requireActiveStage, stageBaseOf } from '../../../scripts/lib/stage-guard.js';
import { requireNotFailed } from '../../../scripts/lib/failed-flow.js';
import { makeIO } from './helpers.js';
```

to:

```js
import path from 'path';
import { openFeedbackStore } from '../../../scripts/lib/feedback-store.js';
import { parseFrontmatter } from '../../../scripts/lib/workfile.js';
import { requireActiveStage, stageBaseOf } from '../../../scripts/lib/stage-guard.js';
import { requireNotFailed } from '../../../scripts/lib/failed-flow.js';
import { makeIO } from './helpers.js';
```

Delete the `readFileSync, writeFileSync, existsSync` import and the `parseArtefactsTable` import — neither is needed any more (artefacts are not used by feedback operations; cycle is read from frontmatter).

- [ ] **Step 2: Helper: read cycle from WORK.md frontmatter**

Add this helper at the top of the module (above `createFeedbackTools`):

```js
function readCycle(io) {
  if (!io.exists('WORK.md')) return null;
  const fm = parseFrontmatter(io.readFile('WORK.md'));
  return fm.cycle || null;
}
```

- [ ] **Step 3: Replace `foundry_feedback_add` execute**

Inside `createFeedbackTools`, replace the `foundry_feedback_add` tool definition's `execute` with:

```js
      async execute(args, context) {
        const io = makeIO(context.worktree);
        const failedGuard = requireNotFailed(io);
        if (!failedGuard.ok) return JSON.stringify({ error: `foundry_feedback_add: ${failedGuard.error}` });
        const guard = requireActiveStage(io);
        if (!guard.ok) return JSON.stringify({ error: `foundry_feedback_add requires active stage; ${guard.error}` });

        const activeStage = guard.active.stage;
        const stageBase = stageBaseOf(activeStage);

        // Per-stage tag allow-list (unchanged from the markdown era).
        if (stageBase === 'forge') {
          return JSON.stringify({ error: 'foundry_feedback_add: forge stages do not add feedback' });
        }
        if (stageBase === 'quench' && args.tag !== 'validation') {
          return JSON.stringify({ error: `foundry_feedback_add: quench may only add tag "validation"; got "${args.tag}"` });
        }
        if (stageBase === 'appraise' && !args.tag.startsWith('law:')) {
          return JSON.stringify({ error: `foundry_feedback_add: appraise tag must start with "law:"; got "${args.tag}"` });
        }
        if (stageBase === 'human-appraise' && args.tag !== 'human') {
          return JSON.stringify({ error: `foundry_feedback_add: human-appraise may only add tag "human"; got "${args.tag}"` });
        }
        if (stageBase === 'assay' && args.tag !== 'validation') {
          return JSON.stringify({ error: `foundry_feedback_add: assay may only add tag "validation"; got "${args.tag}"` });
        }

        const cycle = readCycle(io);
        if (!cycle) return JSON.stringify({ error: 'foundry_feedback_add: WORK.md cycle not found' });

        try {
          const store = openFeedbackStore('WORK.feedback.yaml', io);
          const { id, deduped } = store.add({
            file: args.file,
            tag: args.tag,
            text: args.text,
            source: activeStage,
            cycle,
          });
          return JSON.stringify({ ok: true, id, deduped });
        } catch (err) {
          return JSON.stringify({ error: `foundry_feedback_add: ${err.message}` });
        }
      },
```

- [ ] **Step 3a: Harness sanity check**

If the tests failed in task 3.2 because of harness issues rather than production-code gaps (e.g. import path wrong, active-stage not found), fix the harness to match the pattern in `tests/plugin/assay-tools.test.js`. No stub fabrication — only the real `FoundryPlugin` pattern.

- [ ] **Step 4: Run tests and confirm pass**

Run: `node --test tests/plugin/feedback-tools.test.js`
Expected: all `foundry_feedback_add` tests pass.

- [ ] **Step 5: Full suite**

Run: `npm test`
Expected: **many failures** — every existing plugin test that calls `foundry_feedback_action`/`_wontfix`/`_resolve`/`_list` with the old `{file, index}` shape will break once we switch it in subsequent tasks. For now, `foundry_feedback_add` is converted and those tools still point at the legacy code path; focus on keeping tests green by only asserting add works.

If the full suite is not yet green because of a partial rewrite, **DO NOT commit**. Revert the partial rewrite and make the add task fully contained: if the other tools break at runtime, wrap them so they still run against the legacy shim just for this commit. A cleaner pattern: rewrite one tool, commit, rewrite the next, commit.

Specifically:
- After task 3.3, `add` goes through feedback-store; `action`/`wontfix`/`resolve`/`list` are unchanged and still use the legacy `feedback.js` module.
- This means after task 3.3, `add` writes to `WORK.feedback.yaml` but the other tools still read from `WORK.md`. **That is a transient broken state** and will break integration tests that add-then-list. If any such tests exist, mark them `test.skip(...)` with a comment referencing phase 3 — they'll be restored and updated after task 3.11.

**Verify before committing:**
```bash
npm test
# Check exit status; node:test also emits a summary line like "# fail 0" at end.
echo "exit=$?"
# Or, for a grep-based count of genuine failures:
npm test 2>&1 | rg -c '^# fail [1-9]'
```
If exit is zero (or the `# fail [1-9]` count is zero), commit. Otherwise inspect each failure — it's either a legitimate phase-3 transient (skip with a clear comment) or a regression you caused (fix before committing).

- [ ] **Step 6: Commit**

```bash
git add .opencode/plugins/foundry-tools/feedback-tools.js tests/plugin/feedback-tools.test.js
git commit -m "feat(feedback-tools): foundry_feedback_add writes WORK.feedback.yaml

Switches foundry_feedback_add to use scripts/lib/feedback-store.js;
response shape is now {ok, id, deduped}. Source is automatically
captured from the active stage (spec §8.1). All existing per-stage
tag allow-lists preserved.

Remaining feedback tools still call the legacy markdown-era feedback.js
— they are rewritten in subsequent tasks of phase 3."
```

---

## Task 3.4: New `foundry_feedback_list` (RED)

**Files:** Extend `tests/plugin/feedback-tools.test.js`.

- [ ] **Step 1: Add tests**

```js
describe('foundry_feedback_list — new response shape', () => {
  test('returns items with {id, file, tag, text, source, state, depth} fields', async () => {
    worktree = makeWorktree();
    const t = await tools(worktree);
    const addRes = parseResult(await t.foundry_feedback_add.execute(
      { file: 'haiku.md', text: 'too cheerful', tag: 'law:dark' },
      { worktree },
    ));

    const listRaw = await t.foundry_feedback_list.execute({}, { worktree });
    const items = parseResult(listRaw);
    assert.equal(Array.isArray(items), true);
    assert.equal(items.length, 1);
    const it = items[0];
    assert.equal(it.id, addRes.id);
    assert.equal(it.file, 'haiku.md');
    assert.equal(it.tag, 'law:dark');
    assert.equal(it.text, 'too cheerful');
    assert.equal(it.source, 'appraise:write-check');
    assert.equal(it.state, 'open');
    assert.equal(it.depth, 1);
    assert.equal(it.reason, undefined);
  });

  test('filters by file when `file` argument is supplied', async () => {
    worktree = makeWorktree();
    const t = await tools(worktree);
    await t.foundry_feedback_add.execute({ file: 'a.md', text: 't1', tag: 'law:x' }, { worktree });
    await t.foundry_feedback_add.execute({ file: 'b.md', text: 't2', tag: 'law:x' }, { worktree });
    const items = parseResult(await t.foundry_feedback_list.execute({ file: 'a.md' }, { worktree }));
    assert.equal(items.length, 1);
    assert.equal(items[0].file, 'a.md');
  });

  test('returns an empty array when WORK.feedback.yaml is absent', async () => {
    worktree = makeWorktree();
    const t = await tools(worktree);
    const items = parseResult(await t.foundry_feedback_list.execute({}, { worktree }));
    assert.deepEqual(items, []);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `node --test tests/plugin/feedback-tools.test.js`
Expected: new list tests fail — the existing `foundry_feedback_list` returns the old shape `[{file, index, text, state, tags, resolved}]`, not the new `[{id, file, tag, text, source, state, depth, reason?}]` shape.

---

## Task 3.5: Rewrite `foundry_feedback_list` (GREEN)

**Files:** Modify `.opencode/plugins/foundry-tools/feedback-tools.js`.

- [ ] **Step 1: Replace the `foundry_feedback_list` tool definition**

```js
    foundry_feedback_list: tool({
      description: 'List feedback items, optionally filtered by file',
      args: {
        file: tool.schema.string().optional().describe('Filter by artefact file path'),
      },
      async execute(args, context) {
        const io = makeIO(context.worktree);
        if (!io.exists('WORK.md')) {
          return JSON.stringify({ error: 'WORK.md not found' });
        }
        try {
          const store = openFeedbackStore('WORK.feedback.yaml', io);
          const items = store.list()
            .filter(it => !args.file || it.file === args.file)
            .map(it => {
              const head = it.history[0];
              const base = {
                id: it.id,
                file: it.file,
                tag: it.tag,
                text: it.text,
                source: it.source,
                state: head.state,
                depth: head.state === 'resolved' ? 0 : it.history.length,
              };
              if (head.reason) base.reason = head.reason;
              return base;
            });
          return JSON.stringify(items);
        } catch (err) {
          return JSON.stringify({ error: `foundry_feedback_list: ${err.message}` });
        }
      },
    }),
```

- [ ] **Step 2: Run tests and confirm pass**

Run: `node --test tests/plugin/feedback-tools.test.js`
Expected: all list tests pass.

- [ ] **Step 3: Full suite**

Run: `npm test`

Regressions you should see here:
- Any code that calls `listFeedback(...)` and expects `{file, index, text, state, tags, resolved}` — specifically `scripts/orchestrate.js:99` (`readRecentFeedback`). That function is patched in phase 4; for now, it will return surfaces with `undefined` `resolved` fields but won't crash (it filters on `state === 'wont-fix' || state === 'rejected'`, both of which are still valid states).

If any test genuinely breaks, inspect — if it's a phase-4 concern, add a minimal no-op patch; if it's a real regression, fix.

- [ ] **Step 4: Commit**

```bash
git add .opencode/plugins/foundry-tools/feedback-tools.js tests/plugin/feedback-tools.test.js
git commit -m "feat(feedback-tools): foundry_feedback_list returns id-based shape

Response is now [{id, file, tag, text, source, state, depth, reason?}]
per spec §8.1. depth is history.length for non-resolved items and 0
for resolved (terminal). reason is present iff the current snapshot
has one (rejected/wont-fix/deadlocked)."
```

---

## Task 3.6: New `foundry_feedback_action` (RED)

**Files:** Extend `tests/plugin/feedback-tools.test.js`.

- [ ] **Step 1: Add tests**

```js
describe('foundry_feedback_action — id-based', () => {
  test('transitions an open item to actioned from a forge stage', async () => {
    worktree = makeWorktree();
    const tAdd = await tools(worktree);
    const { id } = parseResult(await tAdd.foundry_feedback_add.execute(
      { file: 'haiku.md', text: 'x', tag: 'law:x' },
      { worktree },
    ));
    // Rewrite active-stage to forge:write and call action.
    writeActiveStage(worktree, { stage: 'forge:write', cycle: 'write-haiku' });
    const tAct = await tools(worktree);
    const res = parseResult(await tAct.foundry_feedback_action.execute({ id }, { worktree }));
    assert.equal(res.ok, true);

    const doc = yaml.load(readFileSync(path.join(worktree, 'WORK.feedback.yaml'), 'utf-8'));
    assert.equal(doc.items[0].history[0].state, 'actioned');
    assert.equal(doc.items[0].history[0].stage, 'forge:write');
  });

  test('rejects non-forge stage', async () => {
    worktree = makeWorktree();
    const t = await tools(worktree);
    const { id } = parseResult(await t.foundry_feedback_add.execute(
      { file: 'haiku.md', text: 'x', tag: 'law:x' },
      { worktree },
    ));
    // active-stage is still appraise:write-check; foundry_feedback_action requires forge.
    const res = parseResult(await t.foundry_feedback_action.execute({ id }, { worktree }));
    assert.ok(res.error);
    assert.match(res.error, /forge/);
  });

  test('rejects unknown id', async () => {
    worktree = makeWorktree({ stage: 'forge:write' });
    const t = await tools(worktree);
    const res = parseResult(await t.foundry_feedback_action.execute({ id: 'DOES_NOT_EXIST' }, { worktree }));
    assert.ok(res.error);
    assert.match(res.error, /not found/);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `node --test tests/plugin/feedback-tools.test.js`
Expected: tests fail — existing `foundry_feedback_action` still takes `{file, index}` and writes to `WORK.md`.

---

## Task 3.7: Rewrite `foundry_feedback_action` (GREEN)

**Files:** Modify `.opencode/plugins/foundry-tools/feedback-tools.js`.

- [ ] **Step 1: Replace the tool definition**

```js
    foundry_feedback_action: tool({
      description: 'Mark a feedback item as actioned (forge stages only)',
      args: {
        id: tool.schema.string().describe('Feedback item id (ULID)'),
      },
      async execute(args, context) {
        const io = makeIO(context.worktree);
        const failedGuard = requireNotFailed(io);
        if (!failedGuard.ok) return JSON.stringify({ error: `foundry_feedback_action: ${failedGuard.error}` });
        const guard = requireActiveStage(io);
        if (!guard.ok) return JSON.stringify({ error: `foundry_feedback_action requires active stage; ${guard.error}` });
        const stageBase = stageBaseOf(guard.active.stage);
        if (stageBase !== 'forge') {
          return JSON.stringify({ error: `foundry_feedback_action requires active forge stage; current: ${guard.active.stage}` });
        }
        const cycle = readCycle(io);
        if (!cycle) return JSON.stringify({ error: 'foundry_feedback_action: WORK.md cycle not found' });

        try {
          const store = openFeedbackStore('WORK.feedback.yaml', io);
          const r = store.transition({
            id: args.id,
            target: 'actioned',
            stage: guard.active.stage,
            cycle,
          });
          if (!r.ok) return JSON.stringify({ error: r.error });
          return JSON.stringify({ ok: true });
        } catch (err) {
          return JSON.stringify({ error: `foundry_feedback_action: ${err.message}` });
        }
      },
    }),
```

- [ ] **Step 2: Run tests and confirm pass**

Run: `node --test tests/plugin/feedback-tools.test.js`
Expected: all action tests pass.

- [ ] **Step 3: Full suite, commit**

Run: `npm test`
Fix any surprise regressions (likely none — no production code currently calls this tool programmatically; LLM callers don't exist at test time).

```bash
git add .opencode/plugins/foundry-tools/feedback-tools.js tests/plugin/feedback-tools.test.js
git commit -m "feat(feedback-tools): foundry_feedback_action takes {id}

Replaces {file, index} with the ULID-based id per spec §8.1. Transition
goes through feedback-store, which enforces the forge-path rule of the
state machine (open|rejected → actioned). Unknown id surfaces as an
error response rather than a silent no-op."
```

---

## Task 3.8: New `foundry_feedback_wontfix` (RED + GREEN)

**Files:** `tests/plugin/feedback-tools.test.js`, `.opencode/plugins/foundry-tools/feedback-tools.js`.

- [ ] **Step 1: Add tests**

```js
describe('foundry_feedback_wontfix — id-based', () => {
  test('transitions to wont-fix with reason from a forge stage', async () => {
    worktree = makeWorktree({ stage: 'forge:write' });
    // First add from an appraise stage (forge cannot add).
    writeActiveStage(worktree, { stage: 'appraise:a', cycle: 'write-haiku' });
    const t1 = await tools(worktree);
    const { id } = parseResult(await t1.foundry_feedback_add.execute(
      { file: 'haiku.md', text: 'x', tag: 'law:x' },
      { worktree },
    ));
    // Switch to forge, call wontfix.
    writeActiveStage(worktree, { stage: 'forge:write', cycle: 'write-haiku' });
    const t2 = await tools(worktree);
    const res = parseResult(await t2.foundry_feedback_wontfix.execute(
      { id, reason: 'out of scope' },
      { worktree },
    ));
    assert.equal(res.ok, true);
    const doc = yaml.load(readFileSync(path.join(worktree, 'WORK.feedback.yaml'), 'utf-8'));
    assert.equal(doc.items[0].history[0].state, 'wont-fix');
    assert.equal(doc.items[0].history[0].reason, 'out of scope');
  });

  test('rejects missing reason', async () => {
    worktree = makeWorktree();
    const tAdd = await tools(worktree);
    const { id } = parseResult(await tAdd.foundry_feedback_add.execute(
      { file: 'haiku.md', text: 'x', tag: 'law:x' },
      { worktree },
    ));
    writeActiveStage(worktree, { stage: 'forge:write', cycle: 'write-haiku' });
    const tWf = await tools(worktree);
    const res = parseResult(await tWf.foundry_feedback_wontfix.execute({ id, reason: '' }, { worktree }));
    assert.ok(res.error);
    assert.match(res.error, /reason/);
  });
});
```

- [ ] **Step 2: Confirm failure**

Run: `node --test tests/plugin/feedback-tools.test.js`
Expected: wontfix tests fail (old signature).

- [ ] **Step 3: Replace the tool definition**

```js
    foundry_feedback_wontfix: tool({
      description: 'Mark a feedback item as wont-fix with reason (forge stages only)',
      args: {
        id: tool.schema.string().describe('Feedback item id (ULID)'),
        reason: tool.schema.string().describe('Reason for wont-fix'),
      },
      async execute(args, context) {
        const io = makeIO(context.worktree);
        const failedGuard = requireNotFailed(io);
        if (!failedGuard.ok) return JSON.stringify({ error: `foundry_feedback_wontfix: ${failedGuard.error}` });
        const guard = requireActiveStage(io);
        if (!guard.ok) return JSON.stringify({ error: `foundry_feedback_wontfix requires active stage; ${guard.error}` });
        const stageBase = stageBaseOf(guard.active.stage);
        if (stageBase !== 'forge') {
          return JSON.stringify({ error: `foundry_feedback_wontfix requires active forge stage; current: ${guard.active.stage}` });
        }
        const cycle = readCycle(io);
        if (!cycle) return JSON.stringify({ error: 'foundry_feedback_wontfix: WORK.md cycle not found' });

        try {
          const store = openFeedbackStore('WORK.feedback.yaml', io);
          const r = store.transition({
            id: args.id,
            target: 'wont-fix',
            stage: guard.active.stage,
            cycle,
            reason: args.reason,
          });
          if (!r.ok) return JSON.stringify({ error: r.error });
          return JSON.stringify({ ok: true });
        } catch (err) {
          return JSON.stringify({ error: `foundry_feedback_wontfix: ${err.message}` });
        }
      },
    }),
```

- [ ] **Step 4: Run tests and commit**

Run: `node --test tests/plugin/feedback-tools.test.js` — expect pass.
Run: `npm test` — no regressions.

```bash
git add .opencode/plugins/foundry-tools/feedback-tools.js tests/plugin/feedback-tools.test.js
git commit -m "feat(feedback-tools): foundry_feedback_wontfix takes {id, reason}

Id-based API per spec §8.1. Transition is gated by feedback-store's
state machine, which requires a non-empty reason for wont-fix per §4.3."
```

---

## Task 3.9: New `foundry_feedback_resolve` (RED + GREEN)

**Files:** `tests/plugin/feedback-tools.test.js`, `.opencode/plugins/foundry-tools/feedback-tools.js`.

- [ ] **Step 1: Add tests**

```js
describe('foundry_feedback_resolve — id-based', () => {
  async function setupToActioned(stage, cycle = 'write-haiku') {
    worktree = makeWorktree({ stage });
    const t1 = await tools(worktree);
    const { id } = parseResult(await t1.foundry_feedback_add.execute(
      { file: 'haiku.md', text: 'x', tag: stage.startsWith('appraise') ? 'law:x' : 'validation' },
      { worktree },
    ));
    // Switch to forge, action it.
    writeActiveStage(worktree, { stage: 'forge:write', cycle });
    const t2 = await tools(worktree);
    const actRes = parseResult(await t2.foundry_feedback_action.execute({ id }, { worktree }));
    assert.equal(actRes.ok, true);
    return id;
  }

  test('source stage resolves an actioned item', async () => {
    const id = await setupToActioned('appraise:write-check');
    // Switch back to source.
    writeActiveStage(worktree, { stage: 'appraise:write-check', cycle: 'write-haiku' });
    const t = await tools(worktree);
    const res = parseResult(await t.foundry_feedback_resolve.execute(
      { id, resolution: 'approved' },
      { worktree },
    ));
    assert.equal(res.ok, true);
    const doc = yaml.load(readFileSync(path.join(worktree, 'WORK.feedback.yaml'), 'utf-8'));
    assert.equal(doc.items[0].history[0].state, 'resolved');
  });

  test('non-source stage cannot resolve', async () => {
    const id = await setupToActioned('appraise:write-check');
    writeActiveStage(worktree, { stage: 'appraise:other-check', cycle: 'write-haiku' });
    const t = await tools(worktree);
    const res = parseResult(await t.foundry_feedback_resolve.execute(
      { id, resolution: 'approved' },
      { worktree },
    ));
    assert.match(res.error, /source/);
  });

  test('rejected resolution requires reason', async () => {
    const id = await setupToActioned('appraise:write-check');
    writeActiveStage(worktree, { stage: 'appraise:write-check', cycle: 'write-haiku' });
    const t = await tools(worktree);
    const res = parseResult(await t.foundry_feedback_resolve.execute(
      { id, resolution: 'rejected' },
      { worktree },
    ));
    assert.match(res.error, /reason/);
  });
});
```

- [ ] **Step 2: Confirm failure**

Run: `node --test tests/plugin/feedback-tools.test.js`
Expected: resolve tests fail.

- [ ] **Step 3: Replace the tool definition**

Note: the OLD API's `resolution` was `'approved' | 'rejected'`. The NEW state machine uses `'resolved' | 'rejected'` (spec §5). We keep the public arg as `'approved' | 'rejected'` for backward compatibility at the prompt surface (skills still say "approved"), but translate internally:

```js
    foundry_feedback_resolve: tool({
      description: 'Resolve a feedback item (approved or rejected)',
      args: {
        id: tool.schema.string().describe('Feedback item id (ULID)'),
        resolution: tool.schema.enum(['approved', 'rejected']).describe('Resolution type'),
        reason: tool.schema.string().optional().describe('Reason (required if rejected, or for deadlock override)'),
      },
      async execute(args, context) {
        const io = makeIO(context.worktree);
        const failedGuard = requireNotFailed(io);
        if (!failedGuard.ok) return JSON.stringify({ error: `foundry_feedback_resolve: ${failedGuard.error}` });
        const guard = requireActiveStage(io);
        if (!guard.ok) return JSON.stringify({ error: `foundry_feedback_resolve requires active stage; ${guard.error}` });
        const stageBase = stageBaseOf(guard.active.stage);
        if (!['quench', 'appraise', 'human-appraise'].includes(stageBase)) {
          return JSON.stringify({ error: `foundry_feedback_resolve requires active quench|appraise|human-appraise stage; current: ${guard.active.stage}` });
        }
        const cycle = readCycle(io);
        if (!cycle) return JSON.stringify({ error: 'foundry_feedback_resolve: WORK.md cycle not found' });

        const target = args.resolution === 'approved' ? 'resolved' : 'rejected';

        try {
          const store = openFeedbackStore('WORK.feedback.yaml', io);
          const r = store.transition({
            id: args.id,
            target,
            stage: guard.active.stage,
            cycle,
            reason: args.reason,
          });
          if (!r.ok) return JSON.stringify({ error: r.error });
          return JSON.stringify({ ok: true });
        } catch (err) {
          return JSON.stringify({ error: `foundry_feedback_resolve: ${err.message}` });
        }
      },
    }),
```

- [ ] **Step 4: Run tests and commit**

Run: `node --test tests/plugin/feedback-tools.test.js` — expect pass.
Run: `npm test` — no regressions.

```bash
git add .opencode/plugins/foundry-tools/feedback-tools.js tests/plugin/feedback-tools.test.js
git commit -m "feat(feedback-tools): foundry_feedback_resolve takes {id, resolution, reason?}

Id-based API. Tool's public 'approved' resolution translates to the
state machine's 'resolved' (terminal). Source-authorship rule enforced
by feedback-store.transition: only the stage that created the item may
resolve or reject it (human-appraise can override deadlocked items via
the same tool — verified in the deadlock-override tests of phase 4)."
```

---

## Task 3.10: Deadlock-override path in `foundry_feedback_resolve` (RED + GREEN)

**Files:** `tests/plugin/feedback-tools.test.js`. No production code change — this verifies the store's deadlock-override surfaces correctly through the tool.

- [ ] **Step 1: Add test**

```js
describe('foundry_feedback_resolve — deadlock override', () => {
  test('human-appraise can resolve a deadlocked item regardless of source', async () => {
    worktree = makeWorktree({ stage: 'appraise:write-check' });
    const tAdd = await tools(worktree);
    const { id } = parseResult(await tAdd.foundry_feedback_add.execute(
      { file: 'haiku.md', text: 'x', tag: 'law:x' },
      { worktree },
    ));
    // Simulate sort-side deadlock: write the snapshot directly via yaml.
    const feedbackPath = path.join(worktree, 'WORK.feedback.yaml');
    const doc = yaml.load(readFileSync(feedbackPath, 'utf-8'));
    doc.items[0].history.unshift({
      state: 'deadlocked',
      stage: 'sort',
      cycle: 'write-haiku',
      timestamp: new Date().toISOString(),
      reason: 'depth=3',
    });
    writeFileSync(feedbackPath, yaml.dump(doc), 'utf-8');

    // Switch to human-appraise stage, resolve it.
    writeActiveStage(worktree, { stage: 'human-appraise:review', cycle: 'write-haiku' });
    const t = await tools(worktree);
    const res = parseResult(await t.foundry_feedback_resolve.execute(
      { id, resolution: 'approved', reason: 'accepting as-is' },
      { worktree },
    ));
    assert.equal(res.ok, true);
    const after = yaml.load(readFileSync(feedbackPath, 'utf-8'));
    assert.equal(after.items[0].history[0].state, 'resolved');
  });

  test('deadlock override requires a reason', async () => {
    worktree = makeWorktree({ stage: 'appraise:write-check' });
    const tAdd = await tools(worktree);
    const { id } = parseResult(await tAdd.foundry_feedback_add.execute(
      { file: 'haiku.md', text: 'x', tag: 'law:x' },
      { worktree },
    ));
    const feedbackPath = path.join(worktree, 'WORK.feedback.yaml');
    const doc = yaml.load(readFileSync(feedbackPath, 'utf-8'));
    doc.items[0].history.unshift({
      state: 'deadlocked',
      stage: 'sort',
      cycle: 'write-haiku',
      timestamp: new Date().toISOString(),
      reason: 'depth=3',
    });
    writeFileSync(feedbackPath, yaml.dump(doc), 'utf-8');
    writeActiveStage(worktree, { stage: 'human-appraise:review', cycle: 'write-haiku' });
    const t = await tools(worktree);
    const res = parseResult(await t.foundry_feedback_resolve.execute(
      { id, resolution: 'approved' }, // no reason
      { worktree },
    ));
    assert.match(res.error, /reason/);
  });

  test('appraise CANNOT override a deadlocked item even when source matches', async () => {
    worktree = makeWorktree({ stage: 'appraise:write-check' });
    const tAdd = await tools(worktree);
    const { id } = parseResult(await tAdd.foundry_feedback_add.execute(
      { file: 'haiku.md', text: 'x', tag: 'law:x' },
      { worktree },
    ));
    const feedbackPath = path.join(worktree, 'WORK.feedback.yaml');
    const doc = yaml.load(readFileSync(feedbackPath, 'utf-8'));
    doc.items[0].history.unshift({
      state: 'deadlocked',
      stage: 'sort',
      cycle: 'write-haiku',
      timestamp: new Date().toISOString(),
      reason: 'depth=3',
    });
    writeFileSync(feedbackPath, yaml.dump(doc), 'utf-8');
    // active-stage is still appraise:write-check (matches source).
    const t = await tools(worktree);
    const res = parseResult(await t.foundry_feedback_resolve.execute(
      { id, resolution: 'approved', reason: 'trying' },
      { worktree },
    ));
    // State machine refuses: only human-appraise overrides deadlocked.
    assert.ok(res.error);
  });
});
```

- [ ] **Step 2: Run**

Run: `node --test tests/plugin/feedback-tools.test.js`
Expected: all three tests pass on the first run — the production behaviour is already correct from tasks 1.8 and 3.9.

If any fail, the state-machine expectation in phase 1 diverges from what phase 3 built; stop and reconcile.

- [ ] **Step 3: Commit**

```bash
git add tests/plugin/feedback-tools.test.js
git commit -m "test(feedback-tools): cover deadlock-override via foundry_feedback_resolve

Locks in the spec §5 deadlock-override rule end-to-end through the
plugin surface: human-appraise can resolve deadlocked items even when
their source is not human-appraise, other stages cannot, and the
override always requires a reason."
```

---

## Task 3.11: Update `foundry_assay_run` feedback emission (RED + GREEN)

**Files:** `.opencode/plugins/foundry-tools/assay-tools.js`, and inspect corresponding tests.

Spec §12 mentions assay in the skill-updates section; the plugin caller also needs adjusting.

- [ ] **Step 1: Inspect the current call site**

`.opencode/plugins/foundry-tools/assay-tools.js:57` has:

```js
const out = addFeedbackItem(text, 'WORK.md', msg, 'validation');
```

Read the full function body (lines 40–70 or so) to understand the signature and surrounding code.

- [ ] **Step 2: Find the existing assay-tools tests**

```bash
rg -l "foundry_assay_run" tests/
```

Read the tests. Look for the assertion that feedback was emitted — it likely parses `WORK.md` for the `## Feedback` section.

- [ ] **Step 3: Update the tests (RED)**

Change the feedback-emission assertion to read `WORK.feedback.yaml` instead:

```js
// OLD pattern:
// assert.match(readFileSync(path.join(dir, 'WORK.md'), 'utf-8'), /## Feedback[\s\S]*- \[ \] .* #validation/);

// NEW pattern:
const doc = yaml.load(readFileSync(path.join(dir, 'WORK.feedback.yaml'), 'utf-8'));
assert.ok(doc.items.length > 0, 'assay should have written at least one item');
const assayItems = doc.items.filter(it => it.tag === 'validation' && it.source.startsWith('assay:'));
assert.ok(assayItems.length > 0);
```

Import `yaml` at the top of the test file if not present.

Run: `node --test tests/plugin/<assay-test-file>.test.js`
Expected: FAIL because the production code still writes markdown.

- [ ] **Step 4: Update the production code (GREEN)**

In `.opencode/plugins/foundry-tools/assay-tools.js`:

Change the import line from:

```js
import { addFeedbackItem } from '../../../scripts/lib/feedback.js';
```

to:

```js
import { openFeedbackStore } from '../../../scripts/lib/feedback-store.js';
import { parseFrontmatter } from '../../../scripts/lib/workfile.js';
```

Replace the feedback-emission section. Old code (line ~57, inside the extractor loop that accumulates validation failures):

```js
const out = addFeedbackItem(text, 'WORK.md', msg, 'validation');
```

becomes something like:

```js
// Inside the function that owns `io` and `activeStage`. Locate the existing
// block that currently writes 'WORK.md' with addFeedbackItem results.
const fm = parseFrontmatter(io.readFile('WORK.md'));
const cycle = fm.cycle;
const store = openFeedbackStore('WORK.feedback.yaml', io);
store.add({
  file: 'WORK.md',
  tag: 'validation',
  text: msg,
  source: activeStage, // the 'assay:<alias>' stage from the caller
  cycle,
});
```

If the assay-tools function doesn't have `activeStage` in scope, thread it through — follow the same pattern as feedback-tools.js (read it from `requireActiveStage(io)` inside the tool's `execute`).

- [ ] **Step 5: Run tests and commit**

Before committing, identify the exact test file modified:

```bash
rg -l "foundry_assay_run" tests/
```

Stage that specific file alongside the production change.

Run: `npm test`
Expected: assay tests pass; full suite green.

```bash
git add .opencode/plugins/foundry-tools/assay-tools.js tests/plugin/<that-file>
git commit -m "feat(assay-tools): emit validation feedback to WORK.feedback.yaml

#validation items added by the assay stage now go through
openFeedbackStore with source='assay:<alias>' per spec §5 and §12.
Replaces the legacy addFeedbackItem call that targeted WORK.md."
```

---

## Task 3.12: Phase 3 verification gate

- [ ] **Step 1: Full suite**

```bash
npm test
```
Expected: all green. No tests skipped without a phase-4 reference comment.

- [ ] **Step 2: Grep for old plugin-API usage**

```bash
rg -n "foundry_feedback_action.*file:|foundry_feedback_wontfix.*file:|foundry_feedback_resolve.*file:" tests/ .opencode/
```
Expected: zero matches in production plugin code. Any matches in skills files or docs stay until phase 5.

- [ ] **Step 3: Confirm plugin tools are now feedback-yaml native**

```bash
rg -n "from.*scripts/lib/feedback\.js" .opencode/
```
Expected: zero matches. (If there are still matches, a tool rewrite was missed.)

- [ ] **Step 4: Handoff**

Phase 3 complete. Tell the operator:

> "Phase 3 complete. All five foundry_feedback_* tools rewritten against the feedback-store with id-based API. foundry_assay_run emits validation feedback via the store. Source-authorship + deadlock-override rules verified end-to-end through the plugin surface. Full suite green. Legacy scripts/lib/feedback.js still imported by sort.js and orchestrate.js — those move in phase 4. Ready for phase 4."
