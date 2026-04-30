# Phase 2 — `foundry-memory/` relocation and directory-scope policy

**Spec sections covered:** §3, §5.3, §6 (notes on `_memory_init`,
`_memory_reset`, `_memory_vacuum`)
**Depends on:** Phase 1 (uses `guarded()` for new path-policy guards
where needed; no new branch wiring yet).
**Mergeable on its own:** yes. Memory data files move to a new top-level
directory; existing memory consumers learn the new path through a
single source of truth (`memoryPaths`). `commitWithPolicy` becomes
stage-aware about the new directory.

---

## 1. Goal

1. Move memory **data** rows from `foundry/memory/relations/` to a new
   top-level `foundry-memory/relations/` while leaving entity/edge
   **type definitions** under `foundry/memory/`.
2. Teach `commitWithPolicy` and `allowedPatternsForStage` about the new
   directory so the assay stage and memory-data writes commit into the
   right place under the right pattern.
3. Update `foundry_memory_init` to scaffold both `foundry/memory/`
   (definitions, schema, db) and `foundry-memory/relations/` (data) per
   spec §6.

This phase **does not** introduce branch guards on memory tools — a
`work/*` branch is still where memory-data writes happen, exactly as
today, so requiring `requireOnFlowBranch` on memory writes is a
behaviour change deferred to Phase 4 (it lands together with the
config-tier branch wiring so the cutover is coherent).

## 2. Spec mapping

- §3: directory layout has new top-level `foundry-memory/`. Empty until
  `foundry_memory_init`. Inherits via normal git branching, no special
  loading.
- §5.3 path-scope rules:
  - **forge** stage commits restricted to artefact `file-patterns`.
  - **assay** stage commits restricted to `foundry-memory/**` (was
    `foundry/memory/**`).
  - **orchestrator commits** restricted to `WORK*` + `.foundry/**`.
  - **`foundry_memory_init`** is the single tool allowed to stage paths
    in both `foundry/` and `foundry-memory/`.
- §6 notes: `_memory_reset` truncates NDJSON under `foundry-memory/`;
  `_memory_vacuum` only touches the gitignored `foundry/memory/memory.db`.

## 3. File map

### Modify

- `scripts/lib/memory/paths.js` — `relationsDir` and `relationFile()`
  resolve under `foundry-memory/relations/` instead of
  `foundry/memory/relations/`. Single source of truth; everything else
  follows.
- `scripts/lib/memory/admin/init.js` — scaffold `foundry-memory/relations/`
  with `.gitkeep` (and the `entities`/`edges` definition dirs continue
  to live under `foundry/memory/` as today).
- `scripts/lib/git-policy.js` — `allowedPatternsForStage` returns
  `['foundry-memory/**']` for the assay stage. `TOOL_MANAGED_PREFIX`
  unchanged.
- `scripts/lib/git-bridge.js` — extend `commitWithPolicy` to accept an
  optional `extraAllowedPatterns` argument so `foundry_memory_init` can
  request both `foundry/**` and `foundry-memory/**`. The dual-allowance
  is carried as data, not branched policy.
- `scripts/lib/memory/admin/reset.js` — no logic change; it loops
  `relationFile(name)`, which now resolves under `foundry-memory/`.
  Documented here so reviewers know the relocation propagates through.

### Create

- `tests/lib/memory/paths.test.js` — asserts the new path resolution.
- `tests/lib/git-policy.test.js` (extend existing) — adds case for
  `assay` stage producing `['foundry-memory/**']`.

### Touch (test files asserting unchanged behaviour)

- `tests/lib/git-bridge.test.js` — must still pass.
- `tests/plugin/assay-tools.test.js`, `tests/plugin/assay-e2e.test.js`,
  `tests/plugin/assay-orchestration.test.js` — must still pass with
  fixtures regenerated for the new directory (see Task 2.4).
- `tests/plugin/memory-end-of-flow-sync.test.js`,
  `tests/plugin/memory-tools.test.js`,
  `tests/plugin/memory-permissions.test.js`,
  `tests/plugin/memory-search.test.js` — must still pass (no fixture
  edits expected; they go through `memoryPaths`).

## 4. Tasks

### Task 2.1 — Relocate `relationsDir` in `memoryPaths`

**Files:**
- Modify: `scripts/lib/memory/paths.js`
- Create: `tests/lib/memory/paths.test.js`

