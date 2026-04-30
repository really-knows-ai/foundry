# Phase 5 — Dry-run mode: tracing, snapshots, and the `dry-run` skill

**Spec sections covered:** §1 (third namespace), §4 (deeper-nesting
refusal), §5.2 strict `requireOnConfigBranch`, §6 (`foundry_snapshot_*`
row + `_git_finish` dry-run cell), §9, §10, §11 (all sub-sections),
§12.4, §13, §14.1 nested-config refusal, §14.4 dry-run failure modes,
§14.5, §15.6, §15.7 dry-run smoke, §16 (final BREAKING entries).
**Depends on:** Phase 1 (`guarded()` is the seam tracing attaches to;
strict `requireOnConfigBranch` is already in place), Phase 2
(`foundry-memory/` is part of the diff), Phase 3 (`foundry_git_branch`
already creates dry-run branches; `foundry_git_finish` already
dispatches to a stub), Phase 4 (config-tier guards refuse dry-run
branches by virtue of the strict regex).
**Mergeable on its own:** yes. After this phase, the spec is
complete: all §16 BREAKING entries are realised and `npm test` covers
the dry-run smoke flow.

---

## 1. Goal

1. Wire verbose tool-call tracing into `guarded()` so every
   `foundry_*` invocation on a dry-run branch appends a JSONL record to
   `.foundry/trace/<branch-slug>.jsonl`.
2. Truncate the trace file at dry-run branch creation
   (`foundry_git_branch({ kind: "dry-run", ... })`).
3. Replace the `finishDryRunStub` placeholder added in Phase 3 with the
   real snapshot-and-discard handler (§11.3 sequence).
4. Add four `foundry_snapshot_*` MCP tools (`_list`, `_show`, `_delete`,
   `_prune`) per spec §11.6.
5. Author the new `dry-run` skill per spec §12.4.
6. Final CHANGELOG and doc updates per §16.

## 2. Spec mapping

- §10: trace records of shape `{ ts, tool, args, result, duration_ms }`,
  one per `foundry_*` tool invocation. Triggered only when
  `currentBranch` matches the dry-run regex.
- §11.1: snapshot path is `.snapshots/<branch-slug>-<ulid>/`. The
  `<ulid>` comes from `scripts/lib/ulid.js`.
- §11.2: snapshot contents — `README.md`, `work/WORK*`, `diff.patch`
  (`git diff config/<x>...HEAD`), `trace.jsonl`.
- §11.3: ten-step sequence; checkout parent before write; force-delete
  dry-run branch; truncate trace; do not stage anything.
- §11.5: failure modes including partial-write recovery; the dry-run
  branch is preserved if step 7 fails.
- §11.6: four snapshot tools, all branch-guard-free meta tools.

## 3. File map

### Create

- `scripts/lib/tracing.js` — `appendTraceRecord(branch, record, io)` and
  `truncateTrace(branch, io)`. Pure logic; takes io.
- `scripts/lib/snapshot/finish.js` — orchestrates the §11.3 sequence.
- `scripts/lib/snapshot/render.js` — generates the README from
  metadata.
- `scripts/lib/snapshot/inspect.js` — list/show/delete/prune logic
  shared by the four MCP tools.
- `.opencode/plugins/foundry-tools/snapshot-tools.js` — registers the
  four MCP tools.
- `tests/lib/tracing.test.js`
- `tests/lib/snapshot/finish.test.js`
- `tests/lib/snapshot/inspect.test.js`
- `tests/plugin/snapshot-tools.test.js`
- `tests/plugin/dry-run-e2e.test.js` — end-to-end smoke from §15.7.
- `skills/dry-run/SKILL.md`

### Modify

- `scripts/lib/guards.js` — add a tracing wrapper around the
  `execute` returned by `guarded()`. Off when not on a dry-run branch.
- `.opencode/plugins/foundry-tools/git-tools.js` — replace
  `finishDryRunStub` with the real handler; truncate trace on dry-run
  branch creation in `foundry_git_branch`.
- `.opencode/plugins/foundry.js` — register
  `createSnapshotTools(...)`.
- `CHANGELOG.md` — final BREAKING entries (snapshot tools, tracing,
  `.snapshots/`).
- `docs/concepts.md`, `docs/getting-started.md`, `docs/tools.md`,
  `README.md` — documentation updates listed in spec §16.

## 4. Architecture

### Trace records

```js
// scripts/lib/tracing.js
//
// Appended in two halves:
//   - "before" record (currently unused — single record at the end is
//     simpler and preserves the result/error in the same line). We emit
//     ONE record per tool call, after the body returns or throws,
//     containing args, result-or-error, and duration_ms.
//
// Record shape (one JSONL line per tool call):
//   { ts: ISO_8601_string, tool, args, result | error, duration_ms }
//
// Path: .foundry/trace/<branch-slug>.jsonl
//   <branch-slug> = current branch with '/' replaced by '-'.
//
// Off-branch: tracing is not invoked; this module's helpers are not
// called.

export function branchSlug(branchName) {
  return branchName.replace(/\//g, '-');
}

/**
 * @param {string} branch    current branch name (must be a dry-run branch)
 * @param {object} record    fully-formed trace record (caller adds ts/duration)
 * @param {object} io        async io with `mkdirp`, `appendFile` (or readFile/writeFile fallback)
 */
export async function appendTraceRecord({ branch, record, io }) {
  const slug = branchSlug(branch);
  const dir = '.foundry/trace';
  const file = `${dir}/${slug}.jsonl`;
  await io.mkdirp(dir);
  const line = JSON.stringify(record) + '\n';
  if (typeof io.appendFile === 'function') {
    await io.appendFile(file, line);
  } else {
    const existing = (await io.exists(file)) ? await io.readFile(file) : '';
    await io.writeFile(file, existing + line);
  }
}

export async function truncateTrace({ branch, io }) {
  const slug = branchSlug(branch);
  const file = `.foundry/trace/${slug}.jsonl`;
  if (await io.exists(file)) await io.writeFile(file, '');
}
```

