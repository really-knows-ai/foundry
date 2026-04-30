# Phase 4 — `foundry_config_*` create/validate tools and full guard wiring

**Spec sections covered:** §5.2 (branch wiring), §5.3 (directory scope
end-to-end), §6 (full tool table), §7, §12.1 (skill rewrites), §12.2,
§12.3, §14.1, §14.3, §15.1, §15.2, §15.3, §15.7 config and work
workflow smoke tests
**Depends on:** Phase 1 (`guarded`, `branch-guard`), Phase 2
(`foundry-memory/` layout), Phase 3 (`foundry_git_branch({ kind: ... })`).
**Mergeable on its own:** yes. After this phase, the spec's full
invariant ("schema mutation only on `config/*`, data mutation only on
`work/*`") is enforced for all non-dry-run paths. Dry-run mode is still
a stub (Phase 5 finishes it).

---

## 1. Goal

1. Add ten new MCP tools — five `foundry_config_create_*` and five
   `foundry_config_validate_*` — covering artefact types, laws,
   appraisers, flows, and cycles. Each create tool produces one
   `commitWithPolicy`-managed commit per invocation.
2. Wire `requireOnConfigBranch` onto every config-tier mutation tool
   (the new ten plus the nine memory-schema tools and `_memory_init`,
   `_memory_reset`, `_memory_change_embedding_model`).
3. Wire `requireOnFlowBranch` onto every flow-tier mutation tool
   (`_memory_put`, `_memory_relate`, `_memory_unrelate`, plus the
   existing flow-execution tools listed in spec §6 row 2).
4. Rewrite the five `add-*` skills to call the new validate-then-create
   pair instead of using `Write`/`Edit` directly.
5. Add the `requireOnConfigBranch` preamble to the nine memory-schema
   skills and to `reset-memory`.

## 2. Spec mapping

- §6 tool guard table: every row in the "Config-tier mutation" and
  "Flow-tier mutation" sections is realised here.
- §7: per-tool create/validate semantics, commit message shape, the
  TOCTOU re-validate, the no-update rule, the existing-file refusal.
- §12.1: skills consume the new tools. No more direct file writes.
- §12.2/§12.3: skills' preambles updated to reference
  `foundry_git_branch({ kind: "config", description })`.

## 3. File map

### Create

- `scripts/lib/config-validators/artefact-type.js`
- `scripts/lib/config-validators/law.js`
- `scripts/lib/config-validators/appraiser.js`
- `scripts/lib/config-validators/flow.js`
- `scripts/lib/config-validators/cycle.js`

  Each exports `validate({ name, body, io }) → { ok, errors? }`.
- `scripts/lib/config-creators/artefact-type.js`
- `scripts/lib/config-creators/law.js`
- `scripts/lib/config-creators/appraiser.js`
- `scripts/lib/config-creators/flow.js`
- `scripts/lib/config-creators/cycle.js`

  Each exports `create({ name, body, io, execFile }) → { ok, path, sha }`
  and internally re-validates before write, then calls
  `commitWithPolicy`.
- `.opencode/plugins/foundry-tools/config-create-tools.js` — registers
  the ten new tools, wires `guarded()` with foundational + branch +
  failed-flow guards.
- `tests/lib/config-validators/<name>.test.js` × 5 — fixture tests.
- `tests/plugin/config-create-tools.test.js` — happy path, validator
  fail, TOCTOU, refusal on wrong branch, refusal on existing file.

### Modify

- `.opencode/plugins/foundry.js` (or wherever tools are aggregated) —
  register `createConfigCreateTools(...)`.
- `.opencode/plugins/foundry-tools/memory-admin-tools.js` — add
  branch guards (`requireOnConfigBranch`) to every gated tool. The
  failed-flow guard is already present after Phase 1.
- `.opencode/plugins/foundry-tools/memory-tools.js` — add
  `requireOnFlowBranch` to `_memory_put`, `_memory_relate`,
  `_memory_unrelate`.
- `.opencode/plugins/foundry-tools/orchestrate-tool.js`,
  `workfile-tools.js`, `feedback-tools.js`, `assay-tools.js`,
  `validate-tools.js`, `appraiser-tools.js`, `history-tools.js`,
  `stage-tools.js`, `artefact-tools.js` — add `requireOnFlowBranch` to
  the flow-tier mutation tools.
- All five `add-*` config skills — replace direct write steps with
  the new tool invocations.
- The nine memory-schema skills + `reset-memory` — add the
  `config/*` preamble matching Phase 3 Task 3.4.
- `CHANGELOG.md`.

### Plugin entry point

The plugin's top-level file likely composes tool registries; identify
it (`.opencode/plugins/foundry.js` per `package.json` `main`) and add
the new registry alongside existing `createConfigTools`,
`createMemoryAdminTools`, etc.

## 4. Architecture

### Validators

Each validator parses frontmatter and the body sections relevant to
runtime, returning a structured result. The contract is identical
across all five so the create-tool wrapper can stay thin.

```js
// scripts/lib/config-validators/<kind>.js
/**
 * @param {object} opts
 * @param {string} opts.name      Slugged identifier (e.g. flow id, law id)
 * @param {string} opts.body      Full markdown body (frontmatter + content)
 * @param {object} opts.io        Async IO with exists / readFile (used to
 *                                resolve cross-references — e.g. a cycle
 *                                referencing an artefact type that must
 *                                already exist).
 * @returns {Promise<{ok: true} | {ok: false, errors: string[]}>}
 */
export async function validate(opts) { ... }
```

Validation rules per kind (from spec §7):

- **artefact-type**: required frontmatter keys: `name`, `output-type`
  (string non-empty), `file-patterns` (array of glob strings,
  non-empty); body has `## Definition` section (existence only — prose
  not parsed).
- **law**: body parses into one or more `## <law-id>` blocks per the
  existing `parseLaws` shape in `scripts/lib/config.js`. At least one
  law id; ids unique within the body; `Passing:` and `Failing:` lines
  present in each law block.
- **appraiser**: required frontmatter: `name`, `voice` (string).
- **flow**: required frontmatter: `id` (matches `name` arg), `cycles`
  (array of cycle ids). Every cycle id must exist in
  `foundry/cycles/`.
- **cycle**: required frontmatter: `id` (matches `name` arg),
  `output-type` (artefact-type id, must exist),
  `input-types` (optional array of artefact-type ids; if present each
  must exist), `flow` (flow id, must exist). Body has
  `## Stages` section.

### Creators

```js
// scripts/lib/config-creators/<kind>.js
import { validate } from '../config-validators/<kind>.js';
import { commitWithPolicy } from '../git-bridge.js';

const PATHS = {
  // map kind -> path-builder(name) -> string under foundry/
};

export async function create({ name, body, io, execFile }) {
  // 1. Re-validate (TOCTOU).
  const v = await validate({ name, body, io });
  if (!v.ok) return { ok: false, errors: v.errors };

  const path = PATHS.<kind>(name);
  if (await io.exists(path)) {
    return { ok: false, errors: [`${path} already exists; updates are not supported in 3.0.0 — edit by hand on this config/* branch`] };
  }
  await io.mkdirp(dirname(path));
  await io.writeFile(path, body);

  const sha = commitWithPolicy({
    message: `config: add <kind> ${name}\n\nvia foundry_config_create_<kind>`,
    allowedPatterns: ['foundry/**'],
    execFile,
  });
  return { ok: true, path, sha };
}
```

Path map:

| kind            | path under `foundry/`                      |
|-----------------|--------------------------------------------|
| `artefact-type` | `artefacts/<name>/definition.md`           |
| `law`           | (operator-supplied via skill — see below)  |
| `appraiser`     | `appraisers/<name>.md`                     |
| `flow`          | `flows/<name>.md`                          |
| `cycle`         | `cycles/<name>.md`                         |

For `law`: the law-add skill currently lets the operator pick between
`foundry/laws/<file>.md` (global) and
`foundry/artefacts/<type>/laws.md` (type-specific). Make this an
explicit creator argument: `create({ name, body, target, io, execFile })`
where `target` is one of `{ kind: "global", file: <name>.md }` or
`{ kind: "type-specific", typeId: <id> }`. The MCP tool exposes both
shapes via a discriminated union arg.

### Commit-message convention

Per spec §7:

```
config: add <kind> <name>

via foundry_config_create_<kind>
```

Substitute `<kind>` with the human kind name (e.g. `law`, `flow`,
`cycle`, `artefact-type`, `appraiser`).

### Tool wiring

Each new MCP tool is composed as:

```js
execute: guarded('foundry_config_create_<kind>', [
    foundationalGitRepo,
    foundationalFoundryRoot,
    requireOnConfigBranch,
    notFailedGuard,           // (uses makeIO sync probe as in Phase 1)
  ],
  async (args, context) => {
    const io = makeAsyncIO(context.worktree);
    const execFile = (argv) => execFileSync('git', argv,
      { cwd: context.worktree, encoding: 'utf8', stdio: 'pipe' });
    const out = await create({ ...args, io, execFile });
    return JSON.stringify(out);
  });
```

The validators are:

```js
execute: guarded('foundry_config_validate_<kind>', [
    foundationalGitRepo,
    foundationalFoundryRoot,
  ],
  async (args, context) => {
    const io = makeAsyncIO(context.worktree);
    const out = await validate({ ...args, io });
    return JSON.stringify(out);
  });
```

The validate tools deliberately don't carry branch guards: validation
is read-only, runnable from anywhere (per spec §6 read-only row).

## 5. Tasks

### Task 4.1 — Validator: artefact-type

**Files:**
- Create: `scripts/lib/config-validators/artefact-type.js`
- Create: `tests/lib/config-validators/artefact-type.test.js`
- Create: `tests/lib/config-validators/fixtures/artefact-type/valid-basic.md`
- Create: `tests/lib/config-validators/fixtures/artefact-type/invalid-missing-output-type.md`

- [ ] **Step 1: Failing fixture test.**

```js
// tests/lib/config-validators/artefact-type.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validate } from '../../../scripts/lib/config-validators/artefact-type.js';

const fixture = (name) =>
  readFileSync(new URL(`./fixtures/artefact-type/${name}.md`, import.meta.url), 'utf8');

const passIO = { exists: async () => true, readFile: async () => '' };

test('artefact-type validator: minimal valid', async () => {
  const out = await validate({
    name: 'short-story',
    body: fixture('valid-basic'),
    io: passIO,
  });
  assert.deepEqual(out, { ok: true });
});

test('artefact-type validator: missing output-type', async () => {
  const out = await validate({
    name: 'short-story',
    body: fixture('invalid-missing-output-type'),
    io: passIO,
  });
  assert.equal(out.ok, false);
  assert.ok(out.errors.some((e) => /output-type/.test(e)));
});
```

Fixtures:

```markdown
<!-- valid-basic.md -->
---
name: short-story
output-type: short-story
file-patterns:
  - artefacts/short-story/*.md
---

## Definition

A short story.
```

```markdown
<!-- invalid-missing-output-type.md -->
---
name: short-story
file-patterns:
  - artefacts/short-story/*.md
---

## Definition

A short story.
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement.**

```js
// scripts/lib/config-validators/artefact-type.js
import { parseFrontmatter } from '../workfile.js';

export async function validate({ name, body }) {
  const errors = [];
  const fm = parseFrontmatter(body);
  if (!fm || typeof fm !== 'object') {
    errors.push('frontmatter is missing or unparseable');
    return { ok: false, errors };
  }
  if (typeof fm.name !== 'string' || !fm.name.trim())
    errors.push('frontmatter.name is required and must be a non-empty string');
  if (fm.name && fm.name !== name)
    errors.push(`frontmatter.name (${fm.name}) must match the supplied name (${name})`);
  if (typeof fm['output-type'] !== 'string' || !fm['output-type'].trim())
    errors.push('frontmatter.output-type is required and must be a non-empty string');
  if (!Array.isArray(fm['file-patterns']) || fm['file-patterns'].length === 0)
    errors.push('frontmatter.file-patterns is required and must be a non-empty array of glob strings');
  if (Array.isArray(fm['file-patterns']) &&
      fm['file-patterns'].some((p) => typeof p !== 'string' || !p.trim()))
    errors.push('every frontmatter.file-patterns entry must be a non-empty string');
  if (!/^##\s+Definition\s*$/m.test(body))
    errors.push('body must contain a "## Definition" section');
  return errors.length ? { ok: false, errors } : { ok: true };
}
```

- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit.**

```bash
git add scripts/lib/config-validators/artefact-type.js \
        tests/lib/config-validators/artefact-type.test.js \
        tests/lib/config-validators/fixtures/artefact-type
git commit -m "feat(config-validators): artefact-type"
```

### Task 4.2 — Validator: law

**Files:**
- Create: `scripts/lib/config-validators/law.js`
- Create: `tests/lib/config-validators/law.test.js`
- Create: `tests/lib/config-validators/fixtures/law/{valid-multi,invalid-no-passing}.md`

- [ ] **Step 1: Failing test.**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validate } from '../../../scripts/lib/config-validators/law.js';

const fx = (n) => readFileSync(new URL(`./fixtures/law/${n}.md`, import.meta.url), 'utf8');

test('law validator: multi-block valid', async () => {
  const out = await validate({ name: 'rules', body: fx('valid-multi') });
  assert.deepEqual(out, { ok: true });
});

test('law validator: missing Passing line', async () => {
  const out = await validate({ name: 'rules', body: fx('invalid-no-passing') });
  assert.equal(out.ok, false);
  assert.ok(out.errors.some((e) => /Passing:/.test(e)));
});

test('law validator: duplicate ids', async () => {
  const dup = `## a\nPassing: x\nFailing: y\n## a\nPassing: x\nFailing: y\n`;
  const out = await validate({ name: 'rules', body: dup });
  assert.equal(out.ok, false);
  assert.ok(out.errors.some((e) => /duplicate/.test(e)));
});

test('law validator: no laws at all', async () => {
  const out = await validate({ name: 'rules', body: '# empty\n' });
  assert.equal(out.ok, false);
  assert.ok(out.errors.some((e) => /at least one law/.test(e)));
});
```

Fixtures:

```markdown
<!-- valid-multi.md -->
## must-be-honest

Passing: states only verifiable claims.
Failing: includes claims it cannot back up.

## must-be-brief

Passing: under 200 words.
Failing: over 200 words.
```

```markdown
<!-- invalid-no-passing.md -->
## must-be-honest

Failing: includes claims it cannot back up.
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement.** Re-use the parsing shape from the existing
  `parseLaws` in `scripts/lib/config.js`:

```js
// scripts/lib/config-validators/law.js
export async function validate({ body }) {
  const errors = [];
  const blocks = [];
  let cur = null;
  for (const line of body.split('\n')) {
    const h = line.match(/^##\s+(.+?)\s*$/);
    if (h) {
      if (cur) blocks.push(cur);
      cur = { id: h[1], lines: [] };
      continue;
    }
    if (cur) cur.lines.push(line);
  }
  if (cur) blocks.push(cur);
  if (blocks.length === 0) {
    errors.push('at least one law (## <law-id> block) is required');
    return { ok: false, errors };
  }
  const seen = new Set();
  for (const b of blocks) {
    if (seen.has(b.id)) errors.push(`duplicate law id "${b.id}"`);
    seen.add(b.id);
    const text = b.lines.join('\n');
    if (!/^Passing:/m.test(text))
      errors.push(`law "${b.id}" is missing a "Passing:" line`);
    if (!/^Failing:/m.test(text))
      errors.push(`law "${b.id}" is missing a "Failing:" line`);
  }
  return errors.length ? { ok: false, errors } : { ok: true };
}
```

- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit.**

### Task 4.3 — Validator: appraiser

Apply the same pattern as Task 4.1: required frontmatter `name` and
`voice` (non-empty strings); body presence of `## Voice` section.
Provide one valid and one invalid fixture. Implement, test, commit.

- [ ] (Steps 1–5 identical pattern to 4.1.)

### Task 4.4 — Validator: flow

Required frontmatter: `id` (matches `name`), `cycles` (non-empty array
of strings). For each `cycles` entry, assert the corresponding cycle
file exists at `foundry/cycles/<id>.md` via `io.exists`. Provide a
fixture pair plus an `io` mock that simulates the cycle file existing
for the valid case and missing for the invalid case.

- [ ] (Steps 1–5 identical pattern.)

### Task 4.5 — Validator: cycle

Required frontmatter: `id` (matches `name`), `flow` (must reference an
existing flow at `foundry/flows/<flow>.md`), `output-type` (must
reference `foundry/artefacts/<id>/definition.md`), optional
`input-types` (each must reference an existing artefact type). Body
has `## Stages` section. Fixture pair, `io` mock, implement, commit.

- [ ] (Steps 1–5 identical pattern.)

### Task 4.6 — Creators (all five)

A single commit per creator. Each is a thin wrapper around its
validator + write + `commitWithPolicy`.

- [ ] **Step 1:** Write a single shared test fixture pattern in
  `tests/lib/config-creators/<kind>.test.js` covering:

  - happy path: validate-pass → write → commit (assert the commit
    message shape and the file path);
  - validator-fail path: returns errors, no write, no commit;
  - existing file refusal: file already exists, returns error, no
    overwrite, no commit.

  Use the test harness pattern from `tests/lib/git-bridge.test.js`
  (mock `execFile`, mock IO from `tests/helpers/mock-io.js`).

- [ ] **Step 2:** Implement each creator per the architecture
  above. The path-map and the `<kind>` token plug into the commit
  message.

- [ ] **Step 3:** Each creator gets one commit:

```bash
git commit -m "feat(config-creators): <kind>"
```

- [ ] **Step 4:** After all five, run `node --test
  tests/lib/config-creators` end-to-end.

### Task 4.7 — MCP tool registry: `config-create-tools.js`

**Files:**
- Create: `.opencode/plugins/foundry-tools/config-create-tools.js`
- Modify: `.opencode/plugins/foundry.js` (the plugin entry; register the
  new tool group).
- Create: `tests/plugin/config-create-tools.test.js`

- [ ] **Step 1: Failing integration test.**

```js
// tests/plugin/config-create-tools.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

function setupRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'foundry-cct-'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 't'], { cwd: dir });
  mkdirSync(join(dir, 'foundry'));
  mkdirSync(join(dir, 'foundry/artefacts'));
  mkdirSync(join(dir, 'foundry/laws'));
  mkdirSync(join(dir, 'foundry/cycles'));
  mkdirSync(join(dir, 'foundry/flows'));
  mkdirSync(join(dir, 'foundry/appraisers'));
  writeFileSync(join(dir, 'foundry/.gitkeep'), '');
  execFileSync('git', ['add', '.'], { cwd: dir });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: dir });
  return dir;
}

test('foundry_config_create_law: refuses on main', async () => {
  const dir = setupRepo();
  // ... call the tool through the plugin's registry helper, with
  // context.worktree = dir.
  const r = await invokeTool('foundry_config_create_law', {
    name: 'rules',
    body: '## one\nPassing: x\nFailing: y\n',
    target: { kind: 'global', file: 'rules.md' },
  }, dir);
  assert.equal(r.ok, false);
  assert.match(r.error, /requires a config\//);
});

test('foundry_config_create_law: happy path on config/x', async () => {
  const dir = setupRepo();
  execFileSync('git', ['checkout', '-q', '-b', 'config/init-laws'], { cwd: dir });
  const body = '## one\nPassing: a\nFailing: b\n';
  const r = await invokeTool('foundry_config_create_law', {
    name: 'rules',
    body,
    target: { kind: 'global', file: 'rules.md' },
  }, dir);
  assert.equal(r.ok, true);
  // File exists on disk:
  const onDisk = readFileSync(join(dir, 'foundry/laws/rules.md'), 'utf8');
  assert.equal(onDisk, body);
  // Exactly one new commit on this branch.
  const log = execFileSync('git', ['log', '--oneline'],
    { cwd: dir, encoding: 'utf8' }).trim().split('\n');
  assert.equal(log.length, 2);
  assert.match(log[0], /config: add law rules/);
});

test('foundry_config_create_law: refuses if target file exists', async () => {
  const dir = setupRepo();
  execFileSync('git', ['checkout', '-q', '-b', 'config/x'], { cwd: dir });
  writeFileSync(join(dir, 'foundry/laws/rules.md'), '## existing\nPassing: x\nFailing: y\n');
  const r = await invokeTool('foundry_config_create_law', {
    name: 'rules',
    body: '## new\nPassing: x\nFailing: y\n',
    target: { kind: 'global', file: 'rules.md' },
  }, dir);
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' '), /already exists/);
});
```

(The `invokeTool` helper is whatever the existing
`tests/plugin/*.test.js` files use to drive a tool's `execute`. If
none exists, factor one out from the existing `git-tools.test.js`
harness.)

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement** the registry. One tool per kind for
  `_create_*` and one per kind for `_validate_*`. Sample:

```js
// .opencode/plugins/foundry-tools/config-create-tools.js
import { execFileSync } from 'child_process';
import { guarded, notFailedGuard } from '../../../scripts/lib/guards.js';
import { requireGitRepo, requireFoundryRoot }
  from '../../../scripts/lib/foundational-guards.js';
import { requireOnConfigBranch } from '../../../scripts/lib/branch-guard.js';
import { makeIO, makeAsyncIO } from './helpers.js';
// ... per-kind validate/create imports

const gateNotFailed = notFailedGuard(makeIO);
const branchExec = (cwd) => (argv) => execFileSync(argv[0], argv.slice(1),
  { cwd, encoding: 'utf8', stdio: 'pipe' });
const branchIo = (cwd) => ({ exec: branchExec(cwd) });

function configBranchGuard(_args, context) {
  return requireOnConfigBranch(branchIo(context.worktree));
}
function gitRepoGuard(_args, context) {
  return requireGitRepo(makeIO(context.worktree));
}
function foundryRootGuard(_args, context) {
  return requireFoundryRoot(makeIO(context.worktree));
}

export function createConfigCreateTools({ tool }) {
  return {
    foundry_config_create_law: tool({
      description: 'Validate and create a law markdown file (single commit on config/*).',
      args: {
        name: tool.schema.string(),
        body: tool.schema.string(),
        target: tool.schema.union([
          tool.schema.object({
            kind: tool.schema.literal('global'),
            file: tool.schema.string(),
          }),
          tool.schema.object({
            kind: tool.schema.literal('type-specific'),
            typeId: tool.schema.string(),
          }),
        ]),
      },
      execute: guarded('foundry_config_create_law',
        [gitRepoGuard, foundryRootGuard, configBranchGuard, gateNotFailed],
        async (args, context) => {
          const io = makeAsyncIO(context.worktree);
          const exec = (argv) => execFileSync('git', argv,
            { cwd: context.worktree, encoding: 'utf8', stdio: 'pipe' });
          try {
            const out = await createLaw({ ...args, io, execFile: exec });
            return JSON.stringify(out);
          } catch (err) {
            return JSON.stringify({ ok: false, error: err.message });
          }
        }),
    }),
    foundry_config_validate_law: tool({
      description: 'Validate a law markdown body without writing.',
      args: {
        name: tool.schema.string(),
        body: tool.schema.string(),
      },
      execute: guarded('foundry_config_validate_law',
        [gitRepoGuard, foundryRootGuard],
        async (args, context) => {
          const io = makeAsyncIO(context.worktree);
          const out = await validateLaw({ ...args, io });
          return JSON.stringify(out);
        }),
    }),
    // ... repeat for artefact-type, appraiser, flow, cycle.
  };
}
```

`makeAsyncIO` is the existing helper used by other plugin tools; if
it's not yet exported from `helpers.js`, add it (it should mirror the
shape used by `admCreateEntity` and friends).

- [ ] **Step 4: Register the new group** in `.opencode/plugins/foundry.js`.
  Find the `Object.assign(tools, createConfigTools(...))` (or
  equivalent) call and add the new factory there.

- [ ] **Step 5: Run integration tests.**

```bash
node --test tests/plugin/config-create-tools.test.js
```

- [ ] **Step 6: Commit.**

```bash
git add .opencode/plugins/foundry-tools/config-create-tools.js \
        .opencode/plugins/foundry.js \
        tests/plugin/config-create-tools.test.js
git commit -m "feat(config-tools): create/validate tools for the 5 config kinds"
```

### Task 4.8 — Wire `requireOnConfigBranch` onto memory-schema admin

**Files:**
- Modify: `.opencode/plugins/foundry-tools/memory-admin-tools.js`
- Modify: `tests/plugin/memory-admin-tools.test.js`

- [ ] **Step 1: Failing test.** Add per-tool refusal-on-main cases. For
  each of the 11 currently-gated admin tools (`create_entity_type`,
  `create_edge_type`, `create_extractor`, `rename_entity_type`,
  `rename_edge_type`, `drop_entity_type`, `drop_edge_type`, `reset`,
  `init`, `vacuum`, `change_embedding_model`):

  - on `main` → returns `error` matching `/requires a config\//`;
  - on `config/foo` → existing happy-path test still green.

  `vacuum` is a special case per spec §6 ("Meta" row, allowed
  everywhere). It does **not** get `requireOnConfigBranch`. Confirm
  this is the case in the test (`vacuum` runs cleanly on main).

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement.** In `memory-admin-tools.js` add
  `configBranchGuard` to the guard array of every tool except
  `vacuum`, `dump`, and `validate` (the last two are read-only and
  carry no guards today).

```js
import { requireOnConfigBranch } from '../../../scripts/lib/branch-guard.js';
function configBranchGuard(_args, context) {
  return requireOnConfigBranch(/* branchIo */);
}

