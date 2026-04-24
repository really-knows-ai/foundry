# Phase 4 Review — Sort Integration + open_feedback + Legacy Cleanup

**Reviewer:** code-review pass over `new-feedback/phase-4-sort-integration.md`
**Date:** 2026-04-24
**Ground truth:** `new-feedback/2026-04-24-work-feedback-yaml-redesign.md`

## Summary verdict

**Needs revision before dispatch.** The phase delivers on the spec intent (per-item
deadlock; `open_feedback` stamping; legacy module deletion) and the TDD/commit
cadence is disciplined. But there are several concrete defects that will cause
executor subagents to stall, hand-roll alternate harnesses, or ship subtly wrong
behaviour:

1. Task 4.2 Step 2 leaves a quietly broken state-mapping (`'resolved' → 'actioned'`)
   that misrepresents deadlock-awareness in the routing branch and contradicts its
   own "Actually, simpler" pivot two paragraphs later. The final instruction is
   ambiguous.
2. The deadlock-pass ordering vs. `determineRoute` is underspecified: sort writes
   deadlock snapshots only inside `nextAfterAppraise`'s call site, so sort
   invocations after `quench` or `forge` (the typical sequence) never perform the
   deadlock pass — contradicting spec §5.2 which says sort "walks all non-resolved
   non-deadlocked items before emitting a route."
3. Task 4.4 Step 5 silently modifies `scripts/lib/history.js:appendEntry` — that
   file belongs to **phase 2** and was already hardened. This either
   double-modifies it or assumes phase 2 left the field unimplemented (it does —
   see below), which the phase text does not make explicit.
4. The "simpler approach" escape hatch in 4.3 (`computeOpenFeedback` unit test)
   is labelled "prefer this" but the preceding block already wrote out the
   full integration test — executors will waste time on the integration path
   before discovering the unit-level helper is acceptable.
5. Task 4.1's `cycleDef` placeholder (`'-- fill in from existing test pattern --'`)
   is honest about the inspection step but the existing `runSort` tests in
   tests/sort.test.js don't take a `cycleDef` argument at all (verified: all
   five call sites pass only `workPath`/`historyPath`). The placeholder is
   misleading.

TDD structure is good and gates are tight. After fixes, this phase is mergeable.

## Strengths

- Deletion of `detectDeadlocks` and the legacy module is appropriately staged as
  the last task (4.5), after all imports are proven gone. The grep-based
  preflight in 4.5 Step 1 is a solid last-line check.
- The state-mapping problem in 4.2 is at least **acknowledged** in the Step 2
  commentary ("Actually, simpler") — the author spotted the issue but didn't
  resolve it cleanly.
- The 4.6 verification gate greps for *every* old function name
  (`detectDeadlocks|parseFeedback|parseFeedbackItem|addFeedbackItem|...`),
  which is the right bar and catches phase-3 leaks.
- Spec §14.3 coverage (three tests: brand-new item not deadlocked,
  per-item deadlock trips, `deadlock-appraise: false` bypass) maps 1:1 to
  task 4.1 Step 4.
- Commit messages are well-scoped and informative; each closes an identifiable
  spec section.

## Issues by severity

### Blocker B1 — Deadlock pass is bound to the appraise branch only

