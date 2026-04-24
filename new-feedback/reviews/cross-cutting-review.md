# Cross-cutting review — WORK.feedback.yaml redesign

**Reviewer:** claude-opus-4.7 (cross-cutting pass)
**Date:** 2026-04-24
**Scope:** spec, PLAN.md, all six phase files, per-phase reviews, codebase as-is.

---

## Executive summary

**Verdict: revise, then ship.** The redesign is well-scoped and the six-phase decomposition is sound — forcing capability first, then migration, then cleanup is the right staging for a breaking API change. The spec is unusually clear; intent is unambiguous in all but two corners. **But the combined plan has one hard spec-coverage gap (lifecycle: nothing deletes `WORK.feedback.yaml` on finish, and four call sites enumerate `WORK.history.yaml` by name — none are touched), one integrity gap (phase 4's deadlock pass calls `writeDeadlockedSnapshot` in a loop, one atomic rename per item, violating spec §6.1's "single pass, all-or-nothing" guarantee), and several seam inconsistencies between phases that will cause executor churn.** The per-phase reviewers flagged most of these — my job is to validate and synthesize. They are right: this plan should not be dispatched as-is, but the fixes are ~2 hours of editing, not a rework. TDD discipline is good, commit cadence is good, spec coverage is ~95% before fixes and 100% after. The riskiest single defect is the lifecycle gap (B1 of phase-6 review) because the CHANGELOG and docs (phase 5) will ship claiming behaviour that doesn't exist.

---

## Spec coverage matrix

| Spec § | Requirement | Phase(s) | Status |
|---|---|---|---|
| §4 | WORK.feedback.yaml schema (items, ULID, history) | 1 | ✔ |
| §4.2 | ULID, 26 chars, Crockford, monotonic | 1 | ✔ (test over-specifies monotonicity; see per-phase review) |
| §4.3 | Reason required/forbidden rules | 1 | ⚠ contradiction with §5.1 rule 5 (see Ambiguities §A1) |
| §5 | Six-state machine | 1 | ✔ |
| §5.1 rules 1–6 | Legal transitions / authorship / override / terminal | 1 | ✔ |
| §5.2 | Per-item depth; `deadlock-iterations` default 3; `deadlock-appraise: true` | 4 | ⚠ phase 4 binds pass to appraise branch only (Contract C2) |
| §5.3 | Rejected `wont-fix` path | 1 (implicit via matrix) | ✔ |
| §6 | Sort integration: `writeDeadlockSnapshots`, route predicate | 4 | ⚠ non-atomic loop (Contract C3) |
| §7 | Remove `## Feedback` from WORK.md | 2 | ✔ |
| §8.1 | Tool signature changes | 3 | ✔ (minor: `stageBase?` arg was never there — spec lies) |
| §8.2 | Authorship enforcement | 1 (store) + 3 (tools) | ✔ |
| §8.3 | Dedup on (file, tag, text) against non-resolved | 1 | ✔ |
| §9.1 | js-yaml, lineWidth: -1 | 1 | ✔ |
| §9.2 | Write-temp-then-rename | 1 (store) + 2 (history, IO shim) | ✔ |
| §9.3 | Acceptable half-write | 6 (consistency test) | ✔ (synthetic only; driven test escape-hatched) |
| §10 | `open_feedback` on every history entry | 2 (plan says "shape only") + 4 (orchestrate wiring) | ⚠ phase 2 does nothing; the `appendEntry` signature change slips into phase 4 without a unit test in `tests/lib/history.test.js` (Contract C1) |
| §11.1 | Delete `readLastSortRoute` | 2 | ✔ |
| §11.2 | `seq` field + (timestamp, seq) sort | 2 | ✔ |
| §11.3 | Malformed yaml → markWorkfileFailed | 2 | ✔ |
| §11.4 | `route ⇒ stage === 'sort'` | 2 | ✔ |
| §11.5 | Doc `route`, `seq`, `open_feedback`, lifecycle | 5 | ✔ (in docs); ✗ lifecycle code (see GAP G1) |
| §11.6 | Atomic history writes | 2 | ✔ |
| §11.7 | `getIteration` doc comment | 2 | ✔ |
| §11.8 | Sort-entry comment text change | 4 | ✔ (but no test; see m2 in phase-4 review) |
| §12 | Six skill updates | 5 | ⚠ see Ambiguities §A2 (forge wont-fix tag ban); orchestrate skill has nothing to edit |
| §13 | Docs + CHANGELOG | 5 | ⚠ CHANGELOG claims "old ## Feedback ignored" — misleading |
| §14.1 | Store unit tests | 1 | ✔ |
| §14.2 | Rewritten feedback.test.js | 4 (deleted) | ✔ (deletion is the rewrite; old tests are retired) |
| §14.3 | Sort integration tests | 4 | ✔ (but harness args wrong; see Contract C4) |
| §14.4 | Plugin tool tests | 3 | ✔ (but harness shape wrong; see Contract C5) |
| §14.5 | History tests | 2 | ✔ |
| §14.6 | Cross-file consistency test | 6 | ⚠ synthetic only, driven test is optional |
| §15 | Single release, hard cutover, 2.6.0 | 5 | ✔ |
| §16 | Risk mitigation (grep sweeps) | 6 | ⚠ grep regexes malformed (see phase-6 review M1) |
| §18 | Files-touched list | — | **GAP G1: `finalize.js`, `git-tools.js`, `workfile-tools.js`, `sort.js:187` all enumerate `WORK.history.yaml` and must also enumerate `WORK.feedback.yaml`. Zero phases touch them.** |

