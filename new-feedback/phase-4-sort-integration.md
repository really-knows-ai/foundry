# Phase 4: Sort Integration + Orchestrate open_feedback + Legacy Cleanup

**Scope:** Replace `detectDeadlocks` (the P1 [feedback M1] bug site) with a top-level `runSort` deadlock pass that calls phase 1's batch primitive `writeDeadlockedSnapshots(items, reason, stage, cycle)`. Update sort's routing predicate to read `history[0].state === 'deadlocked'` from the store. Update `runSort`'s feedback source from markdown parsing to the feedback-store. Thread an already-computed `openFeedback` value into orchestrate's `appendEntry` call sites (the `appendEntry` signature change itself lands in phase 2 — see REVISION-CONTRACT §B2). Update orchestrate's `readRecentFeedback` to read from the store. Delete the legacy `scripts/lib/feedback.js` and `tests/lib/feedback.test.js`. Update sort tests to construct a feedback-store instead of a markdown fixture.

**Spec sections covered:** §5.2 (per-item deadlock depth), §6.1 (top-of-`runSort` deadlock pass, single atomic batch write), §10 (open_feedback computation at call site), §14.3 (sort integration tests).

**Preconditions:** Phases 1–3 committed and green. `.opencode/plugins/foundry-tools/feedback-tools.js` and `assay-tools.js` no longer import from `scripts/lib/feedback.js`. Phase 1 has exported `writeDeadlockedSnapshots(items, reason, stage, cycle)` as a batch primitive on `feedback-store.js` (REVISION-CONTRACT §B1). Phase 2 has extended `appendEntry`'s signature with `open_feedback` and introduced the `undefined → 0` coercion (REVISION-CONTRACT §B2); phase 4 only passes the value through.

**Files in this phase:**
- Modify: `scripts/sort.js`
- Modify: `scripts/orchestrate.js`
- Rewrite: `tests/sort.test.js` (the deadlock + feedback sections)
- Delete: `scripts/lib/feedback.js`
- Delete: `tests/lib/feedback.test.js`
- Delete: `tests/lib/feedback-walker.test.js` (if it exists — check in preflight)

**Cross-phase note — `io.rename` availability.** Every inline `mockIO` in `tests/sort.test.js` already has `rename` because phase 2 task 2.8.5 swept all inline mocks in the tree. Phase 4 does not re-extend any mock; if a `rename`-missing failure surfaces here, the failing mock was missed in phase 2 and that phase's sweep needs amending — do not patch locally.

**Preflight:**

- [ ] **Confirm phase 4 branch is rebased on phase 3 branch** (per REVISION-CONTRACT §B4 / PLAN.md merge-boundary warning — phases 3 and 4 must land together; `main` between them is broken because sort reads a format plugin tools no longer write).

```bash
# Confirm phase-3 state.
rg -n "from.*scripts/lib/feedback\.js" .opencode/
# Expect: zero matches.

rg -n "from.*scripts/lib/feedback\.js" scripts/
# Expect: scripts/sort.js and scripts/orchestrate.js only.

ls tests/lib/feedback-walker.test.js 2>&1 || echo "no walker test to delete"

# Confirm phase-1 batch primitive is in place:
rg -n "writeDeadlockedSnapshots" scripts/lib/feedback-store.js
# Expect: one export.

# Confirm phase-2 appendEntry signature is in place:
rg -n "open_feedback" scripts/lib/history.js
# Expect: at least one match (destructure + coercion).

# Baseline.
npm test
```

---

## Task 4.1: Sort reads from feedback-store (RED)

**Files:** Modify `tests/sort.test.js`.

The current sort tests construct WORK.md fixtures with a `## Feedback` section and assume `parseFeedback(workText, cycle, artefacts)` extracts items. We replace both.

- [ ] **Step 1: Read the existing sort.test.js structure**

```bash
wc -l tests/sort.test.js
rg -n 'parseFeedback|detectDeadlocks|runSort|describe\(' tests/sort.test.js | head -40
```

Identify the major describe blocks:
- `describe('parseFeedbackItem'...)` — phase 4 deletes this block entirely (the function is gone).
- `describe('parseFeedback'...)` — same, delete.
- `describe('runSort' ...)` or equivalent — edit to use feedback-store.
- Any block that tests `detectDeadlocks` directly — rewrite as deadlock-snapshot tests.

- [ ] **Step 2: Delete the now-obsolete blocks**

Delete the entire `describe('parseFeedbackItem', ...)` and `describe('parseFeedback', ...)` blocks from `tests/sort.test.js`. These tests cover markdown parsing that no longer exists.

Remove the corresponding imports:

```js
// Before:
import { parseFeedback, parseFeedbackItem } from '../scripts/sort.js';
// After:
// (removed)
```

Keep: `loadHistory`, `runSort`.

- [ ] **Step 3: Add feedback-store construction helper to the test file**

Add at the top of `tests/sort.test.js` (after imports):

