# Revision Contract

**Purpose:** Single source of truth for revising the six phase files + PLAN.md + spec against the per-phase reviews. Every revision subagent reads this first. No subagent may deviate.

Scope of this revision: **blockers + majors + minors** across all phases. Nits deferred unless trivially adjacent.

---

## A. Spec ambiguity resolutions (now baked into the spec)

### A1. `reason` field on snapshots

**Rule:** `reason` is **required** on snapshots whose `state` is one of `wont-fix`, `rejected`, `deadlocked`, `resolved`. **Forbidden** on `open`. **Not required** on `actioned` (the code change is the reason).

Edits to spec §4.3 table and §5.1:
- §4.3 "Notes" column for `reason`: "Required on `rejected`, `wont-fix`, `deadlocked`, `resolved`; forbidden on `open`; optional on `actioned`."
- §5.1 rule 5 (deadlock override): no change to semantics; `reason` always required there because target states are always in the required set.

Validator behaviour (phase 1):
- `state === 'open'`: no `reason` property at all.
- `state === 'actioned'`: `reason` permitted but not required; validator does not reject either way.
- Others: `reason` must be a non-empty string.

### A2. Forge `wont-fix` scope (replaces old tag-based restriction)

**New rule, added as spec §5.1 rule 7:**

> **7. Forge wont-fix scope.** Forge may transition to `wont-fix` only when `item.source` base is `appraise`. When `item.source` base is `quench` or `human-appraise`, forge's only legal transitions from `{open, rejected}` are to `actioned`. Enforced by `feedback-transitions.js`; surfaces as a source-authorship-adjacent error.

Replaces the old `work-spec.md:97` tag-based check. Tags (`#validation`, `#human`) are now categorical only; no enforcement logic looks at them.

Implementation impact:
- Phase 1: `canForgeWontFix(item, callerStageBase)` predicate added to `feedback-transitions.js`; unit tested with all three source bases × both target states.
- Phase 3: `foundry_feedback_resolve` (or whatever forge calls) returns error when rule 7 is violated.
- Phase 5: `skills/forge/SKILL.md` documents "forge can wont-fix only items from appraise."

### A3. Human-appraise override scope (universal, not deadlock-only)

**Correction to spec §5.1 rule 5.** Replace with:

> **5. Human-appraise authority.** Human-appraise may transition **any** non-resolved item to any legal target state, regardless of `item.source` or `history[0].state`, with the standard legal-target constraints:
> - From `{open, rejected}`: to `{actioned, wont-fix}`
> - From `{actioned, wont-fix}`: to `{resolved, rejected}`
> - From `deadlocked`: to `{resolved, wont-fix, rejected}`
>
> `reason` is required on all transitions that require `reason` per §4.3.
>
> **Note on reachability.** Under the default sort routing, human-appraise only sees non-deadlocked items when the cycle is configured to surface them pre-sort — a future feature (see §17). In practice most human-appraise overrides operate on deadlocked items.

And add to spec §17 Open questions (repurposed as "Future work"):
- Cycle-level mode flag enabling human-appraise to see all unresolved feedback before sort routes. Out of scope for v2.6.0.

