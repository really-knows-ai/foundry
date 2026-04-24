# Phase 2 Review — History Hardening + IO Shim rename

**Reviewer:** automated technical review
**Plan file:** `new-feedback/phase-2-history-hardening.md`
**Spec:** `new-feedback/2026-04-24-work-feedback-yaml-redesign.md`

---

## Summary verdict

**Revise before executing.** The phase correctly covers every spec §11 audit finding plus §7 (strip `## Feedback` from WORK.md) and §9.2 (atomic writes), and the RED/GREEN structure is sound. However, there are **two blocker-class errors** that will cause the plan to fail on execution — one is a direct contradiction of existing code that will produce a wrong test outcome, and one creates a real bug in how `markWorkfileFailed` is called. There are also several major and minor issues around mock IO refactoring, test-fixture dependencies, and task sequencing. Once these are addressed, the phase is ready to ship.

---

## Strengths

- Spec §11.1–§11.7 + §7 + §9.2 all mapped to concrete tasks; no gaps.
- Strict RED/GREEN/commit discipline with explicit "confirm failure for the right reason" gates.
- Task 2.11 correctly identifies that `mockIO` needs refactoring from single-path to multi-path and calls that out as the test-ergonomics pivot rather than hiding it inside an implementation task.
- Verification gate (2.16) spot-checks every spec §11 item — good closure.
- Legacy fixture preservation in 2.15 (leaving `failed-flow-*.test.js` fixtures alone) demonstrates awareness of cross-cutting effects.

---

## Blockers

### B1. Task 2.5 test will pass, not fail — RED step is wrong

**File:** `phase-2-history-hardening.md:264-266` (expected failure description)

The plan asserts that `node --test tests/lib/history.test.js` will fail after adding the new `describe('appendEntry — route/stage invariant')` block. It will not.

Inspecting `tests/lib/history.test.js:119-132` (`describe('appendEntry with route')`): the existing test at line 122 passes `{ cycle: 'c1', stage: 'sort', iteration: 1, comment: 'routed', route: 'forge:x' }` and the test at line 129 passes `{ stage: 'forge', ..., comment: 'x' }` with NO route. Both match the new invariant. None of the three new tests in task 2.5 will fail, because:

- Test 1 (throws when route on non-sort): the **current** `appendEntry` at `scripts/lib/history.js:21` does not throw. Test expects it to throw. **This test fails.** ✓
- Test 2 (accepts route on sort): already passes today. ✓ (pre-existing behaviour)
- Test 3 (no route on non-sort): already passes. ✓

So actually the RED description is partially correct — the *first* test fails, the others pass. But the plan says "Expected: the first new test fails (no such check in `appendEntry` today). Second and third pass." That matches after all. **False alarm — this is fine.** Downgrading to nit: rephrase "**Expected**: FAIL" at the top of the step to "**Expected**: test 1 fails; tests 2–3 pass" to avoid executor confusion.

**Actual blocker lives in 2.7, described below.**

### B2. Task 2.11 calls `markWorkfileFailed(io, msg)` but markWorkfileFailed needs a worktree-rooted io

**File:** `phase-2-history-hardening.md:584-591` (GREEN implementation); `scripts/lib/failed-flow.js:40-48` (production)

`markWorkfileFailed` reads `'WORK.md'` as a relative path via `io.exists('WORK.md')`. This relies on the passed `io` resolving relative paths against the worktree root. The *in-memory* `mockIO` in `tests/lib/history.test.js` has no resolve logic; it uses the passed path as a literal key. That works in tests, but:

1. The production callers (`sort.js`, `orchestrate.js`, `history-tools.js`) pass `historyPath` as an **absolute** path (`path.join(cwd, 'WORK.history.yaml')` — see `git-tools.js:50`, `history-tools.js:14`, `workfile-tools.js:75`). The `io` those callers use is `makeIO(worktree)` which resolves relative paths against `worktree`. So `io.exists('WORK.md')` inside `markWorkfileFailed` works — ✓.

