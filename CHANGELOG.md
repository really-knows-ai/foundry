# Changelog

## [Unreleased]

## [3.0.0] - 2026-04-30

### Breaking changes

- **`foundry_git_branch` requires explicit `kind`.** The previous
  `{ flowId, description }` signature is removed. Callers must now pass
  `kind: 'config' | 'work' | 'dry-run'`. Per-kind requirements:
  `kind: 'config'` needs `description` and a non-`config/*`,
  non-`work/*` starting branch; `kind: 'work'` needs `flowId`,
  `description`, and a non-`config/*`, non-`work/*` starting branch;
  `kind: 'dry-run'` needs `flowId`, `description`, and the operator
  must already be on a `config/<x>` branch. `flowId` is invalid for
  `kind: 'config'`.
- **`foundry_git_finish` dispatches on the current branch prefix.**
  `work/<x>` retains existing semantics (squash-merge plus WORK
  cleanup); `config/<x>` is new (squash-merge, no WORK cleanup);
  `dry-run/<x>/<y>` writes a forensic snapshot under `.snapshots/`
  on the parent `config/<x>` working tree and force-deletes the
  dry-run branch (see "Dry-run finish writes a forensic snapshot"
  below). Any other branch is refused with "nothing to finish".
  `baseBranch` is rejected for dry-run finish (the parent config
  branch is encoded in the dry-run branch name).
- **Dry-run namespace is `dry-run/<parent>/<flowId>-<desc>`, not
  nested under `config/<parent>`.** Originally specified as
  `config/<x>/dry-run/<y>`; git refuses to coexist a parent ref with
  a child-prefixed ref, so the namespace is a flat sibling instead.
  No code outside this release ever shipped the nested form.
- **Schema/config mutation now requires a `config/*` branch.**
  Affected tools: `foundry_config_create_artefact_type`/`_law`/
  `_appraiser`/`_flow`/`_cycle` (new),
  `foundry_memory_create_entity_type`/`_create_edge_type`/
  `_rename_entity_type`/`_rename_edge_type`/`_drop_entity_type`/
  `_drop_edge_type`, `foundry_extractor_create`, `foundry_memory_init`,
  `foundry_memory_reset`, `foundry_memory_change_embedding_model`. All
  refuse on any branch other than `config/<description>`.
- **Flow-data mutation now requires a `work/*` or `dry-run/*/*`
  branch.** Affected tools: `foundry_orchestrate`,
  `foundry_workfile_create`/`_delete`, `foundry_artefacts_set_status`,
  `foundry_feedback_*` (mutating variants), `foundry_assay_run`,
  `foundry_validate_run`, `foundry_appraisers_select`,
  `foundry_stage_begin`/`_end`/`_retry`, `foundry_memory_put`/`_relate`/
  `_unrelate`.
- **Dry-run finish writes a forensic snapshot.** `foundry_git_finish`
  on a `dry-run/<x>/<y>` branch now writes
  `.snapshots/<run-id>/` on the parent `config/<x>` working tree
  (containing `README.md`, `work/WORK*`, `diff.patch`, `trace.jsonl`)
  and force-deletes the dry-run branch. No merge, no commit.
  `baseBranch` remains invalid for this case.
- **`.snapshots/` is a new gitignored top-level directory.** It
  appears in projects only after the first dry-run finish. Snapshots
  are local operator artefacts and never committed by foundry.
- **Four new `foundry_snapshot_*` tools.** `foundry_snapshot_list`,
  `_show`, `_delete`, `_prune` — for programmatic snapshot inspection
  and cleanup. Allowed on every branch (foundational guards only).
- **Verbose tool-call tracing on dry-run branches.** Every
  `foundry_*` tool call (except `foundry_orchestrate` which uses
  inline guards) appends a JSONL record to
  `.foundry/trace/<branch-slug>.jsonl` while on a dry-run branch.
  The trace is truncated when the dry-run branch is created and
  copied into the snapshot at finish.
- **New `dry-run` skill.** Documents the
  config-edit → dry-run → finish → inspect-snapshot loop.

- **Cycle frontmatter key renamed: `output:` → `output-type:`.** The cycle
  frontmatter key that names the produced artefact type is now
  `output-type:`. The orchestrator emits a typed migration diagnostic when
  it sees the old key. Migration: rename `output:` to `output-type:` in
  every `foundry/flows/*/cycles/*.md` file. (`b92f866`)
