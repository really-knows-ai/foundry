# Phase 1 — Guard composition layer and branch guards

**Spec sections covered:** §5.1, §5.2, §5.4, §5.5, §14.1
**Depends on:** nothing (groundwork phase).
**Mergeable on its own:** yes. Behaviour-preserving refactor plus three new
guards that are not yet wired into any tool's branch axis. Existing
`requireNotFailed` checks move from inline to `guarded()` composition with
identical semantics.

---

## 1. Goal

Extract a single `guarded()` composition helper, replace inline
`requireNotFailed` calls and the bespoke `gateAdmin` wrapper with it, and
add three branch-classification guards (`requireOnConfigBranch`,
`requireOnFlowBranch`, `requireOnConfigOrFlowBranch`) ready for later
phases to attach.

This phase ships **no observable behaviour change**. The branch guards
exist but are not yet referenced by any tool; that wiring lands in Phase 3
(for `foundry_git_branch`) and Phase 4 (for config-tier tools).

## 2. Scope

### In scope

- New module `scripts/lib/guards.js` exporting `guarded()`.
- New module `scripts/lib/branch-guard.js` exporting the three branch
  guards plus a small `currentBranch(io)` helper.
- Refactor of every tool file currently calling `requireNotFailed` inline
  to declare the guard via `guarded()` instead.
- Removal of `gateAdmin` from `memory-admin-tools.js`; replaced by
  `guarded()`.
- Foundational guards `requireGitRepo` and `requireFoundryRoot` (new
  module, used by `guarded()` — see Task 2).
- Unit tests for every guard and for composition order.

### Out of scope

- Wiring branch guards into existing tools (Phase 3 / Phase 4).
- Directory-scope (`commitWithPolicy`) changes (Phase 2).
- Tracing hook on `guarded()` (Phase 5; the seam is created here, not the
  behaviour).

## 3. File map

### Create

- `scripts/lib/guards.js` — `guarded()` composition helper.
- `scripts/lib/branch-guard.js` — branch guards + `currentBranch`.
- `scripts/lib/foundational-guards.js` — `requireGitRepo`,
  `requireFoundryRoot`.
- `tests/lib/guards.test.js`
- `tests/lib/branch-guard.test.js`
- `tests/lib/foundational-guards.test.js`

### Modify

- `.opencode/plugins/foundry-tools/memory-admin-tools.js` — drop
  `gateAdmin`, use `guarded()`.
- `.opencode/plugins/foundry-tools/feedback-tools.js` — replace inline
  `requireNotFailed` checks.
- `.opencode/plugins/foundry-tools/assay-tools.js` — same.
- `.opencode/plugins/foundry-tools/validate-tools.js` — same.
- `.opencode/plugins/foundry-tools/stage-tools.js` — same.
- `.opencode/plugins/foundry-tools/workfile-tools.js` — same.
- `.opencode/plugins/foundry-tools/memory-tools.js` — same.
- `.opencode/plugins/foundry-tools/artefact-tools.js` — same.
- `.opencode/plugins/foundry-tools/orchestrate-tool.js` — same.

### Tests touched (not modified, asserted unchanged)

The existing `tests/plugin/failed-flow-tool-gate.test.js` and
`tests/plugin/preconditions.test.js` must continue to pass without edits.
Their pass status is the regression check that the refactor is
behaviour-preserving.

## 4. Architecture

### `guarded()` contract

```js
// scripts/lib/guards.js
//
// Compose pre-execute guards onto a tool's `execute` function. Each guard
// is `(args, context) => { ok: true } | { ok: false, error: string }`.
// Guards run in array order; first failure short-circuits and the wrapped
// execute returns a JSON-stringified `{ error }` object. On all-pass, the
// wrapped execute is invoked unchanged and its return value is passed
// through.
//
// The wrapper does not modify `args` or `context`. It is async-safe:
// guards may be sync or return a Promise.

/**
 * @param {string} toolName  Used to prefix error messages.
 * @param {Array<Function>} guards
 * @param {Function} execute
 * @returns {Function}
 */
export function guarded(toolName, guards, execute) { ... }
```

Error string shape: `` `${toolName}: ${guard.error}` ``. This matches the
current `gateAdmin` and inline `requireNotFailed` shapes exactly, so
existing tests asserting on those strings keep passing.

### Branch guards contract

