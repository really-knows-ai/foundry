# Phase 5 Review — Skills, Docs, CHANGELOG, Version Bump

## Summary verdict

**Request changes.** The phase captures the right intent and its scope matches spec §§11.5/12/13/15. However, it has several **Blocker**-class correctness issues: it instructs the executor to write snippets that contradict the plugin API built in phase 3 (e.g. `foundry_feedback_resolve` with a `reason` on `approved`, `foundry_feedback_add` never returns `{ok: true}` but the plan shows it does, `foundry_feedback_list` not gated by `requireNotFailed`/`requireActiveStage` isn't a problem — but the plan teaches skills to call it in failed-flow check contexts), and proposes skill language that contradicts current forge behaviour (forge being blocked from wont-fixing `#validation` and `#human`). There are also several stale/out-of-date guidance points (CHANGELOG migration note about "old `## Feedback` in existing `WORK.md` files ignored" when phase 2 actually removes that section's emission and phase 4 deletes the parser outright) that will mislead future readers.

Fixable in a morning. Not landable as-is.

## Strengths

- Task decomposition is one-skill-per-task, one commit per task — matches the phase-1–4 cadence and lets reviewers land partial progress.
- Each task cites the spec section it implements.
- Task 5.11 verification gate includes a leftover-prose grep, which is the right instinct for catching stale `## Feedback` references.
- CHANGELOG section follows Keep-a-Changelog and explicitly names the v2.6.0 breakage surface (tool arg shape, state machine expansion, deadlock semantics).

## Issues by severity

### Blocker

**B1. `foundry_feedback_add` response shape in skill snippets contradicts phase-3 code.**
Phase 3 Task 3.3 implements `foundry_feedback_add` to return `{ok: true, id, deduped}` on success and `{error: '...'}` on failure. Phase 5 Task 5.2/5.3/5.4 skill snippets just say "call `foundry_feedback_add`" which is fine prose, but the migration CHANGELOG note (Task 5.10) claims `foundry_feedback_list` response shape changes to `{id, file, tag, text, source, state, depth, reason?}` — which matches phase 3 — yet the skill prose never tells a model what the new response shape is. For comparison, the existing `skills/appraise/SKILL.md:58` explicitly states "The tool also de-duplicates by text-hash" — a first-class fact the appraiser needs to know. Equivalent for the new API would be "the tool returns `{ok: true, id, deduped}`; use `id` for any follow-up action/resolve." Without this, the skill is strictly less informative than what it replaces.

**Fix:** each skill's `foundry_feedback_add` bullet should say "returns `{ok, id, deduped}`" so the consuming model can plan multi-step work around the id.

**B2. Task 5.4 implies human-appraise can resolve `wont-fix` and `actioned` items in addition to deadlocked; phase-1 state machine disagrees for non-source stages.**
Phase 5 Task 5.4's snippet says "Resolving items you sourced. Same pattern as appraise". Correct. But the current `skills/human-appraise/SKILL.md:75` lists "Dismiss deadlocked feedback — `foundry_feedback_resolve(file, index, resolution: 'approved')`. Human-appraise may resolve items in state `actioned` or `wont-fix`. This overrides the appraiser." This is the override path the existing skill documents.

Phase 1's state machine (§5.1 rule 3 + rule 5) is narrower: human-appraise may resolve `actioned`/`wont-fix` items **only when `stageId === item.source`**. The override path is **only** for `state: deadlocked` (per rule 5). Phase 5 Task 5.4's prose is correct on that point — but it silently drops the legacy "human-appraise overrides appraise on actioned/wont-fix regardless of source" behaviour without calling it out as a breaking change in the CHANGELOG.

If this is the intended semantics (it matches the spec I was given), **the CHANGELOG entry must explicitly note: "Human-appraise's override authority narrows from actioned/wont-fix to deadlocked-only. To bypass a non-deadlocked disagreement, a human must now run the cycle to deadlock threshold first."** That's a material behaviour change for anyone relying on the current escape hatch.

If the intent is to preserve the legacy escape hatch, phase 1's state machine is wrong and phase 5 cannot paper over it.

Either way, phase 5 as written is Blocker-level because it ships a silent behaviour change.

