# Phase 2: History Hardening + IO Shim rename

**Scope:** Harden `scripts/lib/history.js` per spec §11 audit findings. Add `rename` capability to the IO shim (needed by phase 1's feedback-store under real IO, and used here for atomic history writes). Remove the `## Feedback` emission from `createWorkfile`. Independent of phase 1; could land first if we were reshuffling.

**Spec sections covered:** §9.2 (atomic rename — real IO), §10 (open_feedback — shape only; actual computation happens in phase 4), §11.1 (delete readLastSortRoute), §11.2 (seq), §11.3 (malformed-yaml → markWorkfileFailed), §11.4 (route implies stage==='sort'), §11.5 (documented in phase 5), §11.6 (atomic history writes), §11.7 (getIteration doc comment), §7 (remove `## Feedback` from WORK.md).

**Files in this phase:**
- Modify: `scripts/lib/history.js`
- Modify: `tests/lib/history.test.js`
- Modify: `.opencode/plugins/foundry-tools/helpers.js`
- Modify: `scripts/lib/workfile.js`
- Modify: `tests/lib/workfile.test.js` (or equivalent — check before starting)

**Preflight:**

```bash
# Find workfile test file.
ls tests/lib/workfile.test.js 2>&1 || rg -l "createWorkfile" tests/

# Baseline.
npm test
# Record test count and confirm all green.
```

---

## Task 2.1: IO shim gains rename (RED)

**Files:** Modify tests that exercise `makeIO` directly, or add a new test file `tests/plugin/helpers.test.js` if none exists.

- [ ] **Step 1: Inspect**

```bash
rg -l "makeIO" tests/
```
If there's an existing `tests/plugin/helpers.test.js`, add to it. Otherwise create it.

- [ ] **Step 2: Write the failing test**

```js
// tests/plugin/helpers.test.js  (create or extend)
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { makeIO } from '../../.opencode/plugins/foundry-tools/helpers.js';

describe('makeIO.rename', () => {
  test('moves a file atomically within the worktree', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'fdy-rename-'));
    try {
      const io = makeIO(dir);
      writeFileSync(path.join(dir, 'src.txt'), 'hello', 'utf-8');
      io.rename('src.txt', 'dst.txt');
      assert.equal(existsSync(path.join(dir, 'src.txt')), false);
      assert.equal(readFileSync(path.join(dir, 'dst.txt'), 'utf-8'), 'hello');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('throws when source does not exist', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'fdy-rename-'));
    try {
      const io = makeIO(dir);
      assert.throws(() => io.rename('missing.txt', 'dst.txt'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('resolves both paths relative to the worktree', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'fdy-rename-'));
    try {
      const io = makeIO(dir);
      writeFileSync(path.join(dir, 'a.txt'), 'x', 'utf-8');
      io.rename('a.txt', 'b.txt'); // neither is absolute
      assert.equal(readFileSync(path.join(dir, 'b.txt'), 'utf-8'), 'x');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 3: Run and confirm failure**

Run: `node --test tests/plugin/helpers.test.js`
Expected: FAIL with `io.rename is not a function`.

---

## Task 2.2: IO shim gains rename (GREEN)

**Files:** Modify `.opencode/plugins/foundry-tools/helpers.js`.

- [ ] **Step 1: Add `rename` to makeIO**

Open `.opencode/plugins/foundry-tools/helpers.js`. At line 5, the existing `fs` import destructures several functions. Add `renameSync`:

```js
import { readFileSync, writeFileSync, existsSync, readdirSync, unlinkSync, mkdirSync, renameSync } from 'fs';
```

In `makeIO` (starts at line 96), insert `rename` after `unlink`:

```js
    unlink: (p) => { if (existsSync(resolve(p))) unlinkSync(resolve(p)); },
    rename: (from, to) => renameSync(resolve(from), resolve(to)),
```

Also update `makeMemoryIO` (line 114) to mirror the addition so memory-using modules can adopt atomicity in the future:

```js
    unlink: async (p) => sync.unlink(p),
    rename: async (from, to) => sync.rename(from, to),
```

- [ ] **Step 2: Run tests and confirm pass**

Run: `node --test tests/plugin/helpers.test.js`
Expected: all 3 tests pass.

- [ ] **Step 3: Full suite**

Run: `npm test`
Expected: no regressions.

- [ ] **Step 4: Commit**

```bash
git add .opencode/plugins/foundry-tools/helpers.js tests/plugin/helpers.test.js
git commit -m "feat(helpers): add rename capability to IO shim

makeIO and makeMemoryIO now expose io.rename(from, to), delegating to
fs.renameSync. Atomic on POSIX and atomic-within-volume on Windows.
Required by the WORK.feedback.yaml store and the upcoming atomic
history.yaml writer (spec §9.2)."
```

---

## Task 2.3: Delete readLastSortRoute (RED)

**Files:** Modify `tests/lib/history.test.js`.

Spec §11.1: `readLastSortRoute` is dead code. Delete it and its tests.

- [ ] **Step 1: Remove the `describe('readLastSortRoute')` block**

Open `tests/lib/history.test.js`. Find the block that starts at line 90 (`describe('readLastSortRoute', () => {`). Delete the entire describe (roughly lines 90–116 — verify by reading the file).

Also remove `readLastSortRoute` from the top-level import at line 3:

```js
// Before:
import { loadHistory, appendEntry, getIteration, readLastSortRoute } from '../../scripts/lib/history.js';
// After:
import { loadHistory, appendEntry, getIteration } from '../../scripts/lib/history.js';
```

- [ ] **Step 2: Run and confirm failure (compilation-level)**

Run: `node --test tests/lib/history.test.js`
Expected: PASS — the tests no longer reference the removed function; suite gets smaller. Also confirm no other test file imports `readLastSortRoute`:

```bash
rg -n "readLastSortRoute" scripts/ tests/ .opencode/
```
Expected: only matches in `scripts/lib/history.js:55` (the definition) — we haven't removed it yet. If anything else matches, delete/adjust those references before proceeding.

---

## Task 2.4: Delete readLastSortRoute (GREEN)

**Files:** Modify `scripts/lib/history.js`.

- [ ] **Step 1: Delete the function**

Open `scripts/lib/history.js`. Delete lines 51–59 (the `/** Return the `route` field ... */` comment and the `readLastSortRoute` export).

- [ ] **Step 2: Confirm no references remain**

```bash
rg -n "readLastSortRoute" scripts/ tests/ .opencode/
```
Expected: zero matches.

- [ ] **Step 3: Run full suite**

Run: `npm test`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add scripts/lib/history.js tests/lib/history.test.js
git commit -m "refactor(history): remove unused readLastSortRoute

Audit (spec §11.1) confirmed zero production callers; only three tests
referenced it. Removing dead code reduces the API surface of the history
module ahead of the feedback redesign."
```

---

## Task 2.5: Enforce route ⇒ stage==='sort' (RED)

**Files:** Modify `tests/lib/history.test.js`.

Spec §11.4: `appendEntry` should throw when `route` is supplied on a non-sort stage entry.

- [ ] **Step 1: Add the test**

Append to `tests/lib/history.test.js`:

```js
describe('appendEntry — route/stage invariant', () => {
  test('throws when route is supplied on a non-sort stage', () => {
    const io = mockIO(null);
    assert.throws(
      () => appendEntry('h.yaml', {
        cycle: 'c1',
        stage: 'forge:write',
        iteration: 1,
        comment: 'x',
        route: 'quench:a',
      }, io),
      /route.*sort/i,
    );
  });

  test('accepts route when stage is sort', () => {
    const io = mockIO(null);
    assert.doesNotThrow(() =>
      appendEntry('h.yaml', {
        cycle: 'c1',
        stage: 'sort',
        iteration: 1,
        comment: 'sort → forge:x',
        route: 'forge:x',
      }, io),
    );
  });

  test('accepts entries without route on non-sort stages', () => {
    const io = mockIO(null);
    assert.doesNotThrow(() =>
      appendEntry('h.yaml', {
        cycle: 'c1',
        stage: 'forge:write',
        iteration: 1,
        comment: 'done',
      }, io),
    );
  });
});
```

Note: `mockIO` in `tests/lib/history.test.js` is defined locally — inspect it to confirm it supports `writeFile` plus the state needed for this test. If the existing mock doesn't support multiple writes, extend it.

- [ ] **Step 2: Run and confirm failure**

Run: `node --test tests/lib/history.test.js`
Expected: the first new test fails (no such check in `appendEntry` today). Second and third pass.

---

## Task 2.6: Enforce route ⇒ stage==='sort' (GREEN)

**Files:** Modify `scripts/lib/history.js`.

- [ ] **Step 1: Add the guard**

In `scripts/lib/history.js:appendEntry`, after the existing `iteration`/`comment` guards (around line 23), add:

```js
  if (route !== undefined && stage !== 'sort') {
    throw new Error(`route is only valid on stage='sort' entries; got stage='${stage}'`);
  }
```

- [ ] **Step 2: Run tests and confirm pass**

Run: `node --test tests/lib/history.test.js`
Expected: all new tests pass; existing tests still pass.

- [ ] **Step 3: Full suite**

Run: `npm test`
Expected: no regressions. If this breaks an existing test that wrote route with a non-sort stage, that test was exercising an invalid state — fix the test fixture to use `stage: 'sort'`.

- [ ] **Step 4: Commit**

```bash
git add scripts/lib/history.js tests/lib/history.test.js
git commit -m "feat(history): enforce route ⇒ stage==='sort' invariant

Per spec §11.4, appendEntry now throws when route is supplied alongside
a non-sort stage. This invariant was implicit: orchestrate.js only sets
route on sort entries, but nothing prevented a caller from violating it.
Also closes the audit gap where the route field wasn't documented."
```

---

## Task 2.7: Add seq field with (timestamp, seq) sort (RED)

**Files:** Modify `tests/lib/history.test.js`.

Spec §11.2.

- [ ] **Step 1: Add tests**

```js
describe('appendEntry — seq field', () => {
  test('first entry has seq 0', () => {
    const io = mockIO(null);
    appendEntry('h.yaml', { cycle: 'c1', stage: 'forge:w', iteration: 1, comment: 'x' }, io);
    const data = yaml.load(io._get('h.yaml'));
    assert.equal(data[0].seq, 0);
  });

  test('subsequent entries increment seq', () => {
    const io = mockIO(null);
    appendEntry('h.yaml', { cycle: 'c1', stage: 'forge:w', iteration: 1, comment: 'a' }, io);
    appendEntry('h.yaml', { cycle: 'c1', stage: 'quench:q', iteration: 1, comment: 'b' }, io);
    const data = yaml.load(io._get('h.yaml'));
    assert.equal(data[0].seq, 0);
    assert.equal(data[1].seq, 1);
  });
});

describe('loadHistory — (timestamp, seq) sort', () => {
  test('entries with same timestamp sort by seq ascending', () => {
    const sameTs = '2026-04-24T10:00:00.000Z';
    const data = yaml.dump([
      { cycle: 'c1', stage: 'b', iteration: 1, comment: 'b', timestamp: sameTs, seq: 2 },
      { cycle: 'c1', stage: 'a', iteration: 1, comment: 'a', timestamp: sameTs, seq: 1 },
    ]);
    const r = loadHistory('h.yaml', 'c1', mockIO(data));
    assert.equal(r[0].stage, 'a');
    assert.equal(r[1].stage, 'b');
  });

  test('entries missing seq are treated as seq 0 (backward compatible)', () => {
    const sameTs = '2026-04-24T10:00:00.000Z';
    const data = yaml.dump([
      { cycle: 'c1', stage: 'first', iteration: 1, comment: 'a', timestamp: sameTs }, // no seq
      { cycle: 'c1', stage: 'second', iteration: 1, comment: 'b', timestamp: sameTs, seq: 5 },
    ]);
    const r = loadHistory('h.yaml', 'c1', mockIO(data));
    assert.equal(r[0].stage, 'first');
    assert.equal(r[1].stage, 'second');
  });
});
```

Note: the `mockIO` helper in `tests/lib/history.test.js` may not expose the written content. Check the helper at the top of that file. If it only reads, extend it to expose `_get` (or equivalent) for assertion — there's likely already a pattern for checking what was written.

- [ ] **Step 2: Run and confirm failure**

Run: `node --test tests/lib/history.test.js`
Expected: new tests fail — `seq` is undefined on entries, and the sort comparator doesn't consider seq.

---

## Task 2.8: Add seq field with (timestamp, seq) sort (GREEN)

**Files:** Modify `scripts/lib/history.js`.

- [ ] **Step 1: Wire seq into appendEntry**

In `scripts/lib/history.js:appendEntry`, replace the body that constructs `entry`:

```js
  const entry = {
    cycle,
    stage,
    iteration,
    comment,
    timestamp: new Date().toISOString(),
    seq: existing.length,
  };
  if (route !== undefined) entry.route = route;
  existing.push(entry);
```

- [ ] **Step 2: Wire seq into loadHistory**

Replace the `filtered.sort(...)` block:

```js
  filtered.sort((a, b) => {
    const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
    const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
    if (ta !== tb) return ta - tb;
    const sa = typeof a.seq === 'number' ? a.seq : 0;
    const sb = typeof b.seq === 'number' ? b.seq : 0;
    return sa - sb;
  });
```

- [ ] **Step 3: Run tests and confirm pass**

Run: `node --test tests/lib/history.test.js`
Expected: all new tests pass.

- [ ] **Step 4: Full suite**

Run: `npm test`
Expected: no regressions.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/history.js tests/lib/history.test.js
git commit -m "feat(history): explicit seq field; sort by (timestamp, seq)

Same-millisecond history entries previously relied on V8 stable sort to
preserve insertion order — a latent ordering bug per spec §11.2.
appendEntry now stamps an explicit seq counter equal to the pre-existing
entry count. loadHistory's comparator is (timestamp asc, seq asc).
Entries written before this change lack seq and are treated as seq=0
on read, preserving their original file order."
```

---

## Task 2.8.5: Extend inline `mockIO` helpers with `rename`

**Files:** every test file that defines an inline `mockIO` (or similar in-memory IO shim) helper.

**Rationale:** The atomic-write refactor in tasks 2.9/2.10 replaces a single `io.writeFile(path, body)` call with `io.writeFile(tmp, body); io.rename(tmp, path)`. Every inline in-memory IO mock that exercises `appendEntry` (or any other path that will gain atomic-rename semantics) therefore needs a `rename(src, dst)` method. There is **no shared `tests/helpers/mockIO.js`** today — each test file builds its own inline shim. Adding `rename` in one place is not an option; it must be added everywhere.

Doing this refactor up-front (before task 2.9) keeps the RED step in 2.9 honest: the test will fail because the production code doesn't call `rename`, not because the mock is missing `rename`.

- [ ] **Step 1: Grep for inline mockIO constructors**

```bash
rg -n 'function mockIO|const mockIO\s*=' tests/
rg -n 'mockIO\s*=\s*\(' tests/
```

Enumerate every hit. Expected locations (verify by running the greps — the list may grow):
- `tests/lib/history.test.js`
- `tests/lib/workfile.test.js` (if present)
- Any other `tests/lib/*.test.js` or `tests/plugin/*.test.js` that rolls its own IO shim

For each hit, read the helper to understand its storage shape (single-path closure, `{path → content}` map, etc.). The `rename` implementation shape must match the storage shape.

- [ ] **Step 2: RED — add a single test that asserts rename capability**

Pick one well-exercised mockIO site (e.g. `tests/lib/history.test.js`) and add:

```js
describe('mockIO — rename capability', () => {
  test('rename moves content and removes the source key', () => {
    const io = mockIO(null);
    io.writeFile('a.yaml', 'hello');
    io.rename('a.yaml', 'b.yaml');
    assert.equal(io.exists('a.yaml'), false);
    assert.equal(io.readFile('b.yaml'), 'hello');
  });
});
```

Run: `node --test tests/lib/history.test.js`
Expected: FAIL with `io.rename is not a function` (or a similar missing-method error).

If the existing `mockIO` is single-path and doesn't support multiple keys, this step doubles as the multi-path refactor: rewrite the helper to hold a `{ path → content }` map so `rename(a, b)` can `map.set(b, map.get(a)); map.delete(a)`. Update every call site in that file accordingly (e.g. `mockIO(data)` → `mockIO({ 'h.yaml': data })` if the helper previously accepted raw content; or keep the positional-string form as shorthand for "one file named `h.yaml`").

- [ ] **Step 3: GREEN — implement `rename` in every inline mock from Step 1**

For a `{path → content}` map-backed helper:

```js
rename: (from, to) => {
  if (!(from in files)) throw new Error(`ENOENT: ${from}`);
  files[to] = files[from];
  delete files[from];
},
```

For a single-path closure helper (if the refactor to multi-path is out of scope for that specific file — unlikely but possible), emulate with a named-pair check:

```js
rename: (from, to) => {
  if (from !== currentPath) throw new Error(`ENOENT: ${from}`);
  currentPath = to;
},
```

Prefer the map-backed form. Grep at the end of this task to confirm every mockIO from Step 1's enumeration now has a `rename` method:

```bash
rg -n 'rename\s*:' tests/
```

- [ ] **Step 4: Run full suite**

```bash
npm test
```

Expected: green. The added `rename` method is dormant — no production code calls it yet (that starts in task 2.10). This task adds the capability only; behaviour is unchanged.

- [ ] **Step 5: Commit**

```bash
git add tests/
git commit -m 'test(io): add rename capability to mockIO helpers

Prepares the test fixtures for the atomic-rename refactor in tasks 2.9
and 2.10. Every inline mockIO across the test suite gains a rename(src,
dst) method that moves content and removes the source key, mirroring
the production makeIO.rename semantics. No production code calls the
new method yet; this is a test-only capability add.'
```

---

## Task 2.9: Atomic history writes (RED)

**Files:** Modify `tests/lib/history.test.js`.

Spec §11.6 + §9.2.

- [ ] **Step 1: Add atomicity test**

The test calls `appendEntry` normally and asserts that the production code routed through `io.rename` (i.e. never wrote directly to the final path). Today it writes directly; tomorrow (task 2.10) it writes to `<path>.tmp` and renames. This RED is driven by the absence of the rename call in production, not by simulating a rename failure.

```js
describe('appendEntry — atomic write', () => {
  test('routes through io.rename rather than writing the live path directly', () => {
    const io = mockIO(null);
    // Spy on rename.
    let renameCalled = false;
    const underlyingRename = io.rename;
    io.rename = (from, to) => { renameCalled = true; return underlyingRename(from, to); };
    // Spy on writeFile targets.
    const writtenPaths = [];
    const underlyingWrite = io.writeFile;
    io.writeFile = (p, body) => { writtenPaths.push(p); return underlyingWrite(p, body); };

    appendEntry('h.yaml', { cycle: 'c1', stage: 'quench:q', iteration: 1, comment: 'x' }, io);

    assert.equal(renameCalled, true, 'appendEntry must call io.rename');
    assert.ok(
      writtenPaths.some(p => p.endsWith('.tmp')),
      `expected a .tmp write; got ${JSON.stringify(writtenPaths)}`,
    );
    assert.ok(
      !writtenPaths.includes('h.yaml'),
      'appendEntry must not writeFile the live path directly',
    );
  });

  test('rename failure leaves the live history file unchanged', () => {
    const initial = yaml.dump([
      { cycle: 'c1', stage: 'forge:w', iteration: 1, comment: 'pre-existing', timestamp: '2026-04-24T09:00:00.000Z', seq: 0 },
    ]);
    const io = mockIO(initial);
    const before = io._get('h.yaml');
    // Override rename to throw. rename is available because of task 2.8.5.
    io.rename = () => { throw new Error('simulated rename failure'); };
    assert.throws(
      () => appendEntry('h.yaml', { cycle: 'c1', stage: 'quench:q', iteration: 1, comment: 'x' }, io),
      /simulated rename failure/,
    );
    assert.equal(io._get('h.yaml'), before, 'live file must be unchanged');
  });
});
```

Note: `io.rename` is provided by the mockIO helpers courtesy of task 2.8.5 — do NOT monkey-patch it in for the first test. The second test overrides it only to simulate a post-implementation crash scenario.

- [ ] **Step 2: Run and confirm failure**

Run: `node --test tests/lib/history.test.js`
Expected: the first new test fails with `appendEntry must call io.rename` (renameCalled is false — current `appendEntry` goes straight to `io.writeFile(historyPath, body)`). The second new test also fails: `appendEntry` never reaches the rename step, so the `simulated rename failure` error is never thrown; `assert.throws` fails with a "function did not throw" shape.

Both failures are for the right reason — production code doesn't route through rename yet. Task 2.10 makes them pass.

---

## Task 2.10: Atomic history writes (GREEN)

**Files:** Modify `scripts/lib/history.js`.

- [ ] **Step 1: Switch to tmp+rename**

Replace the final `io.writeFile(historyPath, yaml.dump(existing));` line in `appendEntry` with:

```js
  const body = yaml.dump(existing);
  const tmp = `${historyPath}.tmp`;
  io.writeFile(tmp, body);
  io.rename(tmp, historyPath);
```

- [ ] **Step 2: Run tests and confirm pass**

Run: `node --test tests/lib/history.test.js`
Expected: all tests pass (including the new rename-failure test).

- [ ] **Step 3: Full suite**

Run: `npm test`
Expected: all green. Any test that uses a mock IO without `rename` will fail — fix each by extending the mock. Search for candidate mocks:

```bash
rg -n 'writeFile.*historyPath|appendEntry' tests/ .opencode/
```

Note: `io.rename` is available across every inline `mockIO` helper courtesy of task 2.8.5 — no ad-hoc extensions should be needed here. If any test still blows up with `io.rename is not a function`, that test's mock was missed in 2.8.5; fix it there (amend the 2.8.5 commit) rather than patching ad-hoc.

- [ ] **Step 4: Commit**

```bash
git add scripts/lib/history.js tests/lib/history.test.js
git commit -m "feat(history): atomic appendEntry via write-temp-then-rename

Per spec §11.6 + §9.2 and observed incompleteness in WORK.history.yaml
in the wild, appendEntry now writes the serialised yaml to a sibling
.tmp file and then calls io.rename. A crash between the two steps leaves
the live file untouched; a stray .tmp remains and is harmless.

Test mocks updated to implement rename; test-only shim mirrors the
production semantics."
```

---

## Task 2.11: Malformed-yaml triggers markWorkfileFailed (RED)

**Files:** Modify `tests/lib/history.test.js`.

Spec §11.3.

- [ ] **Step 1: Add tests**

```js
import { markWorkfileFailed } from '../../scripts/lib/failed-flow.js';  // for assertion only

describe('loadHistory — malformed yaml', () => {
  test('parse failure throws and marks the flow failed', () => {
    // Set up mock IO with a bogus yaml file AND a WORK.md so markWorkfileFailed has something to mark.
    const io = mockIO(':::not-yaml:::');
    // Ensure WORK.md exists for markWorkfileFailed to update.
    io.writeFile('WORK.md', '---\nflow: f\ncycle: c1\n---\n\n# Goal\n\ngo\n\n| File | Type | Cycle | Status |\n|------|------|-------|--------|\n');
    // mockIO is multi-path courtesy of task 2.8.5 — writing WORK.md alongside h.yaml just works.
    assert.throws(
      () => loadHistory('h.yaml', 'c1', io),
      /history\.yaml malformed/i,
    );
    // Confirm WORK.md now has status: failed in frontmatter.
    assert.match(io.readFile('WORK.md'), /status:\s*failed/);
  });

  test('non-array root is treated as malformed', () => {
    const io = mockIO(yaml.dump({ not: 'an array' }));
    io.writeFile('WORK.md', '---\nflow: f\ncycle: c1\n---\n\n# Goal\n\ngo\n\n| File | Type | Cycle | Status |\n|------|------|-------|--------|\n');
    assert.throws(
      () => loadHistory('h.yaml', 'c1', io),
      /history\.yaml malformed/i,
    );
  });
});
```

Note: the mockIO helper is already multi-path with a `rename` method after task 2.8.5. No further refactor is needed here.

- [ ] **Step 2: Run and confirm failure**

Run: `node --test tests/lib/history.test.js`
Expected: the two new tests fail because `loadHistory` doesn't call `markWorkfileFailed` on parse error today.

---

## Task 2.12: Malformed-yaml triggers markWorkfileFailed (GREEN)

**Files:** Modify `scripts/lib/history.js`.

- [ ] **Step 1: Add import**

At the top of `scripts/lib/history.js`:

```js
import yaml from 'js-yaml';
import { markWorkfileFailed } from './failed-flow.js';
```

- [ ] **Step 2: Wrap yaml.load in try/catch**

Replace lines 6–16 (`loadHistory` body):

```js
export function loadHistory(historyPath, cycle, io) {
  if (!io.exists(historyPath)) return [];
  const text = io.readFile(historyPath);
  let data;
  try {
    data = yaml.load(text) || [];
    if (!Array.isArray(data)) {
      throw new Error(`root is not an array`);
    }
  } catch (err) {
    const msg = `WORK.history.yaml malformed: ${err.message}`;
    try { markWorkfileFailed(io, msg); } catch { /* WORK.md gone; nothing to mark */ }
    throw new Error(msg);
  }
  const filtered = data.filter(e => e.cycle === cycle);
  filtered.sort((a, b) => {
    const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
    const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
    if (ta !== tb) return ta - tb;
    const sa = typeof a.seq === 'number' ? a.seq : 0;
    const sb = typeof b.seq === 'number' ? b.seq : 0;
    return sa - sb;
  });
  return filtered;
}
```

- [ ] **Step 3: Run tests and confirm pass**

Run: `node --test tests/lib/history.test.js`
Expected: all new tests pass.

- [ ] **Step 4: Full suite**

Run: `npm test`
Expected: no regressions. If something breaks, it's likely a test passing an unterminated yaml string intentionally to check the `|| []` fallback — that behaviour is preserved for empty/null input (`yaml.load('') === undefined → [] via || []`).

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/history.js tests/lib/history.test.js
git commit -m "feat(history): mark workfile failed on malformed yaml

Per spec §11.3, loadHistory now wraps yaml.load in try/catch and calls
markWorkfileFailed on parse failure or non-array root, mirroring the
pattern established in the P0 #3 failed-flow series for memory sync.
markWorkfileFailed is itself wrapped in a defensive try/catch so a
missing WORK.md cannot shadow the original parse error."
```