### Tracing seam in `guarded()`

The wrapper checks the current branch lazily — only on the first
guard invocation per call — and decides whether to record. The branch
check is one `git rev-parse --abbrev-ref HEAD`, cheap and already done
by `currentBranch`.

```js
// scripts/lib/guards.js  (extended)
import { branchSlug, appendTraceRecord } from './tracing.js';

const DRY_RUN_RE = /^config\/[^/]+\/dry-run\/[^/]+$/;

export function guarded(toolName, guards, execute, opts = {}) {
  // opts.branchIo: factory(context) -> { exec(argv) -> stdout }
  // opts.io:       factory(context) -> async fs IO with mkdirp/writeFile/appendFile
  // Both factories optional; production wires them through the plugin
  // helpers, tests inject fakes.

  return async (args, context) => {
    for (const g of guards) {
      const r = await g(args, context);
      if (!r.ok) return JSON.stringify({ error: `${toolName}: ${r.error}` });
    }

    const branch = opts.branchIo
      ? safeBranch(opts.branchIo(context))
      : null;
    const trace = branch && DRY_RUN_RE.test(branch);
    const ts = new Date().toISOString();
    const t0 = Date.now();
    let result; let error;
    try {
      result = await execute(args, context);
    } catch (e) {
      error = e;
    }
    if (trace && opts.io) {
      const record = {
        ts,
        tool: toolName,
        args: scrub(args),
        ...(error
          ? { error: error.message ?? String(error) }
          : { result: parseResultMaybeJson(result) }),
        duration_ms: Date.now() - t0,
      };
      try {
        await appendTraceRecord({ branch, record, io: opts.io(context) });
      } catch { /* tracing must never break the tool call */ }
    }
    if (error) throw error;
    return result;
  };
}

function safeBranch(io) {
  try {
    const out = io.exec(['git', 'rev-parse', '--abbrev-ref', 'HEAD']).trim();
    return out === 'HEAD' ? null : out;
  } catch { return null; }
}

function parseResultMaybeJson(s) {
  if (typeof s !== 'string') return s;
  try { return JSON.parse(s); } catch { return s; }
}

function scrub(args) {
  // Avoid recording large bodies in trace — they balloon the file.
  // Trim any string > 4KB to a head/tail summary.
  if (!args || typeof args !== 'object') return args;
  const out = {};
  for (const [k, v] of Object.entries(args)) {
    if (typeof v === 'string' && v.length > 4096) {
      out[k] = v.slice(0, 256) + `...(${v.length - 512} chars elided)...` + v.slice(-256);
    } else out[k] = v;
  }
  return out;
}
```

The `opts.branchIo` and `opts.io` factories are wired by the plugin
helpers so the tracing layer never has to know about
`execFileSync` directly.

### Snapshot finish

```js
// scripts/lib/snapshot/finish.js
//
// Implements §11.3 step-by-step. All filesystem access goes through io.
// All git access goes through execFile so the orchestrator can drive a
// process-injected shim in tests.

import { ulid } from '../ulid.js';
import { branchSlug } from '../tracing.js';
import { renderReadme } from './render.js';

export async function finishDryRun({ message, branch, io, execFile }) {
  // 1. Verify clean tree.
  const dirty = execFile(['status', '--porcelain', '--untracked-files=no']).trim();
  if (dirty) {
    return {
      ok: false,
      error: 'foundry_git_finish refuses to run on a dirty worktree (uncommitted changes to tracked files). Commit or stash them first.',
      dirty: dirty.split('\n').map((l) => l.slice(3)),
    };
  }

  // 2. Compute parent config branch from the dry-run branch name.
  const parent = branch.replace(/\/dry-run\/.+$/, '');
  if (!/^config\/[^/]+$/.test(parent)) {
    return { ok: false, error: `cannot derive parent config branch from '${branch}'` };
  }

  // 3. Capture diff (three-dot per §11.2 rationale).
  const diffPatch = execFile(['diff', `${parent}...HEAD`]);

  // 4. Capture WORK files.
  const workCapture = {};
  for (const f of ['WORK.md', 'WORK.history.yaml', 'WORK.feedback.yaml']) {
    if (await io.exists(f)) workCapture[f] = await io.readFile(f);
  }

  // 5. Capture trace.
  const slug = branchSlug(branch);
  const traceFile = `.foundry/trace/${slug}.jsonl`;
  const traceText = (await io.exists(traceFile)) ? await io.readFile(traceFile) : '';

  // 6. Build runId.
  const runId = `${slug}-${ulid()}`;
  const snapDir = `.snapshots/${runId}`;

  // 7. Render README.
  const readme = renderReadme({
    branch, parent, message,
    workfile: workCapture['WORK.md'] ?? '',
    traceText,
  });

  // 8. Checkout parent.
  execFile(['checkout', parent]);

  // 9. Materialise snapshot directory. Best-effort partial-write recovery:
  //    every individual writeFile may throw; if any do, we abort and the
  //    dry-run branch is still alive, so retry is safe (§11.5).
  await io.mkdirp(`${snapDir}/work`);
  await io.writeFile(`${snapDir}/README.md`, readme);
  for (const [name, body] of Object.entries(workCapture)) {
    await io.writeFile(`${snapDir}/work/${name}`, body);
  }
  await io.writeFile(`${snapDir}/diff.patch`, diffPatch);
  await io.writeFile(`${snapDir}/trace.jsonl`, traceText);

  // 10. Force-delete dry-run branch. Truncate trace file.
  execFile(['branch', '-D', branch]);
  if (await io.exists(traceFile)) await io.writeFile(traceFile, '');

  return { ok: true, runId, snapshotPath: snapDir, branch: parent };
}
```

