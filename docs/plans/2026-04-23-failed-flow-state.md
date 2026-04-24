# Failed Flow State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce a `status: failed` frontmatter field on `WORK.md` so the stage_end memory-sync failure (and future unrecoverable failures) can flip the whole flow into a terminal state that blocks every mutating tool and skill, with only `foundry_workfile_delete` + `foundry_git_finish` as escape hatches.

**Architecture:**
1. New lib module `scripts/lib/failed-flow.js` exposes `readFailedStatus(io)`, `markWorkfileFailed(io, reason)`, and `requireNotFailed(io)` \u2014 pure fs-shim users, no plugin coupling.
2. `foundry_stage_end` wraps the current `syncStore` call: on throw, it calls `markWorkfileFailed(io, reason)` and returns `{error, flow_failed: true}` without clearing the active stage (user must explicitly abandon).
3. Every mutating plugin tool adds a `requireNotFailed(io)` guard before its existing stage guard. Read-only tools and the escape-hatch tools (`workfile_get`, `workfile_delete`, `git_finish`, `config_*`, all memory read paths, `artefacts_list`, `feedback_list`, `history_list`) are unchanged.
4. Skills that read `foundry_workfile_get` at the top of their flow (`forge`, `quench`, `appraise`, `human-appraise`, `orchestrate`, `assay`, `flow`) gain a single documented check: if `status: failed`, stop and tell the user to cancel the flow via `foundry_workfile_delete` or back out to main.

**Tech Stack:** Node ESM, `node:test`, `node:assert/strict`, existing fs IO shim (`makeIO`), `js-yaml` via `scripts/lib/workfile.js` helpers.

**Out of scope (spun off into separate tickets):** sort.js git-failure fail-open (P1), assay silent feedback-write (P2), orchestrate `readRecentFeedback` / `markArtefactBlocked` continue-on-error, memory `disposeStores`/`withStore` exception isolation (P2), `getCycleDefinition` silent permission-null. These remain in REVIEW.md under their existing priorities.

---

### Task 1: `failed-flow` lib module (foundation)

**Files:**
- Create: `scripts/lib/failed-flow.js`
- Test: `tests/lib/failed-flow.test.js`

A tiny pure module. Delegates frontmatter work to existing `scripts/lib/workfile.js` helpers. No plugin coupling.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/failed-flow.test.js`:

```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  readFailedStatus,
  markWorkfileFailed,
  requireNotFailed,
} from '../../scripts/lib/failed-flow.js';

function makeIO(files = {}) {
  const store = { ...files };
  return {
    exists: (p) => p in store,
    readFile: (p) => {
      if (!(p in store)) throw new Error(`ENOENT: ${p}`);
      return store[p];
    },
    writeFile: (p, content) => { store[p] = content; },
    _store: store,
  };
}

