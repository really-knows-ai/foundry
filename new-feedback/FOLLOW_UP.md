# FOLLOW_UP.md — Deferred items for the WORK.feedback.yaml redesign

Items captured during phase implementation that are real but deliberately
deferred. Reviewed at the end of phase 6 (final consistency pass) and either
shipped, filed as separate issues, or rejected with a recorded reason.

Each entry: **what**, **why deferred**, **trigger** (when to revisit), **source**.

---

## Phase 3

### F3-1. `assay-tools.js` best-effort feedback path is silently swallowed

**What.** In `.opencode/plugins/foundry-tools/assay-tools.js`, the `else` branch
that emits validation feedback on assay abort wraps the entire body in
`try { ... } catch (_err) { /* best effort */ }`. Two observable paths swallow
silently:

1. If `WORK.md` frontmatter has no `cycle`, the code skips with no log.
2. If `openFeedbackStore.add` throws, the catch eats it.

This is asymmetric with the post-run `syncStore` block (lines 47–50) which
*does* `console.error` on failure.

**Why deferred.** Behaviour is preserved from the pre-rewrite code (the
legacy `addFeedbackItem` path was equally silent). Adding `console.error`
during a tool-rewrite commit would be a stealth behaviour change. Should be
made deliberately, with its own commit and rationale.

**Trigger.** Phase 6 consistency pass, or the next time someone debugs a
"why didn't my failing extractor produce feedback?" mystery.

**Source.** Code-quality review of commit `3f8dc27` (task 3.11). Suggestions
3 and 4 in the reviewer's output.

---

### F3-3. Stale fixture and legacy arg shapes in failed-flow-tool-gate.test.js and preconditions.test.js

**What.**
- `failed-flow-tool-gate.test.js` line 34 seeds a fake `WORK.md` that
  includes a `## Feedback` heading (now obsolete; phase 2 commit `c34db66`
  stopped emitting it).
- `failed-flow-tool-gate.test.js` lines 73–84 call `foundry_feedback_resolve`,
  `foundry_feedback_action`, `foundry_feedback_wontfix` with the legacy
  `{file, index, ...}` arg shape. The failed-flow guard fires before any
  arg validation, so the legacy args are simply discarded.
- `tests/plugin/preconditions.test.js` lines 124–138 (the
  `'feedback stage-base allow-list on action/wontfix/resolve'` describe block)
  has the same pattern: legacy `{file, index, ...}` args. The stage-base
  allow-list guard fires before arg validation, so the calls produce the
  expected error for unrelated reasons.

Both files pass `npm test` correctly today, but the args document a
no-longer-supported API surface.

**Why deferred.** Functionally correct: both test groups are testing guards
upstream of arg validation, not the feedback APIs themselves. Cleanup is
mechanical but adds noise to phase 3. Phase 4 may rebuild
`failed-flow-tool-gate.test.js`'s WORK.md fixture anyway.

**Trigger.** Phase 4 (sort/orchestrate integration) or phase 6 (consistency).

**Source.**
- Code-quality review of commit `3f8dc27` (task 3.11), Notes section.
- Discovered during task 3.12 verification gate that the plan's regex
  (`foundry_feedback_action.*file:` etc., single-line) missed multi-line
  call patterns. Both files surfaced under a multiline-aware grep:
  `rg --multiline "foundry_feedback_(action|wontfix|resolve)\.execute\(\s*[^)]*\bindex:\s*\d" tests/ .opencode/`.
- Also called out in task 3.12's verification-gate scope per the
  phase-3 plan.

**Note for verification-gate users.** Phase 3 plan's grep at task 3.12 step 2
(`rg "foundry_feedback_action.*file:|..." tests/ .opencode/`) is single-line
and produces a false-negative pass on these two files. The multiline grep
above is the more reliable check. Phase 4 or phase 6 should update the
plan's gate command in any retained reference.

---

### F3-4. `foundry_feedback_list` "WORK.md not found" error lacks tool-name prefix

**What.** `feedback-tools.js` line 184 returns
`JSON.stringify({error: 'WORK.md not found'})`. The other four feedback
tools route this same case through `preflight` and produce
`'foundry_feedback_<name>: WORK.md cycle not found'`. Cosmetic
inconsistency.

