# Phase 1 Review — Feedback Store + State Machine

**Reviewer:** plan-reviewer subagent
**Date:** 2026-04-24
**Scope:** `new-feedback/phase-1-feedback-store.md` vs. spec `2026-04-24-work-feedback-yaml-redesign.md` and current codebase.

## Summary verdict

Phase 1 is **mostly sound but has several concrete correctness and testability problems that must be fixed before it ships**. The chosen decomposition (ULID → transitions → store, each TDD'd in isolation) is appropriate, and the state-machine rewrite matches spec §5. However: (a) the "GREEN" step for the transitions rewrite doesn't actually work — the legacy shim in `feedback.js` depends on a target value (`approved`) that no longer exists in the new matrix, so the rewrite will turn the repo red even with the suggested bridge; (b) Task 1.9's RED step specifies tests that *already pass* on the implementation written in Task 1.6, violating TDD; (c) the store's atomicity model has a real bug (same-millisecond ULID monotonicity state is module-global and persists across store instances, breaking deterministic tests and also leaking between real processes within one Node run); (d) reason-required semantics for `resolved-from-deadlocked` contradict spec §4.3. Fix the blockers, tighten two majors, and this phase is ready.

## Strengths

- TDD discipline is enforced per task with explicit RED/GREEN/REFACTOR/COMMIT steps.
- Test coverage of the transition matrix is thorough (forge, source, override, terminal, unknown).
- Dedup invariants for resolved vs deadlocked items are explicitly tested (§8.3 edge cases).
- Verification gate (1.12) correctly asserts that no production code imports the new modules yet — protects against premature wiring.
- Reasonable scope boundary: phase 1 adds capability only; no callers touched, so a regression here can't take down `sort`/`orchestrate`.

## Issues by severity

### Blockers

**B1. Legacy shim in task 1.4 step 3 is wrong — it breaks all existing `validateTransition` callers.**
*Phase file: `phase-1-feedback-store.md:446-466`. Current code: `scripts/lib/feedback.js:256`.*

The plan's shim maps legacy `target === 'approved'` to new `target === 'resolved'`. But the new matrix requires:

```js
sourceMatches: true
```

to be set — **and** it only allows quench/appraise/human-appraise to produce `resolved` from `{actioned, wont-fix}`. That part is fine. The *real* problem is that `feedback.js:147` (`resolveFeedbackItem`) passes `resolution` which is `'approved' | 'rejected'`, but the shim only rewrites `current`/`target`, so `resolveFeedbackItem(… , 'approved', …)` arrives at the shim with `target='approved'`, gets rewritten to `'resolved'`, fine. But `validateTransition` is also called from `actionFeedbackItem` and `wontfixFeedbackItem` with targets `'actioned'` / `'wont-fix'` — the new matrix rejects those on `stageBase='quench' | 'appraise'` etc. when coming from `open`, because the new matrix restricts forge-only targets to `stageBase === 'forge'`. That matches the old matrix, so those calls are fine.

The *actual* blocking failure: the old matrix row `'wont-fix': { approved: ['appraise','human-appraise'], rejected: ['appraise','human-appraise'] }` allowed appraise to transition `wont-fix → approved` *without* the new sourceMatches constraint. The legacy shim passes `sourceMatches: true` unconditionally, so it will silently **weaken authorship for every legacy call**. That in itself is not a failure against the existing test suite (the old tests don't check source identity), so the green-bar will hold — but it means phase 1 has *tightened* the state machine and *loosened* the authorship rule for the interim, which is the opposite of the intended staged rollout.

**Fix:** either keep the old `MATRIX` export alongside the new `validateTransition` (two named exports; new one used by the new store, old one left intact for the legacy shim) OR delete the legacy matrix use site in `feedback.js` entirely in phase 1 by removing the `stageBase` plumbing from `resolveFeedbackItem`/`actionFeedbackItem`/`wontfixFeedbackItem`. Do not smuggle a lossy adapter into a "temporary" shim that will live for five tasks across two phases.

**B2. ULID monotonicity state is module-global and leaks across test files and store instances.**
*Phase file: `phase-1-feedback-store.md:103-155`.*

The implementation uses `let lastTime` / `let lastRandom` at module scope. Two problems:

1. **Test isolation violation.** If test A calls `ulid(1700000000000)` and test B later calls `ulid()` with a real timestamp, state leaks because `node --test` runs tests in the same process (each file in its own worker but tests within a file share module state). The "accepts a custom timestamp for deterministic testing" test at `phase-1-feedback-store.md:70-75` will pass the first run but its `lastRandom` mutation will contaminate whatever test runs next in the same file. Flaky.
2. **In a real process doing 1M+ ULIDs in under a ms**, the incrementRandom path eventually overflows and re-seeds (handled), but the re-seed can produce a value *lower* than the previous, breaking the monotonicity invariant the "produces unique ids across rapid calls" test implicitly relies on. The test uses a `Set` so it won't catch non-monotonicity, but the spec-derived monotonicity test at line 57-62 ("is monotonic when called repeatedly") will fail intermittently when re-seed happens.

**Fix:** either expose a factory (`createUlidGenerator()`) and let tests use a fresh generator, OR accept that monotonicity is a best-effort property and soften the test to "no two ids are equal" + "timestamp component is monotonic". Spec §4.2 says "monotonically-sortable" — that's a property of the timestamp prefix, not of the full ULID across same-ms calls. The monotonicity test over-specifies.

**B3. Reason-required-on-resolved-from-deadlocked contradicts spec §4.3.**
*Phase file: `phase-1-feedback-store.md:864-869`. Spec: §4.3 table + §5.1 rule 5.*

Spec §4.3 says `reason` is "forbidden on `open`, `actioned`, `resolved`". Spec §5.1 rule 5 says "`reason` is always required on a deadlocked-item resolution". These contradict when target=`resolved`. Phase 1's implementation picks §5.1's side, and the test at `phase-1-feedback-store.md:788-796` ("deadlock override requires a reason") locks that in. Fine as a decision, but:

- The YAML schema in §4.1 then will carry `reason` on `state: resolved` snapshots sometimes (deadlock override path) and never otherwise. Consumers (sort, history writer, any downstream reader) must tolerate this. Phase 1 doesn't note the asymmetry.
- No test enforces "reason is omitted from the snapshot when not provided and not required" (e.g. `target=actioned` with no reason should yield a snapshot with no `reason` key, not `reason: undefined`). Current `saveItems` would serialise `undefined` as yaml `~`. Check needed.

**Fix:** (1) Either update spec §4.3 to say `reason` is allowed on `resolved` iff the predecessor was `deadlocked`, or pick the other side and test that human-appraise can override without a reason. Surface this in the phase as an explicit decision with a pointer to whichever spec section gets the fixup. (2) Add a test asserting `reason` field is absent (not `null`, not `undefined`) on snapshots where no reason was passed.

**B4. Task 1.9 is not a real RED step — tests pass without implementation change.**
*Phase file: `phase-1-feedback-store.md:984-988`.*

The task explicitly says: "all tests should pass on first run". This is exactly what TDD forbids. Per the plan's own ground rules (`PLAN.md:69`): "write the failing test, run it and confirm it fails **for the right reason**". The task rationalises this as "documentation-only commit locking in the invariant" but that's retroactive test-writing, not TDD. If the dedup invariant genuinely is already correct, either:

- Delete task 1.9 entirely (it adds no behavioural change).
- Roll the dedup-edge-case tests into task 1.5/1.6 RED, where `add`'s dedup behaviour is being defined for the first time.

Keeping it as-is teaches subagents that "passes on first try" is acceptable when it obviously is not.

### Majors

**M1. `openFeedbackStore` loads items once at construction; writes are persisted, but reads are from an in-memory snapshot.**
*Phase file: `phase-1-feedback-store.md:612`.*

If two `openFeedbackStore` instances exist concurrently (even in tests — e.g. across a single process with multiple test assertions opening fresh stores to simulate persistence), writes from instance A are invisible to instance B's in-memory list until B is re-opened. The test at `phase-1-feedback-store.md:557-564` ("a fresh store instance on the same io sees the persisted item") implicitly acknowledges this by re-opening.

This is mostly fine for single-writer semantics (spec non-goal #5: "multi-process safety"), but:

- Sort's `writeDeadlockSnapshots` (spec §6.1) "acquires a feedback-store handle early, walks all items via the new API, and writes deadlocked snapshots". If orchestrate previously opened its own store handle (to compute `open_feedback` for history.yaml per §10), sort's writes won't be seen by orchestrate unless orchestrate re-opens after sort. Phase 4 handles this, but phase 1's `list()` contract should be documented as "snapshot at open time + this instance's writes", not "live".
- Concurrency between sort and plugin tools is avoided by the stage lock in production, but unit tests that mock the IO shim don't model the lock.

**Fix:** add a one-line doc comment on `list()`: "Returns this instance's current view. Reads do not re-check the file on disk. Callers that need the latest state across writers must re-open the store." Phase 1 is the right place for this because sorting out the contract now prevents phase 3/4 confusion.

**M2. Atomicity refactor in task 1.11 is speculative and may not trigger.**
*Phase file: `phase-1-feedback-store.md:1059-1071`.*

The task says "these tests should pass on first run" and the suggested refactor (build `nextItems`, save, then swap) is gated on "if in-memory-already-mutated variant fails". The current task 1.6 implementation uses `items.push(item); persist();` — it **will** fail the atomicity test because on rename-throw, the in-memory `items` already has the new item while the file does not. But the test only inspects `io._files['WORK.feedback.yaml']`, not in-memory state; so strictly it passes.

**However** the next test that calls `store.list()` on the same instance will see the not-actually-persisted item. The task doesn't test this follow-up. Two items are deceptively in sync — the `io._files` check passes, but the store is now inconsistent with disk.

**Fix:** add a third assertion to the atomicity tests:

```js
assert.equal(store.list().length, 0, 'in-memory state must roll back on persist failure');
```

This will fail under the current task-1.6 impl, forcing the nextItems-swap refactor to actually land. Without this assertion, task 1.11 is a no-op.

**M3. Tests for the new store don't exercise `js-yaml` round-trip characters.**
*Phase file: `phase-1-feedback-store.md:534`.*

Feedback text in the wild contains colons, newlines, YAML indicator chars (`-`, `*`, `?`, etc.), and multi-byte characters. `js-yaml.dump` with `lineWidth: -1` handles these but round-trip failures occasionally surface on long URLs or embedded code fences. Add:

```js
test('handles feedback text with yaml metacharacters', () => {
  const io = mockIO();
  const store = openFeedbackStore('WORK.feedback.yaml', io);
  const tricky = '- [x] a: b\n  | foo | bar\n  ```code```';
  const { id } = store.add({ file: 'a.md', tag: 'law:x', text: tricky, source: 'appraise:a', cycle: 'c' });
  const store2 = openFeedbackStore('WORK.feedback.yaml', io);
  assert.equal(store2.get(id).text, tricky);
});
```

This protects against a `dump`/`load` asymmetry that would silently corrupt text on first re-open.

**M4. No test verifies `history[0]` is returned as a *copy*, not a reference.**
*Phase file: `phase-1-feedback-store.md:624-632`.*

`list()` returns `{ ...it, history: it.history.map(h => ({ ...h })) }` — shallow clones. If a caller mutates `returned.history[0].reason = 'x'`, that doesn't affect the store, but if a caller mutates `returned.tag = 'y'` it also doesn't — good. Still, no test locks this invariant. Add one. Defensive copies are easy to break in later refactors.

**M5. The plan description at `PLAN.md:43` says `tests/lib/feedback-transitions.test.js` is "rewrite", but the phase RED step at `phase-1-feedback-store.md:188` doesn't actually delete the existing file — it just overwrites.**

Current `tests/lib/feedback-transitions.test.js` has three legacy tests that will still pass the *old* `validateTransition` signature: `validateTransition('open', 'actioned', 'forge')` (positional). Under the new signature `{currentState, target, stageBase, sourceMatches}`, these throw or silently fail (destructuring on a string returns `undefined` for each field, which hits `unknown state: undefined`).

The phase file says to write the new tests but doesn't explicitly say "replace the file contents". A subagent following literally could append to the existing file, leaving both old and new tests in the same file, producing a mixed green/red result.

**Fix:** add explicit instruction: "Overwrite `tests/lib/feedback-transitions.test.js` entirely; do not append."

### Minors

**m1. Spec path reference in phase header is inconsistent.** `phase-1-feedback-store.md` doesn't cite a spec path; `PLAN.md:14-15` points at `new-feedback/2026-04-24-work-feedback-yaml-redesign.md`, but §18 of the spec itself claims the doc lives at `docs/specs/2026-04-24-…`. Pick one. A subagent who can't find the spec will guess.

**m2. `validateTransition` rejects `stageBase === 'sort'` silently.** The matrix has no sort row (intentional — spec §6.1 says sort bypasses). But a caller passing `stageBase: 'sort'` gets `unsupported stage base: sort`, which is correct but not self-documenting. Consider adding a specific error: `"sort must use writeDeadlockedSnapshot, not transition"`.

**m3. The test `'quench can resolve only items it sourced'` at `phase-1-feedback-store.md:249` tests a scenario that spec §5 doesn't clearly authorise.** Spec §5.1 rule 3 lists quench among stages that "operate on items where `history[0].state ∈ {actioned, wont-fix}`... Produce `resolved` or `rejected`." Fine. But phase 1's `validateTransition` treats `quench:*` the same as `appraise:*` for wont-fix transitions too (`wont-fix → resolved`), whereas the old matrix intentionally forbade quench from touching wont-fix (spec §5 row `wont-fix    —   → {resolved, rejected}   ...`). Re-read: the spec table column header is "quench / appraise / human-appraise (source == item.source)". Quench *is* allowed. So phase 1 is right and the old matrix was more restrictive. Note the behavioural change in the commit message — anyone reading diffs will wonder.

**m4. No explicit test that `history` never grows longer than expected.** If a caller inadvertently calls `transition` twice for the same effective move (e.g. double-click equivalent), the code will prepend two identical snapshots. Phase 1 accepts this; a "same transition twice produces two snapshots" test locks the behaviour. Decide which is intended.

**m5. `saveItems` writes `{ items: [] }` as `items: []\n`** — js-yaml default flow-style rendering for empty arrays is `items: []`, but for non-empty it's block style. No correctness issue; cosmetic.

**m6. `nowIso` is called twice during transition of a single item when snapshot timestamp and history-yaml `open_feedback` computation both need "now" — they diverge by a few ms.** Irrelevant for phase 1 (no history integration yet) but will matter in phase 4. Note in phase 4 file.

**m7. The "source" field format (`base:alias`) is assumed without being validated.** Spec §4.2 says `source` is type `string (base:alias)`. Phase 1 accepts any string, and `transition` splits on `:` to extract base. If a subagent later passes `source: 'appraise'` (no alias), `stage.split(':')[0]` returns `'appraise'` and `sourceMatches = stage === item.source` still works coincidentally. Consider rejecting invalid formats in `add`.

### Nits

**n1.** `phase-1-feedback-store.md:50` uses `[0-9A-HJKMNP-TV-Z]` — that character class excludes `U` correctly but a comment linking to the Crockford base32 reference would help future readers.

**n2.** Commit message in task 1.4 describes the shim as "minimal" and "one-line" — it's 10 lines (the options-object literal). Update wording.

**n3.** Task 1.12 grep at line 1107 (`rg -n "from.*feedback-store|from.*ulid"`) will also match `from.*ulidtest` if anyone names a future file that way. Tighten regex: `from ['"].*feedback-store`.

**n4.** `tests/lib/feedback-store.test.js:505` inlines an in-memory IO with its own `rename`. `tests/helpers/mockIO.js` doesn't exist yet (plan assumes it). If future phases introduce it, this inline mock drifts. Consider extracting now into `tests/helpers/mockIO.js` as part of phase 1 — the plan references this helper at `PLAN.md:77` as if it already exists.

## Open questions for the author

1. **§4.3 vs §5.1 resolution on `reason` for deadlock-resolved.** Which wins? Update the spec and cite the chosen rule in the phase commit message.
2. **Is the `tests/helpers/mockIO.js` helper assumed to exist (PLAN.md:77) or to be written?** If written, which phase owns it?
3. **Should phase 1 preserve the existing `tests/lib/feedback-transitions.test.js` as a regression fixture during the transition, or overwrite?** The blocker B1 fix depends on this.
4. **ULID monotonicity: property of timestamp prefix only, or of the full 26-char string?** Spec §4.2 says "monotonically-sortable". Tighten the test accordingly.
5. **What is the expected behaviour when `io.rename` on an in-memory mock encounters a same-path (`from === to`) rename?** Not addressed; unlikely to hit but worth a one-line assertion.

## Recommendation

**Revise, then ship.** Blockers B1–B4 are all addressable with small, local changes — none require restructuring the phase. Majors M1–M5 are mostly "add an assertion / add a comment" items. Plan for ~1 hour of revision, re-review, then green-light. Do not dispatch subagents against the current draft — B1 will produce a regression in `npm test` that the subagent will try to patch with increasingly desperate shims, and B4's "passes on first run" instruction will be internalised as a valid TDD outcome and leak into future plans.