```js
// scripts/lib/branch-guard.js

/**
 * @param {object} io  IO with `exec(['git', ...])` returning stdout string.
 * @returns {string|null}  Branch name, or null if detached HEAD / no repo.
 */
export function currentBranch(io) { ... }

// All three return { ok: true } | { ok: false, error: string }.
export function requireOnConfigBranch(io) { ... }       // matches /^config\/[^/]+$/
export function requireOnFlowBranch(io) { ... }         // matches /^work\/.+/ OR /^config\/[^/]+\/dry-run\/.+/
export function requireOnConfigOrFlowBranch(io) { ... } // either of the above
```

`requireOnConfigBranch` is **strict**: `config/foo/dry-run/bar` does not
match (this is the spec §5.2 rule that prevents schema mutation inside
dry-run mode).

### Foundational guards

```js
// scripts/lib/foundational-guards.js
export function requireGitRepo(io) { ... }     // exists('.git') is sufficient
export function requireFoundryRoot(io) { ... } // exists('foundry/') (a directory)
```

### Composition order

When a tool composes guards via `guarded()`, the canonical order is:

1. `requireGitRepo`
2. `requireFoundryRoot`
3. `requireOnConfigBranch` or `requireOnFlowBranch` (whichever applies)
4. `requireNotFailed` (flow-tier only)

Phase 1 implements the helper; phases 3 and 4 do the wiring. This phase
only refactors existing `requireNotFailed` callers — no foundational or
branch guards are added to those callers yet, because that would be a
behaviour change.

## 5. Tasks

### Task 1.1 — `guarded()` helper

**Files:**
- Create: `scripts/lib/guards.js`
- Create: `tests/lib/guards.test.js`

- [ ] **Step 1: Failing test — guards run in order, first failure
  short-circuits.**

```js
// tests/lib/guards.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { guarded } from '../../scripts/lib/guards.js';

test('guarded: runs guards in order until one fails', async () => {
  const calls = [];
  const g1 = () => { calls.push('g1'); return { ok: true }; };
  const g2 = () => { calls.push('g2'); return { ok: false, error: 'nope' }; };
  const g3 = () => { calls.push('g3'); return { ok: true }; };
  const exec = () => { calls.push('exec'); return 'X'; };
  const wrapped = guarded('foundry_x', [g1, g2, g3], exec);
  const out = await wrapped({}, {});
  assert.deepEqual(calls, ['g1', 'g2']);
  assert.equal(out, JSON.stringify({ error: 'foundry_x: nope' }));
});

test('guarded: all-pass invokes execute and returns its value verbatim', async () => {
  const exec = async () => '{"ok":true}';
  const wrapped = guarded('foundry_x', [() => ({ ok: true })], exec);
  assert.equal(await wrapped({}, {}), '{"ok":true}');
});

test('guarded: async guard supported', async () => {
  const wrapped = guarded('foundry_x',
    [async () => ({ ok: false, error: 'async-fail' })],
    () => 'unreachable');
  assert.equal(await wrapped({}, {}),
    JSON.stringify({ error: 'foundry_x: async-fail' }));
});
```

- [ ] **Step 2: Run, expect FAIL** — `node --test tests/lib/guards.test.js`

- [ ] **Step 3: Implement.**

```js
// scripts/lib/guards.js
export function guarded(toolName, guards, execute) {
  return async (args, context) => {
    for (const g of guards) {
      const r = await g(args, context);
      if (!r.ok) {
        return JSON.stringify({ error: `${toolName}: ${r.error}` });
      }
    }
    return execute(args, context);
  };
}
```

- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit.**

```bash
git add scripts/lib/guards.js tests/lib/guards.test.js
git commit -m "feat(guards): add guarded() composition helper"
```

### Task 1.2 — Foundational guards

**Files:**
- Create: `scripts/lib/foundational-guards.js`
- Create: `tests/lib/foundational-guards.test.js`

- [ ] **Step 1: Failing test.**

```js
// tests/lib/foundational-guards.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { requireGitRepo, requireFoundryRoot } from '../../scripts/lib/foundational-guards.js';

function ioWith(paths) {
  return { exists: (p) => paths.has(p) };
}

test('requireGitRepo: ok when .git exists', () => {
  assert.deepEqual(requireGitRepo(ioWith(new Set(['.git']))), { ok: true });
});

test('requireGitRepo: fails when .git missing', () => {
  const r = requireGitRepo(ioWith(new Set()));
  assert.equal(r.ok, false);
  assert.match(r.error, /not a git repository/);
});

test('requireFoundryRoot: ok when foundry/ exists', () => {
  assert.deepEqual(requireFoundryRoot(ioWith(new Set(['foundry/']))), { ok: true });
});

test('requireFoundryRoot: fails when foundry/ missing, names init-foundry', () => {
  const r = requireFoundryRoot(ioWith(new Set()));
  assert.equal(r.ok, false);
  assert.match(r.error, /init-foundry/);
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement.**

```js
// scripts/lib/foundational-guards.js
export function requireGitRepo(io) {
  if (io.exists('.git')) return { ok: true };
  return { ok: false, error: 'not a git repository (no .git directory at worktree root)' };
}