`renderReadme` is straightforward Markdown templating; see Task 5.4.

### Snapshot inspection

```js
// scripts/lib/snapshot/inspect.js — sketch
export async function listSnapshots({ io }) { ... }
export async function showSnapshot({ runId, io }) { ... }
export async function deleteSnapshot({ runId, io }) { ... }
export async function pruneSnapshots({ olderThanDays, io, now }) { ... }
```

Each parses the README's frontmatter (or top-of-file metadata) for
`branch`, `parent`, `flow`, `goal`, `startedAt`, `finishedAt`,
`exitReason`. The README format from `renderReadme` uses YAML
frontmatter so `parseFrontmatter` from `scripts/lib/workfile.js` can be
re-used. Missing-file handling per §11.5: `_list` returns
`error: "incomplete"` when README is missing or unparseable;
`_show` reports `missing: ["README.md", ...]` listing absent files.

`olderThanDays` is checked against the ULID's encoded time prefix —
the first ten Crockford-base32 chars decode to a 48-bit ms-since-epoch
timestamp. Implement a small `decodeUlidTime(ulid)` in
`scripts/lib/ulid.js` (extension to the existing module) so the prune
logic can avoid filesystem stat entirely.

## 5. Tasks

### Task 5.1 — Trace module + unit tests

**Files:**
- Create: `scripts/lib/tracing.js`
- Create: `tests/lib/tracing.test.js`

- [ ] **Step 1: Failing test.**

```js
// tests/lib/tracing.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { branchSlug, appendTraceRecord, truncateTrace }
  from '../../scripts/lib/tracing.js';

function memIo() {
  const fs = new Map();
  return {
    fs,
    exists: async (p) => fs.has(p),
    readFile: async (p) => fs.get(p) ?? '',
    writeFile: async (p, c) => fs.set(p, c),
    appendFile: async (p, c) => fs.set(p, (fs.get(p) ?? '') + c),
    mkdirp: async (_) => {},
  };
}

test('branchSlug: replaces / with -', () => {
  assert.equal(branchSlug('dry-run/foo/bar-baz'),
    'config-foo-dry-run-bar-baz');
});

test('appendTraceRecord: appends JSONL line', async () => {
  const io = memIo();
  await appendTraceRecord({
    branch: 'dry-run/foo/x-y',
    record: { ts: '2026-01-01T00:00:00.000Z', tool: 'foundry_x' },
    io,
  });
  const f = io.fs.get('.foundry/trace/config-foo-dry-run-x-y.jsonl');
  assert.equal(f, '{"ts":"2026-01-01T00:00:00.000Z","tool":"foundry_x"}\n');
});

test('truncateTrace: empties existing file', async () => {
  const io = memIo();
  io.fs.set('.foundry/trace/config-foo-dry-run-x-y.jsonl', '{}\n{}\n');
  await truncateTrace({ branch: 'dry-run/foo/x-y', io });
  assert.equal(io.fs.get('.foundry/trace/config-foo-dry-run-x-y.jsonl'), '');
});
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** `scripts/lib/tracing.js` per §4 above.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit.**

```bash
git add scripts/lib/tracing.js tests/lib/tracing.test.js
git commit -m "feat(tracing): JSONL trace appender for dry-run branches"
```

### Task 5.2 — Wire tracing into `guarded()`

**Files:**
- Modify: `scripts/lib/guards.js`
- Modify: `tests/lib/guards.test.js`

- [ ] **Step 1: Failing test.**

```js
// tests/lib/guards.test.js — add
test('guarded: traces tool calls on dry-run branches', async () => {
  const records = [];
  const io = {
    mkdirp: async () => {},
    exists: async () => false,
    appendFile: async (p, line) => records.push({ p, line }),
    writeFile: async () => {},
    readFile: async () => '',
  };
  const branchIo = { exec: () => 'dry-run/foo/x-y\n' };
  const wrapped = guarded('foundry_x',
    [() => ({ ok: true })],
    async () => '{"ok":true}',
    { branchIo: () => branchIo, io: () => io });
  const out = await wrapped({ a: 1 }, {});
  assert.equal(out, '{"ok":true}');
  assert.equal(records.length, 1);
  const rec = JSON.parse(records[0].line);
  assert.equal(rec.tool, 'foundry_x');
  assert.deepEqual(rec.args, { a: 1 });
  assert.deepEqual(rec.result, { ok: true });
  assert.ok(typeof rec.duration_ms === 'number');
});

test('guarded: does NOT trace on work/* branches', async () => {
  const records = [];
  const io = { appendFile: async (_, l) => records.push(l), mkdirp: async () => {} };
  const branchIo = { exec: () => 'work/foo-bar\n' };
  const wrapped = guarded('foundry_x',
    [() => ({ ok: true })],
    async () => 'X',
    { branchIo: () => branchIo, io: () => io });
  await wrapped({}, {});
  assert.equal(records.length, 0);
});
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Extend** `scripts/lib/guards.js` per §4 sketch.
- [ ] **Step 4: Run, expect PASS** (also re-run existing
  `tests/lib/guards.test.js` cases to confirm no regression).
