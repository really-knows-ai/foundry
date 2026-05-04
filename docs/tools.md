# Foundry Public Tool Reference

Generated from the v3.0.x public plugin API. The authoritative tool set is
enforced by `tests/plugin/tool-registration.test.js` — if that snapshot
drifts, this doc must be updated. Total: **63 tools**.

All tools accept arguments as a JSON object and return JSON-stringified
results. Errors are returned as a stringified `{error: "..."}` object (not
thrown) unless noted otherwise. Some destructive tools require an explicit
`confirm: true` flag.

For a higher-level explanation of stages, cycles, WORK.md, and the feedback
state machine, see [`docs/concepts.md`](./concepts.md) and
[`docs/work-spec.md`](./work-spec.md).

## Conventions

- **Active stage**: many tools require `foundry_stage_begin` to have been
  called and not yet ended. The active stage is recorded in
  `.foundry/active-stage.json`. Tools annotated "requires active stage"
  return an error if called outside one. Tools annotated "requires no
  active stage" do the opposite.
- **Stage base**: stage aliases have the form `<base>:<cycle>` (e.g.
  `forge:create-haiku`). Some tools restrict to a particular base
  (`forge`, `quench`, `appraise`, `human-appraise`, `assay`).
- **Failed flow**: when `WORK.md` frontmatter has `status: failed`:
  - Mutating families refuse to run and return an error prefixed with the tool name. This covers work-branch FS writers, memory writers and mutating memory admin tools (`memory_put`, `memory_reset`, `memory_drop_*`, `memory_rename_*`, `memory_create_*`, `memory_init`, `memory_vacuum`, `memory_change_embedding_model`), and the config-creator family (`foundry_config_create_artefact_type`, `foundry_config_create_law`, `foundry_config_create_appraiser`, `foundry_config_create_flow`, `foundry_config_create_cycle`).
  - Read-only diagnostics remain callable: `foundry_workfile_get`; list tools such as `foundry_artefacts_list`, `foundry_feedback_list`, `foundry_history_list`, and `foundry_memory_list`; every `foundry_config_*` read tool; every `foundry_config_validate_*` schema validator; every memory read tool (`_get`, `_neighbours`, `_query`, `_search`, `_dump`, `_validate`); and every `foundry_snapshot_*` tool.
  - `foundry_git_branch` and `foundry_git_finish` sit outside this guard so the caller can leave the failed branch. The escape hatch is `foundry_workfile_delete`.
- **Worktree context**: every tool reads `context.worktree` (the project
  root) and operates on `foundry/`, `WORK.md`, `WORK.feedback.yaml`,
  `WORK.history.yaml`, and `.foundry/` relative to it.
- **Memory permissions**: memory data tools consult the active cycle's
  `memory.read` / `memory.write` frontmatter (via
  `src/scripts/lib/memory/permissions.js`). Reads of disallowed types return
  empty results; writes return an `error`. When no cycle is active the
  call is unscoped (full access).
- **Branch requirements**: every mutating tool also enforces the branch-namespace split at call time (`src/scripts/lib/branch-guard.js`). The guard is applied per family, so per-tool blocks below do not repeat it:

  | Namespace | Applies to | Notes |
  |-----------|------------|-------|
  | `config/<description>` | `foundry_config_create_*` (5), `foundry_memory_create_entity_type`, `foundry_memory_create_edge_type`, `foundry_memory_rename_*`, `foundry_memory_drop_*`, `foundry_memory_reset`, `foundry_memory_init`, `foundry_memory_change_embedding_model`, `foundry_extractor_create` | Config and schema mutation only. |
  | `work/<flow>-<desc>` or `dry-run/<x>/<y>` | `foundry_orchestrate`, `foundry_stage_begin`, `foundry_stage_end`, `foundry_stage_retry`, `foundry_workfile_*`, `foundry_artefacts_*`, `foundry_feedback_*`, `foundry_assay_run`, `foundry_validate_run`, `foundry_memory_put`, `foundry_memory_relate`, `foundry_memory_unrelate` | Flow-data mutation only. |
  | Any branch | `foundry_workfile_get`, `foundry_artefacts_list`, `foundry_feedback_list`, `foundry_history_list`, `foundry_config_*` read tools, `foundry_config_validate_*`, `foundry_appraisers_select`, `foundry_memory_get`, `foundry_memory_list`, `foundry_memory_neighbours`, `foundry_memory_query`, `foundry_memory_search`, `foundry_memory_dump`, `foundry_memory_validate`, `foundry_snapshot_*` | No branch guard and no failed-flow guard. |
  | Self-classifying | `foundry_git_branch`, `foundry_git_finish` | Each tool checks its own branch rules. Leaving the failed branch is the recovery path. |

  Off-namespace calls return a structured refusal envelope naming the required namespace and the current branch.

## Tool index

