# Phase 2 — New Stage Tools

> Wire up the three new orchestrator/subagent tools: `foundry_stage_begin`, `foundry_stage_end`, `foundry_stage_finalize`. After this phase, the lifecycle is in place but not yet gated by sort (Phase 4) or enforced on the old tools (Phase 3).

**Prereqs:** Phase 1 complete.

**Test command:** `node --test tests/lib/finalize.test.js tests/plugin/stage-tools.test.js`

---

## Setup: wire secret + pending store into the plugin factory

Before Task 5, update `.opencode/plugins/foundry.js` so all tools can reach the secret and pending store.

**Files:**
- Modify: `.opencode/plugins/foundry.js`

- [ ] **Step 1: Import new helpers at top of file**

Add after the existing `scripts/lib` imports:

```js
import { readOrCreateSecret } from '../../scripts/lib/secret.js';
import { createPendingStore } from '../../scripts/lib/pending.js';
import { signToken, verifyToken } from '../../scripts/lib/token.js';
import {
  ensureFoundryDir, readActiveStage, writeActiveStage, clearActiveStage,
  readLastStage, writeLastStage,
} from '../../scripts/lib/state.js';
import {
  requireNoActiveStage, requireActiveStage, stageBaseOf,
} from '../../scripts/lib/stage-guard.js';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync as _exec, execSync as _execSync } from 'node:child_process'; // if not already
```

- [ ] **Step 2: Instantiate secret + pending store inside `FoundryPlugin` factory, above the returned object**

At `foundry.js:121` modify:

```js
export const FoundryPlugin = async ({ directory }) => {
  const secret = readOrCreateSecret(directory);
  const pending = createPendingStore();

  return {
    config: async (config) => {
      // ... existing body unchanged ...
    },
    // ...
  };
};
```

Note: `directory` here is the worktree root at plugin-boot time. Per-invocation `context.worktree` may differ in multi-worktree setups — we **still use `context.worktree`** inside tool `execute` bodies to locate `.foundry/` on disk, and use the **plugin-boot secret** only for signing/verifying. If the worktree changes mid-session this would mismatch; call that out in a code comment but defer a fix (not in HARDEN v2.2.0 scope).

- [ ] **Step 3: Run existing tests to ensure nothing broke**

```bash
node --test tests/
```

Expected: PASS (we only added imports + closure state; no behavior changed).

- [ ] **Step 4: Commit**

```bash
git add .opencode/plugins/foundry.js
git commit -m "feat(harden): bootstrap secret + pending store in plugin factory"
```

---

## Task 5: `foundry_stage_begin(stage, cycle, token)`

**Files:**
- Modify: `.opencode/plugins/foundry.js` (insert new tool definition)
- Create: `tests/plugin/stage-tools.test.js`

**Responsibility:** Verify token (HMAC + expiry + nonce match); write `.foundry/active-stage.json`; return `{ok: true, active-stage: {...}}`.

- [ ] **Step 1: Write failing test**

```js
// tests/plugin/stage-tools.test.js
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FoundryPlugin } from '../../.opencode/plugins/foundry.js';
import { signToken } from '../../scripts/lib/token.js';
import { readOrCreateSecret } from '../../scripts/lib/secret.js';

// Minimal context shape mimicking OpenCode's invocation.
function makeCtx(worktree) { return { worktree }; }

// Helper: boot plugin and return tool map for a given worktree.
async function bootPlugin(dir) {
  const plugin = await FoundryPlugin({ directory: dir });
  return plugin.tool;
}

describe('foundry_stage_begin', () => {
  let dir;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'foundry-stagebegin-'));
    execSync('git init -q', { cwd: dir });
    execSync('git commit --allow-empty -m init -q', { cwd: dir, env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
  });

  it('accepts a valid token and writes active-stage.json', async () => {
    const tools = await bootPlugin(dir);
    // Simulate sort having dispatched: add nonce to pending store.
    // We don't have public access — instead, exercise the real flow:
    // call foundry_sort with a prepared WORK.md (easier in Phase 4).
    // For this unit test, use the internal sign route via a helper export.
    // TEMPORARY: we expose a _test helper — see Step 3 note.
    // ...
  });
});
```