- [ ] **Step 5: Commit.**

```bash
git add scripts/lib/guards.js tests/lib/guards.test.js
git commit -m "feat(guards): trace tool calls on dry-run branches"
```

### Task 5.3 — Plugin wiring of `branchIo` and `io` factories

The `guarded()` helper now takes optional `branchIo` and `io` factories.
Wire them through the central plugin helpers so every tool that calls
`guarded(name, guards, exec)` gets tracing without per-tool changes.

**Files:**
- Modify: `.opencode/plugins/foundry-tools/helpers.js` — export
  `branchIoFactory` and `asyncIoFactory` if not already.
- Modify: every plugin tool file that calls `guarded(...)` — add
  `, { branchIo: branchIoFactory, io: asyncIoFactory }` to each
  invocation.

The change is mechanical and should be one commit per file. Re-run
each file's tests after each change. Many tests are agnostic to
`branch-io` since their fixture branch is `main` (so tracing is a
no-op).

- [ ] **Sub-tasks 5.3.a–5.3.k**, one per plugin tool file from Phase 1
  Task 1.5 plus `memory-admin-tools.js` and the new
  `config-create-tools.js` / `snapshot-tools.js` once they're
  registered.

  For each: edit, run the file's existing tests, expect green, commit.

### Task 5.4 — Snapshot README renderer

**Files:**
- Create: `scripts/lib/snapshot/render.js`
- Create: `tests/lib/snapshot/render.test.js`

The README uses YAML frontmatter so `parseFrontmatter` can recover the
metadata from `_snapshot_list` / `_snapshot_show`.

- [ ] **Step 1: Failing test.**

```js
// tests/lib/snapshot/render.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderReadme } from '../../../scripts/lib/snapshot/render.js';

test('renderReadme: contains frontmatter and body', () => {
  const md = renderReadme({
    branch: 'dry-run/foo/flow-x-goal',
    parent: 'config/foo',
    message: 'tested the new law',
    workfile: '---\nflow: flow-x\ngoal: write a thing\nstatus: done\n---\n',
    traceText: '{"ts":"2026-04-29T10:00:00.000Z"}\n{"ts":"2026-04-29T10:01:23.000Z"}\n',
  });
  // Frontmatter contains structured metadata
  assert.match(md, /^---\n/);
  assert.match(md, /branch: config\/foo\/dry-run\/flow-x-goal/);
  assert.match(md, /parent: config\/foo/);
  assert.match(md, /flow: flow-x/);
  assert.match(md, /exitReason: done/);
  assert.match(md, /startedAt: 2026-04-29T10:00:00\.000Z/);
  assert.match(md, /finishedAt: 2026-04-29T10:01:23\.000Z/);
  // Body contains the human message.
  assert.match(md, /tested the new law/);
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement.**

```js
// scripts/lib/snapshot/render.js
import { parseFrontmatter } from '../workfile.js';

function firstAndLastTraceTs(traceText) {
  const lines = traceText.split('\n').filter(Boolean);
  if (!lines.length) return { startedAt: null, finishedAt: null };
  const first = JSON.parse(lines[0]).ts;
  const last  = JSON.parse(lines[lines.length - 1]).ts;
  return { startedAt: first, finishedAt: last };
}

export function renderReadme({ branch, parent, message, workfile, traceText }) {
  const fm = parseFrontmatter(workfile) || {};
  const { startedAt, finishedAt } = firstAndLastTraceTs(traceText);
  const flow = fm.flow ?? null;
  const goal = fm.goal ?? null;
  const exitReason = fm.status ?? 'unknown';
  const meta = [
    '---',
    `branch: ${branch}`,
    `parent: ${parent}`,
    `flow: ${flow}`,
    `goal: ${goal !== null ? JSON.stringify(goal) : 'null'}`,
    `startedAt: ${startedAt}`,
    `finishedAt: ${finishedAt}`,
    `exitReason: ${exitReason}`,
    '---',
  ].join('\n');
  return `${meta}\n\n# Dry-run snapshot\n\n${message}\n`;
}
```

- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit.**

### Task 5.5 — Dry-run finish handler

**Files:**
- Create: `scripts/lib/snapshot/finish.js`
- Create: `tests/lib/snapshot/finish.test.js`

- [ ] **Step 1: Failing test using a real git tmpdir.**

```js
// tests/lib/snapshot/finish.test.js
// Drive a real git repo: init, branch config/foo, branch
// dry-run/foo/x-y, write a fake artefact, commit, then call
// finishDryRun and assert the .snapshots/ tree.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { finishDryRun } from '../../../scripts/lib/snapshot/finish.js';
import { realFsIo } from '../helpers/real-fs-io.js'; // small helper, see below