**B3. Forge wont-fix tag restriction is dropped without migration.**
Current `skills/forge/SKILL.md:62` says forge can wont-fix only `law:` / `human` tags (validation must be actioned). Phase 5 Task 5.1's replacement prose says "If you decide not to address the feedback: call `foundry_feedback_wontfix` with `{ id, reason }`" with no tag restriction. Phase 3's `foundry_feedback_wontfix` also has no tag check — it only enforces the stage-base. Phase 1's state machine doesn't encode a tag-based prohibition either.

This is a **semantic regression** vs. today's behaviour (see `docs/work-spec.md:97`: "Validation feedback (#validation) cannot be wont-fixed"). Phase 5 must either:
  (a) restore the prohibition in the skill prose and have phase 3 enforce it at the tool layer (this is a phase-3 bug report, not a phase-5 issue), or
  (b) explicitly call out the change in the CHANGELOG's Breaking section.

The current plan does neither.

**B4. Task 5.7 "State machine (Copy the table from spec §5)" is a placeholder.**
Phase 5 Task 5.7 Step 2 literally says `(Copy the table from spec §5; link to the spec for full rules.)`. This is exactly the kind of placeholder the PLAN.md §Self-Review step 2 explicitly forbids. It will either be copy-pasted verbatim (shipping "(Copy the table from spec §5)" into `docs/work-spec.md`) or require the executor to exercise judgment about a table that isn't in the spec as a discrete copyable artefact (§5 is prose-and-block-diagram, not a table).

**Fix:** the phase 5 plan must render the actual table the executor should paste. Given the 6-state machine and the 4 transitioning stages, a ~6×4 cell table is trivial to pre-bake.

**B5. CHANGELOG migration claim is wrong.**
Task 5.10 CHANGELOG text: "The old `## Feedback` section in existing `WORK.md` files is ignored by 2.6.0 code; the new `WORK.feedback.yaml` starts empty."

But phase 2 removes `## Feedback` emission from `createWorkfile` *and* phase 4 deletes `scripts/lib/feedback.js`. Nothing in 2.6.0 reads the `## Feedback` markdown at all; it is neither "ignored" nor "migrated" — it is simply dead text in a file that tools no longer parse. A user upgrading mid-cycle with a `WORK.md` containing a `## Feedback` block will find that block is still physically present in their file (nobody strips it) and new writes go to the yaml — this is a **split-brain state** the CHANGELOG glosses over.

**Fix:** honestly describe the mid-flow upgrade: "Any `## Feedback` content in a pre-2.6.0 `WORK.md` on disk is abandoned — the section is neither parsed nor deleted. Run `foundry_workfile_delete` before `foundry_git_finish` if you need to re-run the cycle on 2.6.0, or finish the cycle on 2.5.x first."

### Major

**M1. Tag allow-list prose incomplete in Task 5.2 (quench) and 5.3 (appraise).**
Phase-3 task 3.3 enforces per-stage tag allow-lists in the tool (`quench` → `validation`, `appraise` → `law:*`, etc.). Task 5.2's snippet says `{ tag: 'validation' }` matter-of-factly but doesn't tell the model that other tags are refused at the tool layer — an LLM reading the skill might try `tag: 'quench-lint'` and get a tool error without context. Task 5.3 is better (explicit `law:<slug>`) but still doesn't state "the tool rejects other tags during appraise" the way the **current** `appraise/SKILL.md:58` does.

**Fix:** retain the existing "the tool rejects other tags during <stage>" sentences in both files.

**M2. `foundry_feedback_resolve` deadlock-override reason requirement mis-described.**
Phase 1 store requires a `reason` on any deadlock-override transition (spec §5.1 rule 5, enforced by `feedback-store.transition` reason-required-when-current-is-deadlocked). Phase 3 `foundry_feedback_resolve` passes `reason` through. Phase 5 Task 5.4 says: "The reason is always required for a deadlock override — it documents why the deadlock is being broken." That's correct.

But Task 5.4 also shows `{ id, resolution: 'approved' | 'rejected', reason: '...' }` as the canonical call shape for deadlock override — implying `reason` is required even when `resolution: 'approved'`. **That is correct for deadlocked items**, but the same snippet elsewhere (Task 5.3 for appraise) shows `resolution: 'approved'` with no reason. A model reading both will conclude reason is conditionally required, which is true — but phase 5 nowhere states the exact rule (reason required iff current-state is `deadlocked` or target is `rejected` or target is `wont-fix`).