---

## Task 2.13: getIteration doc comment

**Files:** Modify `scripts/lib/history.js`.

Spec §11.7. No test changes — this is pure documentation.

- [ ] **Step 1: Expand the jsdoc**

Replace the comment on `getIteration` (currently around line 44 — `/** Count forge entries for a cycle. */`):

```js
/**
 * Count COMPLETED forge stages for a cycle. This includes forges that ran to
 * completion but whose downstream appraise deadlocked or blocked the cycle —
 * completion here means "stage_end was called", not "cycle progressed".
 * Used by sort for max-iterations enforcement.
 */
```

- [ ] **Step 2: Run full suite**

Run: `npm test`
Expected: unchanged.

- [ ] **Step 3: Commit**

```bash
git add scripts/lib/history.js
git commit -m "docs(history): clarify getIteration semantics

Per spec §11.7, documents that getIteration counts COMPLETED forge
stages (stage_end was called), not forges that advanced the cycle.
Removes surprise when max-iterations fires after a run whose forges
all deadlocked downstream."
```

---

## Task 2.13.5: `appendEntry` accepts `open_feedback` option (RED)

**Files:** Modify `tests/lib/history.test.js`.

Spec §10 + REVISION-CONTRACT §B2: `appendEntry` gains an `open_feedback` option. The field is always present on new entries (coercion handled in the next task). Phase 4 later threads a real value in from `orchestrate.js`; until then, callers either pass it explicitly or leave it undefined.

