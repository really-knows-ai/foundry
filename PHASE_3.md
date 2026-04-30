# Phase 3 — `foundry_git_branch` kind rewrite and `config/*` finish mode

**Spec sections covered:** §4, §8.1, §8.2 (work and config modes; the
dry-run mode handler is stubbed in this phase and fleshed out in
Phase 5), §14.1, §14.2, §14.4 (work/config parts), §15.4, §15.5
**Depends on:** Phase 1 (`branch-guard.js`, `guarded()`),
Phase 2 (no direct dependency, but the merge order is enforced for
documentation continuity).
**Mergeable on its own:** yes. The new `foundry_git_branch` signature
is a hard break (no compat shim, per spec §8.1 Q5). All call sites in
this repo plus all skills are updated in lockstep.

---

## 1. Goal

1. Replace the `foundry_git_branch({ flowId, description })` shape with
   `foundry_git_branch({ kind, flowId?, description })`. Each `kind`
   has its own arg-validity table and starting-branch precondition.
2. Extend `foundry_git_finish` to dispatch on the current branch
   prefix:
   - `work/<x>` → existing behaviour (squash-merge + WORK cleanup);
   - `config/<x>` → squash-merge with no WORK cleanup;
   - `dry-run/<x>/<y>` → **stub** that returns
     `error: "dry-run finish not yet implemented (Phase 5)"`. The
     dispatch path is in place so Phase 5 can drop in the snapshot
     handler with no surrounding-code changes.
   - any other branch → refused.
3. Update the five `add-*` config skills' prose preamble to reference
   the new `foundry_git_branch({ kind: "config", ... })` invocation
   shape and remove the "if you're on `work/*` finish first" wording
   in favour of "you must be on `config/*`" (the tool guards back this
   up).

## 2. Spec mapping

- §4: legal branches and refusal of deeper nesting.
- §8.1: per-kind arg requirements table; refusal cases (missing kind,
  forbidden args, wrong starting branch, dirty worktree, already
  nested).
- §8.2: three-mode dispatch on `_git_finish`. `baseBranch` invalid for
  dry-run. Refusal on `main` or unprefixed branches.
- §14.1, §14.2, §14.4: failure-mode catalogue for branch/finish
  validation.
- §15.4 and §15.5: integration test matrices (cross-product of starting
  branch × kind × required-arg variations).

## 3. File map

### Modify

- `.opencode/plugins/foundry-tools/git-tools.js` — both tools rewritten.
- `tests/plugin/git-tools.test.js` — full matrix.
- `skills/add-flow/SKILL.md`
- `skills/add-cycle/SKILL.md`
- `skills/add-law/SKILL.md`
- `skills/add-appraiser/SKILL.md`
- `skills/add-artefact-type/SKILL.md`

  In each: replace the prerequisite preamble with the spec §12.1
  pattern.

- `CHANGELOG.md` — add the BREAKING entry for the signature change.

### Create

- `tests/plugin/git-finish-config-mode.test.js` — exercises the new
  config branch finish path independently of the existing test file.

## 4. Architecture

### `foundry_git_branch` signature and per-kind table

```js
foundry_git_branch({
  kind: 'config' | 'work' | 'dry-run',  // required
  flowId?: string,                       // required for kind='work' or 'dry-run'
  description: string,                   // always required
})
```

Per-kind requirements:

| `kind`     | required args            | required current branch                        | result                                |
|------------|--------------------------|------------------------------------------------|---------------------------------------|
| `config`   | `description`            | not on `config/*` and not on `work/*`          | `config/<slug>`                       |
| `work`     | `flowId`, `description`  | not on `config/*` and not on `work/*`          | `work/<flowId>-<slug>`                |
| `dry-run`  | `flowId`, `description`  | on `config/<x>` (single segment, not nested)   | `dry-run/<x>/<flowId>-<slug>`  |

Refusal cases (§8.1):
- Missing or unknown `kind`.
- Missing required arg for the chosen `kind`.
- Forbidden arg supplied (e.g. `flowId` with `kind: "config"`).
- Wrong starting branch.
- Already on `dry-run/<x>/<y>` regardless of `kind`.
- Dirty worktree (existing behaviour preserved via the
  `requireNoActiveStage` guard chain).