Note: Stage-begin requires the nonce to be in the pending store, which is populated by `foundry_sort`. Testing in isolation needs either (a) a test-only seam, or (b) testing the full `sort → begin` path. Prefer (b) — but that belongs in Phase 4. For this task, test via a `_testing_seedPending` export that we strip before release, OR expose a narrow `__seedPendingForTest` symbol only when `NODE_ENV === 'test'`.

**Decision**: add a minimal test seam. In `foundry.js` factory, after creating `pending`, expose it on the returned plugin under a non-enumerable symbol:

```js
const plugin = { config: ..., 'experimental.chat.messages.transform': ..., tool: {...} };
Object.defineProperty(plugin, Symbol.for('foundry.test.pending'), { value: pending });
Object.defineProperty(plugin, Symbol.for('foundry.test.secret'), { value: secret });
return plugin;
```

Tests read these symbols; production callers never touch them.

Now the realistic test:

```js
it('accepts a valid token and writes active-stage.json', async () => {
  const plugin = await FoundryPlugin({ directory: dir });
  const pending = plugin[Symbol.for('foundry.test.pending')];
  const secret = plugin[Symbol.for('foundry.test.secret')];
  const payload = { route: 'forge:c', cycle: 'c', nonce: 'n1', exp: Date.now() + 60_000 };
  pending.add('n1', payload);
  const token = signToken(payload, secret);

  const res = JSON.parse(await plugin.tool.foundry_stage_begin.execute(
    { stage: 'forge:c', cycle: 'c', token },
    makeCtx(dir),
  ));
  assert.equal(res.ok, true);
  assert.ok(existsSync(join(dir, '.foundry/active-stage.json')));
  const state = JSON.parse(readFileSync(join(dir, '.foundry/active-stage.json'), 'utf-8'));
  assert.equal(state.cycle, 'c');
  assert.equal(state.stage, 'forge:c');
  assert.equal(state.tokenHash.length, 64);
});

it('rejects an expired token', async () => {
  const plugin = await FoundryPlugin({ directory: dir });
  const pending = plugin[Symbol.for('foundry.test.pending')];
  const secret = plugin[Symbol.for('foundry.test.secret')];
  const payload = { route: 'forge:c', cycle: 'c', nonce: 'n2', exp: Date.now() - 1 };
  pending.add('n2', payload);
  const token = signToken(payload, secret);
  const res = JSON.parse(await plugin.tool.foundry_stage_begin.execute(
    { stage: 'forge:c', cycle: 'c', token }, makeCtx(dir),
  ));
  assert.match(res.error, /expired/);
  assert.equal(existsSync(join(dir, '.foundry/active-stage.json')), false);
});

it('rejects a reused nonce', async () => {
  const plugin = await FoundryPlugin({ directory: dir });
  const pending = plugin[Symbol.for('foundry.test.pending')];
  const secret = plugin[Symbol.for('foundry.test.secret')];
  const payload = { route: 'forge:c', cycle: 'c', nonce: 'n3', exp: Date.now() + 60_000 };
  pending.add('n3', payload);
  const token = signToken(payload, secret);
  await plugin.tool.foundry_stage_begin.execute({ stage: 'forge:c', cycle: 'c', token }, makeCtx(dir));
  // Clear active-stage to bypass "no active stage" precondition the second time.
  rmSync(join(dir, '.foundry/active-stage.json'));
  const res2 = JSON.parse(await plugin.tool.foundry_stage_begin.execute({ stage: 'forge:c', cycle: 'c', token }, makeCtx(dir)));
  assert.match(res2.error, /nonce/);
});

it('rejects when stage arg mismatches token payload', async () => {
  const plugin = await FoundryPlugin({ directory: dir });
  const pending = plugin[Symbol.for('foundry.test.pending')];
  const secret = plugin[Symbol.for('foundry.test.secret')];
  const payload = { route: 'forge:c', cycle: 'c', nonce: 'n4', exp: Date.now() + 60_000 };
  pending.add('n4', payload);
  const token = signToken(payload, secret);
  const res = JSON.parse(await plugin.tool.foundry_stage_begin.execute(
    { stage: 'quench:c', cycle: 'c', token }, makeCtx(dir),
  ));
  assert.match(res.error, /token.*mismatch/);
});

it('rejects when active stage already present', async () => {
  const plugin = await FoundryPlugin({ directory: dir });
  const pending = plugin[Symbol.for('foundry.test.pending')];
  const secret = plugin[Symbol.for('foundry.test.secret')];
  const payload = { route: 'forge:c', cycle: 'c', nonce: 'n5', exp: Date.now() + 60_000 };
  pending.add('n5', payload);
  const token = signToken(payload, secret);
  await plugin.tool.foundry_stage_begin.execute({ stage: 'forge:c', cycle: 'c', token }, makeCtx(dir));
  // Add another pending nonce and try again without clearing active-stage.
  const p2 = { route: 'forge:c', cycle: 'c', nonce: 'n6', exp: Date.now() + 60_000 };
  pending.add('n6', p2);
  const token2 = signToken(p2, secret);
  const res = JSON.parse(await plugin.tool.foundry_stage_begin.execute({ stage: 'forge:c', cycle: 'c', token: token2 }, makeCtx(dir)));
  assert.match(res.error, /stage already active/);
});
```