This task adds the parameter plumbing; task 2.13.6 adds the `undefined → 0` coercion invariant.

- [ ] **Step 1: Add the signature test**

```js
describe('appendEntry — open_feedback parameter', () => {
  test('stamps the provided open_feedback value onto the entry', () => {
    const io = mockIO(null);
    appendEntry(
      'h.yaml',
      { cycle: 'c1', stage: 'forge:w', iteration: 1, comment: 'x', openFeedback: 7 },
      io,
    );
    const data = yaml.load(io._get('h.yaml'));
    assert.equal(data[0].open_feedback, 7);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `node --test tests/lib/history.test.js`
Expected: FAIL — current `appendEntry` does not read `openFeedback` from its options; the stamped entry has no `open_feedback` field, so `data[0].open_feedback` is `undefined` and the assertion fails with `undefined !== 7`.

---

## Task 2.13.6: `appendEntry` open_feedback signature (GREEN) + undefined→0 coercion (RED/GREEN)

**Files:** Modify `scripts/lib/history.js`, `tests/lib/history.test.js`.

- [ ] **Step 1: GREEN the signature test**

In `scripts/lib/history.js:appendEntry`, destructure `openFeedback` from the options and stamp it onto the entry as `open_feedback`:

```js
export function appendEntry(historyPath, opts, io) {
  const { cycle, stage, iteration, comment, route, openFeedback } = opts;
  // ... existing guards ...
  const entry = {
    cycle,
    stage,
    iteration,
    comment,
    timestamp: new Date().toISOString(),
    seq: existing.length,
    open_feedback: openFeedback ?? 0,
  };
  if (route !== undefined) entry.route = route;
  existing.push(entry);
  // ... existing tmp+rename write ...
}
```

The `?? 0` is the coercion from step 2 — wiring it in now keeps the GREEN minimal, but we still RED the coercion invariant explicitly before relying on it.

Actually — to keep TDD discipline honest, do the `?? 0` coercion in this same GREEN only if the signature test from 2.13.5 passes without it. It won't: passing a numeric `7` through `entry.open_feedback = openFeedback` would stamp `7`. So land the signature GREEN using plain assignment first:

```js
    open_feedback: openFeedback,
