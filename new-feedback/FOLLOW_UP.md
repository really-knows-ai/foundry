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

### F3-2. Spec §5.1 source-base list does not enumerate `assay`

**What.** The spec at `new-feedback/2026-04-24-work-feedback-yaml-redesign.md`
§5.1 enumerates feedback creation sources as "quench, appraise, or
human-appraise". §12 *implicitly* includes assay (skills/assay/SKILL.md uses
the new feedback API for `#validation` items), and `feedback-store.js`'s
`VALID_SOURCE_BASES` set was extended in commit `3f8dc27` to include
`'assay'`. The spec text was not updated.

**Why deferred.** Doc-only fix, no behavioural impact. Belongs in the §5.1
edit pass rather than buried in a phase-3 implementation commit.

**Trigger.** Phase 5 (skills/docs updates) or phase 6 (consistency).

**Source.** Spec compliance review of commit `3f8dc27` (task 3.11),
Follow-ups item 1.

---

### F3-3. Stale fixture in `tests/plugin/failed-flow-tool-gate.test.js`

**What.** `failed-flow-tool-gate.test.js` line 34 seeds a fake `WORK.md` that
includes a `## Feedback` heading (now obsolete; phase 2 commit `c34db66`
stopped emitting it). Lines 73–84 also call `foundry_feedback_resolve`,
`foundry_feedback_action`, `foundry_feedback_wontfix` with the legacy
`{file, index, ...}` arg shape. These tests pass because the failed-flow
guard fires before any arg validation, so the legacy args are simply
discarded.

**Why deferred.** Functionally correct: the file is testing the failed-flow
gate, not the feedback APIs. Cleanup is mechanical but adds noise to phase 3.

**Trigger.** Phase 4 (sort/orchestrate integration may rebuild this fixture
anyway) or phase 6 (consistency).

**Source.** Code-quality review of commit `3f8dc27` (task 3.11), Notes
section. Also called out in task 3.12's verification-gate scope per the
phase-3 plan.

---

## Phase 2

*(none yet)*

## Phase 1

*(none yet)*

## Cross-phase

*(none yet)*