- [ ] **Step 1: Failing test.**

```js
// tests/lib/memory/paths.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { memoryPaths } from '../../../scripts/lib/memory/paths.js';

test('memoryPaths: definitions stay under foundry/memory/', () => {
  const p = memoryPaths('foundry');
  assert.equal(p.entitiesDir, 'foundry/memory/entities');
  assert.equal(p.edgesDir,    'foundry/memory/edges');
  assert.equal(p.config,      'foundry/memory/config.md');
  assert.equal(p.schema,      'foundry/memory/schema.json');
  assert.equal(p.db,          'foundry/memory/memory.db');
});

test('memoryPaths: relation rows live under top-level foundry-memory/', () => {
  const p = memoryPaths('foundry');
  assert.equal(p.relationsDir, 'foundry-memory/relations');
  assert.equal(p.relationFile('person'),
    'foundry-memory/relations/person.ndjson');
});
```

- [ ] **Step 2: Run, expect FAIL** (current value is
  `foundry/memory/relations`).

- [ ] **Step 3: Implement.** Replace the two relevant lines:

```js
// scripts/lib/memory/paths.js
import { join } from 'node:path';

export function memoryPaths(foundryDir) {
  const root = join(foundryDir, 'memory');
  const entitiesDir = join(root, 'entities');
  const edgesDir = join(root, 'edges');
  const extractorsDir = join(root, 'extractors');
  // Data rows live OUTSIDE foundry/, in a sibling top-level directory.
  // foundryDir is conventionally 'foundry'; the data sibling is
  // 'foundry-memory'. We hard-code the sibling because the data path is
  // a stable layout decision (spec §3), not a configurable.
  const relationsDir = 'foundry-memory/relations';
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

- [ ] **Step 4: Run new test, expect PASS.**

- [ ] **Step 5: Run downstream test files; expect FAIL in some** (this
  is the relocation breakpoint; the next tasks fix them).

```bash
node --test tests/plugin/memory-tools.test.js \
            tests/plugin/memory-end-of-flow-sync.test.js \
            tests/plugin/assay-tools.test.js