- **Artefact-type frontmatter `output:` is removed.** The field had zero
  runtime consumers — forge's write scope is governed by `file-patterns`,
  and `file-patterns` legitimately spans multiple directories so a single
  `output:` (or earlier-proposed `output-dir:`) cannot honestly describe
  artefact location. Migration: delete the `output:` line from every
  `foundry/artefact-types/*.md` definition. (`b92f866`, `88aad11`)
- **Assay extractor failure now marks the workfile failed.** When an
  extractor exits non-zero, parses incorrectly, violates permissions, or
  times out, `foundry_assay_run` calls `markWorkfileFailed` and returns
  `{flow_failed: true, error, …}`. It no longer files a `#validation`
  feedback item. Rationale: the failure cause (a project-authored script
  under `foundry/memory/extractors/`) lives outside any artefact's
  `file-patterns`, so forge has no way to act on assay-sourced feedback;
  the prior behaviour produced unsatisfiable state-machine items. Assay
  is also rejected as a `source` base in `foundry_feedback_add` and in
  `WORK.feedback.yaml`. Migration: any tooling that pattern-matched
  assay-sourced feedback items must instead detect `flow_failed: true`
  on the assay-run response. (`0e8b248`, `5dd69e8`, `08934a8`)
- **Memory NDJSON relations moved to `foundry-memory/relations/`.** The
  per-type row data (`<entity-type>.ndjson`, `<edge-type>.ndjson`) now
  lives at the top-level `foundry-memory/relations/` directory, sibling
  to `foundry/`. The rest of the memory tree (`config.md`,
  `schema.json`, `entities/`, `edges/`, `extractors/`, the gitignored
  `memory.db*` runtime files) stays under `foundry/memory/`. Rationale:
  the relations directory is large, frequently rewritten, and benefits
  from being separable from the human-authored config. Migration for
  projects with an existing populated memory store:
  `git mv foundry/memory/relations foundry-memory/relations` followed
  by `git commit`. Projects that have not yet populated memory can
  simply re-run `foundry_memory_init` on a fresh `config/*` branch.
  (`db5bfa3`)

### Added

- **Five `foundry_config_validate_*` and five `foundry_config_create_*`
  tools** for the artefact-type, law, appraiser, flow, and cycle config
  kinds. The five `add-*` config skills (`add-artefact-type`, `add-law`,
  `add-appraiser`, `add-flow`, `add-cycle`) now use these tools to
  create config entries. Each create produces one git commit per
  invocation. Updates (editing existing config files) are not yet
  exposed as MCP tools; operators edit by hand on the current
  `config/*` branch.
- **Failed-flow guard on `foundry_validate_run`.** Treats validation as
  state-changing for the purposes of the failed-flow guard; the tool now
  refuses on a failed workfile. (`1e58f8f`)
- **Failed-flow guard on 11 mutating memory admin tools.** `foundry_memory_init`,
  `_reset`, `_vacuum`, `_change_embedding_model`, `_create_entity_type`,
  `_create_edge_type`, `_rename_entity_type`, `_rename_edge_type`,
  `_drop_entity_type`, `_drop_edge_type`, and `foundry_extractor_create`
  now refuse on a failed workfile, matching the existing gating on
  `foundry_memory_put` / `_relate` / `_unrelate`. Read-only memory tools
  (`_dump`, `_validate`) remain callable. (`5a8f150`)
- **`foundry_attest` tool.** Verifies the current work cycle is complete (all required stages ran, no unresolved feedback, no blocked artefacts) and commits a signed ATTEST.md to the work branch. `foundry_git_finish` will not merge without this commit at HEAD. Takes `baseBranch` (optional, default `main`), `message` (required goal text), and `confirm` (optional, must be `true` to write). Returns `{ ok: true, diffSha, commitSha }` on success.

### Changed

- **`foundry_memory_dump` response wrapped in a JSON envelope.** The tool
  now returns `{ dump: "<text>" }`, matching the
  contract of every other plugin tool. Callers that previously consumed
  the raw string must read `.dump`. (`b9b4be1`)
- **`foundry_git_branch` errors now return a JSON envelope.**
  Failures are returned as `{ error: "<message>" }`, giving callers a
  structured alternative to raw `execFileSync` errors. (`4a01a9d`)

### Fixed