**Refs:** phase-4 task 4.2 Step 4; spec §5.2 ("sort walks all non-resolved
non-deadlocked items **before emitting a route**") and §6.1 ("acquires a
feedback-store handle early, walks all items via the new API, and writes
deadlocked snapshots for any that qualify").

The task says "integrate the deadlock pass **around the `nextAfterAppraise`
call**, before routing." That is strictly narrower than the spec requires.
Consider: quench runs, appraise runs next by routing, quench runs again, appraise
runs again. If sort only calls `writeDeadlockSnapshots` inside `nextAfterAppraise`,
then an item's depth-N threshold is checked every other sort call at best — and
if the cycle terminates without re-entering the appraise branch (e.g. exhausts
`max-iterations` mid-quench loop), the final deadlock-check never runs.

**Concrete suggestion.** Hoist `writeDeadlockSnapshots` up to `runSort` proper,
just after `loadHistory(...)` and before `determineRoute(...)`. The pass should
be unconditional (gated only by `deadlockAppraise` frontmatter flag) and
independent of which branch `determineRoute` ultimately takes. The routing
branches then all see a consistent store state.

```js
// In runSort, after feedback load:
writeDeadlockSnapshots(store, {
  threshold: deadlockIterations,
  enabled: deadlockAppraise,
  cycle,
});
const refreshedItems = store.list();
const anyDeadlocked = refreshedItems.some(it => it.history[0].state === 'deadlocked');

// Pass anyDeadlocked + the refreshed items into determineRoute, or precompute
// the deadlock-override route here.
```

This matches spec §6.1 verbatim and decouples the deadlock pass from routing
semantics.

### Blocker B2 — State mapping in task 4.2 Step 2 is wrong and contradictory

**Refs:** phase-4 task 4.2 Step 2.

Two problems:

(a) The `state: head.state === 'resolved' ? 'actioned' : head.state` mapping
means a deadlocked item is surfaced to routing helpers with `state: 'deadlocked'`,
which the existing `needsForge = feedback.some(f => f.state === 'open' || f.state === 'rejected')`
predicate correctly ignores. Good. But the `pendingApproval` predicate
(`f.state === 'actioned' || f.state === 'wont-fix'` **AND** `!f.resolved`) will
return true for the shimmed `state: 'actioned', resolved: true` — then the
routing branch `if (pendingApproval) return findFirst(stages, 'appraise')` will
route back to appraise **even for already-resolved items**. That reverses intent.

(b) The task then says "Actually, simpler: give routing helpers direct access to
`head.state`" — but does not actually rewrite the helpers. It hand-waves with
"These still work against the mapping above... Leave them." They do not work:
see (a).

**Concrete suggestion.** Pick one approach and commit:

Option 1 (preferred): update `nextAfterQuench` and `nextAfterAppraise` to use
the native six-state vocabulary. The store exposes `state: 'resolved'` for
terminal items — just skip them.

```js
// feedback surface for routing:
const feedback = store.list().map(it => ({
  id: it.id,
  file: it.file,
  state: it.history[0].state,  // raw
  depth: it.history.length,
}));

// nextAfterQuench / nextAfterAppraise:
const openItems = feedback.filter(f => f.state !== 'resolved' && f.state !== 'deadlocked');
const needsForge = openItems.some(f => f.state === 'open' || f.state === 'rejected');
const pendingApproval = openItems.some(f => f.state === 'actioned' || f.state === 'wont-fix');
```

No `resolved` flag; no double-encoding. Delete `f.resolved` references entirely.

Option 2: keep the shim but fix it — only set `resolved: true` when mapping a
terminal item, AND exclude terminal items from `pendingApproval` explicitly.
More code, same result. Option 1 is cleaner.

### Blocker B3 — `appendEntry` open_feedback change lands in the wrong phase

**Refs:** phase-4 task 4.4 Step 5; phase-2 spec coverage claim ("§10 —
open_feedback — shape only; actual computation happens in phase 4"); phase-2
task 2.6 / 2.8 / 2.10 (none of which touch `appendEntry` signature for
open_feedback).

Phase 2 explicitly disclaims "shape only" for open_feedback but never actually
wires the field into `appendEntry`. Phase 4 then slips in an `appendEntry`
signature change inside a commit that also changes `orchestrate.js`. This
conflates concerns, and more importantly, if phase 2 is audited as "done
per the phase spec" and merged, a subsequent pair-review of phase 4 will see
`scripts/lib/history.js` being changed without any history test covering the
new destructured field. The test added in 4.3 is at `tests/plugin/...` or
`tests/orchestrate.test.js`, not at `tests/lib/history.test.js`.

**Concrete suggestions** (pick one):

1. **Move the `appendEntry` signature change to phase 2.** Phase 2 task 2.8
   (or a new 2.8b) adds `open_feedback` to the destructured args and writes
   the field with coercion-to-zero. A corresponding history unit test goes in
   `tests/lib/history.test.js`: "appendEntry stamps open_feedback when
   supplied; defaults to 0 when omitted." Phase 4 then only wires the
   call-site (`scripts/orchestrate.js`), no history.js touch.

2. **Keep the change in phase 4 but add a history unit test.** Phase 4 task 4.3
   gains an additional `tests/lib/history.test.js` test for the field coercion.
   Phase 4's commit message (4.4 step 8) already mentions `scripts/lib/history.js`
   so this is the smaller shuffle.

Either is defensible; option 1 is tidier.

### Major M1 — `cycleDef` placeholder in 4.1 does not match the existing harness

**Refs:** phase-4 task 4.1 Step 4 (`runSort({ ..., cycleDef: '-- fill in from existing test pattern --', mint: () => 'token' }, io)`).

Every existing `runSort` call in `tests/sort.test.js` takes only `workPath` and
`historyPath`. None passes `cycleDef` or `mint`. The phase-4 author likely
added `mint` because they're aware of recent sort changes, but the placeholder
tells the executor to copy from non-existent call sites.

**Concrete suggestion.** Replace Step 4's `runSort(...)` calls with:

```js
const result = runSort({ workPath: 'WORK.md', historyPath: 'WORK.history.yaml' }, io);
```

...and drop the `mint` arg from the tests. The deadlock routing test doesn't
need `mint` because `result.route` assertion is sufficient; token minting is
orthogonal to deadlock logic.

Also remove the bolded paragraph "**Important:** the `cycleDef` arg value must
come from the existing test file" — it sends executors chasing a ghost.

### Major M2 — Test IO's `rename` vs. existing sort tests

**Refs:** phase-4 task 4.1 Step 3; phase-2 added `rename` to `makeIO` but the
existing sort tests (lines 665, 671, etc.) construct inline IO objects without
`rename`.

`writeDeadlockSnapshots` → `store.writeDeadlockedSnapshot` → `persist()` →
`io.writeFile(tmp, ...); io.rename(tmp, path)`. Any existing sort test whose
inline `io` lacks `rename` will throw `io.rename is not a function` once phase
4's sort.js calls the store. The phase text mentions this obliquely in 4.2
Step 5 ("Walk through each failing test one at a time") but does not call out
that the failure **mode** will universally be missing-`rename`.

**Concrete suggestion.** Add to 4.1 Step 3: "Every existing inline IO object
in `tests/sort.test.js` that does NOT include `rename` must have it added if
the test exercises a path that constructs a feedback store. The quickest fix
is to migrate those tests to the new `makeSortIO` helper." List the line
numbers (665, 671, 682, 716, 732) explicitly so the executor doesn't hunt.

### Major M3 — `readRecentFeedback` behaviour change is implicit

**Refs:** phase-4 task 4.4 Step 2.

The rewrite changes `readRecentFeedback` from "last N matching items" (the
current `.slice(-limit)`) to "most-recent-first limit" via a descending
timestamp sort and `.slice(0, limit)`. Those produce the same items only when
the yaml order matches timestamp order — which is true by construction today.
But if the caller uses the result for display (and humans read top-down), the
new "most-recent-first" order is a UX change that isn't flagged in the
commit message or spec.

**Concrete suggestion.** Either:
- Preserve oldest-first semantics: `candidates.slice(-limit)` after a stable
  timestamp sort ascending.
- Explicitly document in the commit message: "readRecentFeedback now returns
  most-recent-first (previously file-order); callers display top-down."

### Major M4 — Deadlock pass is not transactional across items, but phase claims spec compliance

**Refs:** phase-4 task 4.2 Step 3 (`writeDeadlockSnapshots`); spec §6.1:
"`writeDeadlockSnapshots` works on a single in-memory snapshot of the items:
it walks the list, prepends `{ state: deadlocked, ... }` to every item that
qualifies in the same pass, then serialises and writes the full file once
via the atomic rename."

The phase-4 implementation calls `store.writeDeadlockedSnapshot({ id, ... })`
in a loop — and `writeDeadlockedSnapshot` (defined in phase 1 task 1.8)
calls `persist()` internally on each invocation. That's N atomic rename cycles,
not one. If three items qualify and the second rename fails, items 0 has
`deadlocked` in its history and item 2 does not — exactly the "half-deadlocked"
state spec §6.1 explicitly forbids.

**Concrete suggestion.** Add a batch primitive to the store in phase 4 (task
4.2 can add it adjacent to the sort wiring), or extend phase 1's
`writeDeadlockedSnapshot` retroactively:

```js
// scripts/lib/feedback-store.js
writeDeadlockedSnapshots(deadlocks) {
  // deadlocks: [{ id, cycle, reason }, ...]
  const next = items.map(item => {
    const match = deadlocks.find(d => d.id === item.id);
    if (!match) return item;
    return {
      ...item,
      history: [
        { state: 'deadlocked', stage: 'sort', cycle: match.cycle,
          timestamp: nowIso(), reason: match.reason },
        ...item.history,
      ],
    };
  });
  saveItems(path, next, io);  // single rename
  items = next;
  return { ok: true };
},
```

Then sort's `writeDeadlockSnapshots` becomes:

```js
const qualifying = store.list().filter(/* ... depth >= threshold ... */);
if (qualifying.length) {
  store.writeDeadlockedSnapshots(qualifying.map(it => ({ id: it.id, cycle, reason: ... })));
}
```

One rename, all-or-nothing. This **must** go in phase 4 because it's invoked
from sort; the underlying primitive could stay in phase 1.

### Minor m1 — `findFirst(stages, 'human-appraise')` fallback order

**Refs:** phase-4 task 4.2 Step 4 (deadlock routing target logic).

```js
const inStages = findFirst(stages, 'human-appraise');
if (inStages) return inStages;
if (cycle) return `human-appraise:${cycle}`;
return 'blocked';
```

Spec §5.2 says the fallback is synthesized as `human-appraise:<cycle>` —
fine. But if `cycle` is defined (always, post-setup) **and** no human-appraise
stage exists in the configured `stages`, we silently synthesize one and route
to it. The existing `runSort` emits a violation when a required subagent file
is missing (line 339 of sort.js). The synthesized stage bypasses that check
because it doesn't have a `models:` entry and thus no model resolution.

**Concrete suggestion.** When synthesizing, require the human-appraise agent
file to be present on disk (same check as elsewhere). Or: keep the current
behaviour (it's what the spec says) but note in the phase that synthesized
human-appraise stages skip model-fail-fast validation — so an executor
knows this is by design.

### Minor m2 — `test('writes a sort history entry ...')` missing

**Refs:** phase-4 task 4.3/4.4 tests; spec §11.8 ("sort-entry comment text
changes from `route ${lastStage.stage}` to `sort → ${route}`").

Phase 4 changes the sort-entry comment text at orchestrate.js:434. There's no
test asserting the new format. This is a cosmetic change but the plan claims
to cover §11.8.

**Concrete suggestion.** Add one assertion in 4.3: after a stage completes,
the sort history entry's comment field starts with `sort → `. One line; catches
regressions.

### Minor m3 — Legacy shim removal is not verified in 4.5

**Refs:** phase-4 task 4.5 Step 1 grep; phase-1 task 1.4 legacy shim at
`scripts/lib/feedback.js:256`.

4.5 greps for imports of `feedback.js` but not for the shim's call:
`validateTransition({ currentState: ... })`. After deleting feedback.js the
shim is gone, which is fine, but 4.6 Step 2's grep also doesn't cover
`validateTransition` call sites. If somehow the shim-style call shape leaked
into another module during phases 2 or 3, nothing catches it.

**Concrete suggestion.** Add to 4.6 Step 2:

```bash
rg -n "validateTransition\(" scripts/ .opencode/
```

Expected: only `scripts/lib/feedback-store.js` (one call site).

### Nit n1 — "RED-less" phrasing in task 4.5

Task 4.5 says "RED-less — no failing test first." That's fine, but phrase it
"this is a pure deletion; RED is unnecessary — if any caller still imports
the deleted module, the full suite breaks on delete and the RED moment is the
deletion itself." Same meaning, less likely to be read as "skip TDD."

### Nit n2 — Commit message in 4.4 conflates two concerns

The commit message says "stamp open_feedback on history entries" but the commit
also touches `readRecentFeedback` (different function, different purpose). Split:

- Commit A: "feat(orchestrate): route readRecentFeedback through feedback-store"
- Commit B: "feat(orchestrate,history): stamp open_feedback on every history entry"

Or note both in a single commit body. Current message only mentions one.

### Nit n3 — `store.list()` returns defensive copies (phase 1 task 1.6)

This is fine in phase 1, but in phase 4 `writeDeadlockSnapshots`'s `store.list()`
inside the `for` loop pays that copy cost per call. Post-batch (B2 resolution),
a new `store.snapshot()` method that returns items read-only without copying
would be cheaper. Not urgent; flag for follow-up.

## Open questions

**Q1.** Spec §10 says `open_feedback` counts include deadlocked items (they are
non-resolved). The phase implements this correctly. But spec §5.2 also says
sort's routing reads `history[0].state === 'deadlocked'` to decide routing.
After the first-ever deadlock pass, `computeOpenFeedback` will report
`N deadlocked items` as open — which on human read ("the cycle has 3 open
feedback items") is misleading. Is that intended? Answer: yes, per spec. But
worth a CHANGELOG callout in phase 5.

**Q2.** The `cycle` field on every feedback snapshot is the *transition's*
cycle, not the item's birth cycle. A multi-cycle flow could conceivably carry
feedback across cycles (though today flows are single-cycle-per-WORK.md by
convention). Spec §4.1 doesn't forbid it. Is the intent that feedback is
strictly per-cycle (filter `store.list()` by cycle in routing)? Phase 4's
routing uses `store.list()` unfiltered. If two cycles run in one WORK.md
lifetime, `computeOpenFeedback` over-counts. Probably out of scope per spec
§3 ("Cross-cycle debug views... is not a goal"), but worth a one-line sanity
check or a comment.

**Q3.** `determineRoute` today passes `feedback` (an array) by value down to
`nextAfterAppraise`. Post-refactor it passes the same shape, but the
"refresh after deadlock pass" step in B1's suggested hoisting means the
array passed to `determineRoute` and the live store state can diverge mid-call.
Is it expected that `determineRoute` take a `store` handle (not an array) so
it can re-list after in-function transitions? The spec doesn't go this deep.
Simpler: hoist the deadlock pass above `determineRoute` and pass a
post-deadlock snapshot only.

## Recommendation

**Revise and re-review.** Concretely:

1. **Block on B1** — hoist the deadlock pass to `runSort` proper, not inside
   `nextAfterAppraise`. This is the centrepiece of the phase; getting it wrong
   is the whole story.
2. **Block on B2** — pick one state-mapping approach in 4.2 Step 2 and write
   it out. Delete the "Actually, simpler" false lede.
3. **Block on B3** — move the `appendEntry` signature change to phase 2
   (preferred) or add a history unit test in phase 4.
4. **Block on B4 (M4)** — add a batch `writeDeadlockedSnapshots` primitive so
   the pass is actually atomic.
5. **Clean up M1–M3 and minors** — they're mechanical but they erode
   executor trust.

After those changes, the phase is executable and the state machine lands
cleanly. The underlying design is right; the plan just needs another editing
pass.