### Identified gaps

**G1 (hard gap) — `WORK.feedback.yaml` lifecycle is documented but not coded.** Four production sites hardcode `'WORK.history.yaml'`:
- `scripts/lib/finalize.js:7` (tool-managed filter)
- `scripts/sort.js:187` and `:247` (git-clean-check tool-managed list)
- `.opencode/plugins/foundry-tools/git-tools.js:50–52` (`foundry_git_finish` deletes work files)
- `.opencode/plugins/foundry-tools/workfile-tools.js:63,75` (`foundry_workfile_delete` description and body)

None are modified by any phase. Spec §4 line 38 and phase 5 docs explicitly promise `foundry_git_finish` deletes `WORK.feedback.yaml`. Ship-as-planned = `WORK.feedback.yaml` leaks onto `main` after every squash-merge, and `sort.js`'s git-clean-check will fail loudly when it sees an untracked-but-expected file. **This is the single riskiest miss.**

**G2 (minor gap) — No schema version stamp.** Spec §4.1 motivates the `{ items: [...] }` wrapper as a home for future metadata, but no phase writes `version: 1`. Cheap insurance; optional.

**G3 (minor gap) — `includeResolved` filter on `foundry_feedback_list`.** Current behaviour surfaces every resolved item on every list call. Over a long cycle this bloats LLM context. Spec is silent; current plan matches spec; but this is a foreseeable UX regression.

---

## Phase dependency graph assessment

```
  Phase 1 (store + transitions + ulid)
       │ (provides openFeedbackStore, store.transition, store.writeDeadlockedSnapshot)
       │
  Phase 2 (history hardening + IO rename + ## Feedback removal)
       │ (provides io.rename; removes createWorkfile's ## Feedback section)
       │
  Phase 3 (plugin tool API switch) ← depends on 1 AND 2
       │ (tools now write feedback.yaml; tests need io.rename; feedback.js shim still present)
       │
  Phase 4 (sort + orchestrate + delete feedback.js) ← depends on 1, 2, 3
       │ (deletes scripts/lib/feedback.js which phase 3 stopped using)
       │
  Phase 5 (skills + docs + CHANGELOG + version) ← depends on 1–4
       │ (user-facing prose)
       │
  Phase 6 (consistency test + sweep) ← depends on 1–5
```

**Assessment:**