- **Stage-end memory sync failure is now a hard flow failure.** When
  `foundry_stage_end` cannot flush the in-memory memory DB to the NDJSON
  source of truth, WORK.md is marked `status: failed` with the sync error
  as `reason`, and every mutating tool (`stage_begin`, `orchestrate`,
  `assay_run`, `forge`/`quench`/`appraise`/`human-appraise` helpers,
  `memory_put` / `_relate` / `_unrelate`, `feedback_*`,
  `artefacts_set_status`, `workfile_create`) refuses until the cycle is
  abandoned via `foundry_workfile_delete`. Read-only tools and the
  escape hatches (`workfile_delete`, `git_finish`) remain callable.
  Skills driving each stage (`forge`, `quench`, `appraise`,
  `human-appraise`, `orchestrate`, `assay`, `flow`) were updated to check
  for the failed state at the top of their procedure and hand control
  back to the user. Previously, sync failures were silently swallowed
  (`console.error` + `{ok:true}`) and the Cozo DB was allowed to drift
  ahead of on-disk NDJSON.
- **`foundry_orchestrate` catches `requireNotFailed` violations.** Moved
  the failed-flow check inside the wrapper try/catch so a malformed
  frontmatter `YAMLException` collapses to `{action: 'violation'}` instead
  of bubbling out as an uncaught throw. (`fc3340e`)
- **Missing artefact-type definitions surface a typed finalize error.**
  The orchestrator's finalize bridge now returns
  `{ok: false, error: "missing_artefact_type: <type> (<reason>)"}` when
  `getArtefactType` fails, preserving the real error and avoiding a false
  `unexpected_files` violation. (`cd028eb`)

### Migration

In addition to the per-entry migration notes above, finish or discard any
in-flight cycle started under v2.6.x before upgrading: assay-sourced
feedback items in an existing `WORK.feedback.yaml` are no longer reachable
by the state machine. `foundry_workfile_delete` + re-flow is the supported
path.

## 2.7.0 — 2026-04-27

### Breaking changes

- **Cycle frontmatter key `output:` renamed to `output-type:`.** The
  orchestrator no longer reads `output:` on cycles. All cycle definitions
  in `foundry/cycles/<id>.md` must use `output-type:` to declare the
  artefact-type ID the cycle produces. Unmigrated cycles yield a hard
  violation pointing to the upgrade skill.

### Removed

- **Artefact-type `output:` field.** The `output:` directory path in
  artefact-type frontmatter (`foundry/artefacts/<id>/definition.md`) had
  no runtime consumer — forge's write scope is governed by `file-patterns`,
  not a directory hint. Stale `output:` entries are harmless (parsers
  ignore unknown keys) but should be deleted for hygiene.

### Migration

1. For every `foundry/cycles/<id>.md` whose frontmatter has `output: <type-id>`,
   rename the key to `output-type:`. The value is unchanged.
2. (Optional but recommended) For every `foundry/artefacts/<id>/definition.md`
   whose frontmatter has `output: <dir-path>`, delete the line.

## 2.6.0 — 2026-04-24

### Breaking changes

- `foundry_feedback_*` plugin tools switch from `{ file, index }` to `{ id }`
  addressing. `foundry_feedback_add` drops the `stageBase?` argument (source
  is read from the active stage). `foundry_feedback_list` response shape
  changes to `{ id, file, tag, text, source, state, depth, reason? }`.
- Feedback state machine expands from 4 states to 6 (`open | actioned |
  wont-fix | rejected | deadlocked | resolved`). `approved` is renamed to
  `resolved` internally; the public resolve tool still accepts
  `resolution: 'approved' | 'rejected'` as input.
- Deadlock detection becomes per-item, based on each item's own history depth.
  Items freshly added in the threshold-th iteration are never auto-deadlocked.

### Added

- `WORK.feedback.yaml` — first-class persistent record of every feedback
  item and its full transition history. Replaces the markdown `## Feedback`
  section in `WORK.md`.
- `open_feedback` field on every `WORK.history.yaml` entry.
- `seq` field on every `WORK.history.yaml` entry (tiebreaker for same-ms
  timestamps).
- Atomic writes via write-temp-then-rename for both `WORK.feedback.yaml`
  and `WORK.history.yaml`.
