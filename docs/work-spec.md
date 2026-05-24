# WORK.md Spec

WORK.md is created at the start of a foundry flow on a work branch. It is the shared state between all stages in all foundry cycles. It is transient — it exists only for the duration of the foundry flow.

## Branch namespaces

WORK.md and its sibling YAML files live on one of two branch kinds:

- **`work/<flowId>-<description>`** — the standard flow run. Created
  from `main`. On `foundry_git_finish`, the work branch is preserved
  as `archive/work/<flowId>-<description>-<hash>` and squash-merged to
  the base branch with a signed commit embedding the canonical Foundry
  attestation block.
- **`dry-run/<parentConfig>/<flowId>-<description>`** — a trial run
  used to test in-progress config edits against a real flow. Created
  from a `config/*` branch. On `foundry_git_finish`, the dry-run
  branch is force-deleted and a forensic snapshot
  (`README.md`, `work/WORK*`, `diff.patch`, `trace.jsonl`) is written
  to `.snapshots/<run-id>/` on the parent `config/*` working tree.
  No merge, no commit.

WORK.md is identical on both kinds; the dispatching distinction is
made entirely by `foundry_git_finish`. The third namespace,
`config/<description>`, owns schema/config mutation and never carries
WORK files.

## Frontmatter

```yaml
---
flow: <flow-id>
cycle: <current-cycle-id>
stages: [forge:write-haiku, quench:check-syllables, appraise:evaluate-quality]
max-iterations: 3
always-human-appraise: false
deadlock-human-appraise: true
models:
  forge: anthropic/claude-opus-4.7
  appraise: openai/gpt-5
assay:
  extractors: [list-routes, list-models]
---
```

Fields:
- `flow` — the foundry flow being executed.
- `cycle` — the current cycle id.
- `stages` — the ordered route for this cycle. Each entry uses `base:alias` format where `base` is the stage type (`forge`, `quench`, `appraise`, `human-appraise`, or `assay`) and `alias` is a human-readable name for what that stage does in this cycle. The list is derived from the cycle and artefact type: `forge` and `appraise` are always included; `quench` is included iff any applicable law declares validators; `human-appraise` is included iff the cycle sets `always-human-appraise: true`; and `assay` is included iff the cycle declares an `assay.extractors` block.
- `max-iterations` — how many forge passes before the cycle is blocked (default: 3).
- `always-human-appraise` — run human-appraise every iteration (default: `false`).
- `deadlock-human-appraise` — route to human-appraise when the iteration count reaches `max-iterations` (default: `true`).
- `models` — optional per-stage model overrides; individual appraisers may further override via their own `model` field.
- `assay.extractors` — optional list of extractor names (defined under `foundry/memory/extractors/`) to run at iteration 0 before the first forge. Requires `foundry/memory/` to be initialized; cycle fails to load otherwise.

The `stages` list is the happy path. Sort follows it, loops back to `forge` when unresolved feedback demands it, and routes to `human-appraise` when the iteration count reaches `max-iterations` (provided `deadlock-human-appraise` is `true`). If `assay` is configured, it runs once at iteration 0 before the route begins.

### Who sets what

- `flow`, `cycle` — set by the `flow` skill via `foundry_workfile_create` at flow start and updated as the flow advances between cycles.
- `goal` — written once by the `flow` skill when `WORK.md` is created.
- `stages`, `max-iterations`, `always-human-appraise`, `deadlock-human-appraise`, `models`, `assay` — set by `foundry_orchestrate` on the first call of each cycle (via internal `workfile_configure_from_cycle`, reading the cycle definition).
- The frontmatter may also contain `status: failed` with a `reason` when the flow enters a failed state, locking all mutation tools.

## Sections

### Goal

Free text describing what the foundry flow is producing and any context the human provided. Written once at foundry flow start, not modified after.

## WORK.feedback.yaml

The flow run owns one `WORK.feedback.yaml` file alongside `WORK.md` and
`WORK.history.yaml`. It records every feedback item created during the current run,
and the full state-transition history of each. Tracked in git, committed
per-stage on the work branch, deleted by `foundry_git_finish` before the
squash-merge (same lifecycle as `WORK.history.yaml`).

### Schema

Top-level: `{ items: [Item...] }`.

Each `Item`:

| Field | Type | Required | Mutable? |
|-------|------|----------|----------|
| `id` | string (ULID, 26 chars) | yes | no |
| `file` | string | yes | no |
| `tag` | string (no leading `#`) | yes | no |
| `text` | string | yes | no |
| `source` | string (`base:alias`) | yes | no |
| `history` | array, length >= 1 | yes | prepend-only |

`source` bases include `quench`, `appraise`, and `human-appraise`. Extractor failure marks the workfile failed, so `assay` does not appear as a feedback source.

Each history snapshot:

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `state` | enum | yes | `open \| actioned \| wont-fix \| rejected \| resolved` |
| `stage` | string (`base:alias`) or literal `sort` | yes | Who performed the transition |
| `cycle` | string | yes | Cycle id at the time of the transition |
| `timestamp` | ISO-8601 UTC with ms | yes | |
| `reason` | string | conditional | Required on `rejected`, `wont-fix`; forbidden on `open`; optional on `actioned`, `resolved` |

`history[0]` is always the current state; new snapshots are prepended.
`resolved` is terminal.

### State machine

Feedback items flow through a five-state lifecycle: `open` (newly raised), `actioned` (forge has addressed it), `wont-fix` (forge declined subjective feedback with justification), `rejected` (appraiser or human overruled the wont-fix), and `resolved` (approved by the item's originating stage or human override). Transitions are source-based: the legal moves depend on what stage created the item and who is trying to transition it. The feedback state machine is the engine that routes work between cycles.

The five states and the legal transitions are:

| From \ Caller | forge (any source) | source-stage (quench / appraise / human-appraise where stageId === item.source) | human-appraise (override authority, any source) |
|---|---|---|---|
| `open` | -> `actioned` always; -> `wont-fix` only if `item.source` base is `appraise` | — | — |
| `actioned` | — | -> `{resolved, rejected}` | -> `{resolved, rejected}` |
| `wont-fix` | — | -> `{resolved, rejected}` | -> `{resolved, rejected}` |
| `rejected` | -> `actioned` always; -> `wont-fix` only if `item.source` base is `appraise` | — | — |
| `resolved` | — | — | — (terminal) |

Notes:

- `source-stage` column applies when the caller's stage id exactly matches `item.source` (e.g. `appraise:write-check` resolving an item it created). `human-appraise` override authority (last column) applies regardless of `item.source` and operates only on items in `actioned` or `wont-fix` state (or `deadlocked` for backward compatibility with existing feedback files).
- **Forge `wont-fix` scope.** When `item.source` base is `quench` (objective validation failure) or `human-appraise` (direct user instruction), forge may not `wont-fix` — it must `actioned`. Only `appraise`-sourced items are wont-fix-able by forge. This replaces the earlier tag-based restriction on `validation` / `human` tags.
- `tag` is categorical and display-only. The state machine consults `source`, not tags.
- **Reason required on** `rejected`, `wont-fix`. **Forbidden on** `open`. **Optional on** `actioned`, `resolved`.
- Sort does not write `state: deadlocked`. Deadlock detection in sort uses iteration count comparison against `max-iterations` and `deadlock-human-appraise` to decide whether to route to human-appraise, not per-item deadlock state. The feedback-transition validator still recognises `deadlocked` state for backward compatibility with existing feedback files.

This section is the authoritative specification of the feedback state machine.

### Feedback tag gates

`foundry_feedback_add` enforces per-stage tag rules:

- **forge** and **assay** stages cannot add feedback; the tool returns an error.
- **quench** and **appraise** stages require tags starting with `law:`.
- **human-appraise** requires the tag `human`.
- Quench validator feedback uses the tag format `law:<law-id>:<validator-id>`.

### Transitions are made via the plugin API

No direct yaml editing. Every state change goes through one of:

- `foundry_feedback_add` (creates items from `quench`, `appraise`, and `human-appraise`)
- `foundry_feedback_action` (forge: open/rejected -> actioned)
- `foundry_feedback_wontfix` (forge: open/rejected -> wont-fix)
- `foundry_feedback_resolve` (source stage: actioned/wont-fix -> resolved/rejected; or human-appraise deadlock override)

### Persistence

Writes are atomic: `io.writeFile(path + '.tmp', body); io.rename(tmp, path)`.
A crash between the two steps leaves the live file untouched.

## Who writes what

| Section | Written by | Updated by |
|---------|-----------|------------|
| Frontmatter (`flow`, `cycle`) | `foundry_workfile_create` (flow skill) | updated in place as the flow advances between cycles |
| Frontmatter (`stages`, `max-iterations`, `always-human-appraise`, `deadlock-human-appraise`, `models`, `assay`) | `foundry_orchestrate` (first call of each cycle, internally) | reset on each new cycle |
| Goal | `foundry_workfile_create` (flow skill) | nobody |
| Artefact files | forge stage writes files on disk | git tracks file changes; cycle-level state records completion or failure |
| `WORK.feedback.yaml` | `foundry_feedback_add` (`quench` / `appraise` / `human-appraise`) | `foundry_feedback_action` / `foundry_feedback_wontfix` (forge), `foundry_feedback_resolve` (source stage / human-appraise override) |
| `WORK.history.yaml` | `foundry_orchestrate` | `foundry_orchestrate` |

Artefact files are discovered from branch changes matching the cycle output type's `file-patterns`.

## WORK.history.yaml

A separate file (`WORK.history.yaml`) alongside WORK.md. Append-only log of every stage execution.

```yaml
- timestamp: "2026-04-17T14:32:01.000Z"
  cycle: write-petition
  stage: forge:draft-petition
  iteration: 1
  comment: Initial petition draft created
  seq: 0
  open_feedback: 0

- timestamp: "2026-04-17T14:32:45.000Z"
  cycle: write-petition
  stage: quench:validate-petition
  iteration: 1
  comment: 2 validation issues found
  seq: 1
  open_feedback: 2

- timestamp: "2026-04-17T14:33:12.000Z"
  cycle: write-petition
  stage: forge:draft-petition
  iteration: 2
  comment: Addressed 2 validation issues
  seq: 2
  open_feedback: 2

- timestamp: "2026-04-17T14:33:30.000Z"
  cycle: write-petition
  stage: quench:validate-petition
  iteration: 2
  comment: Validation passed
  seq: 3
  open_feedback: 0

- timestamp: "2026-04-17T14:34:00.000Z"
  cycle: write-petition
  stage: appraise:review-petition
  iteration: 2
  comment: No issues found, cycle complete
  seq: 4
  open_feedback: 0
```

### Fields

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `cycle` | string | yes | |
| `stage` | string or literal `sort` | yes | |
| `iteration` | integer | yes | Count of completed forge stages for the cycle at the time of write |
| `comment` | string | yes | |
| `timestamp` | ISO-8601 UTC with ms | yes | |
| `seq` | integer | yes on write | Monotonic per file; sort tiebreaker for same-ms entries |
| `route` | string | conditional | Only on `stage: sort` entries; records the route decision. Throws if set on a non-sort entry |
| `open_feedback` | integer | yes on write | Count of non-resolved items in `WORK.feedback.yaml` at the time of write |
| `changed_files` | array of strings | conditional | Only on stage entries; records the list of files detected as changed by the finalise step for that stage |

### Rules

- Append-only — never edit or delete entries.
- Every stage produces an entry when it completes.
- Sort reads this to determine what has happened in the current cycle.
- Iteration is derived from counting forge entries for the current cycle.

### Who writes

History entries are written by `foundry_orchestrate` after each stage closes (via its internal `foundry_history_append` — the tool is not registered publicly). Sub-agents never append history directly.

### Lifecycle

`WORK.history.yaml` is tracked in git and committed per-stage on the work
branch. `foundry_git_finish` deletes it before the squash-merge so the
history does not leak into the base branch.

If the yaml is malformed on read (parse failure or non-array root), the
flow is marked failed via `markWorkfileFailed` and the error is re-thrown
to the caller. Mirrors the P0 #3 failed-flow pattern used by the memory
sync writer.

## Example

A complete WORK.md mid-foundry flow:

```markdown
---
flow: make-haiku
cycle: haiku-creation
stages: [forge:write-haiku, quench:check-syllables, appraise:evaluate-quality]
max-iterations: 3
always-human-appraise: false
deadlock-human-appraise: true
---

# Goal

Write a haiku about autumn rain. Should evoke loneliness
and the sound of rain on leaves.

```