```

Run: `node --test tests/lib/history.test.js`
Expected: 2.13.5's test passes. Proceed to Step 2.

- [ ] **Step 2: RED the coercion invariant**

Append to `tests/lib/history.test.js`:

```js
describe('appendEntry — open_feedback coercion', () => {
  test('undefined openFeedback coerces to 0 (field always present)', () => {
    const io = mockIO(null);
    appendEntry(
      'h.yaml',
      { cycle: 'c1', stage: 'forge:w', iteration: 1, comment: 'x' }, // no openFeedback
      io,
    );
    const data = yaml.load(io._get('h.yaml'));
    assert.ok('open_feedback' in data[0], 'open_feedback field must be present');
    assert.strictEqual(data[0].open_feedback, 0);
  });

  test('explicit zero is preserved', () => {
    const io = mockIO(null);
    appendEntry(
      'h.yaml',
      { cycle: 'c1', stage: 'forge:w', iteration: 1, comment: 'x', openFeedback: 0 },
      io,
    );
    const data = yaml.load(io._get('h.yaml'));
    assert.strictEqual(data[0].open_feedback, 0);
  });
});
```

Run: `node --test tests/lib/history.test.js`
Expected: the `undefined` test fails — after Step 1, undefined is stamped as literal `undefined`, which `js-yaml` either omits or serialises as `null`. Either way `assert.strictEqual(undefined|null, 0)` fails. The explicit-zero test passes after Step 1.

- [ ] **Step 3: GREEN the coercion**

Change the entry construction:

```js
    open_feedback: openFeedback ?? 0,