export function requireFoundryRoot(io) {
  if (io.exists('foundry/')) return { ok: true };
  return {
    ok: false,
    error: 'foundry/ directory not found at worktree root. Run the init-foundry skill to scaffold it.',
  };
}
```

The IO's `exists` is consulted with the same path strings the test uses;
the existing `makeIO(worktree)` helper in
`.opencode/plugins/foundry-tools/helpers.js` already resolves relative
paths to the worktree root, so production callers pass `'.git'` and
`'foundry/'` and the IO does the join.

- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit.**

```bash
git add scripts/lib/foundational-guards.js tests/lib/foundational-guards.test.js
git commit -m "feat(guards): add requireGitRepo and requireFoundryRoot"
```

### Task 1.3 — Branch guards

**Files:**
- Create: `scripts/lib/branch-guard.js`
- Create: `tests/lib/branch-guard.test.js`

- [ ] **Step 1: Failing test covering every regex branch.**

```js
// tests/lib/branch-guard.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  currentBranch,
  requireOnConfigBranch,
  requireOnFlowBranch,
  requireOnConfigOrFlowBranch,
} from '../../scripts/lib/branch-guard.js';

function ioWithBranch(name) {
  return {
    exec: (argv) => {
      // Only mock `git rev-parse --abbrev-ref HEAD`.
      if (argv.join(' ') === 'git rev-parse --abbrev-ref HEAD') {
        return name === null ? 'HEAD\n' : `${name}\n`;
      }
      throw new Error('unexpected git call: ' + argv.join(' '));
    },
  };
}

test('currentBranch: returns trimmed branch name', () => {
  assert.equal(currentBranch(ioWithBranch('config/foo')), 'config/foo');
});

test('currentBranch: detached HEAD → null', () => {
  assert.equal(currentBranch(ioWithBranch(null)), null);
});

test('requireOnConfigBranch: matches config/foo', () => {
  assert.deepEqual(
    requireOnConfigBranch(ioWithBranch('config/foo')),
    { ok: true },
  );
});

test('requireOnConfigBranch: rejects config/foo/dry-run/bar (strict)', () => {
  const r = requireOnConfigBranch(ioWithBranch('config/foo/dry-run/bar'));
  assert.equal(r.ok, false);
  assert.match(r.error, /requires a config\/.* branch/);
  assert.match(r.error, /currently on 'config\/foo\/dry-run\/bar'/);
});

for (const bad of ['main', 'work/x-y', 'feature/x', 'HEAD']) {
  test(`requireOnConfigBranch: rejects '${bad}'`, () => {
    const r = bad === 'HEAD'
      ? requireOnConfigBranch(ioWithBranch(null))
      : requireOnConfigBranch(ioWithBranch(bad));
    assert.equal(r.ok, false);
  });
}

test('requireOnFlowBranch: matches work/foo-bar', () => {
  assert.deepEqual(
    requireOnFlowBranch(ioWithBranch('work/foo-bar')),
    { ok: true },
  );
});

test('requireOnFlowBranch: matches config/foo/dry-run/bar-baz', () => {
  assert.deepEqual(
    requireOnFlowBranch(ioWithBranch('config/foo/dry-run/bar-baz')),
    { ok: true },
  );
});

test('requireOnFlowBranch: rejects deeper nesting', () => {
  const r = requireOnFlowBranch(
    ioWithBranch('config/foo/dry-run/bar/dry-run/baz')
  );
  assert.equal(r.ok, false);
});

test('requireOnFlowBranch: rejects config/foo (no dry-run segment)', () => {
  const r = requireOnFlowBranch(ioWithBranch('config/foo'));
  assert.equal(r.ok, false);
});