1. **Dependency order is correct.** Phases 1 and 2 are the only pair that could be parallel (plan says so); neither blocks the other. 3 depends on 1+2. 4 depends on all three (it deletes the shim introduced in 1's task 1.4). 5 and 6 are the tail.

2. **Phase 1 and phase 2 can run concurrently** — neither touches the other's files. PLAN.md captures this correctly.

3. **Undeclared dependency (subtle).** Phase 3's tool tests need `io.rename` via the real `makeIO`, which phase 2 adds. Phase 3's preflight grep (`rg -n "io\.rename" .opencode/plugins/foundry-tools/helpers.js`) explicitly checks for this — so it's declared. ✔

4. **Undeclared dependency (not subtle).** Phase 4's task 4.2 refactors `nextAfterAppraise`/`nextAfterQuench` predicates that read `f.state` + `f.resolved`. Phase 3 never touches `nextAfterAppraise`. But phase 3's `foundry_feedback_list` **also** changes response shape, and orchestrate's `readRecentFeedback` (phase 4 rewrites it) consumes `listFeedback` from the **legacy** module during phase 3. This transient is flagged by phase 3 at tasks 3.3 step 5 and 3.5 step 3 — but the mitigation ("still returns surfaces with undefined `resolved` fields but won't crash") is speculative. In reality orchestrate imports `listFeedback` from `scripts/lib/feedback.js` — that module is still intact through phase 3. No transient exists. The phase-3 mitigation is over-cautious. No blocker; worth tightening.

5. **Could phases be combined?** Phase 2 + phase 4's `appendEntry` signature change for `open_feedback` should be one phase — see Contract C1. Moving `open_feedback` param destructuring + coercion to phase 2 makes phase 4 a pure call-site patch with no history.js touch, which is cleaner.

6. **Could phases be split?** Phase 4 is the heaviest (sort refactor + orchestrate + delete feedback.js + retire sort tests). If anything, splitting "delete feedback.js" into its own trivial phase (call it 4b) makes bisect and rollback cleaner. Low priority.

---

## Contract issues between phases

### Contract C1 — `appendEntry` signature change lands in wrong phase

**Between phases 2 and 4.**
- Phase 2 claims spec §10 coverage as "shape only; actual computation in phase 4" (phase-2-history-hardening.md:5).
- Phase 2 does not change `appendEntry`.
- Phase 4 task 4.4 step 5 silently modifies `scripts/lib/history.js:appendEntry` to destructure `open_feedback` and coerce to 0, **inside a commit that's otherwise about `scripts/orchestrate.js`**.
- No test in `tests/lib/history.test.js` asserts the coercion; the test lives in `tests/orchestrate.test.js` or a new integration file.

**Impact:** `history.js` gets a silent signature change from a commit titled for orchestrate. History unit tests don't cover the new field. A reviewer of phase 4's diff must cross-reference phase 2's "shape only" claim to understand what's going on.

**Fix:** Move the `appendEntry({ ..., open_feedback })` destructuring + coercion + unit test into phase 2 (new task 2.7.5 or 2.8b). Phase 4 only wires the `scripts/orchestrate.js:429,436` call sites. This is what the phase-2 review M3 and phase-4 review B3 both recommend, from opposite sides.

---

### Contract C2 — Deadlock pass scope (phase 4 narrows spec §5.2 + §6.1)

**Phase 4, inside phase.**
- Spec §5.2: "sort walks all non-resolved non-deadlocked items **before emitting a route**".
- Spec §6.1: "`runSort` in `scripts/sort.js` acquires a feedback-store handle early, walks all items via the new API".
- Phase 4 task 4.2 step 4 says "integrate the deadlock pass **around the `nextAfterAppraise` call**, before routing."

**Impact:** sort calls originating from a quench→sort or forge→sort path never run the deadlock pass. The per-item threshold is only checked on appraise→sort transitions. An item that reaches depth N entirely inside the quench loop is never deadlocked.

**Fix:** hoist `writeDeadlockSnapshots` to `runSort` proper, immediately after `loadHistory(...)` and before `determineRoute(...)`. Gate only on the `deadlock-appraise` frontmatter flag. This matches spec §6.1 verbatim. (Phase-4 review B1 makes the same point in detail.)

---

### Contract C3 — Deadlock-pass atomicity violation (phases 1 ↔ 4)

**Between phases 1 and 4.**
- Spec §6.1: "walks the list, prepends `{ state: deadlocked, ... }` to every item that qualifies **in the same pass**, then serialises and writes the full file **once** via the atomic rename. A crash at any point leaves the yaml either fully updated (all N deadlock snapshots present) or untouched (none)."
- Phase 1 task 1.8 implements `store.writeDeadlockedSnapshot({ id, cycle, reason })` as a single-item operation that calls `persist()` (one rename) per invocation.
- Phase 4 task 4.2 step 3 implements `writeDeadlockSnapshots` as a `for` loop over qualifying items that calls `store.writeDeadlockedSnapshot(...)` N times.

**Impact:** N atomic renames, not one. If the second rename fails, item 0 is deadlocked in the live file and items 1..N−1 are not. Spec §6.1 explicitly forbids this half-state; spec §14.6 (consistency test) assumes it cannot happen.

**Fix:** Phase 1 gains a batch primitive `store.writeDeadlockedSnapshots([{ id, cycle, reason }, ...])` that builds the next items array, saves once, then swaps. Phase 4 calls the batch primitive. (Phase-4 review M4 identifies this in detail.)

---

### Contract C4 — sort test harness args (phase 4 fabricates `cycleDef` / `mint`)

**Phase 4, task 4.1 step 4.**
- Phase 4 writes test code like `runSort({ workPath, historyPath, cycleDef: '-- fill in --', mint: () => 'token' }, io)`.
- Existing `tests/sort.test.js` calls `runSort({ workPath, historyPath }, io)` — no `cycleDef`, no `mint`.
- `scripts/sort.js:267` signature accepts those args but they default; the note in phase 4 asks the executor to "copy the pattern from the existing test harness" — the existing harness has no such pattern.

**Impact:** executor wastes time chasing a ghost. Likely outcome: the placeholder gets replaced with inline yaml fixtures for `foundry/cycles/c1.md`, which works but is hand-rolled.

**Fix:** remove `cycleDef` and `mint` from the test scaffolding. Use the shape the existing harness uses. (Phase-4 review M1.)

---

### Contract C5 — plugin test harness (phase 3 fabricates `toolStub`)

**Phase 3, tasks 3.1–3.2.**
- Phase 3 invents a `toolStub` with hand-rolled `tool.schema.string().describe()` etc.
- Real plugin tests (e.g. `tests/plugin/assay-tools.test.js:7,70`) use `const plugin = await FoundryPlugin({ directory: root }); plugin.tool.foundry_feedback_add.execute(...)`.
- Phase 3 preflight asks the executor to "find the stub" — it doesn't exist.

**Impact:** executor either invents one or stops. If they invent one, they ship a test harness that's out of sync with the real `tool` factory — when the real factory's schema shape drifts, the tests silently drift too.

**Fix:** rewrite phase 3 scaffolding to use `FoundryPlugin({directory})`. (Phase-3 review B2.)

---

### Contract C6 — active-stage filename (phase 3 hardcodes wrong name)

**Phase 3, all tasks.**
- Phase 3 writes `.foundry/active-stage` (no extension).
- Actual file: `.foundry/active-stage.json` (see `scripts/lib/state.js:1`).
- Existing tests (`tests/plugin/stage-end-failed-flow.test.js:53`) confirm `.json`.

**Impact:** every phase-3 test fails `requireActiveStage(io)` with a "no active stage" error. Executor will chase ghosts until they read `state.js`.

**Fix:** global rename in phase 3 to `.foundry/active-stage.json`, payload `{cycle, stage, baseSha}`. (Phase-3 review B1.)

---

### Contract C7 — assay sync/async IO boundary (phase 3)

**Phase 3, task 3.11.**
- `openFeedbackStore` is sync (phase 1).
- `assay-tools.js` runs inside `withStore(context)` which hands the caller `memIo` (async shim from `makeMemoryIO`).
- Phase 3 task 3.11 step 4 writes `const store = openFeedbackStore('WORK.feedback.yaml', io)` without specifying which `io`.

**Fix:** use the sync `io` from `makeIO(context.worktree)` (already in scope at `assay-tools.js:19`), not the async `memIo`. (Phase-3 review B3.)

---

### Contract C8 — phase 1 legacy shim weakens authorship (phase 1 → phase 3/4)

**Phase 1, task 1.4 step 3.**
- Legacy shim at `scripts/lib/feedback.js:256` passes `sourceMatches: true` unconditionally to the new `validateTransition`.
- Every legacy call (old markdown API still in use through phases 1–3) now silently bypasses source-authorship checks.

**Impact:** phase 1 tightens the state machine but loosens authorship for the interim — opposite of the intended staged rollout. Anyone using the plugin during phase 1/2 can cross-source-resolve items that the new state machine would forbid.

**Fix:** keep the old `MATRIX` constant alongside the new `validateTransition` and route the shim through the old matrix; or delete the `stageBase` argument from the legacy API entirely in phase 1. (Phase-1 review B1.)

---

## Cross-phase inconsistencies

### Same concept, different names

- **`open_feedback` (snake_case on disk, spec §10) vs `openFeedback` (JS).** Spec and phases are consistent; both forms appear. Low risk; worth a one-line comment.
- **`resolution: 'approved'` (plugin tool arg) vs `target: 'resolved'` (store).** Phase 3 correctly translates at the tool boundary. The skill prose (phase 5) uses `approved` everywhere — correct at that level. The CHANGELOG (phase 5) conflates the two in one sentence: "`approved` is renamed to `resolved` internally; the public resolve tool still accepts `resolution: 'approved' | 'rejected'` as input." — accurate but subtle. Fine.

### Contradictory decisions

- **Reason required on `resolved`?** Spec §4.3 table: forbidden on `resolved`. Spec §5.1 rule 5: required on deadlock-override transitions, which target `resolved`. Phase 1 picks §5.1's side. This is a **spec bug** that must be resolved explicitly before phase 1 execution. See Ambiguity §A1.
- **Forge's tag-based wont-fix restriction.** Current `docs/work-spec.md:97` says `#validation` cannot be wont-fixed. Neither phase 1's matrix, phase 3's tool, nor phase 5's skills preserve this. If dropping is intended, CHANGELOG must flag; if preserving, phase 3 tool layer needs a tag check. See Ambiguity §A2.
- **Human-appraise's override scope.** Current `skills/human-appraise/SKILL.md:75` allows human-appraise to resolve `actioned`/`wont-fix` items regardless of source. New state machine (phase 1) narrows this to `deadlocked`-only. Silent behavioural narrowing with no CHANGELOG entry. See Ambiguity §A3.

### Duplicated work

- Phase 3 tasks 3.2, 3.6, 3.8, 3.9, 3.10 each re-inline the `writeFileSync('.foundry/active-stage', ...)` block. Same for inline worktree setup. ~8 copies of the same 4-line block. Extract once into `setActiveStage(dir, stage)` helper.
- Phase 4 task 4.1's `makeSortIO` helper duplicates the phase-1 test `mockIO` with `rename`. Both should extract to `tests/helpers/mockIO.js` (referenced by `PLAN.md:77` as if it already exists — it does not). See Plan Drift §D2.

---

## Migration & rollout through the phases

**Does the system stay working between phases?**

- **After phase 1:** green. Only new modules added; legacy shim keeps old callers working. Authorship is loosened by C8 — behavioural drift on `main`. Minor.
- **After phase 2:** green. `## Feedback` no longer emitted from `createWorkfile`, but legacy parser still works against existing files. IO shim has `rename`. History atomic + seq + markWorkfileFailed all landed. Clean.
- **After phase 3:** **Split-brain.** Plugin tools write `WORK.feedback.yaml`. Sort and orchestrate still read `WORK.md` `## Feedback` via legacy `feedback.js`. Any cycle that runs sort between phase 3 and phase 4 sees **zero feedback** regardless of what the plugin wrote. Phase 3's mitigation is to acknowledge this as transient and forbid commits that leave tests broken. That's correct discipline, but anyone running `main` between merges of phase 3 and phase 4 has a broken product. **Recommendation:** either (a) merge phases 3 + 4 as a single PR, or (b) make phase 3's legacy read path a bridge that reads from both `WORK.md` and `WORK.feedback.yaml` and unions the result. Option (a) is simpler.
- **After phase 4:** green. Legacy module deleted. Full pipeline on new store.
- **After phase 5 + 6:** green. Docs and final gate.

**Rollout risk:** the "hard cutover" rollout from spec §15 is correct for users (no migration code; "finish in-flight cycles on 2.5"). But for **the repo during development**, the phase-3/phase-4 split is not safe to ship independently. Bundle them.

---

## Top 5 risks ranked by severity

### Risk 1 (HIGH) — `WORK.feedback.yaml` leaks onto main (gap G1)
Four production call sites enumerate `WORK.history.yaml`; all need sibling `WORK.feedback.yaml` entries. None are touched. Ships broken. Docs lie. **Add a phase-2 or phase-6 task to update all four sites with tests.**

### Risk 2 (HIGH) — Deadlock pass not atomic (contract C3)
N renames instead of one; spec §6.1 invariant violated. A crash during the pass leaves a half-deadlocked yaml. The cross-file consistency test in phase 6 would catch it, but only synthetically. **Add batch primitive to phase 1; use in phase 4.**

### Risk 3 (MEDIUM-HIGH) — Phase 3 / phase 4 split ships broken main (migration)
Between the two merges, sort sees zero feedback. **Bundle phases 3+4 into one PR, or add a dual-read bridge in phase 3.**

### Risk 4 (MEDIUM) — Ambiguity §A1 (reason on resolved-from-deadlocked) unresolved
Spec contradicts itself. Phase 1 picks §5.1's side. If that's wrong, tests lock in the wrong behaviour for v2.6.0 and breaking change to fix. **Resolve in spec before phase 1 executes.**

### Risk 5 (MEDIUM) — Silent behavioural narrowing of human-appraise override (ambiguity §A3)
Current users who rely on human-appraise overriding actioned/wont-fix items (without reaching deadlock threshold) will see their workflows break. No CHANGELOG entry. **Decide: preserve legacy behaviour, or flag in CHANGELOG as breaking.**

---

## Simplification opportunities

1. **Bundle phases 3+4.** The split optimises for phase boundaries but creates a broken-main window. One PR with both phases, still commits-per-task inside, is cleaner.

2. **Drop the fabricated `toolStub` in phase 3.** Use the real `FoundryPlugin` in tests. Deletes ~40 lines of stub and removes a drift surface. (Phase-3 review B2.)

3. **Extract `tests/helpers/mockIO.js` in phase 1.** Both phase 1 and phase 4 define near-identical in-memory IOs with `rename`. PLAN.md already references the file as if it exists. Extract once.

4. **Move `appendEntry` open_feedback signature change to phase 2.** Keeps history changes in the phase labelled "history hardening" and leaves phase 4 as a pure orchestrate call-site patch. (Contract C1.)

5. **Consider whether the redesign is over-engineered for the real bug.** The root cause per spec §1 is one function (`detectDeadlocks`) that uses global iteration count instead of per-item depth. A minimal fix: tag feedback items with an `addedAtIteration` field in the existing markdown format and compute depth as `current_iteration - addedAtIteration`. This would close the P1 bug without introducing yaml storage, ULIDs, a state machine, source-authorship, atomic renames, IO shim changes, etc. **That minimal fix is not what the team wants** — the spec is clear that the markdown format has other problems (authorship, mutation, debug log) — but acknowledging that ~70% of the LOC lands to fix adjacent issues is worth calling out. If schedule pressure hits, a minimal per-item fix could ship first as 2.5.1, with the yaml redesign deferred.

---

## Spec ambiguities that must be resolved before implementation

### §A1. Reason on resolved-from-deadlocked (§4.3 vs §5.1 rule 5)

Spec §4.3 table: "forbidden on `open`, `actioned`, `resolved`."
Spec §5.1 rule 5: "`reason` is always required on a deadlocked-item resolution."

These contradict when `target === 'resolved'` and `current === 'deadlocked'`. Phase 1 picks §5.1. Test at phase-1 task 1.7 locks it in.

**Decision needed:** which wins? Document in the spec, then update whichever phase locks in the wrong side.

### §A2. Forge's tag-based wont-fix restriction

`docs/work-spec.md:97` (current): `#validation` cannot be wont-fixed.
Phase 1 state machine: no tag check.
Phase 3 tool: no tag check.
Phase 5 skill prose: no restriction.

**Decision needed:** preserve the restriction, or drop it? If preserve, add to phase 3 tool + phase 5 skill. If drop, add to CHANGELOG Breaking section.

### §A3. Human-appraise override scope

Current behaviour (per `skills/human-appraise/SKILL.md:75`): human-appraise overrides `actioned`/`wont-fix` items regardless of source.
New state machine (phase 1 §5.1 rule 3): human-appraise treated identically to appraise for non-deadlocked items; must match source.
Override authority is **narrowed** to `deadlocked`-only.

**Decision needed:** is the narrowing intentional? If yes, phase 5 CHANGELOG must flag as breaking. If no, phase 1 state machine needs a human-appraise exception for all non-terminal states.

### §A4. `cycle` field semantics on feedback snapshots

Spec §4.3: `cycle` is "Cycle id at the time of the transition".
Phase 4 routing uses unfiltered `store.list()`.

If a WORK.md cycles through multiple foundry-cycle-ids in one flow (rare but not forbidden), items from cycle A are visible to routing in cycle B. `computeOpenFeedback` over-counts. Spec §3 non-goal 3 excludes cross-cycle debug views but doesn't address cross-cycle routing inside one WORK.md.

**Decision needed:** should sort / orchestrate filter store.list() by the current cycle? Probably yes. Add to phase 4.

### §A5. Stale `WORK.feedback.yaml` at start of fresh cycle

Related to gap G1. If the finalize-time delete is not implemented (G1), every new `foundry_workfile_create` starts with the previous cycle's `WORK.feedback.yaml` still present. The store's `loadItems` will read it and surface old items. No phase tests this specifically.

**Decision needed:** `createWorkfile` should also delete or reset `WORK.feedback.yaml`. Add test.

---

## PLAN.md quality

- **File-structure table (PLAN.md:19–49).** Complete and accurate against phase contents. Good. But it omits `finalize.js`, `git-tools.js`, `workfile-tools.js`, `sort.js`'s tool-managed list — all of which need edits per gap G1. PLAN.md drift from reality.
- **Phase table (PLAN.md:55–62).** Matches phase file names. Accurate. Does not flag the phase-3/phase-4 broken-main window. See Risk 3.
- **Self-review checklist (PLAN.md:81–89).** Sound checklist. But "every numbered section maps to at least one task" was apparently not actually run: §11.5 lifecycle-note coverage in phase 5 claims to document the lifecycle, but the code that implements the lifecycle (finalize.js etc.) is nowhere. The self-review found the doc mention and stopped.
- **Drift D1.** PLAN.md:77 references `tests/helpers/mockIO.js` as an established helper. No such file exists. Both phase 1 and phase 4 define mockIO helpers inline.
- **Drift D2.** PLAN.md says "phases are independently mergeable in principle" (line 53). Practically phases 3+4 are not — see Risk 3.

---

## Spec quality

- **Mostly excellent.** Section structure is clean; each decision is motivated; non-goals are explicit.
- **Contradictions §A1–A3** above are the material spec issues. All three are resolvable in 10 minutes.
- **Spec §8.1 "Before" column is wrong.** The "before" signature for `foundry_feedback_add` is `{ file, text, tag, stageBase? }`. Actual current code (see `.opencode/plugins/foundry-tools/feedback-tools.js:14–18`) is `{ file, text, tag }`. No `stageBase?`. Phase 3's commit message repeats the error.
- **Spec §14.6 under-specified.** "End-to-end scenario exercises a full cycle" — phase 6 implements this synthetically only. If "end-to-end" means actually invoking the plugin tools, spec should say so. If synthetic is fine, spec should say so. Phase-6 review M2 flags this.
- **Spec §15 rollout is correct** but assumes `foundry_workfile_delete` actually deletes `WORK.feedback.yaml` — which gap G1 shows it does not. Spec implicitly assumes code that doesn't exist.

---

## Overall recommendation

**Revise before dispatching execution.** The plan is fundamentally sound and the per-phase reviewers caught most of the individual issues. The cross-cutting concerns that they could not catch individually are:

1. **Gap G1 (lifecycle).** Add a task — either in phase 2 adjacent to the IO shim changes, or in a new phase 4.5, or folded into phase 6 — that updates `finalize.js`, `git-tools.js`, `workfile-tools.js`, and `sort.js:187,247` to enumerate `WORK.feedback.yaml` alongside `WORK.history.yaml`. Add unit tests for each. ~30 min.

2. **Contract C3 (atomicity).** Add a batch `writeDeadlockedSnapshots([...])` primitive to phase 1's store. Use it from phase 4's sort integration. ~20 min to plan, ~30 min to execute.

3. **Contract C1 (appendEntry signature).** Move the `open_feedback` destructuring from phase 4 to phase 2. ~10 min plan edit.

4. **Bundle phases 3+4 merge-wise.** Still commits-per-task internally. Avoid the broken-main window. Zero code impact; PR-strategy decision.

5. **Resolve ambiguities §A1, §A2, §A3** before phase 1 or phase 3 or phase 5 execute. Each is a single design decision.

6. **Per-phase review items** — accept or close each. They are mostly correct; integrate their fixes.

Estimated plan-revision time: **2 hours**. Estimated execution time after revision: **unchanged** from the author's current estimate (~3 days of subagent work).

After revision, this is a good plan for a real problem. Ship it.