test('finishDryRun: writes complete snapshot, deletes branch, returns to parent', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'foundry-dryrun-'));
  const git = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', stdio: 'pipe' }).trim();
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 't');
  // Some content on main:
  require('fs').writeFileSync(join(dir, 'README.md'), '# initial\n');
  git('add', '.'); git('commit', '-qm', 'init');
  git('checkout', '-q', '-b', 'config/foo');
  // Create a fake dry-run branch with a flow output:
  git('checkout', '-q', '-b', 'dry-run/foo/flow-x-y');
  require('fs').writeFileSync(join(dir, 'WORK.md'), '---\nflow: flow-x\ngoal: g\nstatus: done\n---\n');
  require('fs').writeFileSync(join(dir, '.foundry/trace/config-foo-dry-run-flow-x-y.jsonl'), '');
  // (The trace file would normally have records; an empty file is
  //  valid per §11.5 — README will note 0-length trace.)
  git('add', '-A'); git('commit', '-qm', 'work');

  const r = await finishDryRun({
    message: 'tested it',
    branch: 'dry-run/foo/flow-x-y',
    io: realFsIo(dir),
    execFile: (argv) => execFileSync('git', argv, { cwd: dir, encoding: 'utf8', stdio: 'pipe' }),
  });

  assert.equal(r.ok, true);
  assert.equal(r.branch, 'config/foo');
  assert.match(r.snapshotPath, /^\.snapshots\/config-foo-dry-run-flow-x-y-[0-9A-HJ-NP-TV-Z]{26}$/);
  // Files exist on disk:
  const snap = join(dir, r.snapshotPath);
  assert.ok(existsSync(join(snap, 'README.md')));
  assert.ok(existsSync(join(snap, 'work/WORK.md')));
  assert.ok(existsSync(join(snap, 'diff.patch')));
  assert.ok(existsSync(join(snap, 'trace.jsonl')));
  // Branch deleted:
  const branches = git('branch', '--list').split('\n').map((s) => s.trim().replace(/^\*\s*/, ''));
  assert.ok(!branches.includes('dry-run/foo/flow-x-y'));
  // We are on parent:
  assert.equal(git('branch', '--show-current'), 'config/foo');
});

test('finishDryRun: dirty tree refused, dry-run branch preserved', async () => { /* similar setup, leave a dirty file, assert ok:false and no snapshot dir created and dry-run branch still exists */ });
```

The helper `tests/lib/helpers/real-fs-io.js` mirrors the
`makeMemoryIO` shape but talks to the real filesystem; about 30 lines.

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** per §4 sketch.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit.**

```bash
git add scripts/lib/snapshot/finish.js scripts/lib/snapshot/render.js \
        tests/lib/snapshot/finish.test.js tests/lib/snapshot/render.test.js \
        tests/lib/helpers/real-fs-io.js
git commit -m "feat(snapshot): finishDryRun writes snapshot and discards branch"
```

### Task 5.6 — Replace the `finishDryRunStub` in `git-tools.js`

**Files:**
- Modify: `.opencode/plugins/foundry-tools/git-tools.js`

- [ ] **Step 1: Failing test.** Update the Phase 3 stub test (in
  `tests/plugin/git-finish-config-mode.test.js`) to assert success on
  a dry-run finish — the assertion shape mirrors Task 5.5 but goes
  through the MCP tool instead of the underlying lib call.

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement.** Replace `finishDryRunStub()` with a thin
  wrapper around `finishDryRun(...)`:

```js
import { finishDryRun } from '../../../scripts/lib/snapshot/finish.js';
import { makeAsyncIO } from './helpers.js';

async function finishDryRunBranch({ branch, args, cwd }) {
  const io = makeAsyncIO(cwd);
  const exec = (argv) => execFileSync('git', argv,
    { cwd, encoding: 'utf8', stdio: 'pipe' });
  if (args.confirm !== true) {
    return JSON.stringify({
      ok: false,
      error: 'foundry_git_finish requires {confirm: true} ...',
      planned: { branch, action: 'snapshot + discard (dry-run finish)' },
    });
  }
  const out = await finishDryRun({ message: args.message, branch, io, execFile: exec });
  return JSON.stringify(out);
}
```

  In the `foundry_git_finish` execute, replace the
  `finishDryRunStub()` line with `await finishDryRunBranch({ branch,
  args, cwd })`.

- [ ] **Step 4:** Run all of `tests/plugin/git-tools.test.js`,
  `tests/plugin/git-finish-config-mode.test.js` — expect PASS.

- [ ] **Step 5: Commit.**

```bash
git add .opencode/plugins/foundry-tools/git-tools.js \
        tests/plugin/git-finish-config-mode.test.js
git commit -m "feat(git-tools): real dry-run finish handler (snapshot + discard)"
```

### Task 5.7 — Truncate trace at dry-run branch creation

**Files:**
- Modify: `.opencode/plugins/foundry-tools/git-tools.js`

- [ ] **Step 1: Failing test** — extend the `kind="dry-run"` happy
  path test from Phase 3 Task 3.1 to first seed
  `.foundry/trace/config-foo-dry-run-flow-x.jsonl` with a leftover
  line; after `_git_branch` runs, assert the file is empty.

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement.** After the successful `git checkout -b
  <built.name>` for `kind === KIND_DRY_RUN`, call:

```js
import { truncateTrace } from '../../../scripts/lib/tracing.js';
// ...
if (args.kind === KIND_DRY_RUN) {
  await truncateTrace({ branch: built.name, io: makeAsyncIO(context.worktree) });
}
```

- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit.**

### Task 5.8 — Snapshot inspection lib

**Files:**
- Create: `scripts/lib/snapshot/inspect.js`
- Create: `tests/lib/snapshot/inspect.test.js`

- [ ] **Step 1: Failing test.** Cover:
  - `listSnapshots`: returns all metadata for present snapshots,
    sorted by `startedAt` descending.
  - `listSnapshots`: missing/malformed README → entry with
    `error: "incomplete"`.
  - `showSnapshot`: returns `{ readme, metadata, diff:
    {files, insertions, deletions}, trace: {lineCount, firstTs,
    lastTs}, missing }`. Compute diff stats by parsing
    `diff.patch` (count `^diff --git`, `^+`, `^-` excluding headers).
  - `deleteSnapshot`: removes the run-id directory; confirm-gate
    behaviour.
  - `pruneSnapshots`: matches by ULID-encoded time; preview without
    confirm.

- [ ] **Step 2: Implement.**

```js
// scripts/lib/snapshot/inspect.js
import { join } from 'node:path';
import { parseFrontmatter } from '../workfile.js';