2. BUT `loadHistory` is also called from **tests** with mock IOs that don't have a `WORK.md` entry. The try/catch in the spec handles that:
   ```
   try { markWorkfileFailed(io, msg); } catch { /* WORK.md gone */ }
   ```
   That's fine.

**Real blocker:** the plan's test at 2.11 step 1 (the `mockIO(':::not-yaml:::')` case) calls `io.writeFile('WORK.md', ...)` before invoking `loadHistory`. But the existing `mockIO` at `tests/lib/history.test.js:6-14` is **single-path**: it has one `fileContent` closure variable and `writeFile` stores to `written`, not keyed by path. Calling `io.writeFile('WORK.md', ...)` will stomp the history content or be ignored depending on how the refactor is done.

The plan anticipates this and says (line 562-568) "Either rewrite `mockIO` to hold a `{ path → content }` map (preferred)...". Good — but this is a **massive refactor** buried inside task 2.11, and every single existing test that uses `mockIO(data)` with a positional string argument (at least 10 call sites in the file) must be rewritten simultaneously. The plan says "Adjust the helper accordingly" in one sentence. This is under-specified.

**Fix:** Split the mockIO refactor into its own task (new 2.10.5 before atomic-write). Provide the exact new helper implementation and enumerate every existing call site that must be updated. Otherwise, the executor will do the refactor ad-hoc, break something subtle, and the RED/GREEN discipline will be lost.

### B3. Task 2.9 will **not** fail — test as written passes against current code

**File:** `phase-2-history-hardening.md:471-475`

The plan says: "Expected: FAIL — the current `appendEntry` calls `io.writeFile(historyPath, body)` directly with no rename, so the error we're looking for won't fire."