```

The expected failures are fixture/path mismatches; the next tasks make
them green.

- [ ] **Step 6: Commit.**

```bash
git add scripts/lib/memory/paths.js tests/lib/memory/paths.test.js
git commit -m "feat(memory): relocate relation rows to foundry-memory/"
```

### Task 2.2 — Update assay's allowed-pattern in `git-policy.js`

**Files:**
- Modify: `scripts/lib/git-policy.js`
- Modify: `tests/lib/git-policy.test.js`

- [ ] **Step 1: Failing test (extend existing test file).**

Append to `tests/lib/git-policy.test.js`:

```js
test('allowedPatternsForStage: assay stage allows foundry-memory/**', () => {
  assert.deepEqual(
    allowedPatternsForStage({ stageBase: 'assay' }),
    ['foundry-memory/**'],
  );
});
```

If the test file does not import `allowedPatternsForStage`, add it to
the import line at top.

- [ ] **Step 2: Run, expect FAIL** (current value is
  `['foundry/memory/**']`).

- [ ] **Step 3: Implement.** Replace the assay branch in
  `allowedPatternsForStage`:

```js
// scripts/lib/git-policy.js  (excerpt)
export function allowedPatternsForStage({ stageBase, forgeFilePatterns = [] } = {}) {
  if (stageBase === 'forge') return forgeFilePatterns;
  if (stageBase === 'assay') return ['foundry-memory/**'];
  return [];
}
```

- [ ] **Step 4: Run all of `tests/lib/git-policy.test.js`, expect PASS.**

- [ ] **Step 5: Commit.**

```bash
git add scripts/lib/git-policy.js tests/lib/git-policy.test.js
git commit -m "feat(git-policy): assay stage commits foundry-memory/**"
```

### Task 2.3 — `commitWithPolicy` accepts `extraAllowedPatterns`

`foundry_memory_init` must produce a single setup commit that contains
both new `foundry/memory/` definitions and the new `foundry-memory/relations/`
scaffold. The simplest extension is an additive optional arg, default
empty.

**Files:**
- Modify: `scripts/lib/git-bridge.js`
- Modify: `tests/lib/git-bridge.test.js`

- [ ] **Step 1: Failing test.**

```js
// tests/lib/git-bridge.test.js — add
test('commitWithPolicy: extraAllowedPatterns are honoured', () => {
  const calls = [];
  const execFile = (argv) => {
    calls.push(argv);
    if (argv[0] === 'status')
      return ['?? foundry/memory/config.md\0', '?? foundry-memory/relations/.gitkeep\0'].join('');
    if (argv[0] === 'rev-parse') return 'abcdef0\n';
    return '';
  };
  const sha = commitWithPolicy({
    message: 'init memory',
    allowedPatterns: ['foundry/**'],
    extraAllowedPatterns: ['foundry-memory/**'],
    execFile,
  });
  assert.equal(sha, 'abcdef0');
  // both paths must end up in the `add --` call.
  const addCall = calls.find((c) => c[0] === 'add');
  assert.ok(addCall.includes('foundry/memory/config.md'));
  assert.ok(addCall.includes('foundry-memory/relations/.gitkeep'));
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement.**

```js
// scripts/lib/git-bridge.js  (excerpt)
export function commitWithPolicy({
  message,
  allowedPatterns = [],
  extraAllowedPatterns = [],
  execFile,
}) {
  const porcelain = execFile(['status', '-z', '--porcelain', '--untracked-files=all']);
  const dirty = parsePorcelainZ(porcelain);
  const merged = [...allowedPatterns, ...extraAllowedPatterns];
  const { allowed, unexpected } = partitionDirty(dirty, merged);
  if (unexpected.length) throw new UnexpectedFilesError(unexpected);
  execFile(['reset', '--quiet']);
  if (allowed.length === 0) return null;
  execFile(['add', '--', ...allowed]);
  execFile(['commit', '-m', message]);
  return execFile(['rev-parse', '--short', 'HEAD']).trim();
}
```

The two arg lists are merged before the call to `partitionDirty`, so
the existing single-list semantics are preserved when callers don't
pass the new arg.

- [ ] **Step 4: Run, expect PASS.** Also re-run the existing
  `tests/lib/git-bridge.test.js` cases — they must still pass without
  edits.

- [ ] **Step 5: Commit.**

```bash
git add scripts/lib/git-bridge.js tests/lib/git-bridge.test.js
git commit -m "feat(git-bridge): commitWithPolicy supports extraAllowedPatterns"
```

### Task 2.4 — `initMemory` scaffolds `foundry-memory/relations/`

**Files:**
- Modify: `scripts/lib/memory/admin/init.js`
- Modify: existing init test fixture (likely
  `tests/plugin/memory-admin-tools.test.js`).

- [ ] **Step 1: Failing test.** Locate the existing test for
  `foundry_memory_init` (in `tests/plugin/memory-admin-tools.test.js`)
  and extend the expected `created` set:

```js
// In the assertion block for memory_init:
assert.ok(out.created.includes('foundry-memory/relations/.gitkeep'),
  'init should create foundry-memory/relations/.gitkeep');
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement.** In `init.js`, the loop currently iterates
  over `[entitiesDir, edgesDir, relationsDir]` to drop `.gitkeep`s. Now
  that `relationsDir` resolves outside `foundry/`, we must also `mkdir`
  the parent `foundry-memory/`. Adjust the prerequisite check too — we
  still require `foundry/` to exist (caller invariant), but
  `foundry-memory/` is created by us.

```js
// scripts/lib/memory/admin/init.js  (excerpt)
export async function initMemory({ io, embeddingsEnabled = true, probe = true }) {
  const p = memoryPaths('foundry');

  if (!(await io.exists('foundry'))) {
    throw new Error('foundry/ does not exist; run init-foundry first');
  }
  if (await io.exists(p.root)) {
    throw new Error('foundry/memory/ already exists');
  }

  const created = [];

  await io.mkdir(p.entitiesDir);
  await io.mkdir(p.edgesDir);
  // relationsDir is outside foundry/. Ensure parents exist.
  await io.mkdir('foundry-memory');
  await io.mkdir(p.relationsDir);

  for (const d of [p.entitiesDir, p.edgesDir, p.relationsDir]) {
    const f = join(d, '.gitkeep');
    await io.writeFile(f, '');
    created.push(f);
  }
  // ... rest unchanged
}
```

If `io.mkdir` is not idempotent in the test mock, the second call (for
`p.relationsDir` whose parent we just created) is fine because mkdir
in the test mock layers paths. Verify `tests/helpers/mock-io.js`'s
`mkdir` behaviour and adjust if necessary.

- [ ] **Step 4: Run the modified test, expect PASS.** Then run the full
  memory test surface:

```bash
node --test tests/plugin/memory-admin-tools.test.js \
            tests/plugin/memory-tools.test.js \
            tests/plugin/memory-end-of-flow-sync.test.js \
            tests/plugin/memory-permissions.test.js \
            tests/plugin/memory-search.test.js \
            tests/plugin/memory-prompt-injection.test.js
```

Expected: PASS. Any failure is almost certainly a test fixture that
hard-coded the old `foundry/memory/relations/...` path; update the
fixture string to `foundry-memory/relations/...`.

- [ ] **Step 5: Commit.**

```bash
git add scripts/lib/memory/admin/init.js tests/plugin/memory-admin-tools.test.js
git commit -m "feat(memory): init scaffolds foundry-memory/relations"
```

### Task 2.5 — Fix any remaining test fixtures referencing the old path

Some integration tests assert on file paths in NDJSON-write checks.

- [ ] **Step 1:** Run the full plugin suite.

```bash
node --test tests/plugin
```

- [ ] **Step 2:** For each failure whose error names a path under
  `foundry/memory/relations/`, update the assertion to
  `foundry-memory/relations/`. Do **not** modify production code in
  this step; the production change is concentrated in `paths.js`
  (Task 2.1) and propagated automatically.

- [ ] **Step 3:** Re-run; confirm green.

- [ ] **Step 4:** Commit (one commit, "test(memory): update fixtures
  for relocated relations dir").

### Task 2.6 — `init-foundry` skill prep for `.snapshots/` gitignore

The spec (§11.1) says `.snapshots/` is added to `.gitignore` by
`init-foundry`. Phase 5 makes `.snapshots/` show up; this phase does the
mechanical gitignore update so a Phase 5 implementer doesn't need to
re-touch `init-foundry`. The line is harmless before Phase 5 (the
directory simply doesn't exist).

**Files:**
- Modify: `skills/init-foundry/SKILL.md`
- Modify: `.gitignore` (this repo's own gitignore — additive line)

- [ ] **Step 1:** Add `.snapshots/` to this repo's `.gitignore` so
  developer worktrees behave correctly when Phase 5 lands.

```gitignore
# .gitignore
node_modules/
__pycache__/
.DS_Store
*.tgz
.foundry/
.worktrees/
.snapshots/
```

- [ ] **Step 2:** Update the `init-foundry` skill (see file for current
  prose) so it instructs the LLM to append both `.foundry/` (existing)
  and `.snapshots/` to a project's `.gitignore` when scaffolding.

  (Read the skill first; only modify the gitignore-list section. No
  test exists for this skill — it's an LLM-driven scaffold — so
  verification is by re-reading the diff.)

- [ ] **Step 3: Commit.**

```bash
git add .gitignore skills/init-foundry/SKILL.md
git commit -m "chore(init): pre-add .snapshots/ to gitignore for phase 5"
```

## 5. Phase 2 acceptance criteria

- `npm test` passes end-to-end.
- `git grep "foundry/memory/relations"` returns no production hits
  (matches inside `CHANGELOG.md` historical entries are acceptable but
  none are expected in code or fixtures).
- `git grep "foundry-memory/"` shows references in `paths.js`,
  `git-policy.js`, the new init scaffold, fixtures, and the `.gitignore`.
- A fresh `foundry_memory_init` against an in-memory fixture creates
  both `foundry/memory/{config.md,schema.json,entities/,edges/}` and
  `foundry-memory/relations/.gitkeep`.
- `commitWithPolicy({ allowedPatterns: ['foundry/**'],
  extraAllowedPatterns: ['foundry-memory/**'] })` cleanly stages dirty
  files in either tree.

## 6. Out-of-scope reminders

- Branch guards on memory tools (Phase 4 wires `requireOnFlowBranch`
  onto `_memory_put`/`_relate`/`_unrelate` and `requireOnConfigBranch`
  onto memory-schema admin tools).
- Any data migration of pre-existing 2.x memory data: per spec §3,
  none. Memory ships fresh in 3.0.0.
- Snapshot writer / reader (Phase 5).
