# Changelog

## 2.3.0 — 2026-04-20

### Breaking

- **LLM orchestration replaced with deterministic `foundry_orchestrate` tool.** The `cycle` and `sort` skills are removed; replaced by a single thin `orchestrate` skill that drives a 3-line loop.
- **Six tools deregistered** from the plugin (still exist as internal imports for tests): `foundry_sort`, `foundry_history_append`, `foundry_stage_finalize`, `foundry_git_commit`, `foundry_workfile_configure_from_cycle`, `foundry_workfile_set`.
- **`foundry_artefacts_add` removed entirely.** `foundry_stage_finalize` (internal) registers forge outputs.
- Upgrade requires clean main + no in-flight workfile (see `upgrade-foundry` skill).

### Added

- `foundry_orchestrate` — single tool that owns the sort → history → dispatch → finalize → history → commit loop. Atomic stage completion.
- `scripts/orchestrate.js` — deterministic orchestration logic, composes existing internal functions.
- Orphaned-stage detection: if orchestrate is called without `lastResult` but an active stage exists, returns `violation`. Fixes the ses_256c failure mode where an LLM skipped the post-dispatch history append and wedged the cycle.

### Fixed

- Root cause of all deferred HARDEN.md bugs (B, C, D, E, G) and the ses_256c bug: LLM misfollowing a deterministic protocol. Protocol now lives inside the plugin tool.

### Migration

See `skills/upgrade-foundry/SKILL.md` for v2.3.0 pre-flight checks. No automated state migration — complete or discard in-flight cycles on v2.2.x before upgrading.

## 2.2.1 — 2026-04-20

Follow-up patch addressing the five bugs deferred from v2.2.0 (see `HARDEN.md` §Deferred).

### Breaking changes

- **Cycle-definition deadlock config flattened.** The nested `human-appraise: {enabled, deadlock-threshold}` block is replaced by three flat keys:
  - `human-appraise: <bool>` (default `false`) — include `human-appraise` in the stage loop every iteration
  - `deadlock-appraise: <bool>` (default `true`) — route to `human-appraise` when LLM appraisers deadlock
  - `deadlock-iterations: <number>` (default `5`) — deadlock threshold
  Run the `upgrade-foundry` skill to migrate existing cycle defs — the old nested form is no longer read.

### New

- **`foundry_workfile_configure_from_cycle({cycleId, stages})`** — populates WORK.md frontmatter from a cycle definition in one call. Replaces the prior 6–7 sequential `foundry_workfile_set` calls at cycle start. Defaults for `max-iterations`, `human-appraise`, `deadlock-appraise`, `deadlock-iterations`, and `models` now live in plugin code rather than skill prose.
- **`foundry_artefacts_list({cycle})`** — optional cycle filter. Callers should always pass the current cycle to avoid picking up stale rows from prior aborted sessions.

### Fixed

- **Bug B — deadlock routing.** Sort now reads the flat deadlock keys from WORK.md frontmatter and routes to `human-appraise` on deadlock (either an existing `human-appraise:<cycle>` stage in `stages`, or a synthesized one). When `deadlock-appraise: false`, deadlock marks the cycle `blocked`.
- **Bug C — stale artefact validation.** `quench`, `appraise`, and `human-appraise` skills now pass the current cycle to `foundry_artefacts_list`, scoping validation to artefacts produced by the current cycle instead of every row that has ever landed in WORK.md.
- **Bug D — overwriting WORK.md.** The `flow` skill now calls `foundry_workfile_get` before `foundry_workfile_create` and prompts the user to resume, discard, or abort when an existing workfile is detected. Silent overwrite is not offered; resume requires matching `flow` and `cycle`.
- **Bug E — missing micro-commits.** `foundry_sort` now returns `{route: 'violation'}` when `WORK.md`, `WORK.history.yaml`, or anything under `.foundry/` has uncommitted changes at the start of a sort call and history is non-empty. Structurally enforces the one-commit-per-stage contract that previously lived only in skill prose. First sort of a cycle is exempt (empty history).
- **Bug G — workfile setup boilerplate.** See `foundry_workfile_configure_from_cycle` above.

### Migration

Run the `upgrade-foundry` skill to migrate cycle definitions to the flat deadlock keys (Bug B). No other migration required — WORK.md, `.foundry/`, and feedback state are forward-compatible.

## 2.2.0 — 2026-04-19

### Breaking changes

- **`foundry_artefacts_add` removed.** Artefact registration now happens exclusively via `foundry_stage_finalize` after a forge stage closes.
- **`foundry_artefacts_set_status` no longer accepts `draft`.** Only `done` and `blocked` are valid. New artefacts are registered as `draft` automatically by `stage_finalize`.
- **Feedback / artefact / workfile mutation tools now enforce stage-lock preconditions.** Tools callable by subagents require an active stage matching their role; tools callable by the orchestrator require no active stage. Out-of-band calls return a structured error instead of mutating state.
- **Feedback state machine strictly enforced.** `approved` is terminal. `quench` cannot approve/reject `wont-fix` items. See `HARDEN.md` §4 for the full matrix.
- **`foundry_sort` dispatchable routes now return a `token` field.** Subagents must redeem the token via `foundry_stage_begin`; forged or replayed tokens are rejected.

### New

- **`foundry_stage_begin(stage, cycle, token)`** — subagents open a work stage by consuming a single-use HMAC-signed token.
- **`foundry_stage_end(summary)`** — subagents close a stage; preserves `baseSha` for finalize.
- **`foundry_stage_finalize(cycle)`** — orchestrator verifies stage output against allowed file patterns, registers matching files as draft artefacts, rejects stray writes with `{error: "unexpected_files", files: [...]}`.
- **`.foundry/` state directory** (gitignored) — holds `.secret` (per-worktree HMAC key, mode 0600), `active-stage.json` (present only during an active stage), `last-stage.json` (for finalize lookup).

### Fixed

- Normalized `maxIterations` → `max-iterations` across workfile read/write paths (previously inconsistent between flow and cycle skills, causing latent deadlock-detection issues).

### Migration

Upgrade with the `upgrade-foundry` skill. `.foundry/` is created automatically on first plugin boot; `.secret` is generated idempotently. No data migration required — existing `WORK.md` and `foundry/*` configs are compatible.