But the test uses `mockIO` which at this point (after task 2.5–2.8 but before 2.11's multi-path refactor) is still single-path, with no `rename` method at all. The test:

```js
io.rename = () => { throw new Error('simulated rename failure'); };
```

...monkey-patches `rename` onto the mockIO. But the production `appendEntry` at this step doesn't call `io.rename` — it calls `io.writeFile`. So the `simulated rename failure` error is never thrown, the `assert.throws(...)` fails, and the test reports a different failure shape ("expected function to throw, returned undefined") than the plan's expectation (`/simulated rename failure/` matching).

The test *will* fail, but for the wrong reason — the plan's "confirm failure for the right reason" discipline is broken. This will confuse the executor.

**Fix:** Rewrite the expected-failure description: "Expected: FAIL with `expected function to throw` (test asserts the error is caught from rename, but current appendEntry doesn't call rename at all)." Then proceed to 2.10 where switching to rename makes the test pass.

---

## Major

### M1. Task 2.11's test writes `status: failed` but asserts via regex on raw WORK.md text — fragile

**File:** `phase-2-history-hardening.md:547-549`

```js
assert.match(io.readFile('WORK.md'), /status:\s*failed/);
```

`markWorkfileFailed` uses `setFrontmatterField`. The actual emitted format depends on `setFrontmatterField`'s quoting rules. This regex will work today but is brittle to any change in frontmatter serialization. Prefer parsing frontmatter in the assertion or reusing `readFailedStatus`. Not a blocker, but worth fixing as this test will likely churn.

### M2. Order-of-tasks risk: atomic write (2.10) lands before mockIO multi-path refactor (2.11)

**File:** `phase-2-history-hardening.md` task ordering

Task 2.10 (atomic write GREEN) makes `appendEntry` call `io.rename(tmp, historyPath)`. Every existing test in `tests/lib/history.test.js` that calls `appendEntry` through the current single-path mockIO will now crash with `io.rename is not a function` — because at this point we haven't yet extended mockIO (that happens inside 2.9's RED step via monkey-patch, but the existing tests don't monkey-patch). The plan vaguely says in task 2.10 step 3: "Any test that uses a mock IO without `rename` will fail — fix each by extending the mock. Search for candidate mocks." This is imperative, not specified.

The existing mockIO is used by `appendEntry` tests at lines 46, 56, 122, 129. After 2.10 lands, all four crash. The executor will have to extend the local `mockIO` helper mid-task with an ad-hoc `rename`. That's another undocumented multi-line change.

**Fix:** Before task 2.9, add an explicit "task 2.8.5: Add `rename` to `mockIO` helper" that makes the local mockIO path-aware enough to support the upcoming atomic-write refactor. Do it once, cleanly. Then the subsequent atomic-write tests in 2.9–2.10 slot in without ambient breakage.

### M3. `open_feedback` not wired in phase 2 despite spec §10

**File:** `PLAN.md:58` (phase scope); `phase-2-history-hardening.md:5` (spec coverage)

The plan says phase 2 covers "§10 (open_feedback — shape only; actual computation happens in phase 4)". But "shape only" is not enforced anywhere in phase 2:
- `appendEntry` doesn't touch `open_feedback`.
- No test asserts `open_feedback` round-trips.
- `loadHistory` sort/filter doesn't mention it.

If "shape only" means "future-compat: the field is allowed", then no test or code is needed in phase 2 and the claim is trivially true. But spec §10 says: "`appendEntry` coerces `undefined` to `0` rather than omitting the field — the field is always present in new entries." That contract is explicit and testable. The plan defers it entirely to phase 4 (where orchestrate.js computes the value), but the *coercion invariant* belongs in `appendEntry` which is phase 2's home. Defer-to-phase-4 for the *value* is fine; defer for the *invariant* is wrong.

**Fix:** Add task 2.7.5 or extend task 2.7: `appendEntry` accepts an `openFeedback` param (nullable), stamps `open_feedback: openFeedback ?? 0` on every new entry. Test it in phase 2. Phase 4 will later pass a real value; until then it's `0`.

### M4. Task 2.10 step 3 grep is malformed

**File:** `phase-2-history-hardening.md:504`

```
rg -n "writeFile.*historyPath\|appendEntry" tests/ .opencode/
```

The `\|` is shell-escaped pipe, wrong for ripgrep (wants bare `|`). Also the quoting is single-line broken — this will either produce zero matches or a literal-backslash-pipe search. Fix to `rg -n "writeFile.*historyPath|appendEntry" tests/ .opencode/`.

### M5. Task 2.15's claim about failed-flow fixture tests is unverified

**File:** `phase-2-history-hardening.md:760-765`

Plan claims three files (`stage-end-failed-flow.test.js`, `failed-flow-e2e.test.js`, `failed-flow-tool-gate.test.js`) "embed the heading in a fixture template; they should keep it... the legacy `feedback.js` walker still handles `## Feedback` sections if they exist." That's plausible, but unverified in the plan. If those tests actually *assert* that `createWorkfile`'s output contains `## Feedback`, they'll break when the GREEN step lands. Before task 2.14, add a preflight grep:

```
rg -n "## Feedback" tests/plugin/
```

and inspect each match to confirm it's a fixture (hard-coded string) vs. an assertion on a `createWorkfile` result. This takes 30 seconds and avoids a surprise test failure in 2.15.

---

## Minor

### Mi1. `readLastSortRoute` deletion not checked against the foundry plugin

**File:** `phase-2-history-hardening.md:168-172`

Preflight grep in task 2.3 covers `scripts/`, `tests/`, `.opencode/` — good. But the deletion rationale ("Unused in production") was established earlier; the plan does not re-confirm it against the current tree. Safe to execute, but worth a one-line "confirmed zero production callers on 2026-04-24 by `rg readLastSortRoute`" in the commit message or task step.

### Mi2. Task 2.13 doc-only commit is bundled poorly

**File:** `phase-2-history-hardening.md:648-681`

A doc-only change with its own commit is fine but adds git noise. Could be squashed with an adjacent functional commit (e.g. 2.7 seq field or 2.11 markWorkfileFailed) under a combined `docs:` suffix. Not important.

### Mi3. ULID monotonicity test in phase 1 (referenced from phase 2?)

Not phase 2 — noting that phase 1 task 1.1 has a monotonicity test `assert.deepEqual(ids, sorted)` over 50 calls in a tight loop. With `Date.now()` granularity (1ms on most platforms), 50 ULIDs will land in the same ms and rely on the `incrementRandom` path. The test will pass, but the `randomIndexes()` re-seed branch inside `incrementRandom` (overflow at index 0) is never hit. Low risk for phase 2, but worth noting for the phase-1 review.

### Mi4. `timestamp` format round-trip

Existing tests at `tests/lib/history.test.js:24,32` use `2025-01-01T00:00:00Z` (no ms). The new code in phase 2 doesn't change `appendEntry`'s `new Date().toISOString()` emission, which always includes ms (`.000Z`). `loadHistory`'s comparator uses `new Date(ts).getTime()`, which parses both fine. No issue, but confirm no fixture anywhere asserts the precise ms-less form.

### Mi5. Sort key stability assumption

`loadHistory`'s sort uses `(ta !== tb) ? ta - tb : sa - sb`. If two entries share `timestamp` AND `seq` (possible in legacy data where both default to 0), the sort falls back to V8's stability guarantee. Fine for Node 18+ (sort is stable since V8 7.0), but worth a one-line comment in the code.

---

## Nits

- `phase-2-history-hardening.md:103-104` imports `renameSync` from `'fs'` but the existing top-of-file imports are split between `'fs'` (default) and destructured members. Append to the destructured import; don't create a second `from 'fs'` line.
- Commit messages use backticks inside `"..."` shell strings. `bash -c "git commit -m \"... \`foo\` ...\""` will try to execute `foo`. Either escape properly, use heredocs, or switch to single-quoted commit messages. Small but will bite an executor copy-pasting.
- Task 2.7 test at line 322 asserts `data[0].seq, 0` after one `appendEntry` call. If `mockIO` accumulates via monkey-patched rename (see M2), this may not read back what was written. Needs coordination with M2's fix.

---

## Contract with phase 1

Phase 2 does not consume phase-1 outputs directly. It adds `io.rename` to `makeIO` — this is what phase 1's feedback-store will use at production time (phase 3/4 wires it up). Phase 1 already mocks `rename` in its own in-memory `mockIO`. The real-IO `rename` shape (`(from, to) => renameSync(resolvedFrom, resolvedTo)`) matches phase 1's mock behaviour. Contract OK.

One latent concern: phase 1's `feedback-store.js` uses `io.exists`, `io.readFile`, `io.writeFile`, `io.rename`. Phase 2 adds `rename` to `makeIO`. Phase 1 does **not** wire feedback-store into any production code — that's phase 3/4 — so there's no phase-2 runtime dependency beyond the shim capability. ✓

---

## Open questions

1. **Is `open_feedback`'s zero-default acceptable for the phase-2 coercion?** If yes (see M3), phase 2 can land it cleanly. If the spec intends `open_feedback` to be strictly populated by orchestrate.js from day one, phase 2 should skip it entirely and the spec-coverage claim in the phase header should be reduced.
2. **Does the failed-flow test suite use fixture WORK.md that happens to match `createWorkfile`'s output?** If yes, the `## Feedback` removal will drift the fixtures. See M5.
3. **Is there a reason orchestrate.js uses `route: lastStage.stage` to mean "route to the stage that just ran" (backward-looking) rather than "route to the next stage" (forward-looking)?** This isn't phase-2 scope but affects how the `route` field is interpreted in the deadlock/consistency tests. Phase 2's invariant `route ⇒ stage==='sort'` is orthogonal to the semantic question, but worth flagging for phase 4/6.

---

## Recommendation

**Revise.** The blockers (B2 mock-IO refactor underspecified; B3 wrong-reason RED in atomic-write task) and the M2 task-ordering issue will derail the execution. Fixes are surgical:

1. Insert task 2.8.5: rewrite `mockIO` in `tests/lib/history.test.js` to multi-path + add `rename`. One commit.
2. Fix task 2.9 expected-failure description.
3. Add task 2.7.5: wire `open_feedback` coercion into `appendEntry` with round-trip test.
4. Add preflight in 2.14 to inventory every `## Feedback` reference in `tests/plugin/`.
5. Fix shell-escaping nits in commit message blocks and `rg` grep in 2.10.

With those changes, phase 2 is ready to ship. Estimated additional scope: ~60 LOC across one new task and two task revisions; no spec drift.
