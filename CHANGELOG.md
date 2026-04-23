# Changelog

## 2.4.1 — 2026-04-23

### Fixed

- `docs/getting-started.md` install snippet used a `packages` key that doesn't exist in OpenCode's config schema. Corrected to the `plugin: ["@really-knows-ai/foundry"]` form already shown in `README.md`.

## 2.4.0 — 2026-04-23

### Added

- **Flow memory** — a typed, graph-shaped knowledge store that persists across cycles. Entity types, edge types, and their prose briefs live in `foundry/memory/`; entity rows and edge rows are committed as NDJSON under `foundry/memory/relations/`; the live Cozo 0.7 database (`foundry/memory/memory.db*`) is gitignored and rebuilt on demand from the NDJSON files. Each cycle declares read/write permissions in its frontmatter (`memory: { read: [...], write: [...] }`); the dispatched stage prompt is augmented with a vocabulary block listing the entity/edge types visible to that cycle and the memory tools available to it.
- **Optional semantic search.** When `embeddings.enabled` is true in `foundry/memory/config.md`, entities are embedded on write against an OpenAI-compatible endpoint (default: local Ollama `nomic-embed-text`, 768 dims) and exposed via `foundry_memory_search`. Embeddings can be disabled; the graph still works.
- **20 memory tools** registered by the plugin: `foundry_memory_{put,relate,unrelate,get,list,neighbours,query,search}` for read/write, `foundry_memory_{create,rename,drop}_{entity,edge}_type` for vocabulary management, `foundry_memory_{init,validate,reset,dump,vacuum,change_embedding_model}` for admin. Destructive operations (`drop_*`) take an optional `confirm` — without it they return a preview of affected rows.
- **9 memory skills**: `init-memory`, `add-memory-entity-type`, `add-memory-edge-type`, `rename-memory-entity-type`, `rename-memory-edge-type`, `drop-memory-entity-type`, `drop-memory-edge-type`, `reset-memory`, `change-embedding-model`. All wrap the deterministic admin tools with the usual conflict-checking, preview-then-confirm, and commit discipline.
- `docs/memory-maintenance.md` — contributor notes on Cozo 0.7 adaptations (`::compact`, typed `<F32;N>?` vector columns, `?[...] <- [[...]]` put syntax, single-vs-double-quote string literal semantics, `::relations` HNSW filtering) and the session-singleton lifecycle constraint.

### Notes

- Memory is strictly opt-in. A project without `foundry/memory/` behaves exactly as before; the prompt-extras injection no-ops, and cycles that don't declare a `memory:` block see no vocabulary and no memory tools in their prompt.
- On store open, orphan relations left behind by drops/renames are reconciled automatically (`::relations` filtered to `^(ent|edge)_[^:]+$`, HNSW indices dropped before `::remove`).
- Memory prompt injection is wrapped in a swallow-errors guard: if memory is misconfigured or drifted, dispatch still succeeds with no vocabulary block rather than failing the cycle.

## 2.3.2 — 2026-04-21

### Changed

- Config-modifying skills (`add-flow`, `add-cycle`, `add-law`, `add-appraiser`, `add-artefact-type`) now refuse to run on a work branch. They require the current branch to not start with `work/`, directing the user to complete or discard the in-flight flow before changing foundry configuration. Structural changes belong on the base branch, not alongside transient flow state.

### Removed

- Historical planning docs (`docs/plans/`, `docs/specs/`, `docs/superpowers/`) and `HARDEN.md`. All described features that shipped in v2.2.0–v2.3.1; git history preserves the full record.

## 2.3.1 — 2026-04-20

### Changed

- `flow` skill: any cycle in a flow may now be the starting cycle (previously limited to `starting-cycles`). The list becomes a hint for ambiguous requests. A cycle whose `inputs` contract cannot be satisfied from files on disk is not eligible to start.
- `flow` skill: between-cycles logic no longer implies any carry-over ceremony. The next cycle's forge discovers the previous cycle's output via filesystem scan against its input types' `file-patterns`.
- `forge` skill: input discovery now explicitly uses filesystem scan against each input type's `file-patterns`, with the goal guiding which candidates are relevant.
- `forge` skill: the write invariant is restated accurately — forge may only write to files matching the output artefact type's `file-patterns` (plus the tool-managed files). All other files on disk are read-only. The previous "inputs are read-only" framing was a special case of this rule.

### Notes

- No tool, schema, or enforcement changes. Existing flows continue to work. `sort.js`'s `checkModifiedFiles` already enforces the write invariant.

## 2.3.0 — 2026-04-20

### Breaking

- **LLM orchestration replaced with deterministic `foundry_orchestrate` tool.** The `cycle` and `sort` skills are removed; replaced by a single thin `orchestrate` skill that drives a 3-line loop.
- **Six tools deregistered** from the plugin (still exist as internal imports for tests): `foundry_sort`, `foundry_history_append`, `foundry_stage_finalize`, `foundry_git_commit`, `foundry_workfile_configure_from_cycle`, `foundry_workfile_set`.
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