const ROOT = '.snapshots';
const REQUIRED = ['README.md', 'work/WORK.md', 'diff.patch', 'trace.jsonl'];

export async function listSnapshots({ io }) {
  if (!(await io.exists(ROOT))) return [];
  const ids = await io.readdir(ROOT);
  const results = [];
  for (const runId of ids) {
    const meta = await readSnapshotMeta({ io, runId });
    results.push(meta);
  }
  // Sort by startedAt descending; missing -> bottom.
  results.sort((a, b) =>
    (b.startedAt ?? '').localeCompare(a.startedAt ?? ''));
  return results;
}

async function readSnapshotMeta({ io, runId }) {
  const dir = join(ROOT, runId);
  const missing = [];
  for (const f of REQUIRED) {
    if (!(await io.exists(join(dir, f)))) missing.push(f);
  }
  const readmePath = join(dir, 'README.md');
  if (!(await io.exists(readmePath))) {
    return { runId, error: 'incomplete', missing };
  }
  const text = await io.readFile(readmePath);
  const fm = parseFrontmatter(text) || {};
  return {
    runId,
    branch: fm.branch ?? null,
    parent: fm.parent ?? null,
    flow: fm.flow ?? null,
    goal: fm.goal ?? null,
    startedAt: fm.startedAt ?? null,
    finishedAt: fm.finishedAt ?? null,
    exitReason: fm.exitReason ?? null,
    ...(missing.length ? { error: 'incomplete', missing } : {}),
  };
}

export async function showSnapshot({ runId, io }) { /* ... */ }
export async function deleteSnapshot({ runId, io, confirm }) { /* ... */ }
export async function pruneSnapshots({ olderThanDays, io, confirm, now }) { /* ... */ }
```

- [ ] **Step 3: Commit.**

### Task 5.9 — Snapshot MCP tools

**Files:**
- Create: `.opencode/plugins/foundry-tools/snapshot-tools.js`
- Modify: `.opencode/plugins/foundry.js`
- Create: `tests/plugin/snapshot-tools.test.js`

- [ ] **Step 1: Failing tests** for the four tools:

  - `_list` returns array; happy path and partial-snapshot path.
  - `_show` happy path returns the structured summary.
  - `_delete` without `confirm` returns preview; with `confirm:true`
    removes the dir.
  - `_prune` without `confirm` returns matching ids; with `confirm:true`
    removes them. `olderThanDays` validation: missing → error,
    negative → error.

- [ ] **Step 2: Implement** the tool registry. Per §11.6 these tools
  carry **only** the foundational guards (`requireGitRepo`,
  `requireFoundryRoot`); no branch guards, no `requireNotFailed`.

```js
// .opencode/plugins/foundry-tools/snapshot-tools.js
import { guarded } from '../../../scripts/lib/guards.js';
import { requireGitRepo, requireFoundryRoot }
  from '../../../scripts/lib/foundational-guards.js';
import { listSnapshots, showSnapshot, deleteSnapshot, pruneSnapshots }
  from '../../../scripts/lib/snapshot/inspect.js';
import { makeAsyncIO, makeIO } from './helpers.js';

const gitRepoGuard     = (_a, c) => requireGitRepo(makeIO(c.worktree));
const foundryRootGuard = (_a, c) => requireFoundryRoot(makeIO(c.worktree));

export function createSnapshotTools({ tool }) {
  return {
    foundry_snapshot_list: tool({
      description: 'List forensic snapshots from past dry-run finishes.',
      args: {},
      execute: guarded('foundry_snapshot_list',
        [gitRepoGuard, foundryRootGuard],
        async (_args, context) => {
          const io = makeAsyncIO(context.worktree);
          return JSON.stringify(await listSnapshots({ io }));
        }),
    }),
    foundry_snapshot_show: tool({
      description: 'Structured summary of a single snapshot.',
      args: { runId: tool.schema.string() },
      execute: guarded('foundry_snapshot_show',
        [gitRepoGuard, foundryRootGuard],
        async (args, context) => {
          const io = makeAsyncIO(context.worktree);
          return JSON.stringify(await showSnapshot({ runId: args.runId, io }));
        }),
    }),
    foundry_snapshot_delete: tool({
      description: 'Delete a snapshot by runId. confirm:true required.',
      args: {
        runId: tool.schema.string(),
        confirm: tool.schema.boolean().optional(),
      },
      execute: guarded('foundry_snapshot_delete',
        [gitRepoGuard, foundryRootGuard],
        async (args, context) => {
          const io = makeAsyncIO(context.worktree);
          return JSON.stringify(await deleteSnapshot({
            runId: args.runId, io, confirm: args.confirm === true,
          }));
        }),
    }),
    foundry_snapshot_prune: tool({
      description: 'Delete snapshots older than N days. confirm:true required.',
      args: {
        olderThanDays: tool.schema.number(),
        confirm: tool.schema.boolean().optional(),
      },
      execute: guarded('foundry_snapshot_prune',
        [gitRepoGuard, foundryRootGuard],
        async (args, context) => {
          if (!Number.isInteger(args.olderThanDays) || args.olderThanDays <= 0) {
            return JSON.stringify({
              ok: false,
              error: 'olderThanDays must be a positive integer',
            });
          }
          const io = makeAsyncIO(context.worktree);
          return JSON.stringify(await pruneSnapshots({
            olderThanDays: args.olderThanDays,
            io, confirm: args.confirm === true, now: Date.now(),
          }));
        }),
    }),
  };
}
```

- [ ] **Step 3: Register** in `.opencode/plugins/foundry.js`.
- [ ] **Step 4: Run,** expect PASS.
- [ ] **Step 5: Commit.**

```bash
git add .opencode/plugins/foundry-tools/snapshot-tools.js \
        scripts/lib/snapshot/inspect.js \
        .opencode/plugins/foundry.js \
        tests/plugin/snapshot-tools.test.js \
        tests/lib/snapshot/inspect.test.js
