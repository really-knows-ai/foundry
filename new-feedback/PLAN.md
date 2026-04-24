# WORK.feedback.yaml Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the markdown `## Feedback` section in `WORK.md` with a first-class YAML file (`WORK.feedback.yaml`) that records every feedback item and its full state-transition history, so that deadlock detection is per-item instead of based on a global iteration counter. Bundle prerequisite hardening of `WORK.history.yaml` (atomic writes, `seq` field, `open_feedback` field, parse-failure handling).

**Architecture:** A new `scripts/lib/feedback-store.js` module owns all reads/writes to `WORK.feedback.yaml`, wrapping a new `scripts/lib/ulid.js` generator. A rewritten `scripts/lib/feedback-transitions.js` enforces a six-state machine (`open | actioned | wont-fix | rejected | deadlocked | resolved`) with source-stage authorship. Sort becomes the sole writer of `deadlocked` snapshots. The plugin's `foundry_feedback_*` tools switch to an id-based API (breaking change, minor version bump to v2.6.0). `scripts/lib/history.js` is hardened: atomic rename, explicit `seq` field, new `open_feedback` field computed at the orchestrate.js call site, and `markWorkfileFailed` on parse failure. The IO shim gains a `rename` capability. All six pipeline skills and three docs files are updated.

**Tech Stack:** Node.js ≥18.3, `js-yaml`, `node:crypto` (for ULID randomness), `node --test` (builtin test runner), `assert` (builtin assertions).

---

## Spec

Full design rationale: `new-feedback/2026-04-24-work-feedback-yaml-redesign.md`. Every task below cites the spec section it implements.

**Clarifications baked into the spec during revision** (see `new-feedback/reviews/REVISION-CONTRACT.md` §A for full text):
- **§4.3 `reason` field:** required on `rejected`, `wont-fix`, `deadlocked`, `resolved`; forbidden on `open`; optional on `actioned`.
- **§5.1 rule 5:** human-appraise has universal override authority on any non-resolved item (not deadlock-only). Preserves today's behaviour.
- **§5.1 rule 7 (new):** forge `wont-fix` restricted by `item.source` base to `appraise` only. Replaces the old tag-based `#validation`/`#human` check.

## File Structure

| Path | Phase | Responsibility |
|------|-------|---------------|
| `scripts/lib/ulid.js` (new) | 1 | ~40 LOC pure-Node ULID generator |
| `scripts/lib/feedback-store.js` (new) | 1 | Load/save `WORK.feedback.yaml`; item CRUD; state-machine validation |
| `scripts/lib/feedback-transitions.js` (rewrite, ~60 LOC) | 1 | Six-state transition matrix + source-authorship predicate |
| `scripts/lib/feedback.js` (delete in phase 4) | 4 | Old markdown parser; retired |
| `scripts/lib/history.js` (modify) | 2 | Atomic rename, `seq`, `open_feedback`, parse-failure → failed flow, remove `readLastSortRoute`, enforce `route ⇒ stage==='sort'`, doc `getIteration` |
| `scripts/lib/workfile.js` (modify) | 2 | Remove `## Feedback` section from `createWorkfile` |
| `.opencode/plugins/foundry-tools/helpers.js` (modify) | 2 | Add `rename` to `makeIO` |
| `.opencode/plugins/foundry-tools/feedback-tools.js` (rewrite) | 3 | Id-based API against `feedback-store.js` |
| `.opencode/plugins/foundry-tools/assay-tools.js` (modify) | 3 | Use new `addFeedback` signature |
| `scripts/sort.js` (modify) | 4 | Replace `detectDeadlocks` with `writeDeadlockSnapshots`; read-side predicate for routing |
| `scripts/orchestrate.js` (modify) | 4 | Compute `open_feedback` at `appendEntry` call sites; use feedback-store for `readRecentFeedback` |
| `skills/forge/SKILL.md` (modify) | 5 | New API usage |
| `skills/quench/SKILL.md` (modify) | 5 | New API usage + source-authorship rule |
| `skills/appraise/SKILL.md` (modify) | 5 | New API + source-authorship rule |
| `skills/human-appraise/SKILL.md` (modify) | 5 | Deadlock-override path |
| `skills/assay/SKILL.md` (modify) | 5 | New `#validation` feedback path |
| `skills/orchestrate/SKILL.md` (modify) | 5 | `foundry_feedback_list` reference |
| `docs/work-spec.md` (modify) | 5 | Rewrite §Feedback; add `route`/`seq`/`open_feedback` + lifecycle to §history.yaml; update "Who writes what" |
| `docs/concepts.md` (modify) | 5 | Update Feedback subsection |
| `README.md` (modify) | 5 | Update §Feedback lifecycle + §WORK.md |
| `CHANGELOG.md` (modify) | 5 | v2.6.0 entry with breaking-change migration note |
| `package.json` (modify) | 5 | Bump `version` to `2.6.0` |
| `tests/lib/feedback-store.test.js` (new) | 1 | Store unit tests |
| `tests/lib/feedback-transitions.test.js` (rewrite) | 1 | State-machine enumeration |
| `tests/lib/history.test.js` (modify) | 2 | Remove `readLastSortRoute`; add malformed-yaml/seq/open_feedback/atomic-rename/route-invariant tests |
| `tests/plugin/feedback-tools.test.js` (new) | 3 | Plugin end-to-end tests |
| `tests/lib/feedback.test.js` (delete) | 4 | Old markdown tests retired |
| `tests/sort.test.js` (modify) | 4 | Update deadlock + routing tests to use feedback-store |
| `tests/plugin/workfiles-consistency.test.js` (new) | 6 | Cross-file (feedback.yaml × history.yaml) integrity |

