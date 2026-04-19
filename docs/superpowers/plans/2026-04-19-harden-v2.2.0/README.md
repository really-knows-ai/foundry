# HARDEN v2.2.0 Tool-Level Enforcement — Implementation Plan

> **For agentic workers:** This plan is executed in a **fresh session** using `superpowers:subagent-driven-development` — dispatch one subagent per numbered task, review between tasks. See the Execution section at the bottom. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move foundry orchestrator constraints from advisory skill text into tool-level preconditions, so fabricated user interactions, stray file writes, and invalid feedback-state transitions become structurally impossible.

**Architecture:** Introduce a per-worktree `.foundry/` state directory containing an HMAC secret and a single-writer `active-stage.json` file. `foundry_sort` hands out HMAC-signed, single-use, expiring tokens that subagents redeem via a new `foundry_stage_begin` tool; subagents close the stage with `foundry_stage_end`; the orchestrator calls `foundry_stage_finalize` which verifies git diffs against the stage's allowed file patterns and registers artefacts. Every existing mutation tool gains a precondition that checks the active-stage state and (for feedback tools) the finite-state-machine transition table.

**Tech Stack:** Node ≥18.3 ESM, `node:test` + `node:assert/strict`, `@opencode-ai/plugin ^1.4.0`, `js-yaml`, `minimatch`, `node:crypto` (HMAC-SHA256). No new runtime deps.

---

## Source spec

Original spec: `HARDEN.md` at the repo root. This plan implements every numbered task in the spec's §Implementation-plan (1–24), plus one cherry-pick of Bug F from §Deferred.

## Review observations folded into this plan

1. **Undocumented tool `foundry_git_finish`** exists in `foundry.js` (lines 458–503) but HARDEN.md omits it. We treat it the same as `git_branch`/`git_commit`: require no active stage. Covered in Phase 3, Task 13.
2. **baseSha carry-through** from `stage_end` → `stage_finalize` is resolved by writing `.foundry/last-stage.json` **before** deleting `active-stage.json`. Picked for restart-safety over in-memory state.
3. **Pending nonce list** is a module-scoped `Map<nonce, {exp, route, cycle}>` closed over by `FoundryPlugin`. Restart invalidates outstanding tokens — acceptable per HARDEN §2.
4. **Dedup hash** is `sha256(text).slice(0, 16)` in hex. Keyed on `{file, tag, hash}`.
5. **`upgrade-foundry/SKILL.md`** already exists; Task 20 becomes an update (not a create).
6. **Bug F cherry-pick**: normalize `max-iterations` (kebab) as canonical; tolerate `maxIterations` on read. Added as Phase 1 Task 4.5 because `foundry_sort` deadlock logic reads this key — risking spurious test failures otherwise.
7. **Secret generation site**: on plugin boot (`config` hook) rather than on every tool call, to avoid a write-race between parallel first calls.

---

## File structure

New files — every one is under published paths (`scripts/`, `.opencode/`, `skills/`) or tests.

| Path | Responsibility |
|---|---|
| `scripts/lib/state.js` | `readActiveStage / writeActiveStage / clearActiveStage / readLastStage / writeLastStage / ensureFoundryDir`. No business logic. |
| `scripts/lib/secret.js` | `readOrCreateSecret(dir)` — idempotent, mode 0600. |
| `scripts/lib/token.js` | `signToken(payload, secret)` / `verifyToken(token, secret)` — HMAC-SHA256, base64url, 10-min exp. |
| `scripts/lib/feedback-transitions.js` | Pure `validateTransition(current, target, stageBase)` matrix + `hashText(text)`. |
| `scripts/lib/pending.js` | `createPendingStore()` → `{add, consume, size}` keyed by nonce, prunes on read. |
| `scripts/lib/stage-guard.js` | `requireNoActiveStage(io)` / `requireActiveStage(io, {stageBase, cycle})` — used by preconditions. |
| `scripts/lib/finalize.js` | `finalizeStage({io, cycle, cycleDef, artefactTypes, git})` — diff + pattern-match + register. |
| `tests/lib/state.test.js` | Unit tests for state helpers. |
| `tests/lib/secret.test.js` | Unit tests for secret helpers. |
| `tests/lib/token.test.js` | Unit tests for forge/expiry/tamper. |
| `tests/lib/feedback-transitions.test.js` | Matrix coverage. |
| `tests/lib/pending.test.js` | Add/consume/expire. |
| `tests/lib/stage-guard.test.js` | Accept and reject paths. |
| `tests/lib/finalize.test.js` | Clean forge / stray-file forge / non-empty quench / empty diff (integration with a tmp git repo). |
| `tests/plugin/stage-tools.test.js` | End-to-end happy + error paths for `stage_begin` / `stage_end` / `stage_finalize`. |
| `tests/plugin/preconditions.test.js` | Reject paths for every precondition-gated tool. |

Modified files:

| Path | Change |
|---|---|
| `.opencode/plugins/foundry.js` | Wire secret init into `config` hook; instantiate pending-store in factory; add 3 new tools; inject preconditions into 15 existing tool `execute` bodies; remove `foundry_artefacts_add` from public surface. |
| `scripts/sort.js` | Generate tokens for dispatchable routes; register nonces; reject when `active-stage.json` exists; tolerate both `max-iterations` and `maxIterations`. |
| `scripts/lib/workfile.js` | Normalize `maxIterations`→`max-iterations` on read/write. |
| `scripts/lib/feedback.js` | Integrate transition validator + dedup into `addFeedbackItem` / `resolveFeedbackItem` etc. |
| `scripts/lib/artefacts.js` | Reject `setArtefactStatus(..., 'draft')`. Keep `addArtefactRow` exported for finalize only. |
| `skills/forge/SKILL.md` | Lifecycle bracketing; remove `artefacts_add`; file-pattern hygiene. |
| `skills/quench/SKILL.md` | Lifecycle bracketing; no-disk-writes reinforced. |
| `skills/appraise/SKILL.md` | Lifecycle bracketing; no-disk-writes reinforced. |
| `skills/human-appraise/SKILL.md` | Lifecycle bracketing; no-disk-writes reinforced. |
| `skills/sort/SKILL.md` | Include token in dispatch; call `stage_finalize` post-return; violation handling. |
| `skills/cycle/SKILL.md` | Reflect sort's new post-stage duties. |
| `skills/upgrade-foundry/SKILL.md` | Ensure `.foundry/` + `.secret` + `.gitignore` entry. |
| `.gitignore` | Add `.foundry/`. |
| `package.json` | Version `2.1.0` → `2.2.0`. |
| `CHANGELOG.md` | Create (file does not yet exist). |

---

## Phase & task index

Tasks are numbered to match HARDEN.md §Implementation-plan. Cross-phase dependencies noted.

| Phase | File | Tasks |
|---|---|---|
| 1 — Infrastructure | [PHASE_1.md](PHASE_1.md) | 1 state, 2 secret, 3 token, 4 transitions, 4.5 key-normalize (Bug F), 4.6 pending-store, 4.7 stage-guard |
| 2 — New tools | [PHASE_2.md](PHASE_2.md) | 5 stage_begin, 6 stage_end, 7 stage_finalize |
| 3 — Preconditions | [PHASE_3.md](PHASE_3.md) | 8 feedback_*, 9 artefacts_set_status, 10 remove artefacts_add, 11 workfile_*, 12 history_append, 13 git_branch/commit/finish |
| 4 — Sort updates | [PHASE_4.md](PHASE_4.md) | 14 token generation, 15 stage-lock reject |
| 5 — Skills | [PHASE_5.md](PHASE_5.md) | 16 forge, 17 quench/appraise/human-appraise, 18 sort, 19 cycle, 20 upgrade-foundry |
| 6 — Release | [PHASE_6.md](PHASE_6.md) | 21 version, 22 CHANGELOG, 23 publish, 24 retest |

Dependency graph (phases must complete in order; within a phase, tasks are sequential unless noted):

```
1 ─► 2 ─► 3 ─► 4 ─► 5 ─► 6
```

All Phase-1 libs are imported by Phase-2/3/4 code, so 1 must land first. Phase-3 preconditions call `requireActiveStage` from Task 4.7. Phase-5 skills document the protocol from Phases 2–4 and should not land before those tools work.

---

## Conventions

- **Commit style**: `feat(harden):` / `fix(harden):` / `test(harden):` / `docs(harden):` — one commit per task (or per step where the task file explicitly says "Commit").
- **Test command**: `node --test tests/` for everything; `node --test tests/lib/<x>.test.js` for targeted runs. No watcher; no coverage tool.
- **Import style**: ESM, `.js` extensions mandatory, named exports (codebase convention).
- **Error format**: Every rejection returns `JSON.stringify({ error: "<tool> requires <condition>; current: <state>" })`. Tools never throw to the caller — they return an error-shaped JSON string, matching existing conventions in `foundry.js`.
- **IO abstraction**: All disk access goes through `makeIO(context.worktree)` (defined at `foundry.js:111`). New helpers take an `io` param the same way `scripts/lib/history.js` does.
- **Path resolution**: `.foundry/` is always resolved relative to `context.worktree` (the per-invocation working directory), never `process.cwd()`.

---

## Breaking changes (user-facing)

Summarized verbatim from HARDEN.md §Breaking-changes — detail to land in `CHANGELOG.md` during Phase 6:

- `foundry_artefacts_add` removed.
- `foundry_artefacts_set_status(draft)` rejected.
- Feedback / artefact / workfile mutation tools enforce stage-lock preconditions.
- Feedback state machine strictly enforced.
- `foundry_sort` adds `token` field to dispatchable routes.

## Execution

**This plan will be executed in a fresh session using `superpowers:subagent-driven-development`.** Do not execute it inline in the same session it was written — fresh context per task is the point.

Workflow:

1. Start a new session at the repo root.
2. Load the `subagent-driven-development` skill.
3. Point it at this directory (`docs/superpowers/plans/2026-04-19-harden-v2.2.0/`) and begin at `PHASE_1.md` Task 1.
4. Dispatch a fresh subagent per numbered task, passing the task's phase file + this README as context. Review each task's diff + test output before proceeding to the next.
5. At each phase boundary, run `node --test tests/` and confirm green before moving to the next phase file.
6. Phases are strictly sequential (see dependency graph above). Tasks within a phase are sequential unless the phase file explicitly marks them parallel-safe (none do in this plan).
