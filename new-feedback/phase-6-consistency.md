# Phase 6: Lifecycle Plumbing + Cross-File Consistency + Final Sweep

**Scope:** Wire `WORK.feedback.yaml` into every per-cycle lifecycle site that earlier phases did not touch (finalize, git-tools, workfile-tools, sort's hardcoded path lists); add an end-to-end integration test (`tests/plugin/workfiles-consistency.test.js`) that runs a full cycle and asserts cross-file invariants between `WORK.feedback.yaml` and `WORK.history.yaml`; then a final grep sweep across the entire repo to catch leaked legacy references. This phase is the final gate.

**Spec sections covered:** §4 (lifecycle — "deleted at `foundry_git_finish`"), §9.3 (acceptable cross-file inconsistencies), §14.6 (cross-file consistency test — mandatory), §16 (risks — skill regression mitigation).

**Preconditions:** Phases 1–5 committed and green. Repository is at v2.6.0.

**Files in this phase:**
- Edit: `scripts/lib/finalize.js`
- Edit: `.opencode/plugins/foundry-tools/git-tools.js`
- Edit: `.opencode/plugins/foundry-tools/workfile-tools.js`
- Edit: `scripts/sort.js` (only if lines ~187 / ~247 hardcoded lists need `WORK.feedback.yaml`; see Task 6.0.4)
- Edit: `tests/lib/finalize.test.js` (add case; create if absent)
- Edit: `tests/plugin/workfile-tools.test.js` (or adjacent — locate at preflight)
- Edit: `tests/plugin/git-tools.test.js` (or adjacent — locate at preflight)
- Create: `tests/plugin/workfiles-consistency.test.js`

**Preflight:**

```bash
npm test
# Expect: all green.

# Locate existing finalize / workfile / git-tools test files so tasks below can
# extend (not create) them.
rg -l --glob '!new-feedback/**' -e 'finalizeStage|foundry_git_finish|foundry_workfile_delete' tests/

# Sanity-check the lifecycle call sites touched by this phase.
rg -n --glob '!new-feedback/**' -e 'WORK\.history\.yaml' -e "'WORK\\.md'" \
   scripts/ .opencode/
```

Record test-file paths for Tasks 6.0.1 / 6.0.2 / 6.0.3.

---

## Task 6.0.1: `finalize.js` — include `WORK.feedback.yaml` in tool-managed list (RED)

**Files:** Edit `scripts/lib/finalize.js`; edit/create `tests/lib/finalize.test.js`.

**Context.** `scripts/lib/finalize.js:5-8` defines `TOOL_MANAGED = ['WORK.md', 'WORK.history.yaml']`. `finalizeStage` uses this to filter out tool-managed files from the artefact-detection pass. Spec §4 requires `WORK.feedback.yaml` to share the workfile lifecycle; leaving it out of this list would cause `finalizeStage` to treat edits to the feedback yaml as unexpected artefact-surface files and reject forge commits.

Note: this task does not cover unlink-on-finish — that is Task 6.0.2 (git-tools). The finalize.js change is purely the tool-managed filter so stage-end does not mis-classify `WORK.feedback.yaml` as an artefact-surface leak.

- [ ] **Step 1: RED — add a failing test**

In `tests/lib/finalize.test.js` (preflight located this path; if it does not exist, create it with the minimal describe/import scaffold matching adjacent `tests/lib/*.test.js` style):

```js
test('finalizeStage does not flag WORK.feedback.yaml as an unexpected file', () => {
  // Simulate a forge stage with a WORK.feedback.yaml change present in the
  // worktree. The fixture must stub `changedFiles` (or its git exec) to return
  // ['WORK.feedback.yaml', 'some-artefact.md'] so the test does not depend on
  // the real git state.
  //
  // Expected: finalizeStage returns { ok: true, ... } and does not include
  // 'WORK.feedback.yaml' in the artefact registration list.
  //
  // Pre-fix failure reason: finalize.js's TOOL_MANAGED list excludes the
  // feedback yaml, so `isToolManaged('WORK.feedback.yaml')` returns false,
  // the filter keeps it in `files`, it fails allowedPatterns matching (not in
  // artefact file-patterns), and finalizeStage returns
  // { ok: false, error: 'unexpected_files', files: ['WORK.feedback.yaml'] }.
});
```

Run: `node --test tests/lib/finalize.test.js`. Expected failure: `unexpected_files` error listing `WORK.feedback.yaml`.

- [ ] **Step 2: GREEN — update `TOOL_MANAGED`**

Edit `scripts/lib/finalize.js`:

```js
const TOOL_MANAGED = [
  'WORK.md',
  'WORK.history.yaml',
  'WORK.feedback.yaml',
];
```

Run the test again. Expect green.

- [ ] **Step 3: Full suite**

`npm test` — expect green.

- [ ] **Step 4: Commit**

```bash
git add scripts/lib/finalize.js tests/lib/finalize.test.js
git commit -m 'fix(finalize): treat WORK.feedback.yaml as tool-managed

Spec 4 places WORK.feedback.yaml on the workfile lifecycle. finalizeStage
previously saw it as an unexpected artefact-surface file and rejected
stage-ends that touched it. Added to the TOOL_MANAGED list with a test
pinning the behaviour.'
```

---

## Task 6.0.2: `git-tools.js` — unlink `WORK.feedback.yaml` on `foundry_git_finish` (RED)

**Files:** Edit `.opencode/plugins/foundry-tools/git-tools.js`; edit/create `tests/plugin/git-tools.test.js` (or whatever path preflight identified).

**Context.** `git-tools.js:49-52` unlinks `WORK.md` and `WORK.history.yaml` before the squash-merge. Spec §4 ("deleted at `foundry_git_finish`, same lifecycle as `WORK.history.yaml`") requires the feedback yaml to be removed there too. Without this, every finished flow leaks `WORK.feedback.yaml` onto the base branch; subsequent flows see a stale yaml at worktree root.

- [ ] **Step 1: Verify every WORK.md / WORK.history.yaml reference in `git-tools.js`**

Walk `git-tools.js` top to bottom. Current references:

| Line | Reference | Needs feedback.yaml? |
| --- | --- | --- |
| 49 | `workPath = path.join(cwd, 'WORK.md')` | companion path needed |
| 50 | `historyPath = path.join(cwd, 'WORK.history.yaml')` | companion path needed |
| 51 | `unlinkSync(workPath)` (if exists) | add feedbackPath unlink |
| 52 | `unlinkSync(historyPath)` (if exists) | add feedbackPath unlink |

`foundry_git_branch` does not touch workfiles (it only creates a branch and relies on the active-stage guard); no change there. Document this in the commit message so future readers see the branch tool was checked.

- [ ] **Step 2: RED — add a failing test**

In `tests/plugin/git-tools.test.js` (preflight path), add:

```js
test('foundry_git_finish removes WORK.feedback.yaml from the worktree', async () => {
  // Set up a tiny git worktree on a temp dir: init, commit a baseline on `main`,
  // checkout a `work/flow-desc` branch, write WORK.md + WORK.history.yaml +
  // WORK.feedback.yaml, commit them, ensure no active stage.
  //
  // Call foundry_git_finish({message:'x'}).
  //
  // Expected: worktree does not contain WORK.feedback.yaml (nor WORK.md nor
  // WORK.history.yaml) on `main` after the squash-merge completes.
  //
  // Pre-fix failure reason: git-tools.js only unlinks WORK.md and
  // WORK.history.yaml; the feedback yaml survives the cleanup commit and
  // rides into main via the squash-merge.
});
```

Run: `node --test tests/plugin/git-tools.test.js`. Expected failure: `WORK.feedback.yaml` still exists after the merge.

- [ ] **Step 3: GREEN — extend the unlink list**

Edit `.opencode/plugins/foundry-tools/git-tools.js`:

```js
const workPath = path.join(cwd, 'WORK.md');
const historyPath = path.join(cwd, 'WORK.history.yaml');
const feedbackPath = path.join(cwd, 'WORK.feedback.yaml');
if (existsSync(workPath)) unlinkSync(workPath);
if (existsSync(historyPath)) unlinkSync(historyPath);
if (existsSync(feedbackPath)) unlinkSync(feedbackPath);
```

Run the test again. Expect green.

- [ ] **Step 4: Full suite**

`npm test` — expect green.

- [ ] **Step 5: Commit**

```bash
git add .opencode/plugins/foundry-tools/git-tools.js tests/plugin/git-tools.test.js
git commit -m 'fix(git-tools): delete WORK.feedback.yaml on foundry_git_finish

Spec 4 makes WORK.feedback.yaml share the workfile lifecycle. Previously
foundry_git_finish only unlinked WORK.md and WORK.history.yaml, leaking
the feedback yaml onto the base branch after every squash-merge.
foundry_git_branch was reviewed and needs no change (it does not touch
workfiles).'
```

---

## Task 6.0.3: `workfile-tools.js` — `foundry_workfile_delete` unlinks `WORK.feedback.yaml` (RED)

**Files:** Edit `.opencode/plugins/foundry-tools/workfile-tools.js`; edit/create `tests/plugin/workfile-tools.test.js`.

**Context.** `workfile-tools.js:62-84` defines `foundry_workfile_delete` which unlinks `WORK.md` and `WORK.history.yaml` but not `WORK.feedback.yaml`. `foundry_workfile_create` does not touch the feedback yaml (it is created lazily on first feedback op); no change needed there, but explicitly record it in the commit message. `foundry_workfile_get` only reads `WORK.md`; no change.

- [ ] **Step 1: Verify every WORK.md / WORK.history.yaml reference in `workfile-tools.js`**

| Lines | Tool | Reference | Action |
| --- | --- | --- | --- |
| 26 | `foundry_workfile_create` | checks `WORK.md` existence | none — feedback yaml is optional per cycle |
| 50 | `foundry_workfile_get` | reads `WORK.md` | none — getter does not expose feedback |
| 74–80 | `foundry_workfile_delete` | unlinks WORK.md + WORK.history.yaml | **add WORK.feedback.yaml unlink** |

- [ ] **Step 2: RED — add a failing test**

In `tests/plugin/workfile-tools.test.js`:

```js
test('foundry_workfile_delete removes WORK.feedback.yaml when present', async () => {
  // Set up a temp worktree containing WORK.md, WORK.history.yaml, and
  // WORK.feedback.yaml. Ensure no active stage.
  //
  // Call foundry_workfile_delete({confirm: true}).
  //
  // Expected: existsSync(<worktree>/WORK.feedback.yaml) === false.
  //
  // Pre-fix failure reason: the tool only unlinks workPath and historyPath;
  // the feedback yaml survives, which corrupts any subsequent
  // foundry_workfile_create flow because the feedback store will load stale
  // items from a prior cycle.
});
```

Run: `node --test tests/plugin/workfile-tools.test.js`. Expected failure: `WORK.feedback.yaml` still exists.

- [ ] **Step 3: GREEN — extend the unlink list**

```js
const workPath = path.join(context.worktree, 'WORK.md');
const historyPath = path.join(context.worktree, 'WORK.history.yaml');
const feedbackPath = path.join(context.worktree, 'WORK.feedback.yaml');
if (existsSync(workPath)) unlinkSync(workPath);
if (existsSync(historyPath)) unlinkSync(historyPath);
if (existsSync(feedbackPath)) unlinkSync(feedbackPath);
```

Also update the tool `description` field from `'Delete WORK.md and WORK.history.yaml (requires confirm:true)'` to include feedback.yaml.

Run the test again. Expect green.

- [ ] **Step 4: Full suite**

`npm test` — expect green.

- [ ] **Step 5: Commit**

```bash
git add .opencode/plugins/foundry-tools/workfile-tools.js tests/plugin/workfile-tools.test.js
git commit -m 'fix(workfile-tools): delete WORK.feedback.yaml on workfile_delete

foundry_workfile_delete now unlinks all three workfiles. Leaving a stale
feedback yaml behind caused the store to surface items from a prior cycle
on the next foundry_workfile_create. foundry_workfile_create and
foundry_workfile_get reviewed and unchanged: create does not touch the
feedback yaml (lazy-created on first write), get only reads WORK.md.'
```

---

## Task 6.0.4: `scripts/sort.js` — review hardcoded workfile-path lists

**Files:** Read-only review of `scripts/sort.js`; edit only if behaviour must change.

**Context.** Two hardcoded lists embed the workfile set:

- Line ~187 (`getAllowedPatterns`): `const always = ['WORK.md', 'WORK.history.yaml'];` — gates which files sort permits to be modified during a stage.
- Line ~247 (`getDirtyToolManagedFiles`): `io.exec('git status --porcelain -- WORK.md WORK.history.yaml .foundry')` — used by the dirty-tool-managed-files guard.

- [ ] **Step 1: Decide per-site whether `WORK.feedback.yaml` needs adding**

For each site, apply this rubric:

1. **`getAllowedPatterns` (line ~187).** Does sort need to permit a `WORK.feedback.yaml` change during any stage? Any stage that adds/actions/resolves feedback mutates this file via the store. If sort's allowed-patterns gate runs on those stages and blocks unexpected changes, the yaml must be in `always`. Verify the gate's scope first: check which stages invoke this (grep for `getAllowedPatterns` / `checkModifiedFiles`) and whether those stages are exactly the ones that run feedback operations. If yes → add `'WORK.feedback.yaml'` to the `always` array.
2. **`getDirtyToolManagedFiles` (line ~247).** This guard catches uncommitted tool-managed files at the start of a sort invocation. A dirty `WORK.feedback.yaml` (written but not committed) is exactly the kind of state this guard exists to detect. Add `WORK.feedback.yaml` to the `git status --porcelain` argument list.

- [ ] **Step 2: Write RED test(s) for any behaviour change**

If Step 1 identifies a change at either site, add a RED test before editing:

- For `getAllowedPatterns`: construct a stage scenario where `WORK.feedback.yaml` is modified; assert `checkModifiedFiles` returns `{ok: true, violations: []}`. Pre-fix failure reason: the yaml is not in `always`, so it falls through as a violation.
- For `getDirtyToolManagedFiles`: fixture a worktree with a dirty uncommitted `WORK.feedback.yaml`; assert the function returns `['WORK.feedback.yaml']`. Pre-fix failure reason: the `git status` arg list omits the yaml, so its dirt is invisible to the guard.

Run: `node --test tests/<path>`. Expected failure reasons as above.

- [ ] **Step 3: GREEN — make the edits**

For each changed site, update the string literal array / command argument. Re-run the tests.

- [ ] **Step 4: If no change is needed at a site**

If the rubric in Step 1 concludes a site should stay as-is (for example, `getAllowedPatterns` is not called on the feedback-writing stages), add a comment inline at the line explaining why and reference this task:

```js
// Note: WORK.feedback.yaml intentionally omitted here. <one-sentence reason>
// See phase-6 task 6.0.4 review for the full rationale.
```

No code change, no test, but commit the comment.

- [ ] **Step 5: Full suite**

`npm test` — expect green.

- [ ] **Step 6: Commit**

```bash
git add scripts/sort.js tests/
git commit -m 'fix(sort): handle WORK.feedback.yaml in hardcoded workfile lists

Extends the allowed-patterns gate and the dirty-tool-managed-files guard
in sort.js to account for the new feedback yaml. (Or: no behaviour change
was needed; inline comments document why each site remains unchanged.)'
```

---

## Task 6.1: Cross-file consistency test — synthetic cases (RED)

**Files:** Create `tests/plugin/workfiles-consistency.test.js`.

The invariant (spec §9.3, §14.6):

> Every `snapshot.stage` in `WORK.feedback.yaml` (other than sort-written
> deadlocked snapshots) has a corresponding entry in `WORK.history.yaml`
> with matching `stage` + `cycle`. The reverse does NOT always hold: a
> history row referencing a sort-side deadlock write that failed to
> persist its own history entry is allowed, because the atomic rename of
> `WORK.feedback.yaml` committed the deadlock before the history write;
> sort on the next call still sees the deadlocked state and routes
> correctly.

- [ ] **Step 1: Decide test scope**

Two complementary approaches:

(a) **Synthetic.** Construct a WORK.feedback.yaml + WORK.history.yaml fixture by hand, then run an assertion function that verifies the invariant. Fast, tightly focused on the invariant.

(b) **Driven.** Simulate a cycle through the plugin tools end to end — add feedback from appraise, action from forge, resolve from appraise — and assert the invariant at each step.

Do both. (a) in this task, (b) in Task 6.2.

- [ ] **Step 2: Write the synthetic test**

```js
// tests/plugin/workfiles-consistency.test.js
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import yaml from 'js-yaml';

// --- Invariant assertion (pure function on two parsed yamls) ---

function assertFeedbackHistoryConsistent(feedbackDoc, historyEntries) {
  // Build a set of (stage, cycle) pairs present in history.
  const historyPairs = new Set(
    historyEntries.map(e => `${e.stage}||${e.cycle}`)
  );
  // Walk every item's every snapshot.
  // Reverse direction (history rows lacking a feedback snapshot) is
  // intentionally not asserted — see spec §9.3.
  const missing = [];
  for (const item of feedbackDoc.items || []) {
    for (const snap of item.history) {
      // Sort-written deadlocked snapshots are exempt per spec §9.3. Any
      // other state on stage: sort is a bug and must be flagged.
      if (snap.stage === 'sort' && snap.state === 'deadlocked') continue;
      const key = `${snap.stage}||${snap.cycle}`;
      if (!historyPairs.has(key)) {
        missing.push(`${item.id}@${snap.state}: stage=${snap.stage} cycle=${snap.cycle}`);
      }
    }
  }
  if (missing.length) {
    assert.fail(`feedback/history inconsistency: ${missing.length} snapshots lack matching history rows:\n${missing.join('\n')}`);
  }
}

// A ULID-legal fixture id. 'I' is NOT in the Crockford base32 alphabet
// (§4.2); use 'J' instead. 26 chars total: 3 prefix + 23 'Z'.
const FIXTURE_ID = 'JD0' + 'Z'.repeat(23);

describe('workfiles consistency — synthetic', () => {
  test('matching (stage, cycle) pairs pass the invariant', () => {
    const feedbackDoc = {
      items: [{
        id: FIXTURE_ID,
        file: 'a.md',
        tag: 'law:x',
        text: 't',
        source: 'appraise:w',
        history: [
          { state: 'resolved', stage: 'appraise:w', cycle: 'c1', timestamp: 'T3', reason: 'good now' },
          { state: 'actioned', stage: 'forge:w', cycle: 'c1', timestamp: 'T2' },
          { state: 'open', stage: 'appraise:w', cycle: 'c1', timestamp: 'T1' },
        ],
      }],
    };
    const historyEntries = [
      { stage: 'appraise:w', cycle: 'c1', comment: 'open', timestamp: 'T1', seq: 0, iteration: 0, open_feedback: 1 },
      { stage: 'forge:w',    cycle: 'c1', comment: 'action', timestamp: 'T2', seq: 1, iteration: 1, open_feedback: 1 },
      { stage: 'appraise:w', cycle: 'c1', comment: 'resolve', timestamp: 'T3', seq: 2, iteration: 1, open_feedback: 0 },
    ];
    assert.doesNotThrow(() => assertFeedbackHistoryConsistent(feedbackDoc, historyEntries));
  });

  test('missing history row for a non-sort stage fails', () => {
    const feedbackDoc = {
      items: [{
        id: FIXTURE_ID,
        file: 'a.md', tag: 'law:x', text: 't', source: 'appraise:w',
        history: [
          { state: 'actioned', stage: 'forge:w', cycle: 'c1', timestamp: 'T2' },
          { state: 'open', stage: 'appraise:w', cycle: 'c1', timestamp: 'T1' },
        ],
      }],
    };
    // Only the forge:w history row exists; appraise:w missing.
    const historyEntries = [
      { stage: 'forge:w', cycle: 'c1', comment: 'action', timestamp: 'T2', seq: 0, iteration: 0, open_feedback: 1 },
    ];
    assert.throws(() => assertFeedbackHistoryConsistent(feedbackDoc, historyEntries), /inconsistency/);
  });

  test('a sort-written deadlocked snapshot is allowed without a history row', () => {
    const feedbackDoc = {
      items: [{
        id: FIXTURE_ID,
        file: 'a.md', tag: 'law:x', text: 't', source: 'appraise:w',
        history: [
          { state: 'deadlocked', stage: 'sort', cycle: 'c1', timestamp: 'T4', reason: 'depth=3' },
          { state: 'rejected', stage: 'appraise:w', cycle: 'c1', timestamp: 'T3', reason: 'still bad' },
          { state: 'actioned', stage: 'forge:w', cycle: 'c1', timestamp: 'T2' },
          { state: 'open', stage: 'appraise:w', cycle: 'c1', timestamp: 'T1' },
        ],
      }],
    };
    const historyEntries = [
      { stage: 'appraise:w', cycle: 'c1', comment: 'open', timestamp: 'T1', seq: 0, iteration: 0, open_feedback: 1 },
      { stage: 'forge:w', cycle: 'c1', comment: 'action', timestamp: 'T2', seq: 1, iteration: 1, open_feedback: 1 },
      { stage: 'appraise:w', cycle: 'c1', comment: 'reject', timestamp: 'T3', seq: 2, iteration: 1, open_feedback: 1 },
      // NOTE: no sort history row — acceptable per spec §9.3.
    ];
    assert.doesNotThrow(() => assertFeedbackHistoryConsistent(feedbackDoc, historyEntries));
  });

  test('a non-deadlocked snapshot on stage: sort FAILS the invariant', () => {
    // Sort only writes `deadlocked` snapshots. Any other state on stage: sort
    // is a writer bug; the exemption must not hide it.
    const feedbackDoc = {
      items: [{
        id: FIXTURE_ID,
        file: 'a.md', tag: 'law:x', text: 't', source: 'appraise:w',
        history: [
          { state: 'actioned', stage: 'sort', cycle: 'c1', timestamp: 'T2' },
          { state: 'open', stage: 'appraise:w', cycle: 'c1', timestamp: 'T1' },
        ],
      }],
    };
    const historyEntries = [
      { stage: 'appraise:w', cycle: 'c1', comment: 'open', timestamp: 'T1', seq: 0, iteration: 0, open_feedback: 1 },
    ];
    assert.throws(() => assertFeedbackHistoryConsistent(feedbackDoc, historyEntries), /inconsistency/);
  });

  test('empty store with empty history passes', () => {
    const feedbackDoc = { items: [] };
    const historyEntries = [];
    assert.doesNotThrow(() => assertFeedbackHistoryConsistent(feedbackDoc, historyEntries));
  });
});
```

- [ ] **Step 3: Run and confirm the test suite picks up the new file**

Run: `node --test tests/plugin/workfiles-consistency.test.js`
Expected: all five synthetic tests pass (the invariant assertion is a pure function, no production wiring needed).

- [ ] **Step 4: Run full suite**

Run: `npm test`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add tests/plugin/workfiles-consistency.test.js
git commit -m 'test(plugin): synthetic cross-file consistency invariant

Introduces the (feedback.yaml x history.yaml) consistency assertion:
every non-sort-deadlocked snapshot stage in WORK.feedback.yaml must have
a matching (stage, cycle) entry in WORK.history.yaml. Sort-written
deadlocked snapshots are exempt per spec 9.3 (sort writes feedback
atomically before history, so a crash between the two leaves feedback
state correct and history lagging by one row). The exemption is tightly
bounded to state: deadlocked + stage: sort so that a sort writer bug
cannot sneak through.'
```

---

## Task 6.2: Driven cross-file consistency test (MANDATORY, RED)

**Files:** Extend `tests/plugin/workfiles-consistency.test.js`.

**This test is mandatory per spec §14.6.** It is not optional. If the harness pattern is hard to use, that is this phase's primary work — do not escape-hatch it.

Exercise the plugin tools end to end and assert the invariant holds after each transition.

- [ ] **Step 1: Locate the existing end-to-end harness**

```bash
rg -l --glob '!new-feedback/**' -e 'foundry_orchestrate' -e 'foundry_stage_begin' -e 'foundry_stage_end' tests/plugin/
```

Identify the existing test file that exercises a full stage lifecycle (begin → feedback op → end) against a real git worktree. Candidates to inspect first: `tests/plugin/failed-flow-e2e.test.js`, and any phase-3-added test that uses `FoundryPlugin({directory: testDir})` with a real worktree. Read its worktree setup helpers; reuse them (copy-paste if not extracted, then fold into a shared helper in a follow-up commit if three or more files duplicate the pattern).

- [ ] **Step 2: Extend the test file**

```js
// Add to tests/plugin/workfiles-consistency.test.js
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
// Import the real plugin entrypoint, matching the pattern used by the
// harness located in Step 1. Do NOT fabricate a tool stub.

describe('workfiles consistency — driven', () => {
  test('after a full appraise/forge/appraise round-trip, the invariant holds', async () => {
    // 1. Set up a worktree with WORK.md + active-stage.json = {cycle, stage:'appraise:w', baseSha}.
    // 2. Add a feedback item via foundry_feedback_add (called through the real plugin).
    // 3. Call the real appendEntry that orchestrate would call to write an
    //    appraise:w entry to WORK.history.yaml.
    // 4. End the stage, switch active-stage to forge:w, action the item via
    //    foundry_feedback_action. Append a forge:w history entry.
    // 5. Switch back to appraise:w. Resolve the item. Append an appraise:w history entry.
    // 6. Load both yaml files and assert the invariant via the pure helper from 6.1.
    const worktree = /* reuse Step 1's makeWorktree helper */;
    try {
      /* full sequence using real plugin tools */
      const feedbackDoc = yaml.load(readFileSync(path.join(worktree, 'WORK.feedback.yaml'), 'utf-8'));
      const historyEntries = yaml.load(readFileSync(path.join(worktree, 'WORK.history.yaml'), 'utf-8'));
      assertFeedbackHistoryConsistent(feedbackDoc, historyEntries);
    } finally {
      rmSync(worktree, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 3: Run**

Run: `node --test tests/plugin/workfiles-consistency.test.js`
Expected: driven test passes (invariant holds through a full lifecycle).

If it fails because the invariant is actually violated in the production path, **stop** — this is a real bug in phases 3–4. Isolate the transition that breaks the invariant (which snapshot has no matching history row?), trace back to the writer, fix before proceeding. If the harness itself is blocking (plugin tools not usable from an integration test), that is a phase-3 bug and must be fixed there — not worked around here.

- [ ] **Step 4: Commit**

```bash
git add tests/plugin/workfiles-consistency.test.js
git commit -m 'test(plugin): driven cross-file consistency via plugin lifecycle

Exercises the feedback + history writers through a full appraise to forge
to appraise round-trip and asserts the 6.1 invariant holds on the produced
yaml files. Catches regressions where a new writer forgets to append a
matching history row (e.g. in the wild: sort did this before the
atomicity work landed).'
```

---

## Task 6.3: Final sweep — grep for legacy references

**Files:** Read-only grep across the repo, then fix any leaks.

- [ ] **Step 1: Run the sweep**

The sweep excludes `new-feedback/` (planning docs — preserved for history, they contain legacy examples by design) and `docs/plans/` (archived implementation plans that may include historical fixtures). It uses proper ripgrep alternation (`'(a|b)'`, not `'a\|b'`).

```bash
echo '=== legacy imports ==='
rg -n --glob '!new-feedback/**' \
   -e 'from .*scripts/lib/feedback\.js' \
   -e '(addFeedbackItem|actionFeedbackItem|wontfixFeedbackItem|resolveFeedbackItem)' \
   -e '(parseFeedback|parseFeedbackItem|detectDeadlocks|readLastSortRoute)' \
   scripts/ .opencode/ tests/
echo

echo '=== legacy prose in skills / docs ==='
rg -n --glob '!new-feedback/**' \
   --glob '!docs/plans/**' \
   -e '## Feedback' \
   -e '\{\s*file,\s*index\s*\}' \
   skills/ docs/ README.md
echo

echo '=== legacy active-stage arg ==='
rg -n --glob '!new-feedback/**' -e 'stageBase:' .opencode/ scripts/
echo

echo '=== version check ==='
rg '^\s*"version":' package.json
echo

echo '=== tool descriptions must not mention legacy surface ==='
rg -n --glob '!new-feedback/**' \
   -e "description: '[^']*WORK\.md[^']*'" \
   -e "description: '[^']*## Feedback[^']*'" \
   .opencode/
echo

echo '=== tests: fixture-only uses of ## Feedback ==='
rg -n --glob '!new-feedback/**' -e '## Feedback' tests/
echo

echo '=== lifecycle sweep — every WORK.history.yaml reference should have a companion WORK.feedback.yaml nearby ==='
rg -n --glob '!new-feedback/**' -e 'WORK\.history\.yaml' scripts/ .opencode/
rg -n --glob '!new-feedback/**' -e 'WORK\.feedback\.yaml' scripts/ .opencode/
# Diff the two mentally: any file in the first list that does not also appear
# in the second is a suspect lifecycle gap. Tasks 6.0.1–6.0.4 should have
# closed these; this sweep catches anything those tasks missed.
```

**Verify the sweep actually matches before trusting the output.** Seed a fake leak in a scratch file (e.g. `parseFeedbackItem` in a tmp file under `tests/`) and confirm the first sweep command lights up. Delete the scratch file before moving on.

- [ ] **Step 2: Triage**

Expected classes:
- **Zero matches** in the first three sweeps (production code + skills + docs).
- **Version** must be `2.6.0`.
- **Tests** may contain `## Feedback` in *fixture strings* (old-shape WORK.md that tests a failed-flow path that predates the redesign). These are acceptable — they document that historical WORK.md files don't crash the new code. **If a test actively asserts markdown-feedback behaviour**, that's a regression miss; remove the test.
- **Lifecycle sweep** should find `WORK.history.yaml` and `WORK.feedback.yaml` mentioned in the same files: `finalize.js`, `git-tools.js`, `workfile-tools.js`, `sort.js` (if task 6.0.4 concluded it needs them). Any file in the history-only list that is not one of those is a miss.

- [ ] **Step 3: Fix any leaks**

Each leak is its own mini-task. Atomic commit per fix:

```bash
# example
git add <file>
git commit -m 'fix(<area>): drop legacy <thing>

Phase 6 sweep found a leak from the v2.5 API surface. <short rationale>.'
```

If zero leaks, skip to task 6.4.

---

## Task 6.4: Phase 6 verification gate

- [ ] **Step 1: Full suite**

```bash
npm test
```

Expected: all green. The phase is complete when every task checkbox in this file is ticked and `npm test` exits zero. Test count is not a gate (commit count is not a gate either — see removed step).

- [ ] **Step 2: Track the plan directory**

`new-feedback/` contains the spec, PLAN.md, per-phase files, and review + contract docs. These are planning docs; they are deliberately preserved for history. **Do not `rm -rf new-feedback/`** as part of this phase — those docs remain valuable for the post-release retrospective and for future readers tracing the redesign's reasoning.

Ask the operator whether to commit the directory:

- If committing: one commit adding the whole `new-feedback/` tree.
- If leaving untracked: no action. The directory stays on the worktree but is not added to git.

There is no delete option in this task.

- [ ] **Step 3: Update REVIEW.md**

The REVIEW.md working doc has P1 [feedback M1] at line 234 and references the other items this redesign closes. Tick the closed items with their commit SHAs:

- P1 [feedback M1] — closed by the full phase 1–6 series.
- P1 [feedback M3] (substring detection) — subsumed by the redesign (no more markdown parsing).
- P2 [memory M1] — closed by phase-2 atomicity + phase-1 feedback-store atomicity.
- P3 testing-gap items for feedback — covered by phase 1, 3, 6 test additions.

Edit REVIEW.md by hand; it is an untracked working doc. Do not commit REVIEW.md.

- [ ] **Step 4: Handoff**

Phase 6 complete. Tell the operator:

> "Phase 6 complete. Lifecycle plumbing wired through finalize.js, git-tools.js, workfile-tools.js, and sort.js (see tasks 6.0.1–6.0.4). Cross-file consistency invariant locked in via a pure assertion helper + synthetic tests (Task 6.1) and a driven end-to-end test (Task 6.2). Final sweep found <N> leaks, fixed in individual commits. Full suite green. v2.6.0 ready. Do you want to:
>
> (a) squash the entire phase series into one commit before pushing, or
> (b) keep the per-task commits as a bisectable history,
>
> and should I commit `new-feedback/` or leave it untracked?"

Await instructions.

---

## Revision Notes

- **Lifecycle plumbing added as blocker tasks 6.0.1–6.0.4.** Per REVISION-CONTRACT §B3 / §C6-B1. Earlier phases did not touch these production sites; this phase is the only place the feedback yaml gets wired into finalize/git-tools/workfile-tools/sort. Each has a RED test with a documented pre-fix failure reason.
- **`finalize.js` scope clarified.** Task 6.0.1 addresses the `TOOL_MANAGED` filter so stage-end does not mis-classify `WORK.feedback.yaml` as an artefact-surface leak. The unlink-on-finish concern lives in Task 6.0.2 (`git-tools.js`), not here — `finalize.js` does not unlink workfiles; `foundry_git_finish` does.
- **`sort.js` task is conditional.** Task 6.0.4 applies a rubric to each of the two hardcoded lists (~187, ~247) and either changes behaviour (with a RED test) or leaves an explanatory inline comment. Either outcome is acceptable; the task is mandatory but the code change is not.
- **Task 6.2 is mandatory.** The prior draft allowed skipping the driven test with `--allow-empty`; that escape is removed per REVISION-CONTRACT §C6-M2. If the harness blocks, that is a phase-3 regression and must be fixed there.
- **Commit-count vibes check removed.** Per §C6-M3. The phase is complete when every checkbox is ticked and `npm test` is green.
- **`rm -rf new-feedback/` removed entirely.** Per §C6 recommendation. Planning docs are preserved.
- **Sweep rewrites** use proper ripgrep alternation (`'(a|b)'`) and `--glob '!new-feedback/**'` throughout. A self-verify step (seed a fake leak) was added to catch future regex regressions.
- **ULID fixture id** uses `'JD0'+Z*23` (J is Crockford-legal; I is not).
- **`stage: 'sort'` exemption** now requires `state === 'deadlocked'` — a new synthetic test (`a non-deadlocked snapshot on stage: sort FAILS the invariant`) pins this down.
- **"Resolved-only" test renamed** to "empty store with empty history passes" (it was always the empty case).
- **Preflight** grew a step to locate existing test files for tasks 6.0.1–6.0.3 so the tasks extend rather than create.