### `foundry_git_finish` dispatch

Branch-prefix dispatch:

```
work/<x>                       → existing handler (refactored, no behaviour change)
config/<x>                     → new config-mode handler
dry-run/<x>/<y>         → STUB returning "not yet implemented" error
anything else (incl. main)     → refused with "nothing to finish on this branch"
```

Common across modes:
- `confirm: true` gate; preview without it.
- Dirty-tree refusal (existing behaviour).
- `baseBranch` accepted for `work/*` and `config/*` (default `main`).
- `baseBranch` **refused** for `dry-run/*/*` (spec §8.2).

## 5. Tasks

### Task 3.1 — Test scaffolding for the new branch matrix

Add the matrix test first; it will fail; we'll then implement the new
tool.

**Files:**
- Modify: `tests/plugin/git-tools.test.js`

- [ ] **Step 1: Add per-kind matrix test.**

```js
// tests/plugin/git-tools.test.js — additions
import test from 'node:test';
import assert from 'node:assert/strict';

// Re-use existing test harness (the file already builds a tools
// registry from createGitTools and stubs execFileSync via env). If a
// shared helper exists, use it; otherwise replicate the harness from
// the existing tests in this file.

test('foundry_git_branch: missing kind is refused', async () => {
  const r = await invokeGitBranch({ description: 'x' });
  assert.match(r.error, /kind is required/);
});

test('foundry_git_branch: kind="config" with flowId is refused', async () => {
  const r = await invokeGitBranch({ kind: 'config', flowId: 'f', description: 'x' });
  assert.match(r.error, /flowId is not valid for kind="config"/);
});

test('foundry_git_branch: kind="config" on main creates config/<slug>', async () => {
  const r = await invokeGitBranchOn('main', { kind: 'config', description: 'add-law' });
  assert.equal(r.branch, 'config/add-law');
});

test('foundry_git_branch: kind="work" missing flowId is refused', async () => {
  const r = await invokeGitBranchOn('main', { kind: 'work', description: 'x' });
  assert.match(r.error, /flowId is required for kind="work"/);
});

test('foundry_git_branch: kind="work" on main creates work/<flowId>-<slug>', async () => {
  const r = await invokeGitBranchOn('main',
    { kind: 'work', flowId: 'creative-flow', description: 'do-stuff' });
  assert.equal(r.branch, 'work/creative-flow-do-stuff');
});

test('foundry_git_branch: kind="dry-run" requires being on config/<x>', async () => {
  const onMain = await invokeGitBranchOn('main',
    { kind: 'dry-run', flowId: 'f', description: 'x' });
  assert.match(onMain.error, /requires a config\//);
  const onWork = await invokeGitBranchOn('work/f-x',
    { kind: 'dry-run', flowId: 'f', description: 'x' });
  assert.match(onWork.error, /requires a config\//);
});

test('foundry_git_branch: kind="dry-run" on config/foo creates the nested branch', async () => {
  const r = await invokeGitBranchOn('config/foo',
    { kind: 'dry-run', flowId: 'creative-flow', description: 'goal-x' });
  assert.equal(r.branch, 'dry-run/foo/creative-flow-goal-x');
});

test('foundry_git_branch: refuses on already-nested dry-run', async () => {
  const r = await invokeGitBranchOn('dry-run/foo/x-y',
    { kind: 'dry-run', flowId: 'f', description: 'z' });
  assert.match(r.error, /cannot nest deeper/);
});

test('foundry_git_branch: refuses kind="config" while already on config/x', async () => {
  const r = await invokeGitBranchOn('config/foo',
    { kind: 'config', description: 'y' });
  assert.match(r.error, /already on a config\//);
});

test('foundry_git_branch: refuses kind="work" while on config/x', async () => {
  const r = await invokeGitBranchOn('config/foo',
    { kind: 'work', flowId: 'f', description: 'g' });
  assert.match(r.error, /cannot start a work branch from a config branch/);
});
```