git commit -m "feat(snapshot): list/show/delete/prune MCP tools"
```

### Task 5.10 — `dry-run` skill

**Files:**
- Create: `skills/dry-run/SKILL.md`

- [ ] **Step 1:** Author the skill verbatim from spec §12.4 with
  appropriate skill frontmatter:

```markdown
---
name: dry-run
type: atomic
description: Trial-run a flow against in-progress config on a dry-run/<x>/<y> branch; finish writes a forensic snapshot and discards the branch.
---

# Dry-run

You help the user trial in-progress config changes against a real flow,
without merging the config or polluting the config branch's history.

## When to use

You are on a `config/<x>` branch with edits in progress (a new law, a
modified flow, a fresh appraiser, etc.) and you want to see how a flow
behaves under those changes — without merging, and without leaving WORK
files or memory rows behind on `config/<x>`.

## Prerequisites

1. Current branch is `config/<x>` (single segment, not nested).
2. Working tree is clean.
3. You know the flow id you want to trial and a one-line description of
   the goal you'll feed it.

If you are on `main`, you must first edit on a `config/<x>` branch:
`foundry_git_branch({ kind: "config", description: "<short-name>" })`.

## Protocol

### 1. Branch into dry-run mode

```text
foundry_git_branch({
  kind: "dry-run",
  flowId: "<flow-id>",
  description: "<dry-run-purpose-slug>"
})
```

This creates `dry-run/<x>/<flow>-<purpose>` and truncates the
trace file. From here on every `foundry_*` tool call is logged to
`.foundry/trace/<branch-slug>.jsonl`.

### 2. Run the flow

Use the `flow` skill (or call `foundry_orchestrate` directly) to drive
the flow against the goal. Memory data writes go to `foundry-memory/`
on this branch, just like a normal flow — they will be discarded with
the branch.

If the flow needs config to be adjusted mid-run: stop, finish the
dry-run (step 4), edit on `config/<x>`, then start a new dry-run.

### 3. Inspect WORK during the run (optional)

`foundry_workfile_get` and the read-only memory tools work as normal;
they appear in the trace.

### 4. Finish: snapshot + discard

```text
foundry_git_finish({
  message: "<one-paragraph findings>",
  confirm: true
})
```

The tool:

- writes `.snapshots/<run-id>/` on the parent `config/<x>` working
  tree, containing `README.md`, `work/WORK*`, `diff.patch`, and
  `trace.jsonl`;
- force-deletes the dry-run branch (its commits become unreachable);
- truncates `.foundry/trace/<branch-slug>.jsonl`.

You are now back on `config/<x>` with the snapshot on disk. Nothing is
committed. The snapshot directory is gitignored.

`baseBranch` is **not valid** for a dry-run finish — the parent is the
config branch you came from.

### 5. Inspect the snapshot

- `foundry_snapshot_list()` enumerates all snapshots.
- `foundry_snapshot_show({ runId })` returns a structured summary.
- The actual files at `.snapshots/<run-id>/` are flat — read directly
  with `Read` / shell tools.

If the snapshot reveals the config needs adjustment: edit on
`config/<x>` (still on it after finish), then optionally re-enter
dry-run mode for another run. Snapshots accumulate; prune them with
`foundry_snapshot_delete` or `foundry_snapshot_prune`.

### 6. Finish the config

When ready, finish `config/<x>` to `main`:

```text
foundry_git_finish({
  message: "<config description>",
  baseBranch: "main",
  confirm: true
})
```

Snapshots are gitignored and stay in the local working tree; they do
not merge with the config.

## What you do NOT do

- You do not run schema-mutation tools while on a dry-run branch.
  `foundry_config_create_*` and the memory-schema tools refuse there
  by design.
- You do not nest dry-runs (`dry-run/x/y/dry-run/z` is refused).
- You do not commit the snapshot directory by hand. If a particular
  snapshot must be preserved beyond the local checkout, copy it out
  first, then delete the original via `foundry_snapshot_delete`.