- [ ] **Step 2: Run — expect failure** (`foundry_stage_begin` doesn't exist yet). `node --test tests/plugin/stage-tools.test.js`

- [ ] **Step 3: Add the test seam to `.opencode/plugins/foundry.js`**

At the bottom of the factory, before `return plugin`:

```js
const plugin = { config, 'experimental.chat.messages.transform': onMessages, tool: { /* ... all tools ... */ } };
Object.defineProperty(plugin, Symbol.for('foundry.test.pending'), { value: pending });
Object.defineProperty(plugin, Symbol.for('foundry.test.secret'), { value: secret });
return plugin;
```

(Restructure the current factory that inline-returns an object literal — extract the object into a `plugin` const first.)

- [ ] **Step 4: Implement `foundry_stage_begin`**

Insert before the history tools (around line 147):

```js
foundry_stage_begin: tool({
  description: 'Open a subagent work stage; consumes a dispatch token from foundry_sort.',
  args: {
    stage: tool.schema.string().describe('Stage alias, e.g. "forge:create-haiku"'),
    cycle: tool.schema.string().describe('Cycle name'),
    token: tool.schema.string().describe('Token received from foundry_sort via the dispatch prompt'),
  },
  async execute(args, context) {
    const io = makeIO(context.worktree);
    // Precondition: no active stage.
    if (readActiveStage(io)) {
      return JSON.stringify({ error: `foundry_stage_begin requires no active stage; current: ${readActiveStage(io).stage}` });
    }
    // Verify token signature + expiry.
    const v = verifyToken(args.token, secret);
    if (!v.ok) return JSON.stringify({ error: `foundry_stage_begin: token ${v.reason}` });
    // Payload must match args.
    if (v.payload.route !== args.stage || v.payload.cycle !== args.cycle) {
      return JSON.stringify({ error: `foundry_stage_begin: token payload mismatch (route=${v.payload.route}, cycle=${v.payload.cycle})` });
    }
    // Single-use nonce check.
    const meta = pending.consume(v.payload.nonce);
    if (!meta) return JSON.stringify({ error: `foundry_stage_begin: nonce not pending or already consumed` });

    // Resolve base SHA from git.
    let baseSha;
    try {
      baseSha = _execSync('git rev-parse HEAD', { cwd: context.worktree }).toString().trim();
    } catch {
      return JSON.stringify({ error: `foundry_stage_begin: git rev-parse HEAD failed (no commits?)` });
    }

    const tokenHash = createHash('sha256').update(args.token).digest('hex');
    const active = {
      cycle: args.cycle,
      stage: args.stage,
      tokenHash,
      baseSha,
      startedAt: new Date().toISOString(),
    };
    writeActiveStage(io, active);
    return JSON.stringify({ ok: true, active });
  },
}),
```

- [ ] **Step 5: Run — expect PASS.**

- [ ] **Step 6: Commit**

```bash
git add .opencode/plugins/foundry.js tests/plugin/stage-tools.test.js
git commit -m "feat(harden): add foundry_stage_begin with token verification"
```

---

## Task 6: `foundry_stage_end(summary)`

**Files:**
- Modify: `.opencode/plugins/foundry.js`
- Modify: `tests/plugin/stage-tools.test.js` (append)

**Responsibility:** Delete `active-stage.json` after writing `last-stage.json` (carries `baseSha`, `cycle`, `stage` for finalize). Return summary back to caller unchanged.

- [ ] **Step 1: Add tests**

```js
describe('foundry_stage_end', () => {
  it('clears active-stage and writes last-stage', async () => {
    // seed as in stage_begin test, then:
    const res = JSON.parse(await plugin.tool.foundry_stage_end.execute({ summary: 'done' }, makeCtx(dir)));
    assert.equal(res.ok, true);
    assert.equal(res.summary, 'done');
    assert.equal(existsSync(join(dir, '.foundry/active-stage.json')), false);
    assert.ok(existsSync(join(dir, '.foundry/last-stage.json')));
  });

  it('errors when no active stage', async () => {
    const plugin = await FoundryPlugin({ directory: dir });
    const res = JSON.parse(await plugin.tool.foundry_stage_end.execute({ summary: 'x' }, makeCtx(dir)));
    assert.match(res.error, /requires active stage/);
  });
});
```

- [ ] **Step 2: Run — expect fail.**

- [ ] **Step 3: Implement**

Below `foundry_stage_begin`:

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
    return JSON.stringify({ ok: true, summary: args.summary });
  },
}),
```

- [ ] **Step 4: Run — PASS.**

- [ ] **Step 5: Commit**

```bash
git add .opencode/plugins/foundry.js tests/plugin/stage-tools.test.js
git commit -m "feat(harden): add foundry_stage_end carrying baseSha to last-stage.json"
```

---

## Task 7: `foundry_stage_finalize(cycle)`

**Files:**
- Create: `scripts/lib/finalize.js`
- Create: `tests/lib/finalize.test.js`
- Modify: `.opencode/plugins/foundry.js`
- Modify: `tests/plugin/stage-tools.test.js` (append)

**Responsibility:** Algorithm from HARDEN.md §5. Orchestrator-only (`requireNoActiveStage`). Returns registered artefacts, or an error listing unexpected files.

### 7a: The pure core in `scripts/lib/finalize.js`

- [ ] **Step 1: Test**

```js
// tests/lib/finalize.test.js
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { finalizeStage } from '../../scripts/lib/finalize.js';