The helpers `invokeGitBranch` and `invokeGitBranchOn(currentBranch, args)`
extend the existing harness in this test file. If the existing helper
already supports a configurable starting branch, parameterise it;
otherwise add `invokeGitBranchOn` that monkey-patches the
`branch --show-current` mock.

- [ ] **Step 2: Run, expect FAIL** — the current tool refuses unknown
  args (`kind`).

- [ ] **Step 3: Commit the failing tests** so CI captures the scope.

```bash
git add tests/plugin/git-tools.test.js
git commit -m "test(git-tools): matrix for new kind-based foundry_git_branch"
```

  (Optional commit — if your project policy is "no failing-test
  commits", skip this and bundle into Task 3.2.)

### Task 3.2 — Rewrite `foundry_git_branch`

**Files:**
- Modify: `.opencode/plugins/foundry-tools/git-tools.js`

- [ ] **Step 1: Implement the per-kind dispatcher.**

```js
// .opencode/plugins/foundry-tools/git-tools.js  (excerpt)
import { execFileSync } from 'child_process';
import { slugify } from '../../../scripts/lib/slug.js';
import { requireNoActiveStage } from '../../../scripts/lib/stage-guard.js';
import { currentBranch } from '../../../scripts/lib/branch-guard.js';
import { makeIO } from './helpers.js';

const KIND_CONFIG  = 'config';
const KIND_WORK    = 'work';
const KIND_DRY_RUN = 'dry-run';
const KINDS = [KIND_CONFIG, KIND_WORK, KIND_DRY_RUN];

function refuse(error) { return JSON.stringify({ error }); }

function validateKindArgs(kind, args) {
  if (kind === KIND_CONFIG) {
    if (args.flowId !== undefined)
      return `flowId is not valid for kind="config"; supply only { kind, description }.`;
    if (!args.description)
      return `description is required for kind="config".`;
    return null;
  }
  if (kind === KIND_WORK || kind === KIND_DRY_RUN) {
    if (!args.flowId)
      return `flowId is required for kind="${kind}".`;
    if (!args.description)
      return `description is required for kind="${kind}".`;
    return null;
  }
  return `unknown kind "${kind}"; expected one of: ${KINDS.join(', ')}.`;
}

function validateStartingBranch(kind, branch) {
  // Nested dry-run never permits a new branch — applies to all kinds.
  if (branch && /^config\/[^/]+\/dry-run\/.+/.test(branch)) {
    return `cannot nest deeper than one dry-run level; you are on '${branch}'.`;
  }
  if (kind === KIND_CONFIG) {
    if (branch && /^config\//.test(branch))
      return `already on a config/* branch ('${branch}'); edit here directly or finish first.`;
    if (branch && /^work\//.test(branch))
      return `cannot start a config branch from a work branch ('${branch}'); finish or abandon it first.`;
    return null;
  }
  if (kind === KIND_WORK) {
    if (branch && /^config\//.test(branch))
      return `cannot start a work branch from a config branch ('${branch}'); ` +
             `use kind="dry-run" to dry-run the in-progress config, or finish config first.`;
    if (branch && /^work\//.test(branch))
      return `already on a work branch ('${branch}'); finish or abandon it first.`;
    return null;
  }
  if (kind === KIND_DRY_RUN) {
    if (!branch || !/^config\/[^/]+$/.test(branch))
      return `kind="dry-run" requires a config/<description> branch as starting point; ` +
             `currently on ${branch ? `'${branch}'` : 'detached HEAD'}.`;
    return null;
  }
  return null;
}

function buildBranchName(kind, args, parentBranch) {
  const descSlug = slugify(args.description);
  if (!descSlug) return { error: 'description slug is empty after normalisation.' };
  if (kind === KIND_CONFIG) return { name: `config/${descSlug}` };
  const flowSlug = slugify(args.flowId);
  if (!flowSlug) return { error: 'flowId slug is empty after normalisation.' };
  if (kind === KIND_WORK)
    return { name: `work/${flowSlug}-${descSlug}` };
  if (kind === KIND_DRY_RUN)
    return { name: `${parentBranch}/dry-run/${flowSlug}-${descSlug}` };
  return { error: 'internal: unhandled kind' };
}

export function createGitTools({ tool }) {
  return {
    foundry_git_branch: tool({
      description:
        'Create and checkout a foundry branch. Requires `kind`: ' +
        '"config" (schema work, off main), "work" (flow run, off main), ' +
        'or "dry-run" (flow run off a config/* branch).',
      args: {
        kind: tool.schema.string().describe('config | work | dry-run'),
        flowId: tool.schema.string().optional()
          .describe('Flow ID. Required for kind="work" and "dry-run".'),
        description: tool.schema.string()
          .describe('Slugified description suffix.'),
      },
      async execute(args, context) {
        const io = makeIO(context.worktree);

        const stageGuard = requireNoActiveStage(io);
        if (!stageGuard.ok)
          return refuse(`foundry_git_branch ${stageGuard.error}`);

        if (!args.kind)
          return refuse('foundry_git_branch: kind is required (one of: config, work, dry-run)');
        if (!KINDS.includes(args.kind))
          return refuse(`foundry_git_branch: unknown kind "${args.kind}" ` +
                        `(expected one of: ${KINDS.join(', ')})`);

        const argErr = validateKindArgs(args.kind, args);
        if (argErr) return refuse(`foundry_git_branch: ${argErr}`);

        const branch = currentBranch({
          exec: (argv) => execFileSync(argv[0], argv.slice(1),
            { cwd: context.worktree, encoding: 'utf8', stdio: 'pipe' }),
        });
        const startErr = validateStartingBranch(args.kind, branch);
        if (startErr) return refuse(`foundry_git_branch: ${startErr}`);

        const built = buildBranchName(args.kind, args, branch);
        if (built.error) return refuse(`foundry_git_branch: ${built.error}`);

        try {
          execFileSync('git', ['checkout', '-b', built.name],
            { cwd: context.worktree, encoding: 'utf8', stdio: 'pipe' });
        } catch (err) {
          const stderr = (err?.stderr || err?.stdout)
            ? String(err.stderr || err.stdout).trim() : '';
          return refuse(`foundry_git_branch: failed to create branch ` +
                        `'${built.name}'.${stderr ? ' ' + stderr : ''}`);
        }
        return JSON.stringify({ ok: true, branch: built.name });
      },
    }),

    // foundry_git_finish updated in Task 3.3.
  };
}
```

Note the `currentBranch` helper from `branch-guard.js` is reused with
an injected `exec` so the same mocking strategy works in both the
helper's own tests and in `git-tools.test.js`.

- [ ] **Step 2: Run the matrix tests, expect PASS.**

```bash
node --test tests/plugin/git-tools.test.js
```

- [ ] **Step 3: Commit.**

```bash
git add .opencode/plugins/foundry-tools/git-tools.js
git commit -m "feat(git-tools): foundry_git_branch requires explicit kind"
```

### Task 3.3 — Extend `foundry_git_finish` for `config/*` mode

The `work/*` path is preserved exactly. The `config/*` path is new and
simpler (no WORK files to clean up). The `dry-run/*/*` path is a
stub that errors out; Phase 5 implements it.

**Files:**
- Modify: `.opencode/plugins/foundry-tools/git-tools.js`
- Create: `tests/plugin/git-finish-config-mode.test.js`

- [ ] **Step 1: Failing test for config-finish.**

```js
// tests/plugin/git-finish-config-mode.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { runGitFinish, gitInit, gitCommit, gitCheckout, gitWriteFile }
  from './helpers/git-fixture.js';
// (Helper file may exist; if not, re-use the harness from
// `tests/plugin/git-tools.test.js`. The point is to drive a real-ish
// git fixture in tmpdir.)

test('foundry_git_finish on config/foo: squash-merges to main, deletes branch', async () => {
  const repo = await gitInit();
  await gitCheckout(repo, '-b', 'config/add-rule');
  await gitWriteFile(repo, 'foundry/laws/rules.md', '# rules\n');
  await gitCommit(repo, 'config: add rule');
  // Confirm preview without confirm.
  const preview = await runGitFinish(repo, { message: 'add rule', confirm: false });
  assert.equal(preview.ok, false);
  assert.match(preview.error, /requires \{confirm: true\}/);
  // Apply.
  const r = await runGitFinish(repo, { message: 'add rule', confirm: true });
  assert.equal(r.ok, true);
  assert.equal(r.branch, 'main');
  // Branch deleted.
  const branches = await repo.listBranches();
  assert.ok(!branches.includes('config/add-rule'));
  // Commit landed on main.
  const log = await repo.log('main');
  assert.match(log[0].message, /add rule/);
});

test('foundry_git_finish on config/foo: refuses dirty tree', async () => {
  const repo = await gitInit();
  await gitCheckout(repo, '-b', 'config/x');
  await gitWriteFile(repo, 'foundry/laws/rules.md', '# r\n');
  await gitCommit(repo, 'config: add r');
  await gitWriteFile(repo, 'foundry/laws/rules.md', '# r\nmore\n'); // dirty
  const r = await runGitFinish(repo, { message: 'x', confirm: true });
  assert.equal(r.ok, false);
  assert.match(r.error, /dirty worktree/);
});

test('foundry_git_finish on dry-run/foo/bar-baz: stubbed (Phase 5)', async () => {
  const repo = await gitInit();
  await gitCheckout(repo, '-b', 'config/foo');
  await gitCommit(repo, 'noop', { allowEmpty: true });
  await gitCheckout(repo, '-b', 'dry-run/foo/bar-baz');
  const r = await runGitFinish(repo, { message: 'try', confirm: true });
  assert.equal(r.ok, false);
  assert.match(r.error, /dry-run finish not yet implemented/);
});

test('foundry_git_finish on main: refused', async () => {
  const repo = await gitInit();
  await gitCommit(repo, 'init', { allowEmpty: true });
  const r = await runGitFinish(repo, { message: 'x', confirm: true });
  assert.equal(r.ok, false);
  assert.match(r.error, /nothing to finish/);
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement `foundry_git_finish` dispatcher.**

```js
// .opencode/plugins/foundry-tools/git-tools.js  (excerpt — append to module)

const WORK_FILES = ['WORK.md', 'WORK.history.yaml', 'WORK.feedback.yaml'];

function classifyBranch(branch) {
  if (!branch) return 'detached';
  if (/^config\/[^/]+\/dry-run\/.+/.test(branch)) return 'dry-run';
  if (/^config\/[^/]+$/.test(branch)) return 'config';
  if (/^work\//.test(branch)) return 'work';
  return 'other';
}

function dirtyTracked(cwd) {
  const out = execFileSync('git',
    ['status', '--porcelain', '--untracked-files=no'],
    { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
  return out ? out.split('\n').map((l) => l.slice(3)) : [];
}

// Existing handler, just extracted into a function so the dispatcher
// stays compact. Behaviour identical to today.
function finishWorkBranch({ workBranch, base, cwd, args }) {
  // ... move the body of the current foundry_git_finish (lines 64–135 of
  //     the existing implementation) here verbatim. No semantic changes.
}

function finishConfigBranch({ configBranch, base, cwd, args }) {
  const planned = {
    workBranch: configBranch,
    baseBranch: base,
    filesToDelete: [],          // no WORK files on a config branch
    action: 'checkout-base, squash-merge, commit, delete-config-branch',
    commitMessage: args.message,
  };
  if (args.confirm !== true) {
    return JSON.stringify({
      ok: false,
      error: 'foundry_git_finish requires {confirm: true} to perform destructive operations. Re-invoke with confirm:true to apply the plan.',
      planned,
    });
  }
  const dirty = dirtyTracked(cwd);
  if (dirty.length) {
    return JSON.stringify({
      ok: false,
      error: 'foundry_git_finish refuses to run on a dirty worktree (uncommitted changes to tracked files). Commit or stash them first.',
      dirty,
    });
  }
  const opts = { cwd, encoding: 'utf8', stdio: 'pipe' };
  execFileSync('git', ['checkout', base], opts);
  try {
    execFileSync('git', ['merge', '--squash', configBranch], opts);
  } catch (err) {
    try { execFileSync('git', ['reset', '--hard', 'HEAD'], opts); } catch {}
    try { execFileSync('git', ['checkout', configBranch], opts); } catch {}
    const stderr = (err?.stderr || err?.stdout)
      ? String(err.stderr || err.stdout).trim() : '';
    return JSON.stringify({
      ok: false,
      error: `foundry_git_finish: squash merge failed (likely a conflict). Config branch '${configBranch}' preserved.${stderr ? ' ' + stderr : ''}`,
    });
  }
  execFileSync('git', ['commit', '-m', args.message], opts);
  const hash = execFileSync('git', ['rev-parse', '--short', 'HEAD'], opts).trim();
  execFileSync('git', ['branch', '-D', configBranch], opts);
  return JSON.stringify({ ok: true, hash, branch: base });
}

function finishDryRunStub() {
  return JSON.stringify({
    ok: false,
    error: 'foundry_git_finish: dry-run finish not yet implemented (Phase 5).',
  });
}

// Replace the export:
foundry_git_finish: tool({
  description: 'Finish the current foundry branch. ' +
    'work/<x>: squash-merge + WORK cleanup. ' +
    'config/<x>: squash-merge. ' +
    'dry-run/<x>/<y>: snapshot + discard (Phase 5).',
  args: {
    message: tool.schema.string().describe('Squash merge / snapshot message'),
    baseBranch: tool.schema.string().optional()
      .describe('Target branch (default: main). Not valid for dry-run finish.'),
    confirm: tool.schema.boolean().optional(),
  },
  async execute(args, context) {
    const io = makeIO(context.worktree);
    const stageGuard = requireNoActiveStage(io);
    if (!stageGuard.ok)
      return refuse(`foundry_git_finish ${stageGuard.error}`);

    const cwd = context.worktree;
    const branch = execFileSync('git', ['branch', '--show-current'],
      { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
    const kind = classifyBranch(branch);

    if (kind === 'dry-run') {
      if (args.baseBranch !== undefined) {
        return refuse(
          'foundry_git_finish: baseBranch is not valid for a dry-run ' +
          'finish; the parent config branch is determined by the dry-run ' +
          'branch name.');
      }
      return finishDryRunStub();
    }

    const base = args.baseBranch || 'main';
    if (kind === 'work')   return finishWorkBranch({ workBranch: branch, base, cwd, args });
    if (kind === 'config') return finishConfigBranch({ configBranch: branch, base, cwd, args });
    if (branch === base) {
      return JSON.stringify({
        ok: true, noop: true,
        message: `Already on ${base} — nothing to merge`, branch: base,
      });
    }
    return refuse(
      `foundry_git_finish: nothing to finish on '${branch || 'detached HEAD'}' ` +
      `(expected work/<x>, config/<x>, or dry-run/<x>/<y>).`);
  },
}),
```

- [ ] **Step 4: Run all git-tools tests.**

```bash
node --test tests/plugin/git-tools.test.js \
            tests/plugin/git-finish-config-mode.test.js
```

Expected: PASS. The work-branch tests must still pass without
modification (they exercise `finishWorkBranch`, which is the existing
body relocated).

- [ ] **Step 5: Commit.**

```bash
git add .opencode/plugins/foundry-tools/git-tools.js \
        tests/plugin/git-finish-config-mode.test.js
git commit -m "feat(git-tools): foundry_git_finish dispatches on branch kind"
```

### Task 3.4 — Update the five `add-*` config-skill preambles

The current preamble in (e.g.) `skills/add-law/SKILL.md` reads
"Foundry configuration changes must be made on the base branch
(usually main); finish or discard any in-flight work branch first." That
is now wrong: config edits must happen on a `config/*` branch. The
skill instructs the LLM to invoke `foundry_git_branch({ kind: "config",
description: "..." })` if needed.

**Files:**
- Modify: `skills/add-law/SKILL.md`
- Modify: `skills/add-flow/SKILL.md`
- Modify: `skills/add-cycle/SKILL.md`
- Modify: `skills/add-appraiser/SKILL.md`
- Modify: `skills/add-artefact-type/SKILL.md`

For each, replace the **Prerequisites** section with this canonical
block (preserve the rest of the skill verbatim):

```markdown
## Prerequisites

Before running this skill, verify all three of the following:

1. The `foundry/` directory exists in the project root. If it does not
   exist, stop and tell the user:

   > Foundry is not initialized in this project. Run the
   > `init-foundry` skill first to create the foundry/ directory
   > structure.

2. The current git branch is a `config/*` branch. Run
   `git rev-parse --abbrev-ref HEAD` and confirm it matches
   `dry-run/<x>/...`).

3. If the branch does not start with `config/`, instruct the user to
   create one before continuing:

   > Foundry configuration changes must be made on a config/* branch.
   > From a clean main branch, call:
   >
   > `foundry_git_branch({ kind: "config", description: "<short-name>" })`
   >
   > Then re-run this skill.

   If the user is on a `dry-run/*/*` branch, they must finish
   that dry-run first (`foundry_git_finish({ message, confirm: true })`)
   before re-running this skill on the parent `config/*`.
```

Phase 4 will further replace the skills' `Write` / `Edit` steps with
the new `foundry_config_create_*` and `foundry_config_validate_*` tool
invocations. For now, leave the existing write steps in place — they
work correctly on a `config/*` branch.

- [ ] **Step 1:** Read each skill file (the structure varies slightly
  between them).
- [ ] **Step 2:** Apply the preamble replacement.
- [ ] **Step 3:** Commit.

```bash
git add skills/add-law/SKILL.md skills/add-flow/SKILL.md \
        skills/add-cycle/SKILL.md skills/add-appraiser/SKILL.md \
        skills/add-artefact-type/SKILL.md
git commit -m "docs(skills): config skills target config/* branches"
```

### Task 3.5 — CHANGELOG entry

**Files:**
- Modify: `CHANGELOG.md`

- [ ] Add to the `[Unreleased] ### Breaking` section:

```
- `foundry_git_branch` now requires an explicit `kind: 'config' |
  'work' | 'dry-run'` argument. The previous `{ flowId, description }`
  signature has been removed; `flowId` is invalid for `kind: 'config'`.
  Per-kind requirements: `kind: 'config'` needs `description` and a
  non-config/non-work starting branch; `kind: 'work'` needs `flowId`,
  `description`, and a non-config/non-work starting branch;
  `kind: 'dry-run'` needs `flowId`, `description`, and the operator
  must already be on a `config/<x>` branch.
- `foundry_git_finish` now dispatches on the current branch prefix:
  `work/<x>` (existing semantics — squash-merge and WORK cleanup),
  `config/<x>` (squash-merge, no WORK cleanup), and
  `dry-run/<x>/<y>` (Phase 5: snapshot + discard; until then,
  this branch is recognised but the handler returns "not yet
  implemented").
```

- [ ] Commit:

```bash
git add CHANGELOG.md
git commit -m "docs(changelog): record git-branch/git-finish breaking changes"
```

## 6. Phase 3 acceptance criteria

- `node --test tests/plugin/git-tools.test.js
   tests/plugin/git-finish-config-mode.test.js` is green.
- `npm test` is green (no other test should regress; the work-branch
  path is byte-for-byte preserved by `finishWorkBranch`).
- `foundry_git_branch` rejects every refusal case in spec §14.2 with a
  message naming the offending state.
- `foundry_git_finish` on `config/foo` produces one squash commit on
  `main` and deletes the config branch.
- `foundry_git_finish` on `dry-run/foo/bar` returns the stub
  error.
- All five config skills' preambles read identically to each other,
  modulo the skill name.

## 7. Out-of-scope reminders

- **Snapshot writer / dry-run finish** lives in Phase 5. The dispatch
  path is in place; Phase 5 replaces `finishDryRunStub()` with the real
  handler.
- **`foundry_config_create_*` / `_validate_*` tools** land in Phase 4.
  This phase only updates the skills' branch-prerequisite preamble.
- **Branch guards on flow-tier tools** are not yet wired. Memory data
  tools and `foundry_orchestrate` still happily run on `main` if
  invoked there directly. Phase 4 adds those guards together with the
  config-tier guards.