```js
import yaml from 'js-yaml';
import { openFeedbackStore } from '../scripts/lib/feedback-store.js';

// Build a mock IO that holds WORK.md + WORK.feedback.yaml + WORK.history.yaml
// in a single map. `rename` is REQUIRED — phase 2 task 2.8.5 already added it
// to every inline mockIO in the tree; this helper matches that shape.
function makeSortIO(files = {}) {
  const store = { ...files };
  return {
    exists: (p) => Object.prototype.hasOwnProperty.call(store, p),
    readFile: (p) => {
      if (!(p in store)) throw new Error(`ENOENT: ${p}`);
      return store[p];
    },
    writeFile: (p, c) => { store[p] = c; },
    rename: (from, to) => {
      if (!(from in store)) throw new Error(`ENOENT: ${from}`);
      store[to] = store[from];
      delete store[from];
    },
    unlink: (p) => { delete store[p]; },
    readDir: () => [],
    mkdir: () => {},
    exec: () => '',
    _get: (p) => store[p],
    _set: (p, c) => { store[p] = c; },
  };
}

// Construct a feedback yaml string with N items. Each item's history[0] is the
// current state; items are created with a configurable history array so tests
// can set depth directly. IDs use only Crockford-base32-legal chars (no I, L, O, U).
function makeFeedbackYaml(items) {
  return yaml.dump({
    items: items.map((it, i) => ({
      id: `ID${String(i).padStart(2, '0')}${'Z'.repeat(22)}`.slice(0, 26),
      file: it.file || 'a.md',
      tag: it.tag || 'law:x',
      text: it.text || `item-${i}`,
      source: it.source || 'appraise:w',
      history: it.history || [
        { state: 'open', stage: 'appraise:w', cycle: it.cycle || 'c1', timestamp: '2026-04-24T10:00:00.000Z' },
      ],
    })),
  });
}
```

- [ ] **Step 4: Add failing test for per-item deadlock detection**

`runSort`'s signature (verified at `scripts/sort.js:267`) is:

```js
export function runSort({ workPath, historyPath, foundryDir, cycleDef, agentsDir, mint, now } = {}, io = defaultIO) { ... }
```

All fields have defaults. `cycleDef` is an **optional** single-cycle-definition object (populated by callers from a cycle markdown file); existing tests in `tests/sort.test.js` omit it, letting sort fall back to its defaults. Do the same here — pass only `workPath` and `historyPath`, exactly as in the tests at lines 665, 716, 732 etc. Do NOT invent a `cycleDef` value.