```

- [ ] **Step 2: Commit.**

```bash
git add skills/dry-run/SKILL.md
git commit -m "docs(skills): add dry-run skill"
```

### Task 5.11 — End-to-end dry-run smoke test

**Files:**
- Create: `tests/plugin/dry-run-e2e.test.js`

- [ ] **Step 1:** Author the test per spec §15.7 "Dry-run workflow":

  - tmpdir with `git init` and a minimal foundry scaffold;
  - `foundry_git_branch({ kind: "config", description: "edit-law" })`;
  - hand-edit a law file (or call `_create_law`); commit;
  - `foundry_git_branch({ kind: "dry-run", flowId: "flow-x",
    description: "goal-x" })`;
  - drive a tiny flow to completion (use the orchestrate fixture
    pattern from `tests/orchestrate-integration.test.js`);
  - `foundry_git_finish({ message: "...", confirm: true })`;
  - assert `.snapshots/<runId>/` exists with all four expected files,
    is **not** in `git status`, dry-run branch is gone, HEAD is
    `config/edit-law` with clean tracked tree, trace file is empty.

- [ ] **Step 2:** Run end-to-end. This is the highest-value test in
  the entire phase set — when it goes green, the spec is realised.

- [ ] **Step 3:** Add the failure-path variant per §15.7:
  same setup but the flow fails mid-cycle; assert snapshot is still
  produced and README's `exitReason` is `failed`.

- [ ] **Step 4: Commit.**

```bash
git add tests/plugin/dry-run-e2e.test.js
git commit -m "test(dry-run): end-to-end snapshot-and-discard smoke"
```

### Task 5.12 — Final CHANGELOG and doc updates

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `README.md`
- Modify: `docs/concepts.md`
- Modify: `docs/getting-started.md`
- Modify: `docs/tools.md`
- Modify: `docs/work-spec.md`

- [ ] **Step 1: CHANGELOG.** Append the remaining BREAKING entries
  from spec §16 that were not added in earlier phases:

```
- New nested branch namespace `dry-run/<x>/<y>` for dry-running
  in-progress config against a real flow run.
- `foundry_git_finish` on a `dry-run/<x>/<y>` branch (dry-run
  finish) writes an untracked snapshot directory at
  `.snapshots/<run-id>/` on the parent config branch's working tree
  and discards the dry-run branch (no merge, no commit). `baseBranch`
  is invalid for this case.
- New gitignored top-level `.snapshots/` directory; appears in
  projects only after the first dry-run finish. Snapshots are local
  operator artefacts and never committed by foundry.
- Four new `foundry_snapshot_*` tools (`_list`, `_show`, `_delete`,
  `_prune`) for programmatic snapshot inspection and cleanup.
- Verbose tool-call tracing is on inside dry-run mode; trace files
  live in `.foundry/trace/` (gitignored) during the run and are
  copied into snapshots at finish.
- New `dry-run` skill.
```

- [ ] **Step 2: Concept docs.** In `docs/concepts.md`, add a section
  describing the §1 invariant in plain English plus the third
  namespace.

- [ ] **Step 3: Getting started.** In `docs/getting-started.md`,
  replace any `foundry_git_branch({ flowId, description })` example
  with the new shape, and add a short dry-run example: edit a law on
  `config/foo`, dry-run it, inspect snapshot, finish.

- [ ] **Step 4: Tools docs.** In `docs/tools.md`, document:
  - `foundry_git_branch` per-kind table from spec §8.1.
  - `foundry_git_finish` three-mode dispatch from §8.2.
  - The five `foundry_config_create_*` and five
    `foundry_config_validate_*` tools.
  - The four `foundry_snapshot_*` tools.

- [ ] **Step 5: Work-spec.** In `docs/work-spec.md`, add the branch
  namespace section (`config/*`, `work/*`, `dry-run/*/*`) and
  the dry-run mode flow lifecycle.

- [ ] **Step 6: README.** Update the quickstart to mention `config/*`
  for first-time config edits and dry-run mode for trying changes.

- [ ] **Step 7: Bump `package.json` to `3.0.0`** and move
  `[Unreleased]` heading to `[3.0.0] - <release-date>`.

- [ ] **Step 8: Delete `SPEC.md`** per its own instruction (line 13).

- [ ] **Step 9: Commit each doc as its own commit** (six small commits)
  to preserve a readable diff history. Final commit:

```bash
rm SPEC.md
git add -A
git commit -m "docs: bump to 3.0.0; remove SPEC.md (implemented)"
```

## 6. Phase 5 acceptance criteria

- `npm test` green, including the new dry-run end-to-end test.
- A fresh repo can run the spec §15.7 dry-run workflow:
  `config/foo` → `dry-run/foo/flow-x-goal` → flow → finish →
  `.snapshots/<runId>/` with all four files, dry-run branch gone,
  trace truncated, HEAD on `config/foo`.
- `foundry_snapshot_list` enumerates all snapshots; partial snapshots
  surface with `error: "incomplete"` and `missing: [...]`.
- Tracing is **off** on `work/*` (verified by spec §15.6 test).
- `SPEC.md` is removed from the repo.
- `CHANGELOG.md` covers all six BREAKING entry groups (3 from earlier
  phases — output-type rename and assay-feedback removal pre-existing,
  config-branch invariant, branch-arg signature; 3 new in this phase —
  dry-run namespace, snapshot tools, tracing).
- `package.json` reads `"version": "3.0.0"`.

## 7. Out-of-scope reminders (final)

- **Auto-replay of snapshots as regression tests** — separate feature.
- **Snapshot diff viewer** — operators use `diff -r`.
- **Trace replay** — trace is for human inspection.
- **Multi-level dry-run nesting** — refused.
- **Dry-run off `work/*`** — refused; only `config/*` parents.
- **Cross-branch snapshot sharing** — snapshots are local artefacts; no
  foundry-managed transport.
- **`foundry_config_update_*` tools** — operators edit by hand on
  `config/*`.
- **Pre-commit/git-policy hook layer** — tool-layer enforcement is
  sufficient (spec §2).