## Phases

Each phase ends with a clean, green tree and an atomic commit per task. See the merge-boundary warning below the phase table — phases 3 and 4 cannot merge independently; phases 1, 2, 5, 6 can.

| # | File | Scope |
|---|------|-------|
| 1 | `new-feedback/phase-1-feedback-store.md` | New `ulid.js`, `feedback-store.js`, rewritten `feedback-transitions.js` + their unit tests. No callers touched yet. |
| 2 | `new-feedback/phase-2-history-hardening.md` | `history.js` audit fixes (seq, open_feedback shape, parse-failure, atomic rename, delete readLastSortRoute, route invariant, doc getIteration), add `rename` to IO shim, remove `## Feedback` from `createWorkfile`. Independent of phase 1. |
| 3 | `new-feedback/phase-3-plugin-api.md` | Rewrite `feedback-tools.js` against `feedback-store.js`; update `assay-tools.js` caller; plugin integration tests. |
| 4 | `new-feedback/phase-4-sort-integration.md` | Replace `detectDeadlocks` with sort-side `writeDeadlockSnapshots`; update routing predicate; feed `open_feedback` to orchestrate's `appendEntry` sites; rewrite sort tests; delete `scripts/lib/feedback.js` + `tests/lib/feedback.test.js`. |
| 5 | `new-feedback/phase-5-skills-docs.md` | Six skills, three docs, CHANGELOG, version bump. |
| 6 | `new-feedback/phase-6-consistency.md` | Cross-file consistency end-to-end test; **lifecycle plumbing for `WORK.feedback.yaml` across `finalize.js`, `git-tools.js`, `workfile-tools.js`, and any hardcoded `WORK.history.yaml` sites in `scripts/`**; final grep sweep for leaked legacy references. |

**Merge boundary warning.** Phases 1, 2, 5, and 6 are independently mergeable. **Phases 3 and 4 are not.** Merging phase 3 without phase 4 leaves sort reading a `## Feedback` markdown format that nothing writes to (broken `main`: sort sees zero feedback, deadlock detection fails silently). These two phases must land in a single PR, or phase 3 must be held until phase 4 is ready and rebased on it.

## Instructions for the Plan Executor

**You are a fresh subagent. You have no prior context.** Read this index first, then read the phase file you were dispatched for. Read the spec (`new-feedback/2026-04-24-work-feedback-yaml-redesign.md`) as needed for design intent.

**Ground rules.**
- TDD is mandatory for every task: write the failing test, run it and confirm it fails **for the right reason**, implement, re-run, confirm pass, commit.
- One commit per task (RED + GREEN + REFACTOR grouped). Use conventional-commit format (e.g. `feat(feedback-store): add ULID generator`, `test(history): cover atomic rename`, `refactor(sort): replace detectDeadlocks with writeDeadlockSnapshots`).
- Never `git push`. Never run `npm version` or amend existing commits unless explicitly told. Ask the human before any destructive git operation.
- Tests must pass before committing. Run `npm test` after each implementation step.
- If a task's expected test failure doesn't happen, **stop** — the plan is wrong; the hypothesis is wrong; escalate rather than push through.

**Test runner.** Project uses `node --test`. Run full suite: `npm test`. Run single file: `node --test tests/path/to/file.test.js`. Tests use `node:test` + `node:assert`, not mocha/jest.

**IO shim.** Most modules accept an `io` object (see `.opencode/plugins/foundry-tools/helpers.js:makeIO`). **There is no shared `mockIO` helper file today** — each test file constructs its own in-memory IO shim inline. Any new capability on the IO shim (e.g. `rename` in phase 2) must be added to every inline mock that exercises the capability; phase 2 has an explicit task (2.8.5) that extends all existing mocks once before relying on `rename`.

**Stage-guard assumptions.** Plugin tools gate on `requireActiveStage(io)` and `requireNotFailed(io)` before doing anything. Tests that exercise plugin tools must set up a fake active stage file (`.foundry/active-stage.json` with payload `{cycle, stage, baseSha}`) — see `tests/plugin/*.test.js` for the pattern. Note the `.json` extension and JSON payload shape; a plain `.foundry/active-stage` file will not satisfy `requireActiveStage`.

## Self-Review

After all six phase files are written, run a self-review pass:

1. **Spec coverage** — every numbered section of the spec (§4 through §15) must map to at least one task.
2. **Placeholder scan** — no "TBD", "similar to task N", "add error handling", "fill in details", `(Copy ...)`.
3. **Type consistency** — function names, field names, tool argument shapes are identical across phases. `id` in phase 3 must match `id` in phase 1.
4. **File path consistency** — every path referenced in a later phase is either present from before or created in an earlier phase.
5. **Lifecycle coverage** — every hardcoded `WORK.history.yaml` or `WORK.md` reference in `scripts/` and `.opencode/plugins/` is reviewed; each either handles `WORK.feedback.yaml` appropriately or has an explicit note why not. Phase 6 owns this sweep; phases 2–4 add coverage for paths they already touch.

## Execution Handoff

After you review and approve all phase files, I will dispatch phases in order via the `subagent-driven-development` skill: one fresh subagent per task, two-stage review (code review + verification) between tasks. Phase boundaries are hard checkpoints where we pause for you to inspect the tree before proceeding.