**Why deferred.** Trivial; not worth a one-line commit on its own.

**Trigger.** Phase 5 (skills/docs may re-touch error messages anyway) or
when the next nearby commit happens to be in this file.

**Source.** Final phase-3 review of commit range `7de6a78^..fb52110`,
Suggestions section.

---

### F3-5. `setupToActioned` test helper lives inside a describe block

**What.** `tests/plugin/feedback-tools.test.js` line 257 defines
`async function setupToActioned(stage, cycle = 'write-haiku')` inside the
`describe('foundry_feedback_resolve — id-based')` block. If a future test
outside that block needs the same setup, the helper would have to be
duplicated or lifted.

**Why deferred.** No current consumer outside the block. Premature
hoisting is its own form of debt.

**Trigger.** Next time another describe block needs `add → action`
sequencing for setup. Lift to module scope at that point.

**Source.** Final phase-3 review of commit range `7de6a78^..fb52110`,
Suggestions section.

---

## Phase 4

### F4-1. Rule-of-three reached for inline WORK.md frontmatter in sort tests

**What.** `tests/sort.test.js` has three tests in the new `runSort — per-item
deadlock` block (lines ~818–997) that build near-identical WORK.md frontmatter
strings inline. The frontmatter varies on a small number of fields (`stages`,
`deadlock-appraise`, `deadlock-iterations`, `max-iterations`); everything else
is boilerplate. A `makeWorkMd({stages, deadlockAppraise, deadlockIterations,
maxIterations})` helper would shrink the file by ~30 lines and make the
*interesting* differences (e.g. `deadlock-appraise: false`) visually obvious.

**Why deferred.** Mechanical extraction; no behaviour change; not asked for
by the plan. Doing it inline with the cleanup commit would expand the diff
beyond review scope.

**Trigger.** Next time a fourth test in this file builds an inline WORK.md
frontmatter, or phase 6 (consistency).

**Source.** Code-quality review of commit `ef89986` (task 4.2),
Issues — Minor #5.

---

### F4-3. Deleted `deadlock escalation` describe block dropped coverage of 4 sub-branches

**What.** Task 4.2 wholesale deleted the seven-test `describe('deadlock
escalation')` block in `tests/sort.test.js` because it tested the now-gone
global-counter `detectDeadlocks` algorithm. The four new per-item-deadlock
tests cover the spec'd behaviour, but four sub-branches of `runSort`'s
deadlock-routing decision (sort.js:355-378) now have no direct test coverage:

1. `human-appraise:${cycle}` synthesis when no human-appraise stage is in
   `stages` but a `cycle` exists.
2. `alreadyInHumanAppraise → return blocked` (deadlocked items remain after
   human-appraise).
3. Default threshold of 5 (when `deadlock-iterations` frontmatter is omitted).
4. Custom non-5 thresholds (the four new tests all use `deadlock-iterations:
   3` explicitly).

Spec reviewer cursorily verified the four branches still look correct on
inspection; no defects found, just no tests.

**Why deferred.** Plan §4.2 listed exactly the four tests to add, so this
isn't a contract violation. Adding more tests inline would expand scope
mid-phase. Deletion was wholesale rather than selective because the deleted
tests' WORK.md fixtures used the legacy `## Feedback` shape and would have
needed full rewrites anyway.

**Trigger.** Phase 6 (consistency pass), or any time someone touches the
deadlock-routing branch in `runSort` and wants regression coverage.