**Lifecycle**
- [`foundry_stage_begin`](#foundry_stage_begin)
- [`foundry_stage_end`](#foundry_stage_end)
- [`foundry_stage_retry`](#foundry_stage_retry)
- [`foundry_orchestrate`](#foundry_orchestrate)
- [`foundry_workfile_create`](#foundry_workfile_create)
- [`foundry_workfile_get`](#foundry_workfile_get)
- [`foundry_workfile_delete`](#foundry_workfile_delete)

**Artefacts**
- [`foundry_artefacts_list`](#foundry_artefacts_list)
- [`foundry_artefacts_set_status`](#foundry_artefacts_set_status)

**Feedback**
- [`foundry_feedback_add`](#foundry_feedback_add)
- [`foundry_feedback_action`](#foundry_feedback_action)
- [`foundry_feedback_wontfix`](#foundry_feedback_wontfix)
- [`foundry_feedback_resolve`](#foundry_feedback_resolve)
- [`foundry_feedback_list`](#foundry_feedback_list)

**History**
- [`foundry_history_list`](#foundry_history_list)

**Config (read-only)**
- [`foundry_config_cycle`](#foundry_config_cycle)
- [`foundry_config_artefact_type`](#foundry_config_artefact_type)
- [`foundry_config_laws`](#foundry_config_laws)
- [`foundry_config_validation`](#foundry_config_validation)
- [`foundry_config_appraisers`](#foundry_config_appraisers)
- [`foundry_config_flow`](#foundry_config_flow)

**Config — Schema validation**
- [`foundry_config_validate_artefact_type`](#foundry_config_validate_artefact_type)
- [`foundry_config_validate_law`](#foundry_config_validate_law)
- [`foundry_config_validate_appraiser`](#foundry_config_validate_appraiser)
- [`foundry_config_validate_flow`](#foundry_config_validate_flow)
- [`foundry_config_validate_cycle`](#foundry_config_validate_cycle)

**Config — Schema mutation**
- [`foundry_config_create_artefact_type`](#foundry_config_create_artefact_type)
- [`foundry_config_create_law`](#foundry_config_create_law)
- [`foundry_config_create_appraiser`](#foundry_config_create_appraiser)
- [`foundry_config_create_flow`](#foundry_config_create_flow)
- [`foundry_config_create_cycle`](#foundry_config_create_cycle)

**Snapshots**
- [`foundry_snapshot_list`](#foundry_snapshot_list)
- [`foundry_snapshot_show`](#foundry_snapshot_show)
- [`foundry_snapshot_delete`](#foundry_snapshot_delete)
- [`foundry_snapshot_prune`](#foundry_snapshot_prune)

**Validation**
- [`foundry_validate_run`](#foundry_validate_run)

**Appraisers**
- [`foundry_appraisers_select`](#foundry_appraisers_select)

**Assay**
- [`foundry_assay_run`](#foundry_assay_run)

**Git**
- [`foundry_git_branch`](#foundry_git_branch)
- [`foundry_git_finish`](#foundry_git_finish)

**Attestation**
- [`foundry_attestation_show`](#foundry_attestation_show)
- [`foundry_attestation_verify`](#foundry_attestation_verify)

**Memory — Data**
- [`foundry_memory_put`](#foundry_memory_put)
- [`foundry_memory_relate`](#foundry_memory_relate)
- [`foundry_memory_unrelate`](#foundry_memory_unrelate)
- [`foundry_memory_get`](#foundry_memory_get)
- [`foundry_memory_list`](#foundry_memory_list)
- [`foundry_memory_neighbours`](#foundry_memory_neighbours)
- [`foundry_memory_query`](#foundry_memory_query)
- [`foundry_memory_search`](#foundry_memory_search)

**Memory — Admin**
- [`foundry_memory_init`](#foundry_memory_init)
- [`foundry_memory_validate`](#foundry_memory_validate)
- [`foundry_memory_dump`](#foundry_memory_dump)
- [`foundry_memory_vacuum`](#foundry_memory_vacuum)
- [`foundry_memory_reset`](#foundry_memory_reset)
- [`foundry_memory_change_embedding_model`](#foundry_memory_change_embedding_model)
- [`foundry_memory_create_entity_type`](#foundry_memory_create_entity_type)
- [`foundry_memory_create_edge_type`](#foundry_memory_create_edge_type)
- [`foundry_memory_rename_entity_type`](#foundry_memory_rename_entity_type)
- [`foundry_memory_rename_edge_type`](#foundry_memory_rename_edge_type)
- [`foundry_memory_drop_entity_type`](#foundry_memory_drop_entity_type)
- [`foundry_memory_drop_edge_type`](#foundry_memory_drop_edge_type)
- [`foundry_extractor_create`](#foundry_extractor_create)

---

## Lifecycle

### `foundry_stage_begin`

> Open a subagent work stage; consumes a dispatch token from
> `foundry_orchestrate`.

**Args:**
- `stage` (string, required): Stage alias, e.g. `forge:create-haiku`.
- `cycle` (string, required): Cycle name.
- `token` (string, required): Token issued by `foundry_orchestrate` in its
  `dispatch` action payload.

**Returns:** `{ ok: true, active: { cycle, stage, tokenHash, baseSha,
startedAt } }` on success.

**Stage requirements:** requires no active stage.

**Failure modes:**
- Flow is failed → `foundry_stage_begin: <reason>`.
- Active stage already exists → `... requires no active stage; current: <stage>`.
- Token signature/expiry invalid → `... token <reason>`.
- Token payload `route`/`cycle` does not match args → `... token payload mismatch (...)`.
- `git rev-parse HEAD` fails (no commits) → `... git rev-parse HEAD failed (no commits?)`.
- Token nonce already consumed or unknown → `... nonce not pending or already consumed`.

**Side effects:** writes `.foundry/active-stage.json`; consumes the
single-use nonce from the in-memory pending store.

### `foundry_stage_end`

> Close the active subagent work stage; preserves `baseSha` for finalize.

**Args:**
- `summary` (string, required): Short summary of the work done.

**Returns:** `{ ok: true, summary }` on success. On post-stage memory sync
failure: `{ error, flow_failed: true }` and the workfile is marked
failed.

**Stage requirements:** requires active stage.

**Failure modes:**
- No active stage → `foundry_stage_end requires active stage; current: none`.
- End-of-stage memory sync to NDJSON fails → returns `flow_failed: true`
  and marks `WORK.md` failed (data-loss guard).

**Side effects:** writes `.foundry/last-stage.json`, clears
`.foundry/active-stage.json`, flushes any pending memory writes to
`foundry-memory/relations/<name>.ndjson`. May mark `WORK.md` as
`status: failed` on sync failure.

### `foundry_stage_retry`

> Retry a failed stage by discarding uncommitted memory changes and
> clearing the failed state. Requires clean git working tree.

**Args:** none.

**Returns:** `{ ok: true, message }` on success. `{ ok: false, error }`
otherwise.

**Stage requirements:** requires no active stage. Requires flow to be
in failed state.

**Preconditions:**
- Flow must have `status: failed`.
- No active stage exists.
- Git working tree must be clean (no uncommitted changes).

**Failure modes:**
- Flow not failed → `foundry_stage_retry requires failed flow; current status is not failed`.
- Active stage exists → `foundry_stage_retry requires no active stage; call foundry_stage_end first`.
- Dirty working tree → `foundry_stage_retry requires clean git working tree; commit or stash changes first`.
- Git status check fails → error with git failure message.

**Side effects:** invalidates the memory store singleton (discards
uncommitted changes, resets to on-disk NDJSON state), clears
`.foundry/last-stage.json`, clears the failed status from `WORK.md`
frontmatter.

### `foundry_orchestrate`

> Run the next step of the current cycle. Call with no args on first
> invocation; call with `lastResult={ok, error?}` after a dispatch or
> human-appraise completes. Returns `{action, ...}` describing what the
> caller should do next.

**Args:**
- `lastResult` (object, optional): `{ ok: boolean, error?: string }` — outcome of the
  prior action.
- `cycleDef` (string, optional): Test-mode override path to a cycle file.

**Returns:** one of:
- `{ action: "dispatch", stage, cycle, prompt, token, ... }` — caller
  should dispatch a subagent. The `prompt` field is augmented with cycle
  memory context (entity types, edge types, extractor briefs) when configured.
- `{ action: "human_appraise", ... }` — surface to the user.
- `{ action: "done", ... }` — cycle complete.
- `{ action: "blocked", ... }` — cycle stalled.
- `{ action: "violation", details, recoverable, affected_files }` —
  policy violation; `recoverable:false` if `runOrchestrate` threw.

**Stage requirements:** none (drives the lifecycle itself). Refuses on
failed flow.

**Failure modes:**
- Flow is failed → `foundry_orchestrate: <reason>`.
- `runOrchestrate` throws → returns a `violation` action carrying the
  message.

**Side effects:** mints/persists dispatch tokens (in-memory pending
store); commits via `commitWithPolicy` when finalising stages (refuses
on unexpected files); appends WORK.md artefact rows when finalising.

### `foundry_workfile_create`

> Create `WORK.md` with frontmatter and goal.

**Args:**
- `flow` (string, required).
- `cycle` (string, required).
- `goal` (string, required): Goal text.
- `stages` (string[], optional): Ordered stage names; enriched with cycle
  qualifiers.
- `maxIterations` (number, optional).
- `models` (string, optional): JSON-encoded per-stage model overrides,
  e.g. `'{"forge":"openai/gpt-4o"}'`.

**Returns:** `{ ok: true }`.

**Stage requirements:** requires no active stage. Refuses on failed
flow.

**Failure modes:**
- `WORK.md` already exists → `... requires no WORK.md; current: exists`.

**Side effects:** writes `WORK.md`.

### `foundry_workfile_get`

> Read `WORK.md` and return frontmatter + goal.

**Args:** none.

**Returns:** `{ ...frontmatter, goal }`. Returns `{ error: "WORK.md not
found" }` if missing. Note: frontmatter keys like `error` could collide with
the tool's own error reporting.

**Stage requirements:** none. **Always callable, even on a failed flow.**

**Side effects:** none.

### `foundry_workfile_delete`

> Delete `WORK.md`, `WORK.history.yaml`, and `WORK.feedback.yaml`
> (requires `confirm:true`).

**Args:**
- `confirm` (boolean, required): Must be `true`.

**Returns:** `{ ok: true }`.

**Stage requirements:** requires no active stage. **Callable on a failed
flow** (escape hatch).

**Failure modes:**
- `confirm !== true` → `foundry_workfile_delete requires {confirm: true}`.
- Active stage exists → `... requires no active stage; current: <stage>`.

**Side effects:** deletes the three workfiles if present. **Destructive.**

---

## Artefacts

### `foundry_artefacts_list`

> List artefacts from the WORK.md table. Optional `cycle` filter —
> callers should always pass the current cycle to avoid stale rows.

**Args:**
- `cycle` (string, optional).

**Returns:** array of `{file, type, cycle, status, ...}` rows. `{error:
"WORK.md not found"}` if missing.

**Stage requirements:** none.

**Side effects:** none.

### `foundry_artefacts_set_status`

> Update the status of an artefact in `WORK.md` (`done` | `blocked`
> only).

**Args:**
- `file` (string, required): Artefact file path.
- `status` (string, required): New status (`done` | `blocked`).

**Returns:** `{ ok: true }`. On invalid input: `{ error: <message> }`.

**Stage requirements:** requires no active stage. Refuses on failed
flow.

**Failure modes:**
- Invalid status, unknown file, malformed table → error from
  `setArtefactStatus`.

**Side effects:** rewrites `WORK.md`.

---

## Feedback

All feedback tools (except `foundry_feedback_list`) require an active
stage and refuse on failed flow. The state machine is described in
[`docs/work-spec.md`](./work-spec.md).

### `foundry_feedback_add`

> Add a feedback item to `WORK.feedback.yaml`.

**Args:**
- `file` (string, required): Artefact file path.
- `text` (string, required): Feedback text.
- `tag` (string, required): Tag for the feedback item.

**Returns:** `{ ok: true, id, deduped }` (where `deduped` is true if an
existing equivalent item was returned). `{ error: ... }` otherwise.

**Stage requirements:** requires active stage. Tag is gated by stage
base:
- `forge` → forbidden (forge stages do not add feedback).
- `quench` → tag must be exactly `validation`.
- `appraise` → tag must start with `law:`.
- `human-appraise` → tag must be exactly `human`.
- `assay` → forbidden. Extractor failures mark the workfile failed and end
  the cycle without filing feedback.

**Failure modes:** see above tag gates; `WORK.md` missing or no `cycle`
in frontmatter.

**Side effects:** writes `WORK.feedback.yaml`.

### `foundry_feedback_action`

> Mark a feedback item as actioned (forge stages only).

**Args:** `id` (string, required) — feedback ULID.

**Returns:** `{ ok: true }` or `{ error: ... }`.

**Stage requirements:** requires active **forge** stage.

**Failure modes:** invalid transition for the item's current state.

**Side effects:** mutates `WORK.feedback.yaml`.

### `foundry_feedback_wontfix`

> Mark a feedback item as wont-fix with reason (forge stages only).

**Args:**
- `id` (string, required).
- `reason` (string, required).

**Returns:** `{ ok: true }` or `{ error: ... }`.

**Stage requirements:** requires active **forge** stage.

**Side effects:** mutates `WORK.feedback.yaml`.

### `foundry_feedback_resolve`

> Resolve a feedback item (`approved` or `rejected`).

**Args:**
- `id` (string, required).
- `resolution` (`"approved"` | `"rejected"`, required). The public
  surface uses `approved`; internally this becomes the state machine's
  `resolved`.
- `reason` (string, optional): Required when `rejected`, or for deadlock
  override.

**Returns:** `{ ok: true }` or `{ error: ... }`.

**Stage requirements:** requires active **quench**, **appraise**, or
**human-appraise** stage.

**Side effects:** mutates `WORK.feedback.yaml`.

### `foundry_feedback_list`

> List feedback items, optionally filtered by `file`.

**Args:** `file` (string, optional).

**Returns:** array of `{ id, file, tag, text, source, state, depth,
reason? }`. `{ error: "... WORK.md cycle not found" }` if `WORK.md` is
missing.

**Stage requirements:** none.

**Side effects:** none.

---

## History

### `foundry_history_list`

> List history entries for a cycle.

**Args:** `cycle` (string, required).

**Returns:** array of history entries (per `loadHistory`).

**Stage requirements:** none.

**Side effects:** none.

---

## Config (read-only definition lookups)

These tools throw on missing/malformed definitions; the thrown error
propagates as a tool error without `{error: ...}` wrapping (no try/catch
in the registration).

### `foundry_config_cycle`

> Get a cycle definition from foundry config.

**Args:** `cycleId` (string, required).

**Returns:** `{ frontmatter, body, ... }` — full parsed cycle definition.

### `foundry_config_artefact_type`

> Get an artefact type definition.

**Args:** `typeId` (string, required).

**Returns:** parsed artefact-type document.

### `foundry_config_laws`

> Get laws, optionally filtered by artefact type.

**Args:** `typeId` (string, optional).

**Returns:** array of law definitions. Without `typeId`, only global
laws under `foundry/laws/` are returned. With `typeId`, type-specific
laws from `foundry/artefacts/<typeId>/laws.md` are appended after the
global set.

### `foundry_config_validation`

> Get validation commands for an artefact type.

**Args:** `typeId` (string, required).

**Returns:** array of `{ id, command, failureMeans, ... }`.

### `foundry_config_appraisers`

> List all appraisers.

**Args:** none.

**Returns:** array of appraiser definitions.

### `foundry_config_flow`

> Get a flow definition.

**Args:** `flowId` (string, required).

**Returns:** parsed flow document.

---

## Validation

### `foundry_validate_run`

> Run validation commands for an artefact type against a file.

**Args:**
- `typeId` (string, required).
- `file` (string, required): Path substituted into `{file}` placeholders
  in each command (POSIX shell-quoted to neutralise spaces and
  metacharacters).

**Returns:** array of `{ id, command, passed, output, failureMeans? }`.
`{ error: "No validation defined for type: ..." }` if the type has no
commands.

**Stage requirements:** none (callable outside any stage; intended to be
invoked by quench, but not enforced). Refused on a failed flow.

**Side effects:** spawns subprocesses via `execSync` in the worktree —
external commands may have arbitrary side effects, which is why the tool
is gated on failed flow.

---

## Appraisers

### `foundry_appraisers_select`

> Select appraisers for an artefact type.

**Args:**
- `typeId` (string, required).
- `count` (number, optional).

**Returns:** array of selected appraiser objects.

**Stage requirements:** none. Callable on flow branches; refused on failed
flow.

**Side effects:** none. This tool is treated as a flow-tier mutation for
branch and failed-flow guards.

---

## Assay

### `foundry_assay_run`

> Run extractors to populate flow memory. Only callable during an active
> assay stage. Aborts on the first extractor failure; on abort, marks
> the workfile failed.

**Args:**
- `cycle` (string, required).
- `extractors` (string[], required): Extractor names, executed in order.

**Returns:** the `runAssay` result object — on success it includes the
list of writes; on failure it includes `failedExtractor`, `reason`, and
optional `stderr`. On post-run memory sync failure: `{ error,
flow_failed: true }`.

**Stage requirements:** requires active **assay** stage matching
`cycle`. Refuses on failed flow.

**Failure modes:**
- Extractor exits non-zero, exceeds timeout, emits invalid JSONL → assay
  result has `ok:false` and the workfile is marked failed.
- Post-run sync to NDJSON fails → workfile marked failed.

**Side effects:** spawns extractor subprocesses, mutates Cozo store and
NDJSON files, may mark `WORK.md` failed.

---

## Git

### `foundry_git_branch`

> Create and checkout a branch in one of three namespaces.

**Args:**
- `kind` (string, required): one of `"config"`, `"work"`, `"dry-run"`.
- `description` (string, required for all kinds): branch description
  suffix.
- `flowId` (string, required for `kind: "work"` and `kind: "dry-run"`;
  invalid for `kind: "config"`).

**Per-kind dispatch:**

| `kind`     | required args                  | required starting branch       | resulting branch                                |
| ---------- | ------------------------------ | ------------------------------ | ----------------------------------------------- |
| `config`   | `description`                  | not `config/*`, not `work/*`   | `config/<desc-slug>`                            |
| `work`     | `flowId`, `description`        | not `config/*`, not `work/*`   | `work/<flow-slug>-<desc-slug>`                  |
| `dry-run`  | `flowId`, `description`        | `config/<parent>`              | `dry-run/<parent>/<flow-slug>-<desc-slug>`      |

**Returns:** `{ ok: true, branch }`.

**Stage requirements:** requires no active stage. Not gated on failed
flow — callable while `WORK.md` has `status: failed` so the caller
can branch away to recover.

**Failure modes:**
- Missing/invalid `kind` → typed error.
- Wrong starting branch for the requested kind → typed error.
- `flowId` supplied with `kind: "config"`, or omitted with the other
  kinds → typed error.
- Active stage exists → `... requires no active stage; current: <stage>`.
- `git checkout -b` failure (e.g. branch already exists, dirty state)
  returns `{ error: "foundry_git_branch: failed to create branch '<branch>'. <git stderr>" }`.

**Side effects:** runs `git checkout -b` in the worktree. For
`kind: "dry-run"`, also truncates `.foundry/trace/<branch-slug>.jsonl`.

### `foundry_git_finish`

> Three-mode dispatch keyed on the current branch prefix. Cleans up,
> integrates, or snapshots — depending on which namespace the branch
> belongs to (requires `confirm:true`).

**Args:**
- `message` (string, required): commit / snapshot message.
- `baseBranch` (string, optional): default `main`. Invalid for
  `dry-run/*/*` (the parent is encoded in the branch name).
- `confirm` (boolean, optional): must be `true` to perform destructive
  operations; otherwise returns a plan.

**Per-mode dispatch:**

| current branch       | mode      | what happens                                                                                                                              |
| -------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `work/<x>`                 | work      | commits `WORK.*` cleanup on the work branch, preserves the branch as `archive/work/<x>-<hash>`, squash-merges to `baseBranch`, creates a signed commit whose message embeds the canonical Foundry attestation block. |
| `config/<x>`               | config    | squash-merges to `baseBranch`, force-deletes the config branch. No WORK cleanup.                                                          |
| `dry-run/<x>/<y>`          | dry-run   | writes `.snapshots/<run-id>/{README.md, work/WORK*, diff.patch, trace.jsonl}` on the parent `config/<x>` working tree; force-deletes the dry-run branch. No merge, no commit. |
| base branch (`main` by default) | noop | `{ ok: true, noop: true, ... }`.                                                                                                           |
| anything else              | refused   | `{ ok: false, error: "... nothing to finish ..." }`.                                                                                      |

**Returns:**
- Plan (when `confirm` is not true):
  - Work mode: `{ ok: false, error: "... requires {confirm: true}...",
    planned: { workBranch, baseBranch, filesToDelete, action, commitMessage } }`
    where `action` describes the archive-branch, cleanup, squash-merge, and
    attested-commit sequence.
  - Config mode: `{ ok: false, error: "... requires {confirm: true}...",
    planned: { workBranch, baseBranch, filesToDelete, action, commitMessage } }`
    where `action` describes checkout, squash-merge, commit, and branch deletion.
  - Dry-run mode: `{ ok: false, error: "... requires {confirm: true}...",
    planned: { branch, action, snapshotPath } }` where `action` is
    `"snapshot + discard (dry-run finish)"`.
- Work success: `{ ok: true, hash, branch, archiveBranch,
  archiveTipSha }` — `hash` is the final squash commit on the base
  branch, `archiveBranch` is `archive/work/<x>-<short-hash>`,
  `archiveTipSha` is the tip of the preserved work branch.
- Config success: `{ ok: true, hash, branch }`.
- Dry-run success: `{ ok: true, runId, snapshotPath, branch }`.
- Dirty worktree (work / config): `{ ok: false, error, dirty: [...] }`.
- Conflict (work / config): `{ ok: false, error: "... squash merge
  failed ..." }`. Worktree reset and checked back out to the source
  branch.
- Refused (not on expected branch): `{ ok: false, error: "... nothing
  to finish ..." }`.

**Stage requirements:** requires no active stage. Not gated on failed
flow — callable while `WORK.md` has `status: failed`, including the
`work` mode whose cleanup deletes the failed `WORK.md` outright.

**Side effects (when confirmed):** see per-mode dispatch above.
**Destructive in all three modes.**

---

## Attestation

### `foundry_attestation_show`

> Show the parsed Foundry attestation block for a git ref.

**Args:**
- `ref` (string, optional): Git ref, default `HEAD`.

**Returns:** `{ ok: true, human_summary, payload }` where `human_summary`
is the commit subject line and `payload` is the parsed JSON attestation
object. `{ error: ... }` when no attestation block is found.

**Stage requirements:** none. Callable on any branch.

**Failure modes:**
- Commit message has no attestation block → `{ error: "attestation
  block not found" }`.
- Invalid JSON in attestation block → parse error.

**Side effects:** none (read-only).

### `foundry_attestation_verify`

> Verify the signed Foundry attestation block on a git ref.

**Args:**
- `ref` (string, optional): Git ref, default `HEAD`.

**Returns:** `{ ok: true, status: "verified", schema, payload }` on
success. `{ error: ... }` when verification fails.

**Stage requirements:** none. Callable on any branch.

**Failure modes:**
- `git verify-commit` fails (commit not signed or signature invalid) →
  returns git error.
- Commit message has no attestation block → `{ error: "attestation
  block not found" }`.
- Invalid JSON in attestation block → parse error.

**Side effects:** none (read-only).

---

## Config — Schema mutation

These five tools each create one named config artefact and produce a
single git commit on the current `config/*` branch. All five refuse
off `config/*` and refuse on failed flow. Each is paired with a
read-only `_validate_*` form (next section) that runs the same schema
checks without writing.

Common args across all five: `name` (string), `body` (string,
markdown). `foundry_config_create_law` also takes a `target` argument
described below. Common returns: `{ ok: true, path, sha }` on success;
`{ ok: false, errors: [...] }` on validation failure;
`{ error, affected_files: [...] }` on commit-policy refusal (the
worktree was dirty with files outside `foundry/**`). Updates to
existing files are not exposed as MCP tools — operators edit by hand on
the current `config/*` branch.

### `foundry_config_create_artefact_type`

> Create a new artefact-type definition under
> `foundry/artefacts/<typeId>/`.

**Args:**
- `name` (string, required): typeId (kebab-case slug).
- `body` (string, required): markdown body with frontmatter
  (`file-patterns`, optional `description`, etc.).

**Returns:** `{ ok: true, path, sha }` on success;
`{ ok: false, errors: [...] }` on schema failure;
`{ error, affected_files }` on commit-policy refusal.

**Stage requirements:** none (no active stage); requires a
`config/*` branch.

**Failure modes:**
- Off `config/*` branch → branch-guard refusal envelope.
- Failed flow → tool-name-prefixed error.
- Body fails artefact-type schema (missing `file-patterns`, glob
  overlap with an existing type, …) → `{ ok: false, errors: [...] }`.
- Target file already exists → `{ ok: false, errors: ["… already
  exists; updates are not supported in 3.0.0 — edit by hand on this
  config/* branch"] }`.
- Worktree has changes outside `foundry/**` →
  `{ error, affected_files }`.

**Side effects:** writes the artefact-type file and commits it on the
current `config/*` branch.

### `foundry_config_create_law`

> Create a new law markdown file. Locator depends on `target.kind`.

**Args:**
- `name` (string, required): law id (kebab-case slug).
- `body` (string, required): markdown body.
- `target` (object, required):
  - `{ kind: "global", file }` — writes `foundry/laws/<file>`.
  - `{ kind: "type-specific", typeId }` — writes
    `foundry/artefacts/<typeId>/laws.md`.

**Returns / Stage requirements / Side effects:** as for
`foundry_config_create_artefact_type`.

**Failure modes:** as for `foundry_config_create_artefact_type`, plus
`target` shape errors:
- Missing or non-object `target` → `{ ok: false, errors: ["target
  argument is required (object with kind + locator)"] }`.
- Unknown `target.kind` → `{ ok: false, errors: ["unknown
  target.kind: <kind>"] }`.
- Missing `target.file` for `global` / missing `target.typeId` for
  `type-specific` → `{ ok: false, errors: [...] }`.

### `foundry_config_create_appraiser`

> Create a new appraiser personality at `foundry/appraisers/<id>.md`.

**Args:**
- `name` (string, required): appraiser id.
- `body` (string, required): markdown body with frontmatter
  (`description`, optional `model`, …).

**Returns / Stage requirements / Side effects:** as for
`foundry_config_create_artefact_type`.

**Failure modes:** as for `foundry_config_create_artefact_type`,
applied to the appraiser schema (missing description, semantic overlap
with an existing appraiser, …).

### `foundry_config_create_flow`

> Create a new flow definition under `foundry/flows/<flowId>/`.

**Args:**
- `name` (string, required): flowId (kebab-case slug).
- `body` (string, required): markdown body with frontmatter
  (`description`, `cycles: [...]`).

**Returns / Stage requirements / Side effects:** as for
`foundry_config_create_artefact_type`.

**Failure modes:** as for `foundry_config_create_artefact_type`,
applied to the flow schema.

### `foundry_config_create_cycle`

> Create a new cycle markdown file under
> `foundry/flows/<flowId>/cycles/<cycleId>.md`.

**Args:**
- `name` (string, required): cycleId (kebab-case slug).
- `body` (string, required): markdown body with frontmatter
  (`flowId`, `output`, optional `inputs`, `memory`, `models`, …).

**Returns / Stage requirements / Side effects:** as for
`foundry_config_create_artefact_type`.

**Failure modes:** as for `foundry_config_create_artefact_type`,
applied to the cycle schema (unknown `output` artefact-type, unknown
`memory.read` / `memory.write` types, unknown referenced appraisers,
…).

---

## Config — Schema validation

These five tools run the same schema checks as their `_create_*`
peers but write nothing and produce no commit. They have no branch
guard and do not refuse on failed flow — authors can iterate on a
draft body from any branch.

Common args: `name` (string), `body` (string).
`foundry_config_validate_law` does NOT require a `target` — schema
validation is target-agnostic.
Common returns: `{ ok: true }` on a valid body;
`{ ok: false, errors: [...] }` otherwise.

### `foundry_config_validate_artefact_type`

> Validate a candidate artefact-type body. Writes nothing.

**Args:** `name`, `body`.

**Returns:** `{ ok: true }` or `{ ok: false, errors: [...] }`.

**Stage requirements:** none. Callable on any branch.

**Failure modes:** schema validation only; never raises.

### `foundry_config_validate_law`

> Validate a candidate law body. Writes nothing.

**Args:** `name`, `body`. (No `target` — schema-only.)

**Returns / Stage requirements / Failure modes:** as for
`foundry_config_validate_artefact_type`.

### `foundry_config_validate_appraiser`

> Validate a candidate appraiser body. Writes nothing.

**Args / Returns / Stage requirements / Failure modes:** as for
`foundry_config_validate_artefact_type`, applied to the appraiser
schema.

### `foundry_config_validate_flow`

> Validate a candidate flow body. Writes nothing.

**Args / Returns / Stage requirements / Failure modes:** as for
`foundry_config_validate_artefact_type`, applied to the flow schema.

### `foundry_config_validate_cycle`

> Validate a candidate cycle body. Writes nothing.

**Args / Returns / Stage requirements / Failure modes:** as for
`foundry_config_validate_artefact_type`, applied to the cycle schema
(memory permissions, target validity, appraiser references).

---

## Snapshots

Forensic artefacts of dry-run finishes. Stored under `.snapshots/`
(gitignored). All four tools are foundational and callable on every
branch — they carry only `gitRepo` and `foundryRoot` guards.

### `foundry_snapshot_list`

> List all snapshots under `.snapshots/`, sorted by `startedAt`
> descending.

**Args:** none.

**Returns:** an array of metadata objects, one per snapshot:
`[{ runId, branch, parent, flow, goal, startedAt, finishedAt,
exitReason }]`. Incomplete snapshots include `error: "incomplete"`
and a `missing: [...]` array. Returns `[]` if `.snapshots/` does not
exist.

**Stage requirements:** none. Callable on any branch.

**Failure modes:** none under normal operation.

**Side effects:** none (read-only).

### `foundry_snapshot_show`

> Read a structured summary of one snapshot: README metadata, diff
> stats, trace stats.

**Args:**
- `runId` (string, required): the snapshot's run id (typically a
  ULID; matches the directory name under `.snapshots/`).

**Returns:** `{ runId, readme, metadata, diff, trace, missing }` —
- `readme`: raw README.md text (or `null` if missing).
- `metadata`: `{ branch, parent, flow, goal, startedAt, finishedAt,
  exitReason }` parsed from the README frontmatter.
- `diff`: `{ files, insertions, deletions }` summarising
  `diff.patch`.
- `trace`: `{ lineCount, firstTs, lastTs }` summarising
  `trace.jsonl`.
- `missing`: array of any of `["README.md", "work/WORK.md",
  "diff.patch", "trace.jsonl"]` that are absent.

When `runId` does not exist, returns
`{ runId, error: "unknown_runId", missing: [...all four files] }`.

**Stage requirements:** none. Callable on any branch.

**Failure modes:** unknown runId returns the error envelope above.

**Side effects:** none (read-only).

### `foundry_snapshot_delete`

> Delete one snapshot directory. Requires `confirm: true`.

**Args:**
- `runId` (string, required).
- `confirm` (boolean, optional): must be `true` to actually delete.

**Returns:**
- Plan (when `confirm` is not true):
  `{ ok: false, error: "foundry_snapshot_delete requires {confirm:
  true}", planned: { runId, path } }`.
- Success: `{ ok: true, runId, removed: ".snapshots/<runId>" }`.
- Unknown runId: `{ ok: false, error: "unknown runId '<id>'" }`.

**Stage requirements:** none. Callable on any branch.

**Failure modes:** unknown runId returns the error envelope above.

**Side effects (when confirmed):** removes the
`.snapshots/<runId>/` directory recursively.

### `foundry_snapshot_prune`

> Bulk-delete snapshots whose runId ULID is older than
> `olderThanDays`. Requires `confirm: true`.

**Args:**
- `olderThanDays` (number, required): positive integer; days
  threshold.
- `confirm` (boolean, optional): must be `true` to actually delete.

**Returns:**
- Plan (when `confirm` is not true):
  `{ ok: false, error: "foundry_snapshot_prune requires {confirm:
  true}", candidates: [...runIds...], cutoff }`.
- Success: `{ ok: true, removed: [...runIds...] }`.
- Bad input: `{ ok: false, error: "olderThanDays must be a positive
  integer" }`.

**Stage requirements:** none. Callable on any branch.

**Failure modes:** non-integer or non-positive `olderThanDays` is
rejected. Snapshots whose runId does not end in a valid 26-char ULID
are silently skipped (treated as untouchable).

**Side effects (when confirmed):** removes each candidate
`.snapshots/<runId>/` directory recursively.

---

## Memory — Data

All memory data tools share these traits unless noted:
- Resolve permissions from the active cycle's frontmatter via
  `withStore`. Reads of disallowed entity/edge types return empty
  results; writes return an `error` string.
- Refuse on failed flow (write tools only).
- Writes that occur outside an active cycle stage are immediately synced
  to NDJSON; in-cycle writes are deferred until `foundry_stage_end`.
- Embedding-aware tools (`put`, `search`) are no-ops or errors when
  embeddings are disabled in `foundry/memory/config.md`.

### `foundry_memory_put`

> Upsert an entity into flow memory. Value must be ≤4KB.

**Args:**
- `type` (string, required): Entity type (must be declared).
- `name` (string, required): Entity name (unique within type).
- `value` (string, required): Free-text intrinsic description (≤4KB).

**Returns:** `{ ok: true }` or `{ error: ... }`.

**Failure modes:** failed flow; cycle lacks write permission for the
type; value too large; type not declared.

**Side effects:** mutates Cozo store; embeds the value if a write
embedder is available; conditionally syncs NDJSON.

### `foundry_memory_relate`

> Upsert an edge between two entities.

**Args:** `from_type`, `from_name`, `edge_type`, `to_type`, `to_name`
(all string, required).

**Returns:** `{ ok: true }` or `{ error: ... }`.

**Failure modes:** failed flow; no write permission on `edge_type`; edge
endpoints do not match the edge type's source/target rules.

**Side effects:** mutates Cozo store; conditionally syncs NDJSON.

### `foundry_memory_unrelate`

> Delete an edge between two entities.

**Args:** same shape as `foundry_memory_relate`.

**Returns:** `{ ok: true }` or `{ error: ... }`.

**Failure modes:** failed flow; no write permission on `edge_type`.

**Side effects:** mutates Cozo store; conditionally syncs NDJSON.

### `foundry_memory_get`

> Fetch a single entity by composite key (`type`, `name`).

**Args:** `type`, `name` (string, required).

**Returns:** the entity object, or `null` (also returned when the type
is read-disallowed).

**Side effects:** none.

### `foundry_memory_list`

> List all entities of a given type.

**Args:** `type` (string, required).

**Returns:** array of entities. Empty array if the type is
read-disallowed.

**Side effects:** none.

### `foundry_memory_neighbours`

> Bounded graph traversal from an entity. Returns entities and edges
> within `depth` hops.

**Args:**
- `type`, `name` (string, required).
- `depth` (number, optional, default 1).
- `edge_types` (string[], optional): Restrict traversal to named edges;
  defaults to all known edges.

**Returns:** `{ entities, edges }`. Both arrays are post-filtered against
read permissions.

**Side effects:** none.

### `foundry_memory_query`

> Arbitrary read-only Cozo Datalog query. Rejects `:put`, `:rm`,
> `:create`, `::remove`. Returns `{headers, rows}`.

**Args:** `datalog` (string, required).

**Returns:** `{ headers, rows }` or `{ error: ... }`.

**Failure modes:** query references an `ent_*` or `edge_*` relation the
cycle cannot read; query contains a forbidden keyword.

**Side effects:** none.

### `foundry_memory_search`

> Semantic nearest-neighbour search over entity values. Requires
> embeddings enabled.

**Args:**
- `query_text` (string, required).
- `k` (number, optional, default 5).
- `type_filter` (string[], optional): default = all readable entity
  types.

**Returns:** array of search results (entity + similarity score). Errors
with `embeddings are disabled in memory config` if no embedder.

**Side effects:** issues an embedding API call.

---

## Memory — Admin

These tools manage the memory schema, on-disk layout, and bulk
operations. They use the worktree-scoped memory IO and (where
applicable) the singleton store. None of them check active-stage
state; they are intended to run as project-level admin actions.

### `foundry_memory_init`

> Scaffold `foundry/memory/` plus top-level `foundry-memory/relations/`:
> creates `entities/` and `edges/` dirs under `foundry/memory/`, creates
> `relations/` under top-level `foundry-memory/`, writes `config.md` and
> `schema.json`, appends `.gitignore` entries, and optionally probes the
> embedding provider. Fails if `foundry/memory/` or `foundry-memory/`
> already exists.

**Args:**
- `embeddings_enabled` (boolean, optional, default `true`).
- `probe` (boolean, optional, default `true`).

**Returns:** init report from `admInitMemory` or `{ error: ... }`.

**Side effects:** creates files and directories under `foundry/memory/`
and `foundry-memory/`; mutates `.gitignore`.

### `foundry_memory_validate`

> Run load-time and drift checks; returns a report.

**Args:** none.

**Returns:** validation report.

**Side effects:** none.

### `foundry_memory_dump`

> Human-readable snapshot of memory. Optional `type` + `name`.

**Args:** `type` (optional), `name` (optional), `depth` (optional).

**Returns:** JSON `{ dump }` where `dump` is the rendered human-readable
report string. On error, JSON `{error}`.

**Side effects:** none.

### `foundry_memory_vacuum`

> Compact the Cozo database.

**Args:** none.

**Returns:** vacuum report.

**Side effects:** rewrites the underlying Cozo storage.

### `foundry_memory_reset`

> Destructive. Purge all memory data (keeps type definitions). Requires
> `confirm: true`.

**Args:** `confirm` (boolean, required).

**Returns:** reset report or `{ error: ... }`.

**Side effects:** wipes all entity/edge rows from Cozo and NDJSON files.
**Destructive.**

### `foundry_memory_change_embedding_model`

> Swap the embedding model and re-embed all existing entities.

**Args:**
- `model` (string, required).
- `dimensions` (number, required).
- `baseURL` (string, optional).
- `apiKey` (string, optional).

**Returns:** reembed report or `{ error: ... }`.

**Failure modes:** probe fails; provider returns vectors whose
dimensionality mismatches `dimensions`.

**Side effects:** re-embeds every entity (issues many embedding API
calls); rewrites `foundry/memory/config.md`; updates schema.

### `foundry_memory_create_entity_type`

> Create a new entity type with a prose body brief.

**Args:** `name` (string, required), `body` (string, required).

**Returns:** create report or `{ error: ... }`.

**Side effects:** writes a new entity-type file and updates schema.

### `foundry_memory_create_edge_type`

> Create a new edge type.

**Args:**
- `name` (string, required).
- `sources` (`"any"` | string[], required).
- `targets` (`"any"` | string[], required).
- `body` (string, required).

**Returns:** create report or `{ error: ... }`.

**Side effects:** writes a new edge-type file and updates schema.

### `foundry_memory_rename_entity_type`

> Rename an entity type and cascade updates to edges and rows.

**Args:** `from`, `to` (string, required).

**Returns:** rename report or `{ error: ... }`.

**Side effects:** rewrites schema, NDJSON, edge-type references.

### `foundry_memory_rename_edge_type`

> Rename an edge type. (Does not touch row data.)

**Args:** `from`, `to` (string, required).

**Returns:** rename report or `{ error: ... }`.

**Side effects:** rewrites schema and edge metadata only.

### `foundry_memory_drop_entity_type`

> Destructive. Delete an entity type and cascade to affected edges.
> Without `confirm`, returns a preview of what would be deleted.

**Args:**
- `name` (string, required).
- `confirm` (boolean, optional). Must be `true` to actually drop.

**Returns:** preview report or drop report; `{ error: ... }` on
failure.

**Side effects (confirm:true only):** removes the entity-type file,
purges rows, drops dependent edges. **Destructive.**

### `foundry_memory_drop_edge_type`

> Destructive. Delete an edge type. Without `confirm`, returns a row
> count preview.

**Args:**
- `name` (string, required).
- `confirm` (boolean, optional).

**Returns:** preview or drop report; `{ error: ... }` on failure.

**Side effects (confirm:true only):** removes the edge-type file and
its rows. **Destructive.**

### `foundry_extractor_create`

> Create a new extractor definition under
> `foundry/memory/extractors/`.

**Args:**
- `name` (string, required).
- `command` (string, required): The CLI to execute.
- `memoryWrite` (string[], required): List of entity/edge types the
  extractor is allowed to write.
- `body` (string, required): Prose brief for the LLM.
- `timeout` (string, optional).

**Returns:** create report or `{ error: ... }`.

**Side effects:** writes a new extractor markdown file under
`foundry/memory/extractors/`.

---

## Design exceptions

1. **`foundry_orchestrate` returns `violation` instead of `{error}`
   when `runOrchestrate` throws.** Intentional: the `violation`
   action signals an unrecoverable orchestrator state to the caller's
   loop. Every other tool uses `{error}` for failure envelopes.