describe('failed-flow', () => {
  describe('readFailedStatus', () => {
    it('returns null when WORK.md is missing', () => {
      const io = makeIO();
      assert.equal(readFailedStatus(io), null);
    });

    it('returns null when status is unset', () => {
      const io = makeIO({ 'WORK.md': '---\ncycle: c\n---\n' });
      assert.equal(readFailedStatus(io), null);
    });

    it('returns null when status is anything other than failed', () => {
      const io = makeIO({ 'WORK.md': '---\ncycle: c\nstatus: active\n---\n' });
      assert.equal(readFailedStatus(io), null);
    });

    it('returns {reason} when status is failed', () => {
      const io = makeIO({
        'WORK.md': '---\ncycle: c\nstatus: failed\nreason: sync broke\n---\n',
      });
      assert.deepEqual(readFailedStatus(io), { reason: 'sync broke' });
    });

    it('returns {reason: ""} when failed with no reason field', () => {
      const io = makeIO({ 'WORK.md': '---\ncycle: c\nstatus: failed\n---\n' });
      assert.deepEqual(readFailedStatus(io), { reason: '' });
    });
  });

  describe('markWorkfileFailed', () => {
    it('sets status: failed and reason', () => {
      const io = makeIO({ 'WORK.md': '---\ncycle: c\n---\n\n# Goal\n\ngo\n' });
      markWorkfileFailed(io, 'sync broke');
      const out = io._store['WORK.md'];
      assert.match(out, /status: failed/);
      assert.match(out, /reason: sync broke/);
      assert.match(out, /# Goal/);
      assert.match(out, /\ngo\n/);
    });

    it('is idempotent when already failed (overwrites reason)', () => {
      const io = makeIO({
        'WORK.md': '---\ncycle: c\nstatus: failed\nreason: old\n---\n',
      });
      markWorkfileFailed(io, 'new');
      assert.match(io._store['WORK.md'], /reason: new/);
      assert.doesNotMatch(io._store['WORK.md'], /reason: old/);
    });

    it('throws if WORK.md is missing', () => {
      const io = makeIO();
      assert.throws(() => markWorkfileFailed(io, 'x'), /WORK\.md not found/);
    });

    it('truncates very long reasons to 500 chars + ellipsis', () => {
      const io = makeIO({ 'WORK.md': '---\ncycle: c\n---\n' });
      const huge = 'x'.repeat(2000);
      markWorkfileFailed(io, huge);
      const out = io._store['WORK.md'];
      const m = out.match(/reason: (.+)/);
      assert.ok(m);
      assert.ok(m[1].length <= 510, `reason length ${m[1].length} should be <=510`);
      assert.ok(m[1].endsWith('...'), 'truncated reason should end with ...');
    });
  });

  describe('requireNotFailed', () => {
    it('ok when WORK.md is missing', () => {
      const io = makeIO();
      assert.deepEqual(requireNotFailed(io), { ok: true });
    });

    it('ok when status is not failed', () => {
      const io = makeIO({ 'WORK.md': '---\ncycle: c\n---\n' });
      assert.deepEqual(requireNotFailed(io), { ok: true });
    });

    it('errors when status is failed', () => {
      const io = makeIO({
        'WORK.md': '---\ncycle: c\nstatus: failed\nreason: sync broke\n---\n',
      });
      const r = requireNotFailed(io);
      assert.equal(r.ok, false);
      assert.match(r.error, /flow is in failed state/);
      assert.match(r.error, /sync broke/);
      assert.match(r.error, /foundry_workfile_delete/);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/lib/failed-flow.test.js`
Expected: FAIL with "Cannot find module '.../scripts/lib/failed-flow.js'"

- [ ] **Step 3: Write minimal implementation**

Create `scripts/lib/failed-flow.js`:

```js
/**
 * Failed-flow lifecycle helpers.
 *
 * When a tool encounters an unrecoverable error (e.g. stage_end could not
 * flush memory to NDJSON and the on-disk source of truth is now behind
 * the live DB), it marks WORK.md with `status: failed` and a `reason`.
 *
 * Every mutating tool guards on this state via `requireNotFailed`. The
 * only ways out are `foundry_workfile_delete` (abandon the cycle) or
 * manually editing WORK.md to remove the failed status after fixing the
 * underlying issue.
 */
import { parseFrontmatter, setFrontmatterField } from './workfile.js';

const MAX_REASON_LEN = 500;

function truncateReason(reason) {
  const s = String(reason ?? '');
  if (s.length <= MAX_REASON_LEN) return s;
  return s.slice(0, MAX_REASON_LEN) + '...';
}

/**
 * @param {{exists: (p: string) => boolean, readFile: (p: string) => string}} io
 * @returns {{reason: string} | null}
 */
export function readFailedStatus(io) {
  if (!io.exists('WORK.md')) return null;
  const text = io.readFile('WORK.md');
  const fm = parseFrontmatter(text);
  if (fm.status !== 'failed') return null;
  return { reason: fm.reason === undefined ? '' : String(fm.reason) };
}

/**
 * Idempotent: overwrites `status` and `reason` whether or not they were set.
 * @param {object} io - requires exists, readFile, writeFile
 * @param {string} reason
 */
export function markWorkfileFailed(io, reason) {
  if (!io.exists('WORK.md')) {
    throw new Error('markWorkfileFailed: WORK.md not found');
  }
  const text = io.readFile('WORK.md');
  const withStatus = setFrontmatterField(text, 'status', 'failed');
  const withReason = setFrontmatterField(withStatus, 'reason', truncateReason(reason));
  io.writeFile('WORK.md', withReason);
}

/**
 * Tool guard: returns `{ok:true}` when the flow is healthy, otherwise
 * `{ok:false, error}` with a message that tells the LLM exactly how to
 * escape (abandon the flow).
 * @param {object} io
 * @returns {{ok: true} | {ok: false, error: string}}
 */
export function requireNotFailed(io) {
  const failed = readFailedStatus(io);
  if (!failed) return { ok: true };
  const reason = failed.reason || '(no reason recorded)';
  return {
    ok: false,
    error:
      `flow is in failed state (reason: ${reason}). ` +
      `No mutating tools are permitted. Use foundry_workfile_delete({confirm: true}) ` +
      `to abandon the cycle, then back out to main and delete the work branch.`,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/lib/failed-flow.test.js`
Expected: PASS (8/8 tests)

- [ ] **Step 5: Run full suite for regressions**

Run: `node --test`
Expected: 567 + 8 = 575 tests pass

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/failed-flow.js tests/lib/failed-flow.test.js
git commit -m "feat(failed-flow): add lib module for WORK.md failed-state lifecycle

Introduce readFailedStatus / markWorkfileFailed / requireNotFailed helpers.
Pure module over the existing workfile.js frontmatter helpers. No plugin
coupling yet \u2014 the guards and writers in subsequent tasks consume this
module.

Prepares for the stage_end memory-sync failure path (P0 #3 in REVIEW.md)
and for skill-level checks that stop all work when a flow is failed."
```

---

### Task 2: Wire `foundry_stage_end` sync-failure path to `markWorkfileFailed`

**Files:**
- Modify: `.opencode/plugins/foundry-tools/stage-tools.js:57-81`
- Test: `tests/plugin/stage-end-failed-flow.test.js` (new)

Current code (stage-tools.js:68-78) swallows `syncStore` throws with `console.error`. Change: on throw, write `status: failed` to WORK.md, still clear the active stage (so user can `foundry_workfile_delete`), return `{error: <message>, flow_failed: true}` instead of `{ok: true}`.

Order of operations in `execute`:
1. Verify active stage (existing).
2. Write last stage + clear active stage (existing \u2014 preserves baseSha for finalize, lets user abandon cleanly).
3. Try syncStore; on throw, call `markWorkfileFailed(io, ...)` and return `{error, flow_failed: true}`.
4. On success, return `{ok: true, summary}`.

- [ ] **Step 1: Write the failing test**

Create `tests/plugin/stage-end-failed-flow.test.js`. Use the same worktree scaffolding pattern as `tests/plugin/memory-end-of-flow-sync.test.js`. Override `syncStore` indirectly by making the memory store produce a corrupt write (easier: inject a syncStore throw by monkey-patching the imported module? Not clean. Alternative: make the memory file non-writable so `writeFile` throws).

Cleanest approach: use a read-only relations directory to force the `io.writeFile` inside `syncStore` to throw (EACCES). Wraps real code.

```js
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { FoundryPlugin } from '../../.opencode/plugins/foundry.js';
import { disposeStores } from '../../scripts/lib/memory/singleton.js';
import { hashFrontmatter } from '../../scripts/lib/memory/schema.js';

function setupWorktree() {
  const root = mkdtempSync(join(tmpdir(), 'failed-flow-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
  mkdirSync(join(root, 'foundry/memory/entities'), { recursive: true });
  mkdirSync(join(root, 'foundry/memory/edges'), { recursive: true });
  mkdirSync(join(root, 'foundry/memory/relations'), { recursive: true });
  mkdirSync(join(root, 'foundry/cycles'), { recursive: true });
  mkdirSync(join(root, '.foundry'), { recursive: true });
  writeFileSync(join(root, 'foundry/memory/config.md'), '---\nenabled: true\n---\n');
  writeFileSync(join(root, 'foundry/memory/entities/finding.md'),
    '---\ntype: finding\n---\n\nA finding.\n');
  const schema = {
    version: 1,
    entities: { finding: { frontmatterHash: hashFrontmatter({ type: 'finding' }) } },
    edges: {},
    embeddings: null,
  };
  writeFileSync(join(root, 'foundry/memory/schema.json'), JSON.stringify(schema, null, 2) + '\n');
  writeFileSync(join(root, 'foundry/cycles/observe.md'),
    `---\noutput: report\nmemory:\n  write: [finding]\n---\n\nCycle body.\n`);
  writeFileSync(join(root, 'WORK.md'),
    `---\nflow: f\ncycle: observe\n---\n\n# Goal\n\ngo\n\n| File | Type | Cycle | Status |\n|------|------|-------|--------|\n\n## Feedback\n`);
  return root;
}

describe('stage_end: sync failure marks flow failed', () => {
  let root, plugin;
  before(async () => { root = setupWorktree(); plugin = await FoundryPlugin({ directory: root }); });
  after(() => {
    // Restore perms so rmSync can recurse.
    try { chmodSync(join(root, 'foundry/memory/relations'), 0o755); } catch {}
    disposeStores();
    rmSync(root, { recursive: true, force: true });
  });

  it('marks WORK.md failed when syncStore throws, keeps active stage cleared, returns flow_failed', async () => {
    const ctx = { worktree: root, cycle: 'observe' };
    const putOut = await plugin.tool.foundry_memory_put.execute(
      { type: 'finding', name: 'f1', value: 'pending' }, ctx);
    assert.match(putOut, /ok.*true/);

    // Simulate active stage.
    writeFileSync(join(root, '.foundry/active-stage.json'),
      JSON.stringify({ cycle: 'observe', stage: 'forge:observe', baseSha: 'abc123' }));

    // Force syncStore writes to fail: make relations dir read-only.
    chmodSync(join(root, 'foundry/memory/relations'), 0o555);

    const endOut = JSON.parse(await plugin.tool.foundry_stage_end.execute({ summary: 'done' }, ctx));
    assert.equal(endOut.flow_failed, true, `expected flow_failed:true, got ${JSON.stringify(endOut)}`);
    assert.match(endOut.error, /memory sync/i);

    // WORK.md now has status: failed + reason.
    const work = readFileSync(join(root, 'WORK.md'), 'utf-8');
    assert.match(work, /status: failed/);
    assert.match(work, /reason: /);

    // Active stage was cleared so user can delete WORK.md.
    assert.equal(existsSync(join(root, '.foundry/active-stage.json')), false,
      'active stage should be cleared even on sync failure so user can abandon');

    // Last stage was still written.
    assert.equal(existsSync(join(root, '.foundry/last-stage.json')), true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/plugin/stage-end-failed-flow.test.js`
Expected: FAIL \u2014 current code returns `{ok:true}` even on sync error, so `flow_failed` is undefined.

- [ ] **Step 3: Implement**

Modify `.opencode/plugins/foundry-tools/stage-tools.js`. Replace lines 57-81 with:

```js
    foundry_stage_end: tool({
      description: 'Close the active subagent work stage; preserves baseSha for finalize.',
      args: {
        summary: tool.schema.string().describe('Short summary of the work done'),
      },
      async execute(args, context) {
        const io = makeIO(context.worktree);
        const active = readActiveStage(io);
        if (!active) return JSON.stringify({ error: 'foundry_stage_end requires active stage; current: none' });
        writeLastStage(io, { cycle: active.cycle, stage: active.stage, baseSha: active.baseSha, summary: args.summary });
        clearActiveStage(io);
        // End-of-flow memory sync: flush any pending cycle-scoped writes.
        // If this fails, the in-memory DB is ahead of the on-disk NDJSON
        // source of truth \u2014 a data-loss risk. Mark the flow failed so no
        // further mutating tool will run until the user abandons the cycle
        // (foundry_workfile_delete) or manually resolves the divergence.
        try {
          const memIo = makeMemoryIO(context.worktree);
          const ctx = getContext(context.worktree);
          if (ctx && ctx.store) {
            await syncStore({ store: ctx.store, io: memIo });
          }
        } catch (err) {
          const msg = `memory sync at stage end failed: ${err?.message ?? err}`;
          try { markWorkfileFailed(io, msg); } catch { /* WORK.md gone? nothing we can do */ }
          return JSON.stringify({ error: msg, flow_failed: true });
        }
        return JSON.stringify({ ok: true, summary: args.summary });
      },
    }),
```

And add the import at the top:

```js
import { markWorkfileFailed } from '../../../scripts/lib/failed-flow.js';
```

- [ ] **Step 4: Run the new test to verify it passes**

Run: `node --test tests/plugin/stage-end-failed-flow.test.js`
Expected: PASS (1/1 test)

- [ ] **Step 5: Run the pre-existing end-of-flow sync test**

Run: `node --test tests/plugin/memory-end-of-flow-sync.test.js`
Expected: PASS (1/1) \u2014 happy path unchanged.

- [ ] **Step 6: Run full suite**

Run: `node --test`
Expected: 575 + 1 = 576 tests pass.

- [ ] **Step 7: Commit**

```bash
git add .opencode/plugins/foundry-tools/stage-tools.js tests/plugin/stage-end-failed-flow.test.js
git commit -m "fix(stage-end): mark flow failed when memory sync fails

Root cause (REVIEW.md P0 #3): foundry_stage_end wrapped syncStore in a
try/catch that logged and returned {ok:true}. A failed NDJSON flush left
the in-memory Cozo DB ahead of the on-disk source of truth; on next
process open, stale NDJSON was re-imported over the live DB and silently
reverted user-visible writes. The tool reported success either way.

Fix: on syncStore throw, write status: failed + reason to WORK.md via
markWorkfileFailed, clear the active stage (so the user can still
foundry_workfile_delete), and return {error, flow_failed:true} instead
of {ok:true}. The next task gates every mutating tool on this state so
no further work is possible until the user abandons the cycle.

Test: tests/plugin/stage-end-failed-flow.test.js forces syncStore to
throw by making the relations dir read-only (EACCES on writeFile),
then asserts flow_failed is set, WORK.md carries status:failed + reason,
and the active stage is cleared. Pre-existing happy-path test in
memory-end-of-flow-sync.test.js still passes."
```

---

### Task 3: Gate all mutating plugin tools on `requireNotFailed`

**Files (one import + one guard-line per module):**
- Modify: `.opencode/plugins/foundry-tools/stage-tools.js` (add to stage_begin only; stage_end must remain callable so caller can see prior-failed state and gets the failed-flow error surfaced)
- Modify: `.opencode/plugins/foundry-tools/workfile-tools.js` (add to workfile_create; leave workfile_delete and workfile_get alone)
- Modify: `.opencode/plugins/foundry-tools/artefact-tools.js` (add to artefacts_set_status)
- Modify: `.opencode/plugins/foundry-tools/feedback-tools.js` (add to feedback_add / feedback_resolve / feedback_action / feedback_wontfix)
- Modify: `.opencode/plugins/foundry-tools/assay-tools.js` (add to assay_run)
- Modify: `.opencode/plugins/foundry-tools/orchestrate-tool.js` (add to orchestrate)
- Modify: `.opencode/plugins/foundry-tools/memory-tools.js` (add to memory_put / memory_relate / memory_unrelate; leave get/list/search/query/neighbours/dump/validate alone)
- Test: `tests/plugin/failed-flow-tool-gate.test.js` (new \u2014 one case per gated tool)

**Design note:** The guard is a plain `requireNotFailed(io)` call at the very top of `execute`, *before* the existing `requireActiveStage` / `requireNoActiveStage` call where one exists, because a failed flow is a stronger condition than stage presence.

**For stage_end specifically:** do NOT add the guard. Current behaviour (any call with no active stage \u2192 error; with active stage \u2192 close it) is still the right semantics. The failed status was written *by* stage_end in task 2; blocking stage_end here would make it impossible to close a stage whose own failure set the flag.

**For stage_begin:** the guard must be added \u2014 opening a new stage under a failed flow is exactly what we want to prevent.

**For workfile_delete / git_finish:** NO guard. These are the escape hatches.

**For memory_admin_tools (drop/rename/init/reset/etc.):** those are on-disk type-definition edits, typically run from main branch outside a cycle. They guard today on `requireNoActiveStage` for branch-state operations but not on WORK.md. Leave them unguarded \u2014 they're sysadmin operations, not part of the stage lifecycle.

- [ ] **Step 1: Write the failing test first**

Create `tests/plugin/failed-flow-tool-gate.test.js`:

```js
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { FoundryPlugin } from '../../.opencode/plugins/foundry.js';
import { disposeStores } from '../../scripts/lib/memory/singleton.js';
import { hashFrontmatter } from '../../scripts/lib/memory/schema.js';

function setupFailedWorktree() {
  const root = mkdtempSync(join(tmpdir(), 'gate-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
  mkdirSync(join(root, 'foundry/memory/entities'), { recursive: true });
  mkdirSync(join(root, 'foundry/memory/edges'), { recursive: true });
  mkdirSync(join(root, 'foundry/memory/relations'), { recursive: true });
  mkdirSync(join(root, 'foundry/cycles'), { recursive: true });
  mkdirSync(join(root, '.foundry'), { recursive: true });
  writeFileSync(join(root, 'foundry/memory/config.md'), '---\nenabled: true\n---\n');
  writeFileSync(join(root, 'foundry/memory/entities/finding.md'),
    '---\ntype: finding\n---\n\nA finding.\n');
  const schema = {
    version: 1,
    entities: { finding: { frontmatterHash: hashFrontmatter({ type: 'finding' }) } },
    edges: {},
    embeddings: null,
  };
  writeFileSync(join(root, 'foundry/memory/schema.json'), JSON.stringify(schema, null, 2) + '\n');
  writeFileSync(join(root, 'foundry/cycles/observe.md'),
    `---\noutput: report\nmemory:\n  write: [finding]\n---\n\nCycle body.\n`);
  // WORK.md already in failed state.
  writeFileSync(join(root, 'WORK.md'),
    `---\nflow: f\ncycle: observe\nstatus: failed\nreason: test\n---\n\n# Goal\n\ngo\n\n| File | Type | Cycle | Status |\n|------|------|-------|--------|\n\n## Feedback\n`);
  return root;
}

function expectFailedError(res, toolName) {
  const out = typeof res === 'string' ? JSON.parse(res) : res;
  assert.ok(out.error, `${toolName}: expected error, got ${JSON.stringify(out)}`);
  assert.match(out.error, /flow is in failed state/i,
    `${toolName}: error should mention failed state, got: ${out.error}`);
}

describe('failed-flow tool gate', () => {
  let root, plugin;
  before(async () => { root = setupFailedWorktree(); plugin = await FoundryPlugin({ directory: root }); });
  after(() => { disposeStores(); rmSync(root, { recursive: true, force: true }); });

  const ctx = () => ({ worktree: root, cycle: 'observe' });

  it('stage_begin refuses under failed', async () => {
    expectFailedError(await plugin.tool.foundry_stage_begin.execute(
      { stage: 'forge:observe', cycle: 'observe', token: 'x' }, ctx()), 'stage_begin');
  });

  it('workfile_create refuses under failed', async () => {
    expectFailedError(await plugin.tool.foundry_workfile_create.execute(
      { flow: 'f', cycle: 'observe', goal: 'g' }, ctx()), 'workfile_create');
  });

  it('artefacts_set_status refuses under failed', async () => {
    expectFailedError(await plugin.tool.foundry_artefacts_set_status.execute(
      { file: 'x.md', status: 'done' }, ctx()), 'artefacts_set_status');
  });

  it('feedback_add refuses under failed', async () => {
    expectFailedError(await plugin.tool.foundry_feedback_add.execute(
      { file: 'x.md', tag: '#needs-work', text: 'y' }, ctx()), 'feedback_add');
  });

  it('feedback_resolve refuses under failed', async () => {
    expectFailedError(await plugin.tool.foundry_feedback_resolve.execute(
      { file: 'x.md', index: 0, resolution: 'approved' }, ctx()), 'feedback_resolve');
  });

  it('feedback_action refuses under failed', async () => {
    expectFailedError(await plugin.tool.foundry_feedback_action.execute(
      { file: 'x.md', index: 0 }, ctx()), 'feedback_action');
  });

  it('feedback_wontfix refuses under failed', async () => {
    expectFailedError(await plugin.tool.foundry_feedback_wontfix.execute(
      { file: 'x.md', index: 0, reason: 'r' }, ctx()), 'feedback_wontfix');
  });

  it('assay_run refuses under failed', async () => {
    expectFailedError(await plugin.tool.foundry_assay_run.execute(
      { cycle: 'observe', extractors: ['e'] }, ctx()), 'assay_run');
  });

  it('orchestrate refuses under failed', async () => {
    expectFailedError(await plugin.tool.foundry_orchestrate.execute({}, ctx()), 'orchestrate');
  });

  it('memory_put refuses under failed', async () => {
    expectFailedError(await plugin.tool.foundry_memory_put.execute(
      { type: 'finding', name: 'x', value: 'y' }, ctx()), 'memory_put');
  });

  it('memory_relate refuses under failed', async () => {
    expectFailedError(await plugin.tool.foundry_memory_relate.execute(
      { from_type: 'finding', from_name: 'a', edge_type: 'e', to_type: 'finding', to_name: 'b' }, ctx()), 'memory_relate');
  });

  it('memory_unrelate refuses under failed', async () => {
    expectFailedError(await plugin.tool.foundry_memory_unrelate.execute(
      { from_type: 'finding', from_name: 'a', edge_type: 'e', to_type: 'finding', to_name: 'b' }, ctx()), 'memory_unrelate');
  });

  // Escape hatches and read-only tools MUST still work.
  it('workfile_delete still works under failed (escape hatch)', async () => {
    // Need a fresh worktree because delete is destructive.
    const root2 = setupFailedWorktree();
    const plugin2 = await FoundryPlugin({ directory: root2 });
    const out = JSON.parse(await plugin2.tool.foundry_workfile_delete.execute(
      { confirm: true }, { worktree: root2, cycle: 'observe' }));
    assert.equal(out.ok, true, `workfile_delete should succeed under failed flow: ${JSON.stringify(out)}`);
    disposeStores();
    rmSync(root2, { recursive: true, force: true });
  });

  it('workfile_get still works under failed (read-only)', async () => {
    const out = JSON.parse(await plugin.tool.foundry_workfile_get.execute({}, ctx()));
    assert.equal(out.status, 'failed');
    assert.equal(out.reason, 'test');
  });

  it('memory_list still works under failed (read-only)', async () => {
    const out = JSON.parse(await plugin.tool.foundry_memory_list.execute(
      { type: 'finding' }, ctx()));
    // Should not error on failed state; may return empty entities.
    assert.ok(out.entities !== undefined || out.rows !== undefined || Array.isArray(out) || out.ok,
      `memory_list should return data, got: ${JSON.stringify(out)}`);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/plugin/failed-flow-tool-gate.test.js`
Expected: FAIL across the 12 mutating-tool assertions \u2014 current code has no guard.

- [ ] **Step 3: Implement the guard per tool module**

For each file listed under "Files" above, apply this pattern:

a. Add import at top: `import { requireNotFailed } from '../../../scripts/lib/failed-flow.js';`
b. In each gated tool's `execute` body, after resolving `io` (already done in every tool), insert as the FIRST precondition:

```js
const failedGuard = requireNotFailed(io);
if (!failedGuard.ok) return JSON.stringify({ error: `<tool_name>: ${failedGuard.error}` });
```

Replace `<tool_name>` with the literal tool name (e.g. `foundry_stage_begin`). Example for `foundry_stage_begin`:

```js
async execute(args, context) {
  const io = makeIO(context.worktree);
  const failedGuard = requireNotFailed(io);
  if (!failedGuard.ok) return JSON.stringify({ error: `foundry_stage_begin: ${failedGuard.error}` });
  const current = readActiveStage(io);
  // ... rest unchanged
}
```

**Tool-specific notes:**
- **assay-tools.js:** `io` is not declared today \u2014 add `const io = makeIO(context.worktree);` on the first line of `execute`.
- **orchestrate-tool.js:** read it first; if the tool uses its own IO, add the local import accordingly.
- **memory-tools.js:** the three mutating handlers all call `withStore(context)` which already builds a memoryIO for them. Use `makeIO(context.worktree)` (the plain IO) for the failed-guard read since WORK.md lives at worktree root, not in `foundry/memory/`.
- **feedback-tools.js:** the existing `makeIO(context.worktree)` already exists in each handler; guard goes after that line.
- **artefact-tools.js:** same.

- [ ] **Step 4: Run the new gate test**

Run: `node --test tests/plugin/failed-flow-tool-gate.test.js`
Expected: PASS (15/15).

- [ ] **Step 5: Run full suite for regressions**

Run: `node --test`
Expected: all prior tests pass + 15 new = net +15.

- [ ] **Step 6: Commit**

```bash
git add .opencode/plugins/foundry-tools/stage-tools.js \
        .opencode/plugins/foundry-tools/workfile-tools.js \
        .opencode/plugins/foundry-tools/artefact-tools.js \
        .opencode/plugins/foundry-tools/feedback-tools.js \
        .opencode/plugins/foundry-tools/assay-tools.js \
        .opencode/plugins/foundry-tools/orchestrate-tool.js \
        .opencode/plugins/foundry-tools/memory-tools.js \
        tests/plugin/failed-flow-tool-gate.test.js
git commit -m "feat(plugin): gate mutating tools on requireNotFailed

After task 2, stage_end marks WORK.md status: failed when memory sync
fails. This change makes every mutating tool honour that state:

  - stage_begin, workfile_create, artefacts_set_status, feedback_*,
    assay_run, orchestrate, memory_put / memory_relate / memory_unrelate
    all refuse to run and return a clear error pointing the caller at
    foundry_workfile_delete as the escape hatch.

  - Escape hatches unchanged: workfile_delete, git_finish, workfile_get,
    all memory read tools (get/list/search/query/neighbours/dump/validate),
    feedback_list, artefacts_list, history_list, config_*.

  - stage_end is intentionally NOT gated so the failing stage_end itself
    (which writes the failed status) can still return cleanly.

  - memory_admin tools (drop/rename/init/reset/etc.) stay unchanged \u2014
    they are sysadmin operations run outside a cycle.

Test: tests/plugin/failed-flow-tool-gate.test.js covers one refused
call per mutating tool and one happy-path call per escape-hatch tool."
```

---

### Task 4: Update skills to stop when flow is failed

**Files (one skill at a time):**
- Modify: `skills/flow/SKILL.md`
- Modify: `skills/orchestrate/SKILL.md`
- Modify: `skills/forge/SKILL.md`
- Modify: `skills/quench/SKILL.md`
- Modify: `skills/appraise/SKILL.md`
- Modify: `skills/human-appraise/SKILL.md`
- Modify: `skills/assay/SKILL.md`

Each skill today calls `foundry_workfile_get` at the top of its procedure. Add a uniform early-exit block immediately after that call.

**Canonical block (copy verbatim, adjusted for each skill's existing numbering):**

```markdown
### Check for failed flow state

If `foundry_workfile_get` returns `{status: "failed", reason: ...}`, STOP. Do not call any other tool. Tell the user:

> The flow is in a failed state. Reason: `<reason>`.
>
> No further work is permitted. To recover:
>
>   1. `foundry_workfile_delete({confirm: true})` to abandon the cycle.
>   2. Back out to main (`git checkout main`) and delete the work branch.
>   3. Investigate and fix the root cause of the failure before restarting.

Then return control to the user and stop.
```

Place it:
- **flow/SKILL.md:** after step "Call `foundry_workfile_get`" (around line 28). If the returned frontmatter has `status: failed`, execute the canonical block. Otherwise continue with existing logic.
- **orchestrate/SKILL.md:** before the loop begins, immediately after the WORK.md existence check (line 12 preamble). The orchestrate tool itself is already gated in task 3, but the skill-level check gives a cleaner user-facing message and avoids a wasted tool call.
- **forge / quench / appraise / human-appraise / assay/ SKILL.md:** right after the `foundry_workfile_get` call in each skill's numbered procedure.

- [ ] **Step 1: Edit flow/SKILL.md**

In `skills/flow/SKILL.md`, find the block under step "a. Call `foundry_workfile_get`" (around line 28). Insert the canonical failed-check block as step `a.ii` (renumber existing b. \u2192 c. if needed \u2014 check the local numbering).

- [ ] **Step 2: Edit orchestrate/SKILL.md**

Insert the canonical block after the "Before running this skill" preamble, before step 1 of the main procedure. Frame it as "Before iterating: check for failed state."

- [ ] **Step 3: Edit forge/SKILL.md**

Insert the canonical block after "2. `foundry_workfile_get` \u2014 understand the goal." in the context-loading section.

- [ ] **Step 4: Edit quench/SKILL.md**

Insert the canonical block after "2. `foundry_workfile_get` \u2014 read the `cycle` from frontmatter."

- [ ] **Step 5: Edit appraise/SKILL.md**

Insert the canonical block after "`foundry_workfile_get` \u2014 read the `cycle` from frontmatter" in its procedure.

- [ ] **Step 6: Edit human-appraise/SKILL.md**

Insert the canonical block after "`foundry_workfile_get` \u2014 current state, goal, cycle".

- [ ] **Step 7: Edit assay/SKILL.md**

Insert the canonical block at step 2 (after "Read WORK.md to find the extractor list" / `foundry_workfile_get()`).

- [ ] **Step 8: Verify no skill test accidentally depends on the old procedure**

Run: `node --test tests/`
Expected: all tests still pass \u2014 skills are prose, no automated test consumes the exact text.

- [ ] **Step 9: Commit**

```bash
git add skills/flow/SKILL.md skills/orchestrate/SKILL.md skills/forge/SKILL.md \
        skills/quench/SKILL.md skills/appraise/SKILL.md skills/human-appraise/SKILL.md \
        skills/assay/SKILL.md
git commit -m "docs(skills): stop every stage skill when WORK.md is failed

Add a uniform early-exit block to flow, orchestrate, forge, quench,
appraise, human-appraise, and assay skills: if foundry_workfile_get
returns status: failed, stop and tell the user to abandon the cycle
via foundry_workfile_delete.

The plugin-side guard added in the previous commit is authoritative
\u2014 tools refuse regardless of whether the LLM follows the skill. This
change gives the LLM a cleaner user-facing message and avoids
tool-call noise when the flow is already toast."
```

---

### Task 5: End-to-end integration test + REVIEW.md tick + CHANGELOG

**Files:**
- Test: `tests/plugin/failed-flow-e2e.test.js` (new)
- Modify: `CHANGELOG.md` (add an Unreleased entry)
- Modify: `REVIEW.md` (tick P0 #3 with commit SHAs)

The e2e test walks through the whole lifecycle: a healthy flow does a memory put, stage_end flips to failed when sync cannot write, the next stage_begin refuses with the failed-state error, `foundry_workfile_delete({confirm:true})` succeeds, and WORK.md is gone.

- [ ] **Step 1: Write the e2e test**

Create `tests/plugin/failed-flow-e2e.test.js`:

```js
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, chmodSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { FoundryPlugin } from '../../.opencode/plugins/foundry.js';
import { disposeStores } from '../../scripts/lib/memory/singleton.js';
import { hashFrontmatter } from '../../scripts/lib/memory/schema.js';

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'e2e-failed-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 't@e.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'T'], { cwd: root });
  mkdirSync(join(root, 'foundry/memory/entities'), { recursive: true });
  mkdirSync(join(root, 'foundry/memory/edges'), { recursive: true });
  mkdirSync(join(root, 'foundry/memory/relations'), { recursive: true });
  mkdirSync(join(root, 'foundry/cycles'), { recursive: true });
  mkdirSync(join(root, '.foundry'), { recursive: true });
  writeFileSync(join(root, 'foundry/memory/config.md'), '---\nenabled: true\n---\n');
  writeFileSync(join(root, 'foundry/memory/entities/finding.md'),
    '---\ntype: finding\n---\n\nA finding.\n');
  writeFileSync(join(root, 'foundry/memory/schema.json'), JSON.stringify({
    version: 1,
    entities: { finding: { frontmatterHash: hashFrontmatter({ type: 'finding' }) } },
    edges: {}, embeddings: null,
  }, null, 2) + '\n');
  writeFileSync(join(root, 'foundry/cycles/observe.md'),
    `---\noutput: report\nmemory:\n  write: [finding]\n---\n\nCycle body.\n`);
  writeFileSync(join(root, 'WORK.md'),
    `---\nflow: f\ncycle: observe\n---\n\n# Goal\n\ngo\n\n| File | Type | Cycle | Status |\n|------|------|-------|--------|\n\n## Feedback\n`);
  return root;
}

describe('failed-flow e2e', () => {
  let root, plugin;
  before(async () => { root = setup(); plugin = await FoundryPlugin({ directory: root }); });
  after(() => {
    try { chmodSync(join(root, 'foundry/memory/relations'), 0o755); } catch {}
    disposeStores();
    rmSync(root, { recursive: true, force: true });
  });

  it('memory put \u2192 stage_end sync fails \u2192 flow failed \u2192 next tool refuses \u2192 delete escapes', async () => {
    const ctx = { worktree: root, cycle: 'observe' };

    // (1) happy put
    const p = JSON.parse(await plugin.tool.foundry_memory_put.execute(
      { type: 'finding', name: 'f1', value: 'v1' }, ctx));
    assert.equal(p.ok, true);

    // (2) stage becomes active
    writeFileSync(join(root, '.foundry/active-stage.json'),
      JSON.stringify({ cycle: 'observe', stage: 'forge:observe', baseSha: 'abc' }));

    // (3) force sync failure
    chmodSync(join(root, 'foundry/memory/relations'), 0o555);

    // (4) stage_end fails \u2192 flow marked failed
    const end = JSON.parse(await plugin.tool.foundry_stage_end.execute({ summary: 's' }, ctx));
    assert.equal(end.flow_failed, true);
    assert.match(readFileSync(join(root, 'WORK.md'), 'utf-8'), /status: failed/);

    // (5) any mutating tool now refuses
    const m = JSON.parse(await plugin.tool.foundry_memory_put.execute(
      { type: 'finding', name: 'f2', value: 'v2' }, ctx));
    assert.match(m.error, /flow is in failed state/i);

    // Restore write perms so delete can succeed.
    chmodSync(join(root, 'foundry/memory/relations'), 0o755);

    // (6) workfile_delete still works
    const d = JSON.parse(await plugin.tool.foundry_workfile_delete.execute({ confirm: true }, ctx));
    assert.equal(d.ok, true);
    assert.equal(existsSync(join(root, 'WORK.md')), false);
  });
});
```

- [ ] **Step 2: Run the e2e test**

Run: `node --test tests/plugin/failed-flow-e2e.test.js`
Expected: PASS (1/1).

- [ ] **Step 3: Add CHANGELOG entry**

Append to the `## [Unreleased]` section in `CHANGELOG.md`:

```markdown
### Fixed

- **Stage-end memory sync failure is now a hard flow failure.** When `foundry_stage_end` cannot flush the in-memory memory DB to the NDJSON source of truth, WORK.md is marked `status: failed` with the sync error as `reason`, and every mutating tool (`stage_begin`, `orchestrate`, `assay_run`, `forge`/`quench`/`appraise` / `human-appraise` helpers, `memory_put` / `_relate` / `_unrelate`, `feedback_*`, `artefacts_set_status`, `workfile_create`) refuses until the cycle is abandoned via `foundry_workfile_delete`. Read-only tools and the escape hatches (`workfile_delete`, `git_finish`) remain callable. Skills driving each stage (`forge`, `quench`, `appraise`, `human-appraise`, `orchestrate`, `assay`, `flow`) were updated to check for the failed state at the top of their procedure and hand control back to the user. Previously, sync failures were silently swallowed (`console.error` + `{ok:true}`) and the Cozo DB was allowed to drift ahead of on-disk NDJSON. See REVIEW.md P0 #3.
```

- [ ] **Step 4: Tick REVIEW.md P0 #3**

Replace the P0 #3 line in REVIEW.md with a `[x]` box and append the commit SHAs for tasks 1-5 (the implementer should run `git log --oneline -6` to capture them). Example format (match the existing P0 #1 / #2 style):

```markdown
- [x] **[memory M5] `putEntity` is not transactional against NDJSON.** Cozo write succeeds, NDJSON write fails \u2192 in-memory DB ahead of on-disk source of truth \u2192 stale state on reopen. **\u2014 addressed in `<sha1>` + `<sha2>` + `<sha3>` + `<sha4>` + `<sha5>` via a new WORK.md `status: failed` lifecycle.** Rather than try to make per-put writes transactional (expensive, changes the "NDJSON is source of truth, DB is derived" contract), `foundry_stage_end`'s syncStore failure path \u2014 previously swallowed by a `console.error` + `{ok:true}` return \u2014 now marks WORK.md `status: failed` with the sync error as `reason`. Every mutating plugin tool gates on `requireNotFailed(io)` and returns a clear error telling the caller to abandon the cycle via `foundry_workfile_delete`. Read-only tools and the escape hatches (`workfile_delete`, `git_finish`) remain callable. Skills driving each stage were updated to check `status: failed` at the top of their procedure and hand control back to the user. New lib module `scripts/lib/failed-flow.js` exposes the lifecycle helpers. Three new test files: `tests/lib/failed-flow.test.js` (unit, 8 cases), `tests/plugin/stage-end-failed-flow.test.js` (stage-end integration, 1 case), `tests/plugin/failed-flow-tool-gate.test.js` (12 refusals + 3 escape-hatch happy paths), `tests/plugin/failed-flow-e2e.test.js` (full lifecycle, 1 case). Suite: 567 \u2192 592 tests passing.
```

- [ ] **Step 5: Run full suite once more**

Run: `node --test`
Expected: 567 + 8 (task 1) + 1 (task 2) + 15 (task 3) + 1 (task 5) = 592 tests pass.

- [ ] **Step 6: Commit**

```bash
git add tests/plugin/failed-flow-e2e.test.js CHANGELOG.md REVIEW.md
git commit -m "test(failed-flow): e2e coverage + CHANGELOG + REVIEW.md tick

Full lifecycle test: memory put \u2192 stage_end sync fails (relations dir
read-only) \u2192 WORK.md marked failed \u2192 memory_put refused with
flow-failed error \u2192 workfile_delete escape hatch succeeds.

REVIEW.md P0 #3 ticked with the five commit SHAs from this series."
```

---

## Self-Review checklist

- [ ] Spec coverage: every requirement in the brainstorming answers (WORK.md frontmatter failed state, all mutating tools gated, all stage skills gated, escape hatches remain, only stage_end-sync failure triggers this in this commit) has a task.
- [ ] No placeholders in task steps \u2014 all code blocks are complete, all file paths are exact.
- [ ] Types / names consistent: `requireNotFailed` / `readFailedStatus` / `markWorkfileFailed` used the same everywhere; `flow_failed:true` return field used in stage_end and the e2e test.
- [ ] Tests are TDD-ordered: write, run-fail, implement, run-pass, commit.
- [ ] Commits are small and conventional: `feat(failed-flow):`, `fix(stage-end):`, `feat(plugin):`, `docs(skills):`, `test(failed-flow):`.