```

Run: `node --test tests/lib/history.test.js`
Expected: both new tests pass; all prior tests still pass.

- [ ] **Step 4: Full suite**

```bash
npm test
```

Expected: no regressions. Existing tests that called `appendEntry` without `openFeedback` now write entries with `open_feedback: 0`. Any test that asserts exact-entry-shape on a file written by `appendEntry` must be updated to expect the new field; grep:

```bash
rg -n 'open_feedback|openFeedback' tests/ scripts/ .opencode/
```

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/history.js tests/lib/history.test.js
git commit -m 'feat(history): appendEntry accepts openFeedback with undefined→0 coercion

Per spec §10 and REVISION-CONTRACT §B2, appendEntry now reads an
openFeedback option from its opts object and stamps open_feedback on
every new entry. Undefined coerces to 0 so the field is always present;
explicit zero is preserved. Phase 4 will thread a real count in from
orchestrate.js; until then callers either omit the option (field
defaults to 0) or pass an explicit value.

The shape invariant (open_feedback always present) is phase 2 work;
the call-site computation (countOpen() in orchestrate) is phase 4.'
```

---

## Task 2.14: Remove `## Feedback` section from WORK.md (RED)

**Files:** Modify `tests/lib/workfile.test.js` (or the equivalent — inspect first).