// Each previously-guarded tool's execute becomes:
execute: guarded('foundry_memory_create_entity_type',
  [gitRepoGuard, foundryRootGuard, configBranchGuard, gateNotFailed],
  async (args, context) => { /* unchanged body */ }),
```

`vacuum` keeps its existing guards (only `gateNotFailed`).

- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit.**

```bash
git add .opencode/plugins/foundry-tools/memory-admin-tools.js \
        tests/plugin/memory-admin-tools.test.js
git commit -m "feat(memory-admin): require config/* branch for schema mutation"
```

### Task 4.9 — Wire `requireOnFlowBranch` onto flow-tier tools

The flow-tier set per spec §6 row 2:

- `foundry_orchestrate`
- `foundry_workfile_create`, `_get`, `_delete`
- `foundry_artefacts_set_status`, `_list`
- `foundry_feedback_*` (every mutating action)
- `foundry_assay_run`
- `foundry_validate_run`
- `foundry_appraisers_select`
- `foundry_history_list` (read-only — see note below)
- `foundry_stage_begin`, `_end`
- `foundry_memory_put`, `_relate`, `_unrelate`

**Read-only callout:** `foundry_workfile_get`, `foundry_history_list`,
and the read-only `_artefacts_list` are **not** guarded by branch — they
appear in spec §6 row 3 (read-only) and can run anywhere. Cross-check
each tool against the table before adding the guard.

**Files:**
- Modify: each plugin file in the flow-tier list.
- Modify: tests in `tests/plugin/` for each.

- [ ] **Step 1: Failing-test sweep.** For each flow-tier mutation tool,
  add one case:

```js
test('<tool>: refuses on main', async () => {
  const dir = setupRepoOnMain();
  const r = await invokeTool('<tool>', {/* min args */}, dir);
  assert.match(r.error, /requires a work\//);
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement.** In each tool file:

```js
import { requireOnFlowBranch } from '../../../scripts/lib/branch-guard.js';
function flowBranchGuard(_args, context) {
  return requireOnFlowBranch(branchIo(context.worktree));
}
// Add flowBranchGuard to the guards array of each mutation tool.
```

- [ ] **Step 4: Run the full plugin suite.** Some long-running tests
  (`failed-flow-e2e.test.js`, `assay-e2e.test.js`,
  `orchestrate-integration.test.js`) likely set up their fixtures on
  `main` and never branch off. Update these fixtures to checkout a
  `work/<flow>-test` branch as part of setup. The fix is mechanical —
  add `git checkout -b work/test-x` to the test's existing setup helper
  and re-run.

- [ ] **Step 5: Commit per file** to keep diffs small:

```bash
git add .opencode/plugins/foundry-tools/orchestrate-tool.js tests/...
git commit -m "feat(orchestrate): require flow branch"
# repeat per file
```

- [ ] **Step 6: After the sweep, full-suite check.**

```bash
npm test
```

### Task 4.10 — Rewrite the five `add-*` skills' write steps

Each skill currently ends with a "write the file" step using `Write` /
`Edit`. Replace those steps with explicit invocations of
`foundry_config_validate_<kind>` (loop until ok) followed by
`foundry_config_create_<kind>`.

**Files:**
- Modify: `skills/add-law/SKILL.md`
- Modify: `skills/add-flow/SKILL.md`
- Modify: `skills/add-cycle/SKILL.md`
- Modify: `skills/add-appraiser/SKILL.md`
- Modify: `skills/add-artefact-type/SKILL.md`

For each, the "Write" step becomes:

```markdown
### N. Validate the draft

Call `foundry_config_validate_<kind>({ name: "<name>", body: "<full markdown>" })`.

If the result is `{ ok: false, errors: [...] }`, address each error
(adjust the body) and re-run until you get `{ ok: true }`. Common
issues: missing required frontmatter keys, references to artefact
types or flows that don't exist yet.

### N+1. Create the file

Call `foundry_config_create_<kind>({ name, body, ... })`. The tool:

- re-validates the body (TOCTOU);
- writes `foundry/<path-for-kind>`;
- produces one git commit on the current `config/*` branch.

If the tool returns `{ ok: false, errors }` because the target file
already exists, the user should edit the file by hand on this
`config/*` branch — `foundry_config_create_*` does not support updates.

Show the user the resulting commit hash from the response.
```

For the `law` skill specifically, the create call carries the `target`
discriminated union:

```markdown
foundry_config_create_law({
  name: "<file-name-without-extension>",
  body: <full markdown>,
  target: { kind: "global", file: "<file-name>.md" }   // OR
           { kind: "type-specific", typeId: "<artefact-type>" }
})
```

- [ ] **Step 1:** Apply the skill rewrites.
- [ ] **Step 2:** Self-check: read each rewritten skill end-to-end and
  confirm the "What you do NOT do" section still makes sense given
  that `Write` is no longer the write mechanism.
- [ ] **Step 3:** Commit (one per skill file).

### Task 4.11 — Memory-schema and `reset-memory` skill preambles

Add the same `config/*` preamble (from Phase 3 Task 3.4) to each of:

- `skills/add-memory-entity-type/SKILL.md`
- `skills/add-memory-edge-type/SKILL.md`
- `skills/rename-memory-entity-type/SKILL.md`
- `skills/rename-memory-edge-type/SKILL.md`
- `skills/drop-memory-entity-type/SKILL.md`
- `skills/drop-memory-edge-type/SKILL.md`
- `skills/change-embedding-model/SKILL.md`
- `skills/init-memory/SKILL.md`
- `skills/add-extractor/SKILL.md`
- `skills/reset-memory/SKILL.md`

These skills already reach into `foundry_memory_*` MCP tools (no
direct file writes), so only the **prerequisites** prose changes.

- [ ] **Step 1:** Read each skill, find the existing prerequisites
  block, replace it with the canonical preamble from Phase 3 Task 3.4.
- [ ] **Step 2:** Spot-check by re-reading.
- [ ] **Step 3:** Commit.

```bash
git add skills/add-memory-entity-type/SKILL.md \
        skills/add-memory-edge-type/SKILL.md \
        skills/rename-memory-entity-type/SKILL.md \
        skills/rename-memory-edge-type/SKILL.md \
        skills/drop-memory-entity-type/SKILL.md \
        skills/drop-memory-edge-type/SKILL.md \
        skills/change-embedding-model/SKILL.md \
        skills/init-memory/SKILL.md \
        skills/add-extractor/SKILL.md \
        skills/reset-memory/SKILL.md
git commit -m "docs(skills): memory-schema and reset-memory require config/*"
```

### Task 4.12 — CHANGELOG entry

Add to `[Unreleased] ### Breaking`:

```
- Schema/config mutation now requires a `config/*` branch.
  Affected tools: foundry_config_create_artefact_type/_law/_appraiser/
  _flow/_cycle (new), foundry_memory_create_entity_type/_create_edge_type/
  _rename_entity_type/_rename_edge_type/_drop_entity_type/_drop_edge_type,
  foundry_extractor_create, foundry_memory_init, foundry_memory_reset,
  foundry_memory_change_embedding_model. All refuse on any branch other
  than config/<description>.
- Flow-data mutation now requires a `work/*` or `dry-run/*/*`
  branch. Affected tools: foundry_orchestrate, foundry_workfile_create/
  _delete, foundry_artefacts_set_status, foundry_feedback_* (mutating
  variants), foundry_assay_run, foundry_validate_run,
  foundry_appraisers_select, foundry_stage_begin/_end, foundry_memory_put/
  _relate/_unrelate.
- Five new `foundry_config_validate_*` and five new
  `foundry_config_create_*` tools (artefact-type, law, appraiser, flow,
  cycle). The five `add-*` config skills now use these instead of writing
  files directly. Each create produces one git commit per invocation.
- Updates (editing existing config files) are not yet exposed as MCP
  tools; operators edit by hand on the current config/* branch.
```

- [ ] Commit:

```bash
git add CHANGELOG.md
git commit -m "docs(changelog): config-tier and flow-tier branch wiring"
```

## 6. Phase 4 acceptance criteria

- `npm test` is green.
- Every config-tier tool refuses on `main` with a message naming the
  branch and pointing at `foundry_git_branch({ kind: "config", ... })`.
- Every flow-tier tool refuses on `main` and on `config/<x>` with a
  message naming the branch and pointing at the right
  `foundry_git_branch` invocation.
- A fresh repo can run the spec §15.7 "Config workflow" smoke test:
  branch `config/x` → call `_create_law` → finish → law on main.
- A fresh repo can run the spec §15.7 "Work workflow" smoke test:
  branch `work/<flow>-x` → run a tiny flow → finish → artefacts on
  main. (Memory writes go to `foundry-memory/` per Phase 2.)
- The five `add-*` skills have no `Write` or `Edit` calls in their
  steps; only `foundry_config_validate_*` and `foundry_config_create_*`.

## 7. Out-of-scope reminders

- Dry-run mode is still a stub. `foundry_git_branch({ kind: "dry-run", ... })`
  works (Phase 3) and lands you on a `dry-run/<x>/<y>` branch
  where the flow-tier guards admit you, but `foundry_git_finish` on
  that branch still returns the Phase 3 stub error. Phase 5 finishes
  this.
- No `foundry_config_update_*` tools (spec §17). Operators editing
  existing config files do so by hand on `config/*`.
- Tracing (§10) is not yet attached to `guarded()`. Phase 5.