function git(cwd, cmd) { return execSync(`git ${cmd}`, { cwd, env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).toString().trim(); }

describe('finalizeStage', () => {
  let dir, baseSha;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'foundry-fin-'));
    execSync('git init -q', { cwd: dir });
    writeFileSync(join(dir, 'README.md'), 'hi');
    git(dir, 'add .'); git(dir, 'commit -m init -q');
    baseSha = git(dir, 'rev-parse HEAD');
  });

  it('clean forge diff: matching file registers as draft', () => {
    mkdirSync(join(dir, 'haikus'), { recursive: true });
    writeFileSync(join(dir, 'haikus/one.md'), '...');
    const res = finalizeStage({
      cwd: dir, baseSha,
      stageBase: 'forge',
      cycleDef: { outputArtefactType: 'haiku' },
      artefactTypes: { haiku: { filePatterns: ['haikus/*.md'] } },
      registerArtefact: () => {},
    });
    assert.equal(res.ok, true);
    assert.deepEqual(res.artefacts, [{ file: 'haikus/one.md', type: 'haiku', status: 'draft' }]);
  });

  it('forge diff with stray file rejects', () => {
    writeFileSync(join(dir, 'stray.txt'), 'x');
    mkdirSync(join(dir, 'haikus'), { recursive: true });
    writeFileSync(join(dir, 'haikus/a.md'), '');
    const res = finalizeStage({
      cwd: dir, baseSha, stageBase: 'forge',
      cycleDef: { outputArtefactType: 'haiku' },
      artefactTypes: { haiku: { filePatterns: ['haikus/*.md'] } },
      registerArtefact: () => {},
    });
    assert.equal(res.ok, false);
    assert.equal(res.error, 'unexpected_files');
    assert.deepEqual(res.files, ['stray.txt']);
  });

  it('quench with any diff rejects', () => {
    writeFileSync(join(dir, 'x.md'), '');
    const res = finalizeStage({
      cwd: dir, baseSha, stageBase: 'quench',
      cycleDef: { outputArtefactType: 'haiku' },
      artefactTypes: { haiku: { filePatterns: ['haikus/*.md'] } },
      registerArtefact: () => {},
    });
    assert.equal(res.ok, false);
    assert.deepEqual(res.files, ['x.md']);
  });

  it('empty diff is ok', () => {
    const res = finalizeStage({
      cwd: dir, baseSha, stageBase: 'quench',
      cycleDef: { outputArtefactType: 'haiku' },
      artefactTypes: { haiku: { filePatterns: ['haikus/*.md'] } },
      registerArtefact: () => {},
    });
    assert.equal(res.ok, true);
    assert.deepEqual(res.artefacts, []);
  });

  it('filters out tool-managed files', () => {
    writeFileSync(join(dir, 'WORK.md'), 'x');
    writeFileSync(join(dir, 'WORK.history.yaml'), 'x');
    mkdirSync(join(dir, '.foundry'), { recursive: true });
    writeFileSync(join(dir, '.foundry/active-stage.json'), '{}');
    const res = finalizeStage({
      cwd: dir, baseSha, stageBase: 'quench',
      cycleDef: { outputArtefactType: 'haiku' },
      artefactTypes: { haiku: { filePatterns: ['haikus/*.md'] } },
      registerArtefact: () => {},
    });
    assert.equal(res.ok, true);
  });
});
```

- [ ] **Step 2: Run — fail.**

- [ ] **Step 3: Implement**

```js
// scripts/lib/finalize.js
import { execSync } from 'node:child_process';
import { minimatch } from 'minimatch';