Spec §7.

- [ ] **Step 1: Inspect existing createWorkfile tests**

```bash
rg -n "createWorkfile" tests/
```

Find the test that asserts the generated WORK.md contains `## Feedback`. The existing assertion likely looks like:

```js
assert.match(result, /## Feedback/);
```

- [ ] **Step 2: Invert the assertion**

Change the existing passing assertion to assert **absence**:

```js
assert.doesNotMatch(result, /^##\s+Feedback/m);
```

- [ ] **Step 3: Run and confirm failure**

Run: `node --test tests/lib/workfile.test.js`
Expected: FAIL because `createWorkfile` still emits the header.

---

## Task 2.15: Remove `## Feedback` section from WORK.md (GREEN)

**Files:** Modify `scripts/lib/workfile.js`.

- [ ] **Step 1: Preflight — inventory every `## Feedback` reference in tests**

Before making assumptions about which tests will break, grep the known-suspect fixture sites plus the broader plugin test tree:

```bash
rg -n '^## Feedback' tests/fixtures/failed-flow-*.test.js 2>&1 || true
rg -n '^## Feedback|## Feedback' tests/plugin/ tests/lib/
```

For every hit, classify:
- **Fixture template** (hard-coded string embedded in a test file to simulate a historical WORK.md): leave untouched. The legacy `feedback.js` walker still tolerates `## Feedback` sections if present, so the fixture's continued inclusion of the heading does not regress behaviour.
- **Assertion on `createWorkfile` output** (test expects the heading in freshly-generated WORK.md): must be inverted in task 2.14 before landing this GREEN. If task 2.14 missed one, come back and fix it.