**Fix:** add a "Reason rules" sub-bullet to Task 5.3/5.4 or to `docs/work-spec.md` table in Task 5.7: "`reason` is required when resolving a deadlocked item, or when `resolution: 'rejected'`; otherwise optional."

**M3. `skills/orchestrate/SKILL.md` has no feedback prose to edit.**
Task 5.6 Step 1 says "Find any prose that says 'parse the ## Feedback section' or 'read WORK.md for feedback' or similar." I read `skills/orchestrate/SKILL.md` end-to-end — there is **no such prose**. The skill is a pure dispatch loop; it never mentions feedback. Task 5.6 Step 1 will find nothing to edit, and the suggested replacement ("call `foundry_feedback_list` to see current feedback state") has no natural home in this skill.

**Fix:** either drop Task 5.6 entirely (and remove `skills/orchestrate/SKILL.md` from the PLAN.md file-structure table), or clarify that Task 5.6 is a **grep-confirm-nothing-found** task that produces no commit. Spec §12's "no behavioural change" wording supports the latter.

**M4. `skills/assay/SKILL.md:11` reference will be missed by Task 5.5's instruction.**
Task 5.5 says "Find the section that describes how assay emits `#validation` feedback on extractor failure." The actual line is at `skills/assay/SKILL.md:11`: *"On any failure, `foundry_assay_run` writes a `#validation` feedback row against `WORK.md` and returns an aborted result."* That's the only mention. Task 5.5's replacement prose is a whole paragraph (6 lines) that doesn't fit this one-sentence spot — it's longer and restructures the skill.

**Fix:** narrow Task 5.5's replacement to a drop-in sentence (e.g. "On any failure, `foundry_assay_run` writes a `validation`-tagged feedback item to `WORK.feedback.yaml` with `source: assay:<alias>` and returns an aborted result."). Save the long-form paragraph for `docs/work-spec.md` or `docs/concepts.md`.

**M5. Task 5.8 will miss `docs/concepts.md:97` "## Feedback" heading.**
The grep `rg -n "feedback\|## Feedback\|WORK\.md" docs/concepts.md | head -20` in Task 5.8 Step 1 will find it, but the "Rewrite the Feedback subsection" replacement snippet (8 lines) is shorter than the existing Feedback subsection is likely to be. Line 97 is a `## Feedback` heading — so at minimum lines 97–114 need replacing. Without seeing the full current subsection content, the plan can't guarantee the rewrite lands cleanly.

**Fix:** Task 5.8 must instruct the executor to first `read` the whole subsection, then replace the range — not just "rewrite the 'Feedback' subsection".

**M6. Task 5.10 Step 3 `package.json` edit bypasses `npm version` but doesn't account for `package-lock.json`.**
`package.json` version lives in two places on most projects: `package.json` itself *and* `package-lock.json` (root `version` plus `packages[""]`). The task says "Do not use `npm version`" (correct for a single hand-crafted commit) but then only edits `package.json`. Stale `package-lock.json` version is not catastrophic, but it creates a downstream CI mismatch.

**Fix:** Task 5.10 Step 3 should verify whether `package-lock.json` exists and contains the `version` field; if so, update both atomically. (The simpler alternative — run `npm version 2.6.0 --no-git-tag-version --no-commit-hooks` then stage only the files you want — is actually cleaner than hand-editing and preserves lockfile integrity.)

### Minor

**m1. Commit-message bodies reference spec section numbers (§5.1, §8.1, §4.3) that won't exist in the repo after merge.**
Spec document lives at `new-feedback/2026-04-24-work-feedback-yaml-redesign.md`. After `foundry_git_finish` → squash-merge, that file either goes to `docs/specs/2026-04-24-…md` (per spec §18 "New: … `docs/specs/…`") or is dropped. Commit messages citing "spec §5.1 rule 3" are fine if the spec lands in `docs/specs/`; worth confirming with the operator before landing.