test('requireOnConfigOrFlowBranch: matches both config/foo and work/foo', () => {
  assert.deepEqual(
    requireOnConfigOrFlowBranch(ioWithBranch('config/foo')),
    { ok: true },
  );
  assert.deepEqual(
    requireOnConfigOrFlowBranch(ioWithBranch('work/foo-bar')),
    { ok: true },
  );
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement.**

```js
// scripts/lib/branch-guard.js
const CONFIG_RE   = /^config\/[^/]+$/;
const WORK_RE     = /^work\/.+$/;
const DRY_RUN_RE  = /^config\/[^/]+\/dry-run\/[^/]+$/;

export function currentBranch(io) {
  const out = io.exec(['git', 'rev-parse', '--abbrev-ref', 'HEAD']).trim();
  if (!out || out === 'HEAD') return null;
  return out;
}

function describe(branch) {
  return branch === null ? 'detached HEAD' : `'${branch}'`;
}

export function requireOnConfigBranch(io) {
  const b = currentBranch(io);
  if (b && CONFIG_RE.test(b)) return { ok: true };
  return {
    ok: false,
    error:
      `this tool requires a config/<description> branch (strict; ` +
      `config/<x>/dry-run/<y> does not count); currently on ${describe(b)}. ` +
      `Use foundry_git_branch({ kind: "config", description: "..." }) ` +
      `from main first.`,
  };
}

export function requireOnFlowBranch(io) {
  const b = currentBranch(io);
  if (b && (WORK_RE.test(b) || DRY_RUN_RE.test(b))) return { ok: true };
  return {
    ok: false,
    error:
      `this tool requires a work/<flow>-<desc> or ` +
      `config/<x>/dry-run/<y> branch; currently on ${describe(b)}. ` +
      `Use foundry_git_branch({ kind: "work", flowId, description }) ` +
      `from main, or { kind: "dry-run", flowId, description } from a config branch.`,
  };
}

export function requireOnConfigOrFlowBranch(io) {
  const b = currentBranch(io);
  if (b && (CONFIG_RE.test(b) || WORK_RE.test(b) || DRY_RUN_RE.test(b))) {
    return { ok: true };
  }
  return {
    ok: false,
    error:
      `this tool requires a config/* or work/* or config/*/dry-run/* ` +
      `branch; currently on ${describe(b)}.`,
  };
}
```

- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit.**

```bash
git add scripts/lib/branch-guard.js tests/lib/branch-guard.test.js
git commit -m "feat(guards): add config/flow/dry-run branch guards"
```

### Task 1.4 — Refactor `memory-admin-tools.js` to use `guarded()`

The `gateAdmin` wrapper is replaced by `guarded()`. Behaviour is
identical: `requireNotFailed` runs before the body. `dump` and `validate`
remain unguarded (read-only diagnostics).

**Files:**
- Modify: `.opencode/plugins/foundry-tools/memory-admin-tools.js`

- [ ] **Step 1: Confirm baseline tests pass before edit.**

```bash
node --test tests/plugin/memory-admin-tools.test.js tests/plugin/failed-flow-tool-gate.test.js
```

Expected: PASS. Establishes the green baseline.

- [ ] **Step 2: Edit.** Replace the `gateAdmin(name, fn)` definition (lines
  35–42 of the current file) with an import and call to `guarded()`.

```js
// Replace the import block to add guards + failed-flow gate.
import { guarded } from '../../../scripts/lib/guards.js';
import { requireNotFailed } from '../../../scripts/lib/failed-flow.js';
import { makeIO, makeMemoryIO, errorJson } from './helpers.js';
// ... existing admin imports ...

// Delete the gateAdmin function entirely.

// Build a `notFailed` guard that constructs the sync IO each call:
function notFailedGuard(args, context) {
  return requireNotFailed(makeIO(context.worktree));
}
```

For each tool that previously used `gateAdmin('name', fn)`, replace with:

```js
execute: guarded('foundry_memory_create_entity_type',
  [notFailedGuard],
  async (args, context) => {
    try {
      const io = makeMemoryIO(context.worktree);
      const out = await admCreateEntity({ worktreeRoot: context.worktree, io, ...args });
      return JSON.stringify(out);
    } catch (err) { return errorJson(err); }
  }),
```

Apply this transformation to every tool that currently calls `gateAdmin`:
`create_entity_type`, `extractor_create`, `create_edge_type`,
`rename_entity_type`, `rename_edge_type`, `drop_entity_type`,
`drop_edge_type`, `reset`, `init`, `vacuum`, `change_embedding_model`.

`dump` and `validate` remain as plain `execute(...)` (no guards), exactly
as they are today.

- [ ] **Step 3: Re-run baseline tests, expect PASS unchanged.**

```bash
node --test tests/plugin/memory-admin-tools.test.js tests/plugin/failed-flow-tool-gate.test.js
```

The error-message format must be unchanged. If a test fails, the most
likely cause is `guarded()` producing a different prefix shape than
`gateAdmin` did — re-check Task 1.1's error string format matches the
existing gateAdmin output (`{ error: '${toolName}: ${guard.error}' }`).

- [ ] **Step 4: Commit.**

```bash
git add .opencode/plugins/foundry-tools/memory-admin-tools.js
git commit -m "refactor(memory-admin): use guarded() instead of gateAdmin"
```

### Task 1.5 — Refactor remaining inline `requireNotFailed` callers

Eight tool files duplicate the same inline pattern:

```js
const io = makeIO(context.worktree);
const guard = requireNotFailed(io);
if (!guard.ok) return JSON.stringify({ error: `<tool_name>: ${guard.error}` });
```

Replace this in each file with the `guarded()` wrapper plus the
`notFailedGuard` helper from Task 1.4. To avoid duplicating
`notFailedGuard` across files, add it as a named export to
`scripts/lib/guards.js`:

```js
// Add to scripts/lib/guards.js
import { requireNotFailed } from './failed-flow.js';

// `makeIO` is provided by the caller, since failed-flow lives in a
// different layer than the plugin helpers. We accept an io factory.
export function notFailedGuard(makeSyncIO) {
  return (_args, context) => requireNotFailed(makeSyncIO(context.worktree));
}
```

Each plugin tool file then declares:

```js
import { guarded, notFailedGuard } from '../../../scripts/lib/guards.js';
import { makeIO } from './helpers.js';
const gateNotFailed = notFailedGuard(makeIO);
```

and wraps every previously-inline-guarded `execute` with
`guarded('<tool_name>', [gateNotFailed], async (args, context) => { ... })`.

**Files (one commit per file to keep the diff readable):**

- [ ] **Sub-task 1.5.a:** `feedback-tools.js`
  - [ ] Run `node --test tests/plugin/feedback-tools.test.js` — green.
  - [ ] Refactor.
  - [ ] Re-run, expect PASS.
  - [ ] `git commit -m "refactor(feedback-tools): use guarded()"`

- [ ] **Sub-task 1.5.b:** `assay-tools.js`
  - Same loop. Test files: `tests/plugin/assay-tools.test.js`,
    `tests/plugin/assay-orchestration.test.js`, `tests/plugin/assay-e2e.test.js`.

- [ ] **Sub-task 1.5.c:** `validate-tools.js` (test:
  `tests/plugin/validate-tools.test.js`).

- [ ] **Sub-task 1.5.d:** `stage-tools.js` (tests:
  `tests/plugin/stage-tools.test.js`,
  `tests/plugin/stage-end-failed-flow.test.js`).

- [ ] **Sub-task 1.5.e:** `workfile-tools.js` (tests:
  `tests/plugin/workfiles-consistency.test.js`,
  `tests/plugin/failed-flow-tool-gate.test.js`).

- [ ] **Sub-task 1.5.f:** `memory-tools.js` (tests:
  `tests/plugin/memory-tools.test.js`,
  `tests/plugin/memory-permissions.test.js`).

- [ ] **Sub-task 1.5.g:** `artefact-tools.js` (test:
  `tests/plugin/orchestrate.test.js` exercises artefact set_status).

- [ ] **Sub-task 1.5.h:** `orchestrate-tool.js` (tests:
  `tests/plugin/orchestrate.test.js`,
  `tests/plugin/orchestrate-wrapper.test.js`,
  `tests/orchestrate-integration.test.js`,
  `tests/orchestrate-open-feedback.test.js`,
  `tests/orchestrate.test.js`).

After 1.5.h:

- [ ] **Step: full suite green.**

```bash
npm test
```

Expected: PASS, with no test changes.

## 6. Phase 1 acceptance criteria

- `npm test` passes with no test files modified.
- `git grep "requireNotFailed(" .opencode/plugins/foundry-tools/` returns
  no inline `if (!guard.ok)` pattern; only references inside
  `guards.js` / `notFailedGuard`.
- `git grep "gateAdmin"` returns nothing in
  `.opencode/plugins/foundry-tools/`.
- `scripts/lib/guards.js`, `scripts/lib/branch-guard.js`, and
  `scripts/lib/foundational-guards.js` exist with their unit tests passing.
- The branch guards have **zero call sites** outside their own test file.
  They are deliberately wired in by later phases.

## 7. Out-of-scope reminders

- No tool currently demands `requireOnConfigBranch` or
  `requireOnFlowBranch`; that wiring lives in Phase 3 and Phase 4.
- `commitWithPolicy` is unchanged in this phase. Phase 2 makes it
  branch- and stage-aware.
- The `guarded()` wrapper does not yet emit trace records. The seam
  exists; the body is added in Phase 5.