Implementation impact:
- Phase 1: `isAuthorized(item, callerStage)` treats human-appraise base as source-agnostic for any non-resolved state. Unit tested against every `{prevState, source, callerBase}` triple that exercises the override path.
- Phase 3: `foundry_feedback_resolve` accepts human-appraise override without source match.
- Phase 5: `skills/human-appraise/SKILL.md` must state "human-appraise can override any non-resolved item" (preserves today's behaviour); remove any narrowing language.

---

## B. Cross-phase moves (authoritative)

### B1. Batch deadlock persist primitive moves to phase 1

Phase 1 adds `feedback-store.js` method `writeDeadlockedSnapshots(items, reason, stage, cycle)` that:
- Accepts an array of items to deadlock in one call.
- Builds the new `history` arrays in memory for all items.
- Persists once (single atomic rename).
- Either all snapshots land or none.

Phase 4 no longer loops `writeDeadlockedSnapshot` per item; calls this batch method exactly once per sort pass.

Unit tests (phase 1):
- batch with N items writes exactly one file, one rename.
- mid-write crash (rename throws) leaves all N items unchanged.
- empty array is a no-op, no file touched.

### B2. `appendEntry` `open_feedback` coercion moves to phase 2

Phase 2 changes `appendEntry` signature to accept `open_feedback` option. Phase 2 also adds the coercion: if caller passes `undefined`, `appendEntry` writes `open_feedback: 0` so the field is always present. Unit test in `tests/lib/history.test.js` (phase 2).

Phase 4 only adds the **call-site computation** (`openFeedback = store.countOpen()`) in `orchestrate.js`. The shape invariant is phase 2's job.

### B3. Lifecycle plumbing moves to phase 6 as blocker tasks

Phase 6 adds explicit tasks to wire `WORK.feedback.yaml` into these production sites (none currently touched by any phase):

- `scripts/lib/finalize.js:6-7` — extend unlink list to include `WORK.feedback.yaml`.
- `.opencode/plugins/foundry-tools/git-tools.js` — any `foundry_git_finish`/`foundry_git_branch` path that references history/workfile must reference feedback.yaml too.
- `.opencode/plugins/foundry-tools/workfile-tools.js` — `foundry_workfile_delete`, `foundry_workfile_create`, any workfile lifecycle tool.
- `scripts/sort.js:187,247` — any hardcoded `WORK.history.yaml` reference that should be format-aware.

Phase 6 executor must grep for `WORK.history.yaml` and `WORK.md` across `scripts/` and `.opencode/plugins/foundry-tools/` and ensure every lifecycle site also handles `WORK.feedback.yaml`. This is a mandatory task, not a sweep nicety.

Tests: extend `tests/plugin/workfiles-consistency.test.js` (phase 6) or adjacent finalize/git-tools tests to assert `WORK.feedback.yaml` is deleted by `foundry_git_finish` and `foundry_workfile_delete`.

### B4. Phase 3/4 bundling — procedural only

**Decision:** phases 3 and 4 remain separate files but PLAN.md states explicitly they MUST be merged to `main` together (or phase 3 must not be merged ahead of phase 4).

Between phase 3 merging and phase 4 merging, sort reads old `## Feedback` markdown while plugin tools write yaml — sort sees zero feedback. This is a broken-main state.

PLAN.md update:
- Delete the line "Phases are independently mergeable in principle, but should land in order because phases 3+ depend on phases 1–2 being in place."
- Replace with:
  > **Merge boundary warning.** Phases 1, 2, 5, and 6 are independently mergeable. **Phases 3 and 4 are not.** Merging phase 3 without phase 4 leaves sort reading a format nothing writes to (broken main). These two phases must land in a single PR, or phase 3 must be held until phase 4 is ready.
- Add a checkbox to phase 3's final task: "Confirm phase 4 branch is ready before merging phase 3 to main."
- Add a checkbox to phase 4's first task: "Confirm phase 4 branch is rebased on phase 3 branch."

### B5. `mockIO` helper refactor — pre-task in phase 2

Phase 2 adds task **2.8.5** before the atomic-rename task:

> **Task 2.8.5 — Extend existing `mockIO` helpers with `rename`.**
> 1. Grep `tests/` for the existing `mockIO` constructor pattern(s) — there is no single shared helper today; each test file builds its own.
> 2. Add `rename(src, dst)` to each inline `mockIO` by delegating to the underlying in-memory map: `map.set(dst, map.get(src)); map.delete(src)`.
> 3. RED commit: add one test that asserts `io.rename(a, b)` moves content and removes `a`.
> 4. GREEN commit: implement in each location.
> 5. Commit message: `test(io): add rename capability to mockIO helpers`.

Also: PLAN.md line 77 currently references `tests/helpers/mockIO.js` — **this file does not exist.** Replace that sentence with:

> IO shim mocks are built inline per test file; there is no shared helper. Any new capability on the IO shim (e.g. `rename` in phase 2) must be added to **every** inline mock that exercises the capability.

---

## C. Per-phase required edits

### C1. Phase 1 (`phase-1-feedback-store.md`)

- **B1 (legacy shim, task 1.4):** remove the `sourceMatches: true` unconditional default. Option chosen: **keep the legacy matrix as a separate export** (`legacyTransitionsMatrix`) and delete the bridge from `scripts/lib/feedback.js` in this phase. Callers of the old signature continue to use `legacyTransitionsMatrix` until phase 4 deletes them entirely.
- **B2 (ULID monotonicity state):** convert module-global `lastTime`/`lastRandom` into closure state owned by a factory: `createUlidGenerator() → () => string`. The default export is `createUlidGenerator()` (preserves ergonomic import). Tests that need determinism instantiate their own generator. Document in jsdoc.
- **B3 (spec contradiction):** resolved upstream in A1; phase 1 task descriptions and validator tests must match A1's final rule (reason required on resolved, not forbidden). Update the §4.3 references in phase 1 task descriptions.
- **B4 (task 1.9 not RED):** rewrite task 1.9 so the test fails first. Concretely: add a test for a behaviour not yet implemented (e.g. `writeDeadlockedSnapshots` from B1, or the new source-based wont-fix restriction from A2). Task must include RED verification step.
- **M2 (atomicity tests):** add `assert.strictEqual(store.list().length, 0)` after the rename-throws assertion to catch the in-memory mutation bug.
- **M5 (file-rewrite instruction):** task description for `feedback-transitions.test.js` rewrite must start with "Delete existing file contents first, then write new contents" — explicit, not implicit.
- Incorporate B1's batch primitive (new task — insert between current 1.7 and 1.8, covering `writeDeadlockedSnapshots` with RED test).
- Incorporate A2's `canForgeWontFix` predicate (new task or extend existing transitions task; add unit tests).
- Incorporate A3's universal human-appraise authority (existing authorization task; ensure tests cover non-deadlocked override path).

### C2. Phase 2 (`phase-2-history-hardening.md`)

- **Blocker — mockIO refactor:** replaced by task 2.8.5 (see B5). Remove the buried hand-wave sentence in task 2.11.
- **Blocker — task 2.9 RED wrong-reason:** rewrite the RED test so it fails because the rename assertion fails, not because the function signature is wrong. Concretely: the test should call `appendEntry` normally and assert that a rename occurred in the mock (which it won't, pre-implementation), rather than monkey-patching `io.rename` to throw.
- **Major — task 2.10 ambient breakage:** 2.8.5 obviates this. Note in 2.10 that `io.rename` is now available everywhere because of 2.8.5.
- **Major — `open_feedback` coercion:** bake into phase 2 per B2. Add a task between current 2.11 and the shape tests covering the `undefined → 0` coercion with a RED test.
- **Major — fixture grep:** task 2.15 must include a preflight step: `rg -n '^## Feedback' tests/fixtures/failed-flow-*.test.js` and enumerate hits before making assumptions. Add this as step 1 of the task.
- **Minor — shell escaping:** commit message examples containing backticks or `$()` inside double quotes must use single quotes or escape the backticks. Sweep and fix all commit-message examples.
- **Minor — ripgrep syntax:** fix the malformed `rg` pipe in task 2.10 step 3.

### C3. Phase 3 (`phase-3-plugin-api.md`)

- **Blocker — active-stage filename:** global find-replace in the phase file: `.foundry/active-stage` → `.foundry/active-stage.json`. Payload is `{cycle, stage, baseSha}`. Every test-scaffold example that writes a fake active stage must write the JSON payload, not a string.
- **Blocker — fabricated `tool` stub:** delete every reference to a "reuse the existing stub" shortcut. Tests use real `FoundryPlugin({directory: root})` — match the existing plugin test pattern. Add a single paragraph early in the phase: "Plugin tests in this phase instantiate the real plugin via `FoundryPlugin({directory: testDir})` and exercise tools end-to-end; there is no stub layer."
- **Blocker — task 3.11 sync/async mismatch:** decide the IO shape for assay-tools. Recommendation: **feedback-store.js stays sync**; assay-tools wraps its own IO. Rewrite 3.11 to: "feedback-store is sync; assay-tools synchronously opens the store, writes items, returns. If assay-tools is itself async, it `await`s its own pre/post work but store calls remain sync." Remove the "thread activeStage through" hand-wave.
- **Major — `foundry_feedback_list` shape:** return `{items: []}` on empty (or consistently `[]`), never `{error}` for the empty case. Document the exact shape in phase 3's task description for `foundry_feedback_list`.
- **Minor — tool description strings:** every `tool()` registration's `description` field must be grep-verified to not mention `WORK.md` or `## Feedback`. Add as a RED-adjacent check in the phase's self-review.
- **Minor — active-stage helper:** if `writeFileSync(active-stage.json)` is inlined ≥3 times across tests, extract a `writeActiveStage(dir, {cycle, stage, baseSha})` test helper. Otherwise leave inline.
- Incorporate A2: `foundry_feedback_resolve` error path when forge attempts `wont-fix` on a non-appraise-source item. New test.
- Incorporate A3: `foundry_feedback_resolve` accepts human-appraise caller for any non-resolved item. New test.

### C4. Phase 4 (`phase-4-sort-integration.md`)

- **Blocker B1 (deadlock pass scope):** move the deadlock pass out of `nextAfterAppraise` into `runSort` top-level, before any routing decision. Per spec §6.1. Rewrite the task that currently places the call.
- **Blocker B2 (state shim):** delete the `resolved → actioned` mapping. Use the six-state vocabulary directly throughout. `pendingApproval` predicate reads `state` from the new enum.
- **Blocker B3 (`appendEntry` signature):** move to phase 2 per B2. Phase 4 only threads `openFeedback` into existing `appendEntry` call sites.
- **Blocker B4 (batch persist):** use phase 1's `writeDeadlockedSnapshots(items, ...)` (B1) exactly once per sort pass. Remove the loop.
- **Major M1 (`cycleDef` placeholder):** replace all occurrences of the placeholder with the real shape — look at how sort currently reads `cycleDef` and mirror it exactly.
- **Major M2 (missing `rename` in inline IOs):** obviated by phase 2 task 2.8.5. Add a cross-reference note.
- **Major M3 (undocumented `readRecentFeedback` ordering change):** if the ordering changes, add a CHANGELOG-style note in the task and a test that pins the new ordering with a clear comment explaining why it differs from today.

### C5. Phase 5 (`phase-5-skills-docs.md`)

- **Blocker B1 (response shape):** skills must document the new `foundry_feedback_add` response shape `{ok, id, deduped}`. Add explicit prose to `skills/forge/SKILL.md`, `skills/quench/SKILL.md`, `skills/appraise/SKILL.md`, `skills/human-appraise/SKILL.md`, `skills/assay/SKILL.md` showing the response shape and explaining `deduped`.
- **Blocker B2 (human-appraise authority):** resolved upstream in A3. Skill doc must state "human-appraise can override any non-resolved item regardless of source" — preserves today's behaviour. Remove any narrowing language the current draft introduced.
- **Blocker B3 (forge wont-fix):** resolved upstream in A2. `skills/forge/SKILL.md` must state "forge can mark `wont-fix` only for feedback whose source stage base is `appraise`." Replace any old tag-based language.
- **Blocker B4 (task 5.7 placeholder):** replace `(Copy the table from spec §5)` with the actual transition matrix table, authored inline. Executor must not see a placeholder.
- **Blocker B5 (CHANGELOG factual error):** rewrite the migration note. Current form: "2.6.0 ignores the old `## Feedback` section". Correct form: "2.6.0 no longer reads or writes the `## Feedback` section. Pre-2.6.0 workfiles with in-flight feedback are not auto-migrated — finish or discard in-flight cycles before upgrading. `foundry_workfile_delete` + re-flow is the supported path."
- **Major — missing prose:** each skill rewrite task must list the concrete paragraphs/bullets to insert, not "update to match new API".
- **Major — task 5.6 (orchestrate skill):** verify there is prose to edit; if not, either drop the task or replace with "add short paragraph about `foundry_feedback_list` usage in the loop."
- **Major — `package-lock.json`:** if version bump touches `package-lock.json`, add an explicit commit step for it.
- Incorporate §17 update in spec — future-work note about pre-sort human-appraise mode (per A3).

### C6. Phase 6 (`phase-6-consistency.md`)

- **Blocker B1 (lifecycle gap):** resolved upstream in B3. Add explicit tasks for `finalize.js`, `git-tools.js`, `workfile-tools.js`, `sort.js` lifecycle plumbing. Each is its own task with RED test.
- **Major M1 (broken `rg` alternation):** rewrite sweep commands. Use literal patterns or proper alternation syntax (`'(a|b)'` not `'a\|b'`). Exclude `new-feedback/` via `--glob '!new-feedback/**'`.
- **Major M2 (driven test escape hatch):** delete the "if harness cost is high, skip with empty commit" language. The end-to-end test is mandatory per spec §14.6. If it's hard, that is the phase's primary work.
- **Major M3 (commit count vibes):** delete the "roughly 40–60 commits" check. Replace with: "phase is complete when every task checkbox is ticked and `npm test` is green" — task completion, not commit count, is the gate.
- **Minor — misleading test name:** rename any "resolved-only" test that is actually empty.
- **Minor — `'ID0'+Z*23` ULID fixture:** use a Crockford-base32-legal character (not `I`). Fix any test fixture that violates the ULID alphabet.
- **Minor — `stage==='sort'` exemption:** must also require `state==='deadlocked'` to match spec (sort writes only deadlocked snapshots).
- **Minor — `rm -rf new-feedback/` is ungated:** either remove entirely from phase 6 (do not delete spec/plan files as part of the implementation — preserve for history), or gate on explicit confirmation.

---

## D. PLAN.md updates (authoritative)

- Replace line 53 ("Phases are independently mergeable in principle...") with the merge-boundary warning from B4.
- Fix line 77 — `tests/helpers/mockIO.js` does not exist. Replace per B5.
- Add the three ambiguity resolutions to the "Spec" section as a short "Clarifications baked into spec §4.3 / §5.1 / §17" bullet list pointing at this contract.
- Phase-file table: add one-line summary mentioning B3 lifecycle tasks in phase 6 row.
- Self-Review section: add "(5) Lifecycle coverage — every hardcoded `WORK.history.yaml` or `WORK.md` in `scripts/` and `.opencode/plugins/` is reviewed and either updated to also handle `WORK.feedback.yaml` or has an explicit note why not."

---

## E. Spec doc updates (authoritative)

File: `new-feedback/2026-04-24-work-feedback-yaml-redesign.md`

- §4.3 row for `reason`: update "Required on..." per A1.
- §5.1 rule 5: replace with A3's universal-authority wording.
- §5.1 append rule 7: A2's source-based wont-fix scope.
- §17 Open questions: rename to "Future work"; list A3's future-mode cycle flag.
- Add a dated note at the top of the file (before §1):
  > **Revision 2026-04-24 (during implementation planning):** Three ambiguities resolved against reviewer feedback — see `new-feedback/reviews/REVISION-CONTRACT.md` §A. Summary: `reason` required on all snapshots except `open`/`actioned`; forge `wont-fix` restricted by source stage (appraise only); human-appraise override is universal, not deadlock-only.

---

## F. Ground rules for revision subagents

1. **Read this contract in full before editing any phase file.** If it contradicts the per-phase review, this contract wins (it reconciled reviews against the full plan).
2. **Do not create new files.** Edit the existing phase file in place.
3. **Preserve task numbering where possible.** If you insert a task, use `.5` suffixes (e.g., `2.8.5`) rather than renumbering everything.
4. **Preserve the TDD discipline.** Every new or revised task has an explicit RED step with a documented failure reason.
5. **Consistency across phases.** Function signatures, field names, file paths must match. If in doubt about a name, this contract's C-section wins.
6. **Do not edit other phase files.** Your subagent revises exactly one phase.
7. **Do not edit the spec.** The spec edits are handled in a single pass by the coordinator (me). You may reference the resolved spec rules (A1–A3) in your phase file.
8. **Do not edit PLAN.md.** Also coordinator.
9. **Flag surprises.** If your phase cannot implement its contract section cleanly, write a `## Revision Notes` section at the bottom of the phase file documenting the issue. Do not invent solutions outside this contract.

---

## G. Verification checklist (coordinator runs after all revisions)

- [ ] Every blocker in every phase review is addressed in the corresponding phase file or explicitly marked wontfix with reason in `## Revision Notes`.
- [ ] Every major in every phase review is addressed or explicitly deferred with reason.
- [ ] Spec §4.3 and §5.1 wording matches A1–A3.
- [ ] PLAN.md contains the merge-boundary warning; no "independently mergeable in principle" line remains.
- [ ] Phase 1 contains `writeDeadlockedSnapshots` task with atomic test.
- [ ] Phase 2 contains task 2.8.5 (mockIO rename) and `open_feedback` coercion task.
- [ ] Phase 3 uses `.foundry/active-stage.json` everywhere; no `tool` stub references.
- [ ] Phase 4 calls `writeDeadlockedSnapshots` once, not in a loop; deadlock pass is in `runSort`.
- [ ] Phase 5 contains no placeholders; CHANGELOG wording matches B5.
- [ ] Phase 6 contains explicit tasks for finalize.js, git-tools.js, workfile-tools.js lifecycle.
- [ ] `rg 'tests/helpers/mockIO.js' new-feedback/` returns zero hits.
- [ ] `rg '## Feedback' new-feedback/ --glob '!2026-04-24-*.md' --glob '!reviews/*.md'` returns zero unintended hits.