```js
describe('runSort — per-item deadlock (spec §6.1)', () => {
  test('brand-new open item is NOT deadlocked even when cycle iteration count is high', () => {
    const feedbackYaml = makeFeedbackYaml([
      {
        // Single history entry = depth 1; threshold default 3 → not deadlocked.
        history: [{ state: 'open', stage: 'appraise:w', cycle: 'c1', timestamp: '2026-04-24T10:00:00.000Z' }],
      },
    ]);
    // History has 10 forge+appraise entries (old detectDeadlocks would have tripped
    // on the global counter; the new per-item pass must NOT).
    const historyEntries = [];
    for (let i = 0; i < 5; i++) {
      historyEntries.push({ cycle: 'c1', stage: 'forge:w', iteration: i, comment: 'x', timestamp: `2026-04-24T10:0${i}:00.000Z`, seq: i * 2 });
      historyEntries.push({ cycle: 'c1', stage: 'appraise:w', iteration: i, comment: 'x', timestamp: `2026-04-24T10:0${i}:30.000Z`, seq: i * 2 + 1 });
    }
    const io = makeSortIO({
      'WORK.md': `---\nflow: f\ncycle: c1\nstages:\n  - forge:w\n  - appraise:w\ndeadlock-appraise: true\ndeadlock-iterations: 3\nmax-iterations: 100\n---\n\n# Goal\n\ngo\n\n| File | Type | Cycle | Status |\n|------|------|-------|--------|\n| a.md | t | c1 | pending |\n`,
      'WORK.feedback.yaml': feedbackYaml,
      'WORK.history.yaml': yaml.dump(historyEntries),
    });
    const result = runSort({ workPath: 'WORK.md', historyPath: 'WORK.history.yaml' }, io);
    // Expected: route is forge (still needs work), NOT human-appraise (not deadlocked).
    assert.match(result.route, /^forge:/);
    // And no deadlocked snapshot should have been written.
    const doc = yaml.load(io._get('WORK.feedback.yaml'));
    assert.notEqual(doc.items[0].history[0].state, 'deadlocked');
  });

  test('item whose own history depth >= threshold IS deadlocked and routes to human-appraise', () => {
    const feedbackYaml = makeFeedbackYaml([
      {
        history: [
          { state: 'rejected', stage: 'appraise:w', cycle: 'c1', timestamp: '2026-04-24T10:03:00.000Z', reason: 'still bad' },
          { state: 'actioned', stage: 'forge:w', cycle: 'c1', timestamp: '2026-04-24T10:02:00.000Z' },
          { state: 'rejected', stage: 'appraise:w', cycle: 'c1', timestamp: '2026-04-24T10:01:00.000Z', reason: 'bad' },
          { state: 'actioned', stage: 'forge:w', cycle: 'c1', timestamp: '2026-04-24T10:00:30.000Z' },
          { state: 'open', stage: 'appraise:w', cycle: 'c1', timestamp: '2026-04-24T10:00:00.000Z' },
        ],
        // depth = 5, threshold = 3 → deadlocked
      },
    ]);
    const io = makeSortIO({
      'WORK.md': `---\nflow: f\ncycle: c1\nstages:\n  - forge:w\n  - appraise:w\n  - human-appraise:c1\ndeadlock-appraise: true\ndeadlock-iterations: 3\nmax-iterations: 100\n---\n\n# Goal\n\ngo\n\n| File | Type | Cycle | Status |\n|------|------|-------|--------|\n| a.md | t | c1 | pending |\n`,
      'WORK.feedback.yaml': feedbackYaml,
      'WORK.history.yaml': yaml.dump([{ cycle: 'c1', stage: 'appraise:w', iteration: 2, comment: 'x', timestamp: '2026-04-24T10:03:00.000Z', seq: 0 }]),
    });
    const result = runSort({ workPath: 'WORK.md', historyPath: 'WORK.history.yaml' }, io);
    assert.match(result.route, /^human-appraise:/);
    // Verify the snapshot was written via the batch primitive.
    const doc = yaml.load(io._get('WORK.feedback.yaml'));
    assert.equal(doc.items[0].history[0].state, 'deadlocked');
    assert.equal(doc.items[0].history[0].stage, 'sort');
  });

  test('when deadlock-appraise: false, no snapshot is written and route is not forced', () => {
    const feedbackYaml = makeFeedbackYaml([
      {
        // depth 5, but deadlock-appraise disabled → no snapshot, normal routing.
        history: [
          { state: 'rejected', stage: 'appraise:w', cycle: 'c1', timestamp: '2026-04-24T10:03:00.000Z', reason: 'still bad' },
          { state: 'actioned', stage: 'forge:w', cycle: 'c1', timestamp: '2026-04-24T10:02:00.000Z' },
          { state: 'rejected', stage: 'appraise:w', cycle: 'c1', timestamp: '2026-04-24T10:01:00.000Z', reason: 'bad' },
          { state: 'actioned', stage: 'forge:w', cycle: 'c1', timestamp: '2026-04-24T10:00:30.000Z' },
          { state: 'open', stage: 'appraise:w', cycle: 'c1', timestamp: '2026-04-24T10:00:00.000Z' },
        ],
      },
    ]);
    const io = makeSortIO({
      'WORK.md': `---\nflow: f\ncycle: c1\nstages:\n  - forge:w\n  - appraise:w\ndeadlock-appraise: false\ndeadlock-iterations: 3\nmax-iterations: 100\n---\n\n# Goal\n\ngo\n\n| File | Type | Cycle | Status |\n|------|------|-------|--------|\n| a.md | t | c1 | pending |\n`,
      'WORK.feedback.yaml': feedbackYaml,
      'WORK.history.yaml': yaml.dump([{ cycle: 'c1', stage: 'appraise:w', iteration: 2, comment: 'x', timestamp: '2026-04-24T10:03:00.000Z', seq: 0 }]),
    });
    const result = runSort({ workPath: 'WORK.md', historyPath: 'WORK.history.yaml' }, io);
    // No deadlock snapshot written.
    const doc = yaml.load(io._get('WORK.feedback.yaml'));
    assert.notEqual(doc.items[0].history[0].state, 'deadlocked');
    // rejected state → needs forge. Route must NOT be human-appraise (no deadlock).
    assert.doesNotMatch(result.route, /^human-appraise/);
  });
});
```

- [ ] **Step 5: Run and confirm failure**

Run: `node --test tests/sort.test.js`
Expected: all three new tests fail. Most likely failure is "module not found" for `openFeedbackStore` if sort.js hasn't been updated yet, or the routing assertions fail because the existing `detectDeadlocks` path is still live.

---

## Task 4.1.5: Hoist deadlock pass to `runSort` top-level (RED)

**Files:** Add a failing test in `tests/sort.test.js`.

**Why this is a separate task:** Per REVISION-CONTRACT §C4 blocker B1 and spec §6.1, the deadlock pass must run **at the top of `runSort`, before any routing decision** — not inside the appraise branch. This test pins that invariant independent of which routing branch is ultimately taken, so a future refactor can't silently bury the pass back inside `nextAfterAppraise`.

- [ ] **Step 1: Add the test**

```js
describe('runSort — deadlock pass runs before routing (spec §6.1)', () => {
  test('deadlock snapshot is written even when routing would have gone to quench', () => {
    // Construct a scenario where the routing helper would normally send the
    // cycle to quench (e.g. last stage was forge, quench next in stages), but
    // a feedback item has depth >= threshold. The deadlock pass must still
    // run and override the route to human-appraise.
    const feedbackYaml = makeFeedbackYaml([
      {
        history: [
          { state: 'rejected', stage: 'appraise:w', cycle: 'c1', timestamp: '2026-04-24T10:04:00.000Z', reason: 'no' },
          { state: 'actioned', stage: 'forge:w', cycle: 'c1', timestamp: '2026-04-24T10:03:00.000Z' },
          { state: 'rejected', stage: 'appraise:w', cycle: 'c1', timestamp: '2026-04-24T10:02:00.000Z', reason: 'no' },
          { state: 'actioned', stage: 'forge:w', cycle: 'c1', timestamp: '2026-04-24T10:01:00.000Z' },
          { state: 'open', stage: 'appraise:w', cycle: 'c1', timestamp: '2026-04-24T10:00:00.000Z' },
        ],
      },
    ]);
    const io = makeSortIO({
      // Last completed stage is forge → normal routing picks quench next.
      'WORK.md': `---\nflow: f\ncycle: c1\nstages:\n  - forge:w\n  - quench:v\n  - appraise:w\n  - human-appraise:c1\ndeadlock-appraise: true\ndeadlock-iterations: 3\nmax-iterations: 100\n---\n\n# Goal\n\ngo\n\n| File | Type | Cycle | Status |\n|------|------|-------|--------|\n| a.md | t | c1 | pending |\n`,
      'WORK.feedback.yaml': feedbackYaml,
      'WORK.history.yaml': yaml.dump([
        { cycle: 'c1', stage: 'forge:w', iteration: 2, comment: 'x', timestamp: '2026-04-24T10:04:30.000Z', seq: 0 },
      ]),
    });
    const result = runSort({ workPath: 'WORK.md', historyPath: 'WORK.history.yaml' }, io);
    // Without the top-level pass, route would be quench:v. With it, deadlock
    // overrides to human-appraise.
    assert.match(result.route, /^human-appraise:/, 'deadlock pass must run before routing, regardless of previous stage');
    const doc = yaml.load(io._get('WORK.feedback.yaml'));
    assert.equal(doc.items[0].history[0].state, 'deadlocked');
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `node --test tests/sort.test.js`
Expected: FAIL with route matching `quench:` or similar (pre-implementation, the pass is either missing or tied to the appraise branch so this post-forge path never hits it).

---

## Task 4.2: Sort reads from feedback-store + top-level deadlock pass (GREEN)

**Files:** Modify `scripts/sort.js`.

- [ ] **Step 1: Replace imports**

At the top of `scripts/sort.js` (lines 23–24):

```js
// Before:
import { loadHistory } from './lib/history.js';
import { parseFeedback, parseFeedbackItem, detectDeadlocks } from './lib/feedback.js';

// After:
import { loadHistory } from './lib/history.js';
import { openFeedbackStore } from './lib/feedback-store.js';
```

Remove the export lines at the bottom:

```js
// Delete:
export { parseFeedback, parseFeedbackItem } from './lib/feedback.js';
```

Keep `export { loadHistory }` because sort.test.js still uses it. The `parseFeedback`/`parseFeedbackItem` exports are gone.

- [ ] **Step 2: Replace the feedback surface used by routing helpers**

Around line 288 of `scripts/sort.js`, `const feedback = parseFeedback(workText, cycle, artefacts);` becomes:

```js
  const store = openFeedbackStore('WORK.feedback.yaml', io);
  // Expose items in the six-state vocabulary directly — no legacy mapping shim.
  // Routing helpers below read `state` from this shape; there is no `resolved`
  // boolean because 'resolved' is now a first-class state.
  const feedback = store.list().map(item => ({
    id: item.id,
    file: item.file,
    state: item.history[0].state,           // 'open' | 'actioned' | 'wont-fix' | 'rejected' | 'deadlocked' | 'resolved'
    depth: item.history.length,
  }));
```

Update `nextAfterAppraise` and `nextAfterQuench` predicates to use the native six-state vocabulary. Replace references to `f.resolved` with state-based checks:

```js
  // In nextAfterAppraise / nextAfterQuench (or wherever these predicates live):
  const openItems     = feedback.filter(f => f.state !== 'resolved' && f.state !== 'deadlocked');
  const needsForge    = openItems.some(f => f.state === 'open' || f.state === 'rejected');
  const pendingApproval = openItems.some(f => f.state === 'actioned' || f.state === 'wont-fix');
```

Delete every remaining reference to `f.resolved` — the property no longer exists on the new surface.

- [ ] **Step 3: Add the top-level deadlock pass, calling phase-1's batch primitive**

Near the other feedback helpers at the top of `scripts/sort.js`, add:

```js
/**
 * Walk feedback items and, if any have depth >= threshold, write ALL qualifying
 * deadlocked snapshots in a SINGLE atomic batch (phase-1 primitive). Returns
 * true iff at least one snapshot was written.
 *
 * When enabled is false, returns false without reading the store.
 *
 * Per spec §6.1: called once per runSort invocation, BEFORE any routing
 * decision — never tied to a specific routing branch.
 */
function runDeadlockPass(store, { threshold, enabled, cycle }) {
  if (!enabled) return false;
  const qualifying = store.list().filter(item => {
    const head = item.history[0];
    if (head.state === 'resolved' || head.state === 'deadlocked') return false;
    return item.history.length >= threshold;
  });
  if (qualifying.length === 0) return false;
  // Single batch write — all N snapshots or none (phase-1 primitive).
  store.writeDeadlockedSnapshots(
    qualifying,
    // Per-item reason is derived inside writeDeadlockedSnapshots from the item's
    // own depth; this top-level reason is a fallback / category descriptor.
    `depth >= threshold=${threshold}`,
    'sort',
    cycle,
  );
  return true;
}
```

> **Signature note.** `writeDeadlockedSnapshots(items, reason, stage, cycle)` is phase 1's batch primitive (REVISION-CONTRACT §B1). Match its signature exactly; do not re-invent it here.

- [ ] **Step 4: Hoist the deadlock pass to the top of `runSort`, before routing**

Inside `runSort`, immediately after the feedback store is opened (step 2) and before any call to `determineRoute` / `nextAfterAppraise` / `nextAfterQuench`:

```js
  // Spec §6.1 — single top-level pass, before any routing decision.
  runDeadlockPass(store, {
    threshold: deadlockIterations,
    enabled:   deadlockAppraise,
    cycle,
  });

  // Re-list after the potential writes so routing sees the updated states.
  const refreshedFeedback = store.list().map(item => ({
    id: item.id,
    file: item.file,
    state: item.history[0].state,
    depth: item.history.length,
  }));
  const anyDeadlocked = refreshedFeedback.some(f => f.state === 'deadlocked');

  if (anyDeadlocked) {
    const alreadyInHumanAppraise = baseStage(current) === 'human-appraise';
    if (alreadyInHumanAppraise) {
      return { route: 'blocked', details: 'deadlocked items remain after human-appraise' };
    }
    const inStages = findFirst(stages, 'human-appraise');
    if (inStages) return { route: inStages, details: 'deadlock → human-appraise' };
    if (cycle)    return { route: `human-appraise:${cycle}`, details: 'deadlock → synthesized human-appraise' };
    return { route: 'blocked', details: 'no human-appraise stage configured' };
  }
```

Then let the existing routing logic fall through to `nextAfterAppraise` / `nextAfterQuench` / etc. with `refreshedFeedback` (replacing the old `feedback` local).

Delete the old `detectDeadlocks(...)` call entirely (was around line 119). `nextAfterAppraise` and siblings no longer know about deadlocks — they are pure normal-routing helpers now.

- [ ] **Step 5: Run tests**

Run: `node --test tests/sort.test.js`
Expected: the four new tests (3 in 4.1 + 1 in 4.1.5) pass. Other sort tests may break — diagnose each:
- If a test constructed a WORK.md with a `## Feedback` section and asserted routing, update it to construct a `WORK.feedback.yaml` fixture using `makeFeedbackYaml`.
- If a test asserted the old `detectDeadlocks` output, either delete it (covered by the new tests) or rewrite it to call `runDeadlockPass` / observe `store.writeDeadlockedSnapshots` directly.

Walk through each failing test one at a time. For each: decide delete vs. rewrite, apply the change, re-run. Do not commit until all are resolved.

- [ ] **Step 6: Full suite**

Run: `npm test`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add scripts/sort.js tests/sort.test.js
git commit -m 'feat(sort): per-item deadlock via top-level runDeadlockPass

Replaces detectDeadlocks (which flagged every open item once a GLOBAL
appraise-entry threshold tripped) with a single top-level pass in
runSort that walks the feedback store and calls phase 1's batch
primitive writeDeadlockedSnapshots() exactly once per invocation --
all qualifying items get their deadlocked snapshot in one atomic
rename, or none do. Sort is the only writer of state=deadlocked
per spec §6.1.

The pass runs BEFORE any routing decision, not inside
nextAfterAppraise. A deadlock detected at any point in the cycle
routes to human-appraise regardless of which stage last ran,
closing a window where a deadlocked item could hide behind a
quench- or forge-bound route.

Routing helpers use the six-state vocabulary directly; the old
resolved-boolean shim is gone. Closes P1 [feedback M1].'
```

---

## Task 4.3: orchestrate.js writes open_feedback (RED)

**Files:** Add a unit test for `computeOpenFeedback` (the call-site helper).

Spec §10. Per REVISION-CONTRACT §B3, phase 4 only adds the **call-site computation** — `appendEntry`'s signature change + `undefined → 0` coercion is phase 2's job. If phase 2 is missing the coercion, stop and escalate; do not work around it here.

- [ ] **Step 1: Locate the test seam**

```bash
rg -l 'orchestrate.*appendEntry|WORK\.history\.yaml.*open_feedback' tests/
rg -n 'foundry_orchestrate\b' tests/plugin/ tests/
```

There is no ready-made integration harness that exercises `orchestrate.js`'s `appendEntry` call sites at the shape level. Rather than re-invent one, factor a pure helper `computeOpenFeedback(io)` out of `scripts/orchestrate.js` (see 4.4 step 3) and unit-test it directly. The integration-level assertion that the field actually reaches `WORK.history.yaml` is covered by phase 6's cross-file consistency test (§14.6).

- [ ] **Step 2: Add the unit test**

Create `tests/orchestrate-open-feedback.test.js` (or append to an existing `tests/orchestrate.test.js` if one exists):

```js
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import yaml from 'js-yaml';
import { computeOpenFeedback } from '../scripts/orchestrate.js';

function mockIO(files = {}) {
  const store = { ...files };
  return {
    exists:   (p) => Object.prototype.hasOwnProperty.call(store, p),
    readFile: (p) => store[p],
    writeFile:(p, c) => { store[p] = c; },
    rename:   (from, to) => { store[to] = store[from]; delete store[from]; },
    unlink:   (p) => { delete store[p]; },
  };
}

describe('computeOpenFeedback (spec §10)', () => {
  test('counts non-resolved items', () => {
    const io = mockIO({
      'WORK.feedback.yaml': yaml.dump({ items: [
        { id: 'A', file: 'a', tag: 'x', text: 't', source: 's', history: [{ state: 'open',     stage: 's', cycle: 'c', timestamp: 'T' }] },
        { id: 'B', file: 'a', tag: 'x', text: 't', source: 's', history: [{ state: 'resolved', stage: 's', cycle: 'c', timestamp: 'T' }] },
        { id: 'C', file: 'a', tag: 'x', text: 't', source: 's', history: [{ state: 'actioned', stage: 's', cycle: 'c', timestamp: 'T' }] },
      ]}),
    });
    assert.equal(computeOpenFeedback(io), 2);
  });

  test('resolved-only store yields 0', () => {
    const io = mockIO({
      'WORK.feedback.yaml': yaml.dump({ items: [
        { id: 'A', file: 'a', tag: 'x', text: 't', source: 's', history: [{ state: 'resolved', stage: 's', cycle: 'c', timestamp: 'T' }] },
      ]}),
    });
    assert.equal(computeOpenFeedback(io), 0);
  });

  test('deadlocked items count as open', () => {
    const io = mockIO({
      'WORK.feedback.yaml': yaml.dump({ items: [
        { id: 'A', file: 'a', tag: 'x', text: 't', source: 's', history: [{ state: 'deadlocked', stage: 'sort', cycle: 'c', timestamp: 'T', reason: 'd' }] },
        { id: 'B', file: 'a', tag: 'x', text: 't', source: 's', history: [{ state: 'resolved',   stage: 's',    cycle: 'c', timestamp: 'T' }] },
      ]}),
    });
    assert.equal(computeOpenFeedback(io), 1);
  });

  test('missing feedback.yaml returns 0', () => {
    const io = mockIO({});
    assert.equal(computeOpenFeedback(io), 0);
  });
});
```

- [ ] **Step 3: Run and confirm failure**

Run: `node --test tests/orchestrate-open-feedback.test.js`
Expected: FAIL — `computeOpenFeedback` is not exported from `scripts/orchestrate.js` yet.

---

## Task 4.4: orchestrate.js writes open_feedback (GREEN)

**Files:** Modify `scripts/orchestrate.js`. **Do NOT modify `scripts/lib/history.js`** — the signature change lives in phase 2 (REVISION-CONTRACT §B2); phase 4 only threads the value through.

- [ ] **Step 1: Replace the `listFeedback` import**

Line 15 of `scripts/orchestrate.js`:

```js
// Before:
import { listFeedback } from './lib/feedback.js';
// After:
import { openFeedbackStore } from './lib/feedback-store.js';
```

- [ ] **Step 2: Rewrite `readRecentFeedback`**

Replace the function body (lines 91–107):

```js
function readRecentFeedback(cycleId, io, limit = 5) {
  // CHANGELOG NOTE (2026-04-24): ordering changed.
  //
  // Pre-redesign: candidates.slice(-limit) over listFeedback's FILE order.
  // Because items were appended to WORK.md's ## Feedback section in creation
  // order and listFeedback preserved that, callers displayed oldest-first
  // within the tail window.
  //
  // Post-redesign: WORK.feedback.yaml stores items by creation order, but
  // history[0].timestamp is the authoritative "when did this item most
  // recently change" signal. Callers of this helper (human-appraise skill
  // preamble) want the MOST RECENT wont-fix/rejected items -- the last few
  // that went through the appraise cycle. Sort by history[0].timestamp DESC
  // and slice the first `limit`.
  //
  // Net effect for a same-ms-file: identical items surface, order reversed.
  // Callers treating this as a set (not a list) are unaffected; callers that
  // care about display order now see most-recent first.
  try {
    if (!io.exists('WORK.feedback.yaml')) return [];
    const store = openFeedbackStore('WORK.feedback.yaml', io);
    const items = store.list();
    const candidates = items.filter(it => {
      const s = it.history[0].state;
      return s === 'wont-fix' || s === 'rejected';
    });
    candidates.sort((a, b) =>
      b.history[0].timestamp.localeCompare(a.history[0].timestamp)
    );
    return candidates.slice(0, limit).map(it => ({
      id:     it.id,
      file:   it.file,
      text:   it.text,
      state:  it.history[0].state,
      reason: it.history[0].reason,
    }));
  } catch {
    return [];
  }
}
```

- [ ] **Step 3: Add `computeOpenFeedback` helper and export it**

Somewhere near the top of `scripts/orchestrate.js`:

```js
/**
 * Spec §10. Count non-resolved items for stamping on every history entry.
 * Deadlocked items count as open; only 'resolved' is excluded. Returns 0 on
 * missing file or any read/parse error -- the count is debug metadata, not
 * load-bearing, so a failed read does not abort the cycle.
 */
export function computeOpenFeedback(io) {
  if (!io.exists('WORK.feedback.yaml')) return 0;
  try {
    const store = openFeedbackStore('WORK.feedback.yaml', io);
    return store.list().filter(it => it.history[0].state !== 'resolved').length;
  } catch {
    return 0;
  }
}
```

- [ ] **Step 4: Thread `openFeedback` into `appendEntry` call sites**

At `scripts/orchestrate.js:429` and `:436` (the two `appendEntry` calls around a stage completion):

```js
    const openFeedback = computeOpenFeedback(io);
    appendEntry(historyPath, {
      cycle: cycleId,
      stage: 'sort',
      iteration,
      route: lastStage.stage,
      comment: `sort → ${lastStage.stage}`,   // spec §11.8 cosmetic change
      open_feedback: openFeedback,
    }, io);
    appendEntry(historyPath, {
      cycle: cycleId,
      stage: lastStage.stage,
      iteration,
      comment: summary,
      open_feedback: openFeedback,
    }, io);
```

> **`appendEntry` signature:** already accepts `open_feedback` via phase 2's change (REVISION-CONTRACT §B2), with `undefined → 0` coercion. Phase 4 passes a concrete number in; phase 2 handled the "always-present" invariant. If `appendEntry` rejects the new property here, phase 2 is incomplete — stop and escalate, do not edit `scripts/lib/history.js` in this phase.

- [ ] **Step 5: Run tests and confirm pass**

Run: `node --test tests/orchestrate-open-feedback.test.js`
Expected: all four tests pass.

- [ ] **Step 6: Full suite**

Run: `npm test`
Expected: all green. Pre-existing history tests that inspect `appendEntry` output should already tolerate `open_feedback` (phase 2's signature + coercion work).

- [ ] **Step 7: Commit**

```bash
git add scripts/orchestrate.js tests/orchestrate-open-feedback.test.js
git commit -m 'feat(orchestrate): stamp open_feedback on history entries

Per spec §10, both appendEntry call sites in orchestrate.js now pass
open_feedback -- the count of non-resolved items in WORK.feedback.yaml.
Deadlocked items are counted as open; only resolved is excluded.
Exports computeOpenFeedback as a pure helper so it can be unit-tested
independently of the orchestrate integration flow.

appendEntry signature/coercion is owned by phase 2 (REVISION-CONTRACT
§B2); phase 4 only threads the value through.

Also updates readRecentFeedback to read from the feedback store. Note
ordering change: most-recent-first via history[0].timestamp DESC,
replacing the old file-order slice(-limit). See in-line comment for
the rationale.'
```

---

## Task 4.5: Delete legacy `scripts/lib/feedback.js` + tests (RED-less)

**Files:** Delete `scripts/lib/feedback.js`, `tests/lib/feedback.test.js`, and `tests/lib/feedback-walker.test.js` (if present).

This is a pure deletion. RED is unnecessary — if any caller still imports the deleted module, the full suite breaks on delete and the RED moment is the deletion itself.

- [ ] **Step 1: Find remaining imports**

```bash
rg -n "from '.*scripts/lib/feedback\.js'|from '\./lib/feedback\.js'|from '\./feedback\.js'" scripts/ .opencode/ tests/
```
Expected: zero matches. If any remain, stop — the caller is still using the old API and hasn't been updated.

- [ ] **Step 2: Delete the files**

```bash
git rm scripts/lib/feedback.js tests/lib/feedback.test.js
# Only if present:
[ -f tests/lib/feedback-walker.test.js ] && git rm tests/lib/feedback-walker.test.js
```

- [ ] **Step 3: Run full suite**

Run: `npm test`
Expected: all green. If any test fails, a fixture or import still references the old module.

- [ ] **Step 4: Commit**

```bash
git commit -m 'refactor(feedback): delete legacy markdown-based feedback module

scripts/lib/feedback.js owned parsing, mutation, and dedup against the
## Feedback section of WORK.md. All callers moved to
scripts/lib/feedback-store.js in phases 3-4. With no remaining imports,
the module and its tests are removed.

tests/lib/feedback-walker.test.js (if present) is dropped for the same
reason -- the walker is gone.'
```

---

## Task 4.6: Phase 4 verification gate

- [ ] **Step 1: Full suite**

```bash
npm test
```
Expected: all green.

- [ ] **Step 2: Hard grep for leaked legacy references**

```bash
rg -n 'scripts/lib/feedback\.js|scripts/lib/feedback\b' scripts/ .opencode/ tests/
```
Expected: zero matches.

```bash
rg -n 'detectDeadlocks|parseFeedback|parseFeedbackItem|addFeedbackItem|actionFeedbackItem|wontfixFeedbackItem|resolveFeedbackItem|listFeedback\b' scripts/ .opencode/ tests/
```
Expected: zero matches in production, possibly zero in tests. Matches in `docs/` / `skills/` / `README.md` / `CHANGELOG.md` remain; phase 5 handles those.

```bash
rg -n 'validateTransition\(' scripts/ .opencode/
```
Expected: only `scripts/lib/feedback-store.js` call sites (phase 1's store-internal use).

- [ ] **Step 3: Confirm the new pipeline is wired end-to-end**

```bash
rg -n 'openFeedbackStore' scripts/ .opencode/
```
Expected: imports in `scripts/sort.js`, `scripts/orchestrate.js`, `.opencode/plugins/foundry-tools/feedback-tools.js`, `.opencode/plugins/foundry-tools/assay-tools.js`.

```bash
rg -n 'writeDeadlockedSnapshots' scripts/ .opencode/
```
Expected: one definition in `scripts/lib/feedback-store.js` (phase 1), one call from `scripts/sort.js` (phase 4). No loop-style per-item callers.

- [ ] **Step 4: Handoff**

Phase 4 complete. Tell the operator:

> "Phase 4 complete. Sort now writes per-item deadlock snapshots via the phase-1 batch primitive at the top of runSort, before any routing decision (spec §6.1). Brand-new open items are never deadlocked regardless of global iteration count. Orchestrate stamps open_feedback on every history entry via computeOpenFeedback (signature owned by phase 2). Legacy scripts/lib/feedback.js deleted. All plugin tools, sort, and orchestrate use feedback-store exclusively. Full suite green. Ready for phase 5 (skills + docs + CHANGELOG + version bump). Remember: phases 3 and 4 must merge together."

---

## Revision Notes

Applied per `new-feedback/reviews/REVISION-CONTRACT.md` §C4 on 2026-04-24.

- **B1 — top-level deadlock pass.** Hoisted out of `nextAfterAppraise` into `runSort` proper. New task 4.1.5 pins the invariant with a post-forge routing test; task 4.2 Step 4 does the wiring. Spec §6.1 now matches the plan.
- **B2 — six-state vocabulary.** Deleted the `resolved → actioned + resolved:true` mapping shim in 4.2 Step 2. Routing helpers now consume `state` directly from the new enum; `pendingApproval` reads `state === 'actioned' || state === 'wont-fix'` without any `resolved` boolean.
- **B3 — `appendEntry` signature moved to phase 2.** Task 4.4 Step 5 (which used to modify `scripts/lib/history.js`) is deleted. Phase 4 now only adds the call-site computation (`computeOpenFeedback`) and threads the value in. The preflight checks for the phase-2 change being in place; the 4.4 green step notes: if `appendEntry` rejects the field here, escalate — do not patch history.js.
- **B4 — batch primitive.** The per-item `store.writeDeadlockedSnapshot({id, cycle, reason})` loop is gone. `runDeadlockPass` calls `store.writeDeadlockedSnapshots(items, reason, stage, cycle)` exactly once per sort pass. Matches phase 1's export (REVISION-CONTRACT §B1).
- **M1 — `cycleDef` placeholder.** Verified against `scripts/sort.js:267` — `cycleDef` is optional with a sensible default, and every existing test in `tests/sort.test.js` (665, 671, 682, 716, 732, 744, 761, 780, 793, 895, 902, 912, 920, 928, 939) omits it. The revised tests do the same. Removed the "fill in from existing test pattern" placeholder and the bolded paragraph telling the executor to hunt for a ghost value.
- **M2 — `rename` on inline IOs.** Cross-referenced phase 2 task 2.8.5 in the top-of-file note and in the `makeSortIO` helper comment. No local patching here — if a `rename`-missing failure surfaces, it's a phase-2 sweep gap, not a phase-4 fix.
- **M3 — `readRecentFeedback` ordering change.** Prominently documented in both the task description (4.4 Step 2) and the helper body itself via a CHANGELOG-style inline comment. The new order is most-recent-first; the old was file-order tail. Commit message in 4.4 Step 7 calls this out. No test pins the order today (there's no dedicated `readRecentFeedback` test in the repo); if phase 5 or a later phase adds one, it should reference the inline comment.
- **New first-task checkbox** per REVISION-CONTRACT §B4 added to the preflight: "Confirm phase 4 branch is rebased on phase 3 branch."

No surprises beyond the contract. All edits are mechanical applications of §C4.