const TOOL_MANAGED = [
  'WORK.md',
  'WORK.history.yaml',
];
const TOOL_MANAGED_PREFIX = ['.foundry/'];

function changedFiles(cwd, baseSha) {
  const tracked = execSync(`git diff --name-only ${baseSha} HEAD`, { cwd }).toString().split('\n').filter(Boolean);
  const diffUnstaged = execSync('git diff --name-only', { cwd }).toString().split('\n').filter(Boolean);
  const untracked = execSync('git ls-files --others --exclude-standard', { cwd }).toString().split('\n').filter(Boolean);
  return [...new Set([...tracked, ...diffUnstaged, ...untracked])];
}

function isToolManaged(f) {
  if (TOOL_MANAGED.includes(f)) return true;
  return TOOL_MANAGED_PREFIX.some(p => f.startsWith(p));
}

export function finalizeStage({ cwd, baseSha, stageBase, cycleDef, artefactTypes, registerArtefact }) {
  const files = changedFiles(cwd, baseSha).filter(f => !isToolManaged(f));
  const allowedPatterns = stageBase === 'forge'
    ? (artefactTypes[cycleDef.outputArtefactType]?.filePatterns ?? [])
    : [];
  const unexpected = [];
  const matched = [];
  for (const f of files) {
    const hit = allowedPatterns.find(p => minimatch(f, p));
    if (hit) matched.push(f);
    else unexpected.push(f);
  }
  if (unexpected.length) return { ok: false, error: 'unexpected_files', files: unexpected };
  const artefacts = matched.map(file => {
    registerArtefact({ file, type: cycleDef.outputArtefactType, status: 'draft' });
    return { file, type: cycleDef.outputArtefactType, status: 'draft' };
  });
  return { ok: true, artefacts };
}
```

- [ ] **Step 4: Run — PASS.**

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/finalize.js tests/lib/finalize.test.js
git commit -m "feat(harden): add finalize.js diff + pattern match core"
```