- Source-authorship rule: only the stage that created a feedback item can
  resolve/reject it. Human-appraise has universal override authority —
  it may transition any non-resolved item to any legal target state
  regardless of source (per spec §5.1 rule 5). In practice default sort
  routing only surfaces deadlocked items to human-appraise; a cycle-level
  mode flag to surface non-deadlocked items pre-sort is future work
  (spec §17).

### Removed

- `scripts/lib/feedback.js` (markdown parser + walker).
- `readLastSortRoute` from `scripts/lib/history.js` (dead code).
- `## Feedback` section from `createWorkfile` output.

### Fixed

- Deadlock detection no longer flags freshly-added open items (P1 [feedback M1]).
- `WORK.history.yaml` writes are now atomic (closes observed incompleteness
  in the wild).
- Malformed `WORK.history.yaml` on read now marks the flow failed via
  `markWorkfileFailed`, allowing graceful recovery.
- `appendEntry` enforces `route => stage === 'sort'`; violating calls throw.

### Migration

2.6.0 no longer reads or writes the `## Feedback` section. Pre-2.6.0
workfiles with in-flight feedback are not auto-migrated — finish or
discard in-flight cycles before upgrading. `foundry_workfile_delete`
+ re-flow is the supported path. Any `## Feedback` content left over
in a `WORK.md` on disk after the upgrade is inert text: neither parsed
nor deleted by 2.6.0 tools, and new writes go to `WORK.feedback.yaml`.
Users running `foundry_git_finish` post-upgrade on a stale cycle will
squash-merge the inert markdown unless they delete the workfile first.

## 2.5.0 — 2026-04-23

### Added

- **Assay stage** (`assay`) — deterministic pre-forge stage that runs project-authored extractor scripts to populate flow memory. Opt-in per cycle via `assay: { extractors: [...] }`. Iteration-0-only. Strict failure semantics: any non-zero exit, parse error, permission violation, or timeout aborts the cycle with `#validation` feedback. See [docs/concepts.md](docs/concepts.md#assay).
- **Extractor** authoring skill (`add-extractor`) and plugin tool (`foundry_extractor_create`). Extractors live at `foundry/memory/extractors/<name>.md` and emit JSONL rows typed by a `kind` discriminator.
- **`foundry_assay_run`** plugin tool for running extractors inside an active assay stage.

## 2.4.2 — 2026-04-23

### Changed

- README: new hero-style "Governed work for AI" section before the TOC — names the discipline problem, lists what developers get, speaks to teams under a "structural, not cultural" framing.
- README: old "Why Foundry?" section removed; the five bullets it contained now live under a renamed "Design principles" section (was "Design decisions"), prefaced with the governing rule (*trust the tool, not the LLM*) and extended with a new principle entry on human-in-the-loop gates.

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
- **Bug C — stale artefact validation.** `quench`, `appraise`, and `human-appraise` skills now pass the current cycle to `foundry_artefacts_list`, scoping validation to artefacts produced by the current cycle.
- **Bug D — overwriting WORK.md.** The `flow` skill now calls `foundry_workfile_get` before `foundry_workfile_create` and prompts the user to resume, discard, or abort when an existing workfile is detected. Silent overwrite is not offered; resume requires matching `flow` and `cycle`.
- **Bug E — missing micro-commits.** `foundry_sort` now returns `{route: 'violation'}` when `WORK.md`, `WORK.history.yaml`, or anything under `.foundry/` has uncommitted changes at the start of a sort call and history is non-empty. Structurally enforces the one-commit-per-stage contract that previously lived only in skill prose. First sort of a cycle is exempt (empty history).
- **Bug G — workfile setup boilerplate.** See `foundry_workfile_configure_from_cycle` above.

### Migration

Run the `upgrade-foundry` skill to migrate cycle definitions to the flat deadlock keys (Bug B). No other migration required — WORK.md, `.foundry/`, and feedback state are forward-compatible.

## 2.2.0 — 2026-04-19

### Breaking changes

- **`foundry_artefacts_add` removed.** Artefact registration now happens exclusively via `foundry_stage_finalize` after a forge stage closes.
- **`foundry_artefacts_set_status` no longer accepts `draft`.** Only `done` and `blocked` are valid. New artefacts are registered as `draft` automatically by `stage_finalize`.
- **Feedback / artefact / workfile mutation tools now enforce stage-lock preconditions.** Tools callable by subagents require an active stage matching their role; tools callable by the orchestrator require no active stage. Out-of-band calls return a structured error.
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