**m2. Task 5.11 Step 2 grep regex is fragile.**
`rg -n "## Feedback\|\\- \\[ \\]\|\\- \\[x\\]\|\\- \\[~\\]\|{ file, index }\|\\| approved\|\\| rejected" skills/ docs/ README.md` — the `\\| approved` will match any markdown table cell ending in ` approved`, producing false positives. Also `- [ ]` is used by plans themselves (this phase file uses it heavily for the checklist syntax); the grep will be noisy if the executor's `pwd` drifts.

**Fix:** use word-boundary-aware alternation and be explicit about the paths. Or just inspect manually — the grep is a belt-and-braces check, not a gate.

**m3. Phase 5 is marked dependent on "Phases 1–4 committed and green. No production code uses the legacy feedback API" — but the legacy-test file `tests/lib/feedback.test.js` is deleted in phase 4, and the `scripts/lib/feedback.js` shim is also deleted then. What if phase 5 discovers a skills-test that was covering pre-migration behaviour? The plan has no contingency.**

**Fix:** add a preflight grep to Task 5.0 (preflight): `rg -n "addFeedbackItem|parseFeedback|detectDeadlocks" skills/ docs/ README.md CHANGELOG.md` — should be zero, but if non-zero, stop.

**m4. No explicit check that `skills/forge/SKILL.md:87` "An item is resolved if it is `approved`" gets updated.**
Task 5.1's replacement focuses on the protocol steps, but leaves intact the legacy "Unresolved feedback" and "resolved if it is `approved`" paragraph at lines 77–83. That paragraph uses the old state vocabulary (`approved`) and must be rewritten to reference the 6-state machine.

**Fix:** Task 5.1 Step 3 must replace the entire "Unresolved feedback" and "#human feedback" subsections too, not only the protocol bullet.

**m5. Task 5.9 (README) is one paragraph of guidance for what is likely a 20–30-line edit.**
README has `§Feedback lifecycle` (line 234) and `§WORK.md` table (line 211). Task 5.9 Step 2 is terse; a concrete before/after would protect against drift. The existing phase 5 pattern (Task 5.7 has concrete snippets) should apply here too.

### Nit

**n1.** Commit message in Task 5.5 says "Matches the call site updated in phase 3 (.opencode/plugins/foundry-tools/assay-tools.js)." — true but not useful in the commit log; would be clearer as "see phase-3 commit `feat(assay-tools): …`".

**n2.** Task 5.7's proposed `§WORK.feedback.yaml` table uses `| prepend-only` as a cell value — render cleanly in most markdown, but `js-yaml` parses this doc? No, it's in docs. Ignore unless lint catches it.

**n3.** Task 5.10's CHANGELOG Removed section lists `readLastSortRoute` — but that's an internal helper never exposed publicly. Users don't care. Move it to a "Internal" section or drop.

**n4.** Task 5.8's concepts.md replacement ends with "See `docs/work-spec.md` for the full schema and state machine." — good instinct, but `docs/work-spec.md` is a sibling not a child; no path prefix needed. Current text is correct; flag only because similar links elsewhere (README.md line 42) use `../README.md` style and consistency matters.

## Open questions

1. **Does the state machine in phase 1 deliberately narrow human-appraise's override to deadlocked-only (see B2)?** If yes, CHANGELOG must document. If no, phase 1 + phase 5 both need revision.
2. **Should forge retain the tag-based wont-fix prohibition (validation, human)?** If yes, phase 3 (tool layer) and phase 5 (forge skill prose) both need it. If no, CHANGELOG must flag.
3. **Where does `new-feedback/2026-04-24-work-feedback-yaml-redesign.md` end up post-merge?** Spec §18 says `docs/specs/`. Worth one-line-confirming in phase 5 preflight so commit-message §-references stay valid.
4. **Is `package-lock.json` version bump in scope?** Convention-dependent.

## Recommendation

**Block on B1–B5.** They are small fixes individually (each is a prose tweak or a 1–2 line plan edit), but they compound: a worker executing this phase as-written will ship a state-machine behaviour change with no CHANGELOG note (B2), a regression on the `#validation cannot be wont-fixed` invariant (B3), and a placeholder `(Copy the table from spec §5)` in shipping docs (B4).

After addressing blockers, re-review Majors M1–M6 as a batch — they're all tractable. Minors can be fixed during execution without another review cycle.

Estimated effort to fix the plan: 45 minutes. Estimated effort to execute the fixed plan: matches current estimate (~3 hours of subagent work).