### 7b: Wire the tool in `.opencode/plugins/foundry.js`

- [ ] **Step 1: Plugin-level test in `tests/plugin/stage-tools.test.js`**

```js
describe('foundry_stage_finalize', () => {
  it('happy path: forge stage, matching file, registers artefact row', async () => {
    // 1. prepare worktree with a cycle def + artefact type on disk
    // 2. sort (phase 4) OR seed pending store directly
    // 3. stage_begin → write file → stage_end → stage_finalize
    // 4. assert the WORK.md table has the new row
  });

  it('rejects unexpected files and returns files list', async () => { /* ... */ });

  it('requires no active stage', async () => {
    // With active-stage.json present, finalize errors.
  });
});
```

Implementation detail: the plugin test must author a valid `foundry/cycles/c.md` and `foundry/artefact-types/haiku.md` in the temp dir to satisfy `getCycleDefinition` / `getArtefactType`. Copy the shapes from existing fixtures in `tests/sort.test.js` (read that file first to mirror the YAML frontmatter).

- [ ] **Step 2: Run — fail.**

- [ ] **Step 3: Implement tool**

```js
foundry_stage_finalize: tool({
  description: 'Verify stage output matches allowed file patterns; register artefacts as drafts.',
  args: {
    cycle: tool.schema.string().describe('Cycle name'),
  },
  async execute(args, context) {
    const io = makeIO(context.worktree);
    const guard = requireNoActiveStage(io);
    if (!guard.ok) return JSON.stringify({ error: guard.error });
    const last = readLastStage(io);
    if (!last) return JSON.stringify({ error: 'foundry_stage_finalize: no last stage recorded; call stage_end first' });
    if (last.cycle !== args.cycle) return JSON.stringify({ error: `foundry_stage_finalize: cycle mismatch (last=${last.cycle}, got=${args.cycle})` });

    const cycleDef = getCycleDefinition(args.cycle, io);
    if (!cycleDef) return JSON.stringify({ error: `foundry_stage_finalize: unknown cycle ${args.cycle}` });
    const artType = getArtefactType(cycleDef.outputArtefactType, io);
    const artefactTypes = artType ? { [cycleDef.outputArtefactType]: artType } : {};

    const workPath = path.join(context.worktree, 'WORK.md');
    const result = finalizeStage({
      cwd: context.worktree,
      baseSha: last.baseSha,
      stageBase: stageBaseOf(last.stage),
      cycleDef,
      artefactTypes,
      registerArtefact: ({ file, type, status }) => addArtefactRow(workPath, { file, type, status, cycle: args.cycle }, io),
    });
    return JSON.stringify(result);
  },
}),
```

Add import at top: `import { finalizeStage } from '../../scripts/lib/finalize.js';`

- [ ] **Step 4: Run — PASS.**

- [ ] **Step 5: Commit**

```bash
git add .opencode/plugins/foundry.js tests/plugin/stage-tools.test.js
git commit -m "feat(harden): add foundry_stage_finalize verification gate"
```

---

## Phase 2 complete

Sanity: `node --test tests/` — everything green. Proceed to [PHASE_3.md](PHASE_3.md).
