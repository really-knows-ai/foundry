# Phase 3 — Preconditions on Existing Tools

> Harden every existing mutation tool. Each task is "add preconditions + tests for accept and reject paths". We **do not rewrite tool bodies** — we prepend a guard check.

**Prereqs:** Phases 1–2 complete.

**Test command:** `node --test tests/plugin/preconditions.test.js tests/lib/`

**Helper pattern** used in every task below — extract once at the top of the tool map if convenient, or inline:

```js
// Helper: serialize a guard result if it's a rejection; call next() otherwise.
// (Since tools return strings, a plain if/else is fine — see per-task code.)
```

Each task follows the same rhythm:
1. Write reject-path test.
2. Run — fail.
3. Inject guard into tool body in `.opencode/plugins/foundry.js`.
4. Run — pass.
5. Also update the accept-path test to ensure existing behavior survives.
6. Commit.

Reject-path tests live in a new `tests/plugin/preconditions.test.js`. Accept-path tests largely exist in `tests/lib/*.test.js` at the helper level; we add plugin-level smoke tests only where missing.

---

## Task 8: `foundry_feedback_*` — stage lock + state-machine + dedup

**Files:**
- Modify: `scripts/lib/feedback.js`
- Modify: `.opencode/plugins/foundry.js` (feedback tool bodies lines 331–411)
- Create: `tests/plugin/preconditions.test.js` (feedback section)
- Modify: `tests/lib/feedback.test.js` (new transition + dedup cases)

### Sub-8a: Embed transition validation in `resolveFeedbackItem`

- [ ] **Step 1: Add tests to `tests/lib/feedback.test.js`**

```js
it('resolveFeedbackItem rejects invalid transition: quench cannot approve wont-fix', () => {
  // set up a fixture WORK.md with a wont-fix item, then:
  const res = resolveFeedbackItem(path, { file: 'a.md', index: 0, resolution: 'approved', reason: 'x', stageBase: 'quench' }, io);
  assert.equal(res.ok, false);
  assert.match(res.error, /stage quench cannot transition wont-fix/);
});

it('resolveFeedbackItem rejects mutation of approved (terminal)', () => {
  // fixture with an approved item, then:
  const res = resolveFeedbackItem(path, { file: 'a.md', index: 0, resolution: 'rejected', reason: 'x', stageBase: 'quench' }, io);
  assert.equal(res.ok, false);
});
```

- [ ] **Step 2: Run — fail.**

- [ ] **Step 3: Modify `resolveFeedbackItem`** in `scripts/lib/feedback.js` to accept a `stageBase` param and call `validateTransition(currentState, resolution, stageBase)` before mutating. Return `{ok: false, error}` on rejection.

Similarly, extend `actionFeedbackItem` and `wontfixFeedbackItem` to validate `open|rejected → actioned|wont-fix` with `stageBase: 'forge'`.

- [ ] **Step 4: Pass.**

### Sub-8b: Embed dedup in `addFeedbackItem`

- [ ] **Step 1: Test**

```js
it('addFeedbackItem dedupes by {file, tag, text-hash}', () => {
  addFeedbackItem(path, { file: 'a.md', tag: 'validation', text: 'same' }, io);
  const r2 = addFeedbackItem(path, { file: 'a.md', tag: 'validation', text: 'same' }, io);
  assert.equal(r2.deduped, true);
  // Assert WORK.md still has exactly one item.
});
```

- [ ] **Step 2: Fail.**

- [ ] **Step 3: Implement** — before inserting, list existing items, compute `hashText(text)`, check for match on `{file, tag, hash}`. If match, return `{ok: true, deduped: true}` without writing.

- [ ] **Step 4: Pass.**

### Sub-8c: Plugin-level stage lock on all five feedback tools

- [ ] **Step 1: Add plugin tests in `tests/plugin/preconditions.test.js`**