Expected classification (verify by actually reading each hit):
- `tests/plugin/stage-end-failed-flow.test.js`, `tests/plugin/failed-flow-e2e.test.js`, `tests/plugin/failed-flow-tool-gate.test.js` → fixture templates, leave alone.
- `tests/lib/workfile.test.js` → assertion on `createWorkfile` output; task 2.14 already inverted it.

If a hit falls outside these classifications, stop and escalate rather than guessing.

- [ ] **Step 2: Remove the heading from the template**

In `scripts/lib/workfile.js:createWorkfile` (line 104), change:

```js
  return `${fm}
# Goal

${goal}

| File | Type | Cycle | Status |
|------|------|-------|--------|

## Feedback
`;
```

to:

```js
  return `${fm}
# Goal

${goal}

| File | Type | Cycle | Status |
|------|------|-------|--------|
`;
```

- [ ] **Step 3: Run tests and confirm pass**

Run: `node --test tests/lib/workfile.test.js`
Expected: pass.

- [ ] **Step 4: Full suite**

Run: `npm test`
Expected: **will likely break tests that seeded WORK.md fixtures with `## Feedback` present**. Classification was done in Step 1; cross-reference the hits enumerated there. Specifically:
- `tests/plugin/stage-end-failed-flow.test.js:34`
- `tests/plugin/failed-flow-e2e.test.js:32`
- `tests/plugin/failed-flow-tool-gate.test.js:34`

