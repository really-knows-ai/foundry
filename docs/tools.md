# Foundry Public Tool Reference

Generated from the v2.6.x public plugin API. The authoritative tool set is
enforced by `tests/plugin/tool-registration.test.js` — if that snapshot
drifts, this doc must be updated. Total: **46 tools**.

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
- **Failed flow**: when `WORK.md` frontmatter has `status: failed`, most
  tools refuse to run and return an error prefixed with the tool name.
  The escape hatches are `foundry_workfile_get` and
  `foundry_workfile_delete`.
- **Worktree context**: every tool reads `context.worktree` (the project
  root) and operates on `foundry/`, `WORK.md`, `WORK.feedback.yaml`,
  `WORK.history.yaml`, and `.foundry/` relative to it.
- **Memory permissions**: memory data tools consult the active cycle's
  `memory.read` / `memory.write` frontmatter (via
  `scripts/lib/memory/permissions.js`). Reads of disallowed types return
  empty results; writes return an `error`. When no cycle is active the
  call is unscoped (full access).

## Tool index

**Lifecycle**
- [`foundry_stage_begin`](#foundry_stage_begin)
- [`foundry_stage_end`](#foundry_stage_end)
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

**Validation**
- [`foundry_validate_run`](#foundry_validate_run)

**Appraisers**
- [`foundry_appraisers_select`](#foundry_appraisers_select)

**Assay**
- [`foundry_assay_run`](#foundry_assay_run)

**Git**
- [`foundry_git_branch`](#foundry_git_branch)
- [`foundry_git_finish`](#foundry_git_finish)

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
`foundry/memory/{entities,edges}/*.ndjson`. May mark `WORK.md` as
`status: failed` on sync failure.

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
  should dispatch a subagent.
- `{ action: "human_appraise", ... }` — surface to the user.
- `{ action: "done", ... }` — cycle complete.
- `{ action: "blocked", ... }` — cycle stalled.
- `{ action: "violation", details, recoverable, affected_files }` —
  policy violation; `recoverable:false` if `runOrchestrate` threw.

**Stage requirements:** none (drives the lifecycle itself). Refuses on
failed flow.

**Failure modes:**
- Flow is failed → `foundry_orchestrate: <reason>`.
- `runOrchestrate` throws → returns a `violation` action with the message
  rather than an error envelope.

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
found" }` if missing.

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
- `assay` → tag must be exactly `validation`.

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
propagates as a tool error rather than being wrapped in `{error: ...}`
(no try/catch in the registration).

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

**Returns:** array of law definitions.

> ⚠️ **Implementation note:** when called without `typeId`, the wrapper
> calls `getLaws('foundry', io)` — i.e. it passes `io` as the second
> positional argument where `getLaws` expects a type id. Verify against
> `scripts/lib/config.js`'s `getLaws` signature; this may be a latent
> bug. See follow-ups.

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

**Stage requirements:** none. (Note: callable outside any stage; intended
to be invoked by quench, but not enforced.)

**Side effects:** spawns subprocesses via `execSync` in the worktree —
external commands may have arbitrary side effects.

---

## Appraisers

### `foundry_appraisers_select`

> Select appraisers for an artefact type.

**Args:**
- `typeId` (string, required).
- `count` (number, optional).

**Returns:** array of selected appraiser objects.

**Stage requirements:** none.

**Side effects:** none.

---

## Assay

### `foundry_assay_run`

> Run extractors to populate flow memory. Only callable during an active
> assay stage. Aborts on the first extractor failure; on abort, emits a
> `validation` feedback item against `WORK.md`.

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
  result has `ok:false` and a `validation` feedback item is added.
- Post-run sync to NDJSON fails → workfile marked failed.

**Side effects:** spawns extractor subprocesses, mutates Cozo store and
NDJSON files, may write `WORK.feedback.yaml`, may mark `WORK.md`
failed.

---

## Git

### `foundry_git_branch`

> Create and checkout a work branch for a flow.

**Args:**
- `flowId` (string, required).
- `description` (string, required): Branch description suffix.

**Returns:** `{ ok: true, branch }` where `branch` is
`work/<flow-slug>-<desc-slug>`.

**Stage requirements:** requires no active stage.

**Failure modes:**
- Active stage exists → `... requires no active stage; current: <stage>`.
- `git checkout -b` failure (e.g. branch exists) propagates as a thrown
  error from `execFileSync`.

**Side effects:** runs `git checkout -b` in the worktree.

### `foundry_git_finish`

> Clean up work files, squash-merge to the base branch, and delete the
> work branch (requires `confirm:true`).

**Args:**
- `message` (string, required): Squash-merge commit message.
- `baseBranch` (string, optional): Default `main`.
- `confirm` (boolean, optional): Must be `true` to perform destructive
  operations; otherwise returns a plan.

**Returns:**
- Plan (when `confirm` is not true): `{ ok: false, error: "...
  requires {confirm: true}...", planned: { workBranch, baseBranch,
  filesToDelete, action, commitMessage } }`.
- No-op (already on base): `{ ok: true, noop: true, message, branch }`.
- Success: `{ ok: true, hash, branch }`.
- Dirty worktree: `{ ok: false, error, dirty: [...] }`.
- Conflict: `{ ok: false, error: "... squash merge failed (likely a
  conflict). Work branch '<branch>' preserved...." }`. Worktree is reset
  to HEAD and checked back out to the work branch.

**Stage requirements:** requires no active stage.

**Side effects (when confirmed):** deletes `WORK.md`,
`WORK.history.yaml`, `WORK.feedback.yaml` if present; commits cleanup;
checks out base; squash-merges the work branch; commits; force-deletes
the work branch. **Destructive.**

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

> Scaffold `foundry/memory/`: creates `entities/`, `edges/`,
> `relations/` dirs with `.gitkeep`, writes `config.md` and
> `schema.json`, appends `.gitignore` entries, and optionally probes
> the embedding provider. Fails if `foundry/memory/` already exists.

**Args:**
- `embeddings_enabled` (boolean, optional, default `true`).
- `probe` (boolean, optional, default `true`).

**Returns:** init report from `admInitMemory` or `{ error: ... }`.

**Side effects:** creates files and directories under
`foundry/memory/`; mutates `.gitignore`.

### `foundry_memory_validate`

> Run load-time and drift checks; returns a report.

**Args:** none.

**Returns:** validation report.

**Side effects:** none.

### `foundry_memory_dump`

> Human-readable snapshot of memory. Optional `type` + `name`.

**Args:** `type` (optional), `name` (optional), `depth` (optional).

**Returns:** a string (not JSON-stringified) — the rendered report. On
error, JSON `{error}`.

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

## Follow-ups / inconsistencies spotted while documenting

1. **`foundry_config_laws` arity bug.** When `typeId` is omitted, the
   wrapper calls `getLaws('foundry', io)` — passing `io` as the second
   positional argument. Either `getLaws` accepts `io` here (in which
   case the typed branch
   `getLaws('foundry', args.typeId, io)` is correct, suggesting the
   no-typeId branch is missing the `io`), or it expects a `typeId`
   string (in which case `io` is being misused as a filter). Worth
   inspecting `scripts/lib/config.js` `getLaws` signature.
2. **`foundry_validate_run` has no stage guard.** It runs subprocesses
   regardless of active stage, and does not check for failed flow.
   Quench cycles enforce this externally, but a direct caller could
   invoke validation outside the lifecycle.
3. **Memory admin tools have no failed-flow guard.** Destructive ops
   like `foundry_memory_reset` and `foundry_memory_drop_*` will run
   even on a workfile marked failed. Compare with the data-write
   tools, which all gate on `requireNotFailed`.
4. **`foundry_memory_dump` returns a raw string** rather than a JSON
   envelope. All other tools return `JSON.stringify(...)`. Documented
   above, but inconsistent with the contract stated in this doc's
   preamble.
5. **`foundry_git_branch` propagates raw `execFileSync` errors.** Other
   git/io wrappers catch and wrap; here a thrown error from `git
   checkout -b` will surface as an unhandled tool error rather than
   `{error: ...}`.
6. **`foundry_orchestrate` returns `violation` (not `{error}`) when
   `runOrchestrate` throws.** This is intentional (recoverable=false
   signals the orchestrator state), but is the only tool whose error
   path does not use `{error}`.