```js
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FoundryPlugin } from '../../.opencode/plugins/foundry.js';

function initRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'foundry-pre-'));
  execSync('git init -q', { cwd: dir });
  writeFileSync(join(dir, 'WORK.md'), '---\ncycle: c\n---\n# Goal\n\n## Artefacts\n\n| File | Type | Status |\n|---|---|---|\n');
  execSync('git add . && git commit -m init -q', { cwd: dir, env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
  return dir;
}

describe('feedback tools require active stage', () => {
  let dir, plugin;
  beforeEach(async () => { dir = initRepo(); plugin = await FoundryPlugin({ directory: dir }); });

  for (const toolName of ['foundry_feedback_add', 'foundry_feedback_action', 'foundry_feedback_wontfix', 'foundry_feedback_resolve']) {
    it(`${toolName} errors with no active stage`, async () => {
      const args = toolName === 'foundry_feedback_add'
        ? { file: 'x.md', tag: 'validation', text: 't' }
        : toolName === 'foundry_feedback_resolve'
        ? { file: 'x.md', index: 0, resolution: 'approved' }
        : { file: 'x.md', index: 0 };
      const res = JSON.parse(await plugin.tool[toolName].execute(args, { worktree: dir }));
      assert.match(res.error, /requires active/);
    });
  }

  it('foundry_feedback_list is always allowed (read-only)', async () => {
    const res = JSON.parse(await plugin.tool.foundry_feedback_list.execute({}, { worktree: dir }));
    assert.equal(res.error, undefined);
  });
});
```