These tests embed the heading in a fixture template; they should keep it (the fixture represents historical WORK.md content and the tests don't care about the heading). Do **not** modify them here — they stay green because the legacy `feedback.js` walker still handles `## Feedback` sections if they exist. Leave them alone.

The failing tests we actually expect are any that create a new WORK.md via `createWorkfile` and then read it back expecting the heading. Those must be updated: invert their assertions (the heading is gone) or delete assertions that are now vacuous.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/workfile.js tests/lib/workfile.test.js
git commit -m "feat(workfile): stop emitting ## Feedback heading

Per spec §7, WORK.md no longer owns feedback state — it moves to
WORK.feedback.yaml. createWorkfile emits the goal and the artefacts
table only; plugin tools and skills gain the new yaml file from
phases 3–5.

Test fixtures in tests/plugin/failed-flow-*.test.js still embed the
heading in historical-shape fixtures and are left untouched — the
legacy feedback parser handles them gracefully until phase 4."
```

---

## Task 2.16: Phase 2 verification gate

- [ ] **Step 1: Full suite**

```bash
npm test
```
Expected: all green. Test count delta: +3 helpers.test, +3 route invariant, +3 seq, +1 atomic, +2 malformed, minus 3 readLastSortRoute deleted = roughly +9 net.

- [ ] **Step 2: Confirm no leaked legacy refs in production code**

```bash
rg -n "readLastSortRoute" scripts/ .opencode/
```
Expected: zero matches.

```bash
rg -n "^## Feedback|'## Feedback'|\"## Feedback\"" scripts/
```
Expected: zero matches (tests may still have fixtures — those are OK).

- [ ] **Step 3: Confirm history.js handles the full spec-§11 surface**

Spot check `scripts/lib/history.js`:
- `readLastSortRoute` gone.
- `appendEntry` stamps `seq`.
- `appendEntry` throws on `route` + non-sort.
- `appendEntry` writes via `io.writeFile(tmp) + io.rename`.
- `loadHistory` sorts by `(timestamp, seq)`.
- `loadHistory` catches parse error and calls `markWorkfileFailed`.
- `getIteration` has the new doc comment.

- [ ] **Step 4: Handoff**

Phase 2 complete. Tell the operator:

> "Phase 2 complete. history.js hardened: atomic writes, seq field, route invariant, markWorkfileFailed on parse error, readLastSortRoute deleted, getIteration documented. IO shim gains rename. createWorkfile stops emitting ## Feedback. Full suite green. Ready for phase 3."

---

## Revision Notes

Applied during revision against REVISION-CONTRACT §C2 + §B2 + §B5:

- Contract item "Task 2.15 preflight grep" — **added** as new Step 1 of task 2.15. Contract literally cites `tests/fixtures/failed-flow-*.test.js`, but those files live under `tests/plugin/`; the step greps both locations (the contract path first for faithfulness, then the actual tree).
- The following contract items were already reflected in the file prior to this revision pass — verified and left intact rather than duplicated:
  - Task 2.8.5 (mockIO rename extension, §B5) — present at lines 431–520 with the four-step RED/GREEN shape the contract requires.
  - Task 2.9 RED rewrite (fail on missing rename, not monkey-patched throw) — present at lines 524–584. The first sub-test spies on `io.rename` and asserts `renameCalled === true`; the monkey-patched-throw path is isolated to a second sub-test whose failure reason ("function did not throw") is explicitly called out as the right-reason failure in step 2.
  - Removal of the buried mockIO hand-wave in task 2.11 — done; the current note at line 673 is a deliberate post-2.8.5 cross-reference, not a hand-wave.
  - `open_feedback` coercion + `appendEntry` signature change (§B2) — present as tasks 2.13.5 (signature RED) and 2.13.6 (GREEN + coercion RED/GREEN) at lines 790–932.
  - Cross-reference in task 2.10 step 3 that rename is already extended via 2.8.5 — present at line 617.
  - Malformed `rg` pipe fix in task 2.10 step 3 — already uses a bare `|` at line 614; no `\|` remains.
  - Shell-escaping sweep of commit-message blocks — inspected every `git commit -m "..."` body (lines 134, 199, 298, 419, 623, 741, 780, 1043); none contain backticks or `$(...)` inside double quotes. The single-quoted commit bodies at 513 and 921 are already correct. Nothing to fix.
- No changes required outside `phase-2-history-hardening.md` per §F ground rules.
