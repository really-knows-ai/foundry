# Review — `phase-6-consistency.md`

**Reviewer:** claude-opus-4.7 via OpenCode
**Date:** 2026-04-24
**Scope:** Final-gate phase: cross-file consistency test + legacy sweep.
**Files read:** spec (`2026-04-24-work-feedback-yaml-redesign.md`), `PLAN.md`, all six phase files, `scripts/lib/finalize.js`, `scripts/lib/failed-flow.js`, test layout under `tests/`.

---

## Summary verdict

**Major rework required before this phase ships.** The synthetic assertion in Task 6.1 is well-scoped and genuinely locks in spec §14.6. But the phase is advertised as "the final gate" and it misses a spec-mandated lifecycle change (`foundry_git_finish` must delete `WORK.feedback.yaml`; no earlier phase does this, and phase 6's sweep won't surface it). The grep sweep in 6.3 has sloppy regex construction, overbroad patterns, and will produce noise that buries real leaks. Task 6.2 is effectively optional ("if the harness cost is high, skip") — which, combined with the synthetic-only coverage, means the plan's own stated goal ("catches regressions where a new writer forgets to append a matching history row") is not actually enforced by anything that runs against production code.

Fix the `finalize.js` gap, tighten the sweep, and commit to either the driven test or a deterministic production-path integration before calling this the final phase.

---

## Strengths

- The pure invariant helper (`assertFeedbackHistoryConsistent`) is the right shape: cheap, composable, reusable from both synthetic and driven tests.
- Explicit handling of the asymmetry between feedback.yaml and history.yaml (spec §9.3) — sort-written deadlocked snapshots are correctly exempted.
- The four synthetic cases (match, miss, deadlock-exempt, empty) cover the meaningful corners of the invariant.
- Explicit guidance to **stop and isolate** if the driven test fails is good discipline.
- Handoff question to the operator about squash vs. per-task history and the fate of `new-feedback/` is appropriate for the end of a multi-phase series.

---

## Issues by severity

### BLOCKER — 1

#### B1. `foundry_git_finish` never deletes `WORK.feedback.yaml`

Spec §4 (line 38): "Tracked in git, committed per-stage, **deleted at `foundry_git_finish`** (same lifecycle as `WORK.history.yaml`)". Phase 5 §11.5 doc prose mentions it ("deleted by `foundry_git_finish` before the squash-merge"), and the work-spec update reiterates it, but **no phase modifies the code that performs the deletion**.

Evidence: `scripts/lib/finalize.js:6-7` lists the files to unlink; it contains `'WORK.md'` and `'WORK.history.yaml'` but not `'WORK.feedback.yaml'`. No phase file grep-matches `finalize.js` or the unlink list.

Impact: v2.6.0 ships with `WORK.feedback.yaml` leaking onto the base branch after every squash-merge. Every subsequent flow sees a stale yaml at worktree root until someone notices and deletes it manually. Docs and CHANGELOG claim behaviour that doesn't exist.

Fix: Add a task (preferably in phase 2 where lifecycle-adjacent work already happens, or in this phase as Task 6.0 before the consistency test) that:
1. Updates `scripts/lib/finalize.js` to include `WORK.feedback.yaml` in the unlink list.
2. Adds a test in `tests/lib/finalize.test.js` asserting the file is removed by `foundry_git_finish`.
3. Greps for any other reference to `WORK.history.yaml` that implies "these are the workfiles" — there may be more than one call site.

Phase 6's sweep should also grep for `'WORK.history.yaml'` literals and verify there's a matching `'WORK.feedback.yaml'` literal nearby. Currently it does not.

---

### MAJOR — 3

#### M1. Grep sweep (Task 6.3, step 1) is brittle and will leak

The five `rg` invocations use unescaped `|` alternation inside single-quoted ERE patterns mixed with shell-escaped `\|` (which ripgrep interprets as a literal pipe, not alternation — ripgrep uses `|` as alternation by default, no backslash). Examples:

- `rg -n "from.*scripts/lib/feedback\.js\|scripts/lib/feedback-walker\|..."` — the `\|` sequences match literal `\|` in file contents, not pipes. This sweep will find nothing even when leaks exist.
- `rg -n "## Feedback\|- \[ \]\|..."` — same bug. Also `- [ ]`/`- [x]` are markdown-checkbox patterns that appear in every task checklist in the `new-feedback/` tree itself. If that directory survives (Task 6.4 leaves it undecided), the sweep will return hundreds of false positives from the plan files.
- `rg -n "stageBase:" .opencode/ scripts/` — this one is correct, but inconsistent style.

Fix: Either use ripgrep's multi-pattern `-e <p1> -e <p2>` form, or pass each regex as `-e 'alt1|alt2'` without backslashes. Also exclude the planning tree explicitly: `rg -g '!new-feedback/**' ...`. Re-test the sweep against a deliberately-seeded leak (e.g. `git grep -nI 'parseFeedback' -- scripts/` should find something if you inject one) to prove the regex actually matches.

Suggested rewrite (one example):

```bash
rg -n -g '!new-feedback/**' -e 'from.*scripts/lib/feedback\.js' \
    -e 'addFeedbackItem|actionFeedbackItem|wontfixFeedbackItem|resolveFeedbackItem' \
    -e 'parseFeedback|parseFeedbackItem|detectDeadlocks|readLastSortRoute' \
    scripts/ .opencode/ tests/
```

#### M2. Task 6.2 (driven test) is escape-hatched into triviality

Step 2 ends with: "If the harness cost is high... skip the driven test." Step 4 offers a `--allow-empty` commit that documents the gap. This contradicts the phase's stated goal ("catches real integration bugs... driven coverage catches regressions where a new writer forgets to append a matching history row").

The synthetic test (6.1) only verifies that the invariant *helper* is correct. Nothing in this plan verifies that the *production code* produces invariant-compliant output. Spec §14.6 explicitly calls for "an end-to-end scenario exercises a full cycle" — the synthetic test does not satisfy that.

Fix: Either (a) make the driven test mandatory — reference the exact existing integration harness (e.g. `tests/plugin/failed-flow-e2e.test.js` has real worktree + orchestrate patterns you can copy), or (b) downgrade the spec §14.6 commitment explicitly in the spec before shipping. Do not let the executor silently skip it.

Concrete suggestion: inspect `tests/plugin/failed-flow-e2e.test.js` in phase 6 preflight, confirm the pattern works, and write the driven test using that harness. If the harness genuinely can't do it, that's a phase-3 bug (plugin tools should be usable in integration tests), not a phase-6 escape.

#### M3. Task 6.4 step 2 (commit count) is not a verification — it's vibes

"Expect a clean, reviewable sequence... Roughly 40–60 commits total. If the count looks like hundreds, something went wrong." A commit count in a loose range is not a quality gate. If the executor sees 73 commits, the plan doesn't say what to do.

Fix: Drop step 2, or make it a real check — e.g. "every commit message prefix must be one of `feat|fix|test|refactor|docs|chore`; enumerate via `git log --format='%s' origin/main..HEAD | grep -vE '^(feat|fix|test|refactor|docs|chore)'`; expect empty output". That actually verifies something.

---

### MINOR — 5

#### m1. Synthetic test's "resolved-only store with empty history passes" is misleading

The test at line 149 is named "resolved-only store" but actually passes an **empty** `items` array and empty history. It's testing the empty case, not the resolved-only case. Either rename to "empty store passes" or add actual resolved items with matching history rows.

#### m2. ID generation in the synthetic test is shaky

`'ID0' + 'Z'.repeat(23)` produces a 26-char string but `I` is not in the Crockford base32 alphabet (§4.2, phase-1 ulid test line 51 enforces `[0-9A-HJKMNP-TV-Z]`). If the consistency test ever passes these through the store or its validator, it will fail. Currently the test only hand-constructs docs and doesn't round-trip through the store, so it works — but it's a footgun for anyone who extends the test later.

Fix: use a real ULID literal, e.g. `'01HXY8K9Q5Z3WN0GJM2TYBR4AB'` (matches the spec example). Or call `ulid()` from `scripts/lib/ulid.js`.

#### m3. The exempted-deadlock case allows ANY `stage: sort` snapshot, not just `deadlocked`

The invariant helper at line 68 says `if (snap.stage === 'sort') continue;`. The spec §9.3 only exempts `state: deadlocked` with `stage: sort`. If any other state ever lands on a sort-stage snapshot (a bug), the invariant would silently accept it. Tighten:

```js
if (snap.stage === 'sort' && snap.state === 'deadlocked') continue;
```

Then the snapshot's state is also part of the exemption — a sort writing any other state is a bug and the invariant correctly flags it.

#### m4. No test for the "forbidden" direction (history row without feedback snapshot)

Spec §9.3 is explicit that the forward direction (feedback→history) must hold strictly (modulo sort-deadlock). It's silent on the reverse, but an invariant test that's one-directional-only should say so in a comment. Consider adding a note in the helper: `// Reverse direction intentionally not asserted — see spec §9.3.`

#### m5. `rm -rf new-feedback/` in step 3 of Task 6.4 is destructive and ungated

"If discarding: `rm -rf new-feedback/`". This sits in a checklist for an executor who may autorun it. Add an explicit confirmation step or change to `git rm -r --cached new-feedback/ && rm -rf new-feedback/` so the operation is traceable in git history, and insist the operator confirms before executing.

---

### NIT — 3

#### n1. Task 6.2's pseudocode is not runnable and has literal `/* ... */` ellipses

The executor is instructed to "copy-paste the `toolStub` and `makeWorktree` helpers from tests/plugin/feedback-tools.test.js" but those helpers don't exist yet — they'd be created in phase 3. Reference the actual helper name from phase 3 once, and link the test pattern from `tests/plugin/failed-flow-e2e.test.js` which already exists.

#### n2. Inconsistent casing: `open_feedback` vs `openFeedback`

Spec §10 uses `open_feedback` on disk and `openFeedback` in-JS. The synthetic test uses `open_feedback` throughout (correct for yaml). Phase 4's appendEntry destructure at line 555 uses snake_case. Consistent, but worth a comment somewhere — readers coming from JS will expect camelCase.

#### n3. REVIEW.md update (Task 6.4 step 4) is untracked housekeeping

Fine to include, but "do not commit REVIEW.md — it's untracked" is stated without context. Phase 5 didn't mention REVIEW.md at all. Clarify in phase 5 that REVIEW.md is intentionally left untracked and phase 6 updates it as final bookkeeping, or drop this step.

---

## Open questions

1. **Is there a `docs/work-spec.md` entry or table that says "these files exist per-cycle"?** Phase 5 updates the "Who writes what" table but doesn't explicitly enumerate the file-lifecycle for `WORK.feedback.yaml`. Phase 6 should grep-verify every per-cycle-file enumeration includes the new file.
2. **How does `WORK.feedback.yaml` behave if it exists at the start of a fresh cycle (e.g. leaked from B1 above)?** The store's load should be robust, but no phase tests this specifically. Consider a test: "stale WORK.feedback.yaml from a previous cycle is... (ignored? overwritten? error?)".
3. **Is the plan's self-review (PLAN.md §Self-Review) meant to be re-run at phase 6?** It's only run once per the plan text. Phase 6 is the natural place to re-execute the "spec coverage" check against the final tree.

---

## Recommendation

**Request changes before dispatching phase 6 execution.**

Minimum blocker set:
- (B1) Add a finalize.js task to this phase (or insert into phase 2) that includes `WORK.feedback.yaml` in the unlink list, with a unit test.
- (M1) Rewrite the grep sweep to use correct ripgrep syntax and exclude `new-feedback/`. Verify the sweep actually matches a seeded leak.
- (M2) Commit to a mandatory driven test. If the phase-3 plugin harness can't support it, that's a phase-3 bug, not a phase-6 escape.

Merge-ready after: minors addressed in place (m1–m5 are small edits), B1+M1+M2 resolved, nits optional.

Once these land, phase 6 genuinely closes the loop. Today it closes 80% of it and quietly leaves the remainder as exercises for future readers.