**Source.** Spec compliance review of commit `ef89986` (task 4.2),
final note. Code-quality review confirmed no defects on inspection
(Issues — Minor #9).

---

### F4-2. `makeFeedbackYaml` ID truncation has an invisible cliff at i ≥ 100

**What.** `tests/sort.test.js` `makeFeedbackYaml` builds IDs as
``` `EX${String(i).padStart(2, '0')}${'Z'.repeat(22)}`.slice(0, 26) ```. For
`i < 100` the length is exactly 26 and `.slice(0,26)` is a no-op. For
`i >= 100` the prefix becomes 3 digits and the slice silently chops the last
`Z`. Still 26 Crockford-legal chars and still unique, but the cliff is
invisible to a reader.

**Why deferred.** Theoretical at current usage — every test in this file
needs 1–2 items. Real fix is either a comment or a deterministic-width
construction; neither blocks anything today.

**Trigger.** Any test in this file using `i >= 10` items, or any future
helper user reading `makeFeedbackYaml` and pausing at the slice.

**Source.** Code-quality review of commit `ef89986` (task 4.2),
Issues — Minor #6.

---

### F4-4. `localeCompare` for ISO-8601 timestamp DESC sort is overkill

**What.** `scripts/orchestrate.js:118` (`readRecentFeedback`) uses
`b.history[0].timestamp.localeCompare(a.history[0].timestamp)` to sort
candidates DESC. ISO-8601 sorts correctly under plain lexicographic
comparison (`<` / `>`); `localeCompare` invokes the Intl collator, which is
slower and locale-dependent (though ISO-8601 happens to be locale-stable).
Idiomatic replacement: `a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0`.

**Why deferred.** Zero practical impact — same order on the small candidate
set. Stylistic only.

**Trigger.** Any future refactor of `readRecentFeedback`, or a perf concern
(extremely unlikely at expected scale).

**Source.** Code-quality review of commits `efa632c..7a5308a` (tasks
4.3+4.4), Issues — Minor #2.

---

### F4-5. `mockIO`/`makeSortIO`-style in-memory io fakes are duplicating across test files

**What.** `tests/orchestrate-open-feedback.test.js:6-14` defines an inline
`mockIO` that is a near-subset of `tests/sort.test.js:27-46`'s `makeSortIO`.
Both share `exists`/`readFile`/`writeFile`/`rename`/`unlink` semantics; sort's
adds `exec` and `_get`/`_set`. This is the second instance of the pattern
(rule-of-three not yet reached). Distinct from F4-1 (inline WORK.md
frontmatter) — a separate trend.

**Why deferred.** Rule-of-three not reached. Current implementations are
small and intentionally specialized. Premature extraction obscures the
test's local context.

**Trigger.** Third near-duplicate appears (likely in phase 5/6 tests).

**Source.** Code-quality review of commits `efa632c..7a5308a` (tasks
4.3+4.4), Issues — Minor #3.

---

### F4-6. `mockIO.readFile` doesn't throw on missing key

**What.** `tests/orchestrate-open-feedback.test.js:9` — `readFile: (p) =>
store[p]` returns `undefined` for missing keys instead of throwing ENOENT
(unlike `makeSortIO` in `tests/sort.test.js`). `computeOpenFeedback` does
call `io.exists()` first so this never matters today, but if a future
regression caused the code to skip the `exists` check, the "missing
feedback.yaml returns 0" test would silently pass via undefined-fed-to-yaml
rather than catching the regression.

**Why deferred.** Very low priority defensive tightening. The `exists()`
guard makes this a hypothetical concern.

**Trigger.** Any change to `computeOpenFeedback`'s read path that touches
the `exists` guard.

**Source.** Code-quality review of commits `efa632c..7a5308a` (tasks
4.3+4.4), Issues — Minor #5.

---

### F4-7. Stale comment references to legacy API names in production `.js` files

**What.** Two production source files retain comment-only references to
deleted/legacy feedback APIs after the phase 4 cleanup:

1. `scripts/orchestrate.js:94,96` — CHANGELOG NOTE inside `readRecentFeedback`
   explains the pre-/post-redesign ordering change and names the old
   `listFeedback` helper for context.
2. `scripts/lib/feedback-transitions.js:85,95,105` — comments reference the
   deleted `scripts/lib/feedback.js` to explain why the legacy state-transition
   matrix is preserved verbatim.

Both are documentary, not functional. The phase 4 verification gate flagged
them because they cause `rg listFeedback` and `rg scripts/lib/feedback\.js`
to return non-zero, but neither represents a real call site.

**Why deferred.** Reviewer's call: these comments aid future maintainers by
preserving historical context that would otherwise be lost. Removing them
unblocks a cleaner grep but reduces the file's self-explanation. Phase 5/6
gets to decide — keep, sweep, or rewrite to drop the legacy names while
preserving the explanation.

**Trigger.** Phase 5 (skills/docs sweep) or phase 6 (consistency).

**Source.** Phase 4 verification gate (task 4.6), Issues section.

---

## Phase 2

*(none yet)*

## Phase 1

*(none yet)*

## Cross-phase

*(none yet)*