Also test the stage-base allow-list: within an active `forge` stage, `feedback_resolve` is rejected (forge doesn't resolve). Within an active `quench` stage, `feedback_add` with `tag: 'law:x'` is rejected (quench can only add `validation`).

- [ ] **Step 2: Fail.**

- [ ] **Step 3: Modify each feedback tool execute body** in `.opencode/plugins/foundry.js:331-411` to prepend:

```js
const guard = requireActiveStage(io);
if (!guard.ok) return JSON.stringify({ error: guard.error });
const stageBase = stageBaseOf(guard.active.stage);
```

Per-tool additional checks:

- `foundry_feedback_add`: enforce tag allow-list:
  - `forge`: rejected (forge doesn't add feedback)
  - `quench`: `tag` must equal `'validation'`
  - `appraise`: `tag` must start with `'law:'`
  - `human-appraise`: `tag` must equal `'human'`
- `foundry_feedback_action`, `foundry_feedback_wontfix`: require `stageBase === 'forge'`.
- `foundry_feedback_resolve`: require `stageBase` in `{quench, appraise, human-appraise}`, pass `stageBase` through to `resolveFeedbackItem` for matrix check.

- [ ] **Step 4: Pass.**

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/feedback.js .opencode/plugins/foundry.js tests/lib/feedback.test.js tests/plugin/preconditions.test.js
git commit -m "feat(harden): enforce stage-lock + state-machine + dedup on feedback tools"
```

---

## Task 9: `foundry_artefacts_set_status` — orchestrator-only, reject `draft`

**Files:**
- Modify: `scripts/lib/artefacts.js` (reject `draft` value)
- Modify: `.opencode/plugins/foundry.js:302-315`
- Modify: `tests/lib/artefacts.test.js`
- Modify: `tests/plugin/preconditions.test.js`

- [ ] **Step 1: Test**

```js
// tests/lib/artefacts.test.js
it('setArtefactStatus rejects draft value', () => {
  assert.throws(() => setArtefactStatus(path, { file: 'a.md', status: 'draft' }, io), /status draft not permitted/);
});

// tests/plugin/preconditions.test.js
it('foundry_artefacts_set_status requires no active stage', async () => {
  // seed active-stage.json, call tool, expect error
});
```

- [ ] **Step 2: Fail.**

- [ ] **Step 3: Implement**

In `scripts/lib/artefacts.js` `setArtefactStatus`:

```js
if (status === 'draft') throw new Error('status draft not permitted; use stage_finalize for registration');
if (!['done', 'blocked'].includes(status)) throw new Error(`invalid status: ${status}`);
```

In the tool body, prepend `requireNoActiveStage` guard and wrap the call in try/catch to serialize.

- [ ] **Step 4: Pass.**

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/artefacts.js .opencode/plugins/foundry.js tests/lib/artefacts.test.js tests/plugin/preconditions.test.js
git commit -m "feat(harden): restrict artefacts_set_status to done|blocked, orchestrator-only"
```

---

## Task 10: Remove `foundry_artefacts_add` from public surface

**Files:**
- Modify: `.opencode/plugins/foundry.js:285-300`
- Modify: `tests/plugin/preconditions.test.js`

**Responsibility:** The helper `addArtefactRow` remains exported from `scripts/lib/artefacts.js` for `stage_finalize` to call. The public **tool** is removed.

- [ ] **Step 1: Test**

```js
it('foundry_artefacts_add is not registered', async () => {
  const plugin = await FoundryPlugin({ directory: dir });
  assert.equal(plugin.tool.foundry_artefacts_add, undefined);
});
```

- [ ] **Step 2: Fail.**

- [ ] **Step 3: Delete the tool definition** at lines 285–300.

- [ ] **Step 4: Pass.**

- [ ] **Step 5: Commit**

```bash
git add .opencode/plugins/foundry.js tests/plugin/preconditions.test.js
git commit -m "feat(harden)!: remove foundry_artefacts_add (use stage_finalize)"
```

(Note the `!` — breaking change flag for conventional commits.)

---

## Task 11: `foundry_workfile_*` — stage lock + key whitelist on `_set`

**Files:**
- Modify: `.opencode/plugins/foundry.js:178-282`
- Modify: `tests/plugin/preconditions.test.js`

**Responsibility:**
- `workfile_create`, `workfile_set`, `workfile_delete` — require no active stage.
- `workfile_set` additionally — key must be in `{cycle, stages, max-iterations, models}` (post Task 4.5 normalization, `maxIterations` is normalized to `max-iterations` but the argument name can remain `maxIterations` for BC).
- `workfile_delete` additionally — require `args.confirm === true`.
- `workfile_create` additionally — require WORK.md absent (already the case; ensure the error shape matches the canonical `requires ...; current: ...` format).
- `workfile_get` — always allowed (read-only).

- [ ] **Step 1: Tests** — cover each reject path.

```js
it('workfile_set rejects unknown key', async () => {
  // with no active stage, attempt to set key 'foo' → error
});
it('workfile_set requires no active stage', async () => { /* ... */ });
it('workfile_delete requires {confirm: true}', async () => { /* ... */ });
it('workfile_delete requires no active stage', async () => { /* ... */ });
it('workfile_create errors when WORK.md exists', async () => { /* ... */ });
it('workfile_get succeeds during active stage', async () => { /* ... */ });
```

- [ ] **Step 2: Fail.**

- [ ] **Step 3: Implement**

Prepend `requireNoActiveStage(io)` guard to the three mutators. For `_set`:

```js
const ALLOWED_KEYS = new Set(['cycle', 'stages', 'max-iterations', 'maxIterations', 'models']);
if (!ALLOWED_KEYS.has(args.key)) {
  return JSON.stringify({ error: `foundry_workfile_set: key must be one of cycle|stages|max-iterations|models; got ${args.key}` });
}
```

For `_delete`:

```js
if (args.confirm !== true) {
  return JSON.stringify({ error: 'foundry_workfile_delete requires {confirm: true}' });
}
```

Add `confirm` to the tool's `args` schema:

```js
confirm: tool.schema.boolean().describe('Must be true to confirm deletion'),
```

- [ ] **Step 4: Pass.**

- [ ] **Step 5: Commit**

```bash
git add .opencode/plugins/foundry.js tests/plugin/preconditions.test.js
git commit -m "feat(harden): lock workfile tools and add key whitelist + delete confirm"
```

---

## Task 12: `foundry_history_append` — sort-route alias check

**Files:**
- Modify: `scripts/lib/history.js` (expose `readLastSortRoute`)
- Modify: `.opencode/plugins/foundry.js:148-162`
- Modify: `tests/lib/history.test.js`
- Modify: `tests/plugin/preconditions.test.js`

**Rule** (HARDEN.md §3 orchestrator matrix):
- `stage === 'sort'` → always allowed.
- `stage === <alias>` → the most recent `sort` history entry's comment/payload must have routed to `<alias>`.

**Design note:** we need to extend `appendEntry` to record the routed-to alias when `stage === 'sort'`. Simplest: store in the comment with a prefix, or add an optional `route` field. We add the field.

- [ ] **Step 1: Tests**

```js
// tests/lib/history.test.js
it('readLastSortRoute returns last sort entry route', () => {
  appendEntry(path, { cycle: 'c', stage: 'sort', iteration: 1, comment: 'sorted', route: 'forge:c' }, io);
  assert.equal(readLastSortRoute(path, 'c', io), 'forge:c');
});

// tests/plugin/preconditions.test.js
it('history_append(stage=sort) is always allowed with no active stage', async () => { /* ... */ });
it('history_append(stage=forge:c) errors when last sort routed elsewhere', async () => { /* ... */ });
it('history_append(stage=forge:c) ok when last sort routed to forge:c', async () => { /* ... */ });
```

- [ ] **Step 2: Fail.**

- [ ] **Step 3: Implement**

`scripts/lib/history.js`: add optional `route` to `appendEntry` (already takes an object, so just persist it verbatim in the YAML). Add:

```js
export function readLastSortRoute(historyPath, cycle, io) {
  const entries = loadHistory(historyPath, io).filter(e => e.cycle === cycle && e.stage === 'sort');
  return entries.length ? entries[entries.length - 1].route ?? null : null;
}
```

Plugin tool at `foundry.js:148-162`:

```js
async execute(args, context) {
  const io = makeIO(context.worktree);
  const guard = requireNoActiveStage(io);
  if (!guard.ok) return JSON.stringify({ error: guard.error });
  if (args.stage !== 'sort') {
    const expected = readLastSortRoute(path.join(context.worktree, 'WORK.history.yaml'), args.cycle, io);
    if (args.stage !== expected) {
      return JSON.stringify({ error: `foundry_history_append: stage ${args.stage} does not match last sort route ${expected ?? 'none'}` });
    }
  }
  // ... existing body ...
}
```

Also add `route` to the tool's `args` schema as optional.

- [ ] **Step 4: Pass.**

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/history.js .opencode/plugins/foundry.js tests/lib/history.test.js tests/plugin/preconditions.test.js
git commit -m "feat(harden): history_append requires last sort route to match"
```

---

## Task 13: `foundry_git_branch`, `foundry_git_commit`, `foundry_git_finish` — no active stage

**Files:**
- Modify: `.opencode/plugins/foundry.js:427-503`
- Modify: `tests/plugin/preconditions.test.js`

- [ ] **Step 1: Tests** — three `requires no active stage` rejection tests, one per tool.

- [ ] **Step 2: Fail.**

- [ ] **Step 3: Prepend `requireNoActiveStage(io)` guard** to each tool's execute body. `foundry_git_finish` gets the same treatment even though HARDEN.md doesn't list it — rationale documented in README §Review-observations.

- [ ] **Step 4: Pass.**

- [ ] **Step 5: Commit**

```bash
git add .opencode/plugins/foundry.js tests/plugin/preconditions.test.js
git commit -m "feat(harden): git tools require no active stage"
```

---

## Phase 3 complete

`node --test tests/` — all green. The tool surface is now strictly gated. Proceed to [PHASE_4.md](PHASE_4.md).
