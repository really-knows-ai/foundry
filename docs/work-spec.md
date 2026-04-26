# WORK.md Spec

WORK.md is created at the start of a foundry flow on a work branch. It is the shared state between all stages in all foundry cycles. It is transient — it exists only for the duration of the foundry flow.

## Frontmatter

```yaml
---
flow: <flow-id>
cycle: <current-cycle-id>
stages: [forge:write-haiku, quench:check-syllables, appraise:evaluate-quality]
max-iterations: 3
human-appraise: false
deadlock-appraise: true
deadlock-iterations: 5
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
- `stages` — the ordered route for this cycle. Each entry uses `base:alias` format where `base` is the stage type (`forge`, `quench`, `appraise`, `human-appraise`, or `assay`) and `alias` is a human-readable name for what that stage does in this cycle. Derived from the cycle and artefact type: `forge` + `appraise` are always included, `quench` is included iff the artefact type has `validation.md`, `human-appraise` is included iff the cycle sets `human-appraise: true`, and `assay` is included iff the cycle declares an `assay.extractors` block — when present it runs once at iteration 0, before the first forge.
- `max-iterations` — how many forge passes before the cycle is blocked (default: 3).
- `human-appraise` — run human-appraise every iteration (default: `false`).
- `deadlock-appraise` — route to human-appraise when LLM appraisers deadlock (default: `true`).
- `deadlock-iterations` — deadlock threshold (default: 5).
- `models` — optional per-stage model overrides; individual appraisers may further override via their own `model` field.
- `assay.extractors` — optional list of extractor names (defined under `foundry/memory/extractors/`) to run at iteration 0 before the first forge. Requires `foundry/memory/` to be initialized; cycle fails to load otherwise.

The `stages` list is the happy path. Sort follows it but loops back to `forge` when unresolved feedback demands it, and inserts a `human-appraise` stage on deadlock. When `assay` is present, it runs first at iteration 0 (before the first forge), then the normal `stages` route applies.

### Who sets what

- `flow`, `cycle`, `goal` — set by the `flow` skill via `foundry_workfile_create` at flow/cycle boundaries.
- `stages`, `max-iterations`, `human-appraise`, `deadlock-appraise`, `deadlock-iterations`, `models`, `assay` — set by `foundry_orchestrate` on the first call of each cycle (via internal `workfile_configure_from_cycle`, reading the cycle definition).

## Sections

### Goal

Free text describing what the foundry flow is producing and any context the human provided. Written once at foundry flow start, not modified after.

### Artefacts

A table tracking every artefact produced by the foundry flow.

```markdown
# Artefacts

| File | Type | Cycle | Status |
|------|------|-------|--------|
| petitions/login-change.md | petition | write-petition | draft |
| features/login-change.feature | gherkin | petition-to-gherkin | draft |
```

Statuses:
- `draft` — artefact exists but has not cleared all stages
- `done` — artefact has cleared all stages
- `blocked` — artefact hit iteration limit or a violation

## WORK.feedback.yaml

Every cycle owns a `WORK.feedback.yaml` file alongside `WORK.md` and
`WORK.history.yaml`. It records every feedback item created during the cycle
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

`source` bases include `assay`, `quench`, `appraise`, and `human-appraise`.

Each history snapshot:

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `state` | enum | yes | `open \| actioned \| wont-fix \| rejected \| deadlocked \| resolved` |
| `stage` | string (`base:alias`) or literal `sort` | yes | Who performed the transition |
| `cycle` | string | yes | Cycle id at the time of the transition |
| `timestamp` | ISO-8601 UTC with ms | yes | |
| `reason` | string | conditional | Required on `rejected`, `wont-fix`, `deadlocked`, `resolved`; forbidden on `open`; optional on `actioned` |

`history[0]` is always the current state; new snapshots are prepended.
`resolved` is terminal.

### State machine

The six states and the legal transitions are:

| From \ Caller | forge (any source) | source-stage (assay / quench / appraise / human-appraise where stageId === item.source) | sort | human-appraise (override authority, any source) |
|---|---|---|---|---|
| `open` | -> `actioned` always; -> `wont-fix` only if `item.source` base is `appraise` | — | -> `deadlocked` (if depth >= threshold) | -> `{actioned, wont-fix}` |
| `rejected` | -> `actioned` always; -> `wont-fix` only if `item.source` base is `appraise` | — | -> `deadlocked` (if depth >= threshold) | -> `{actioned, wont-fix}` |
| `actioned` | — | -> `{resolved, rejected}` | -> `deadlocked` (if depth >= threshold) | -> `{resolved, rejected}` |
| `wont-fix` | — | -> `{resolved, rejected}` | -> `deadlocked` (if depth >= threshold) | -> `{resolved, rejected}` |
| `deadlocked` | — | — | — | -> `{resolved, wont-fix, rejected}` |
| `resolved` | — | — | — | — (terminal) |

Notes:

- `source-stage` column applies when the caller's stage id exactly matches `item.source` (e.g. `appraise:write-check` resolving an item it created). `human-appraise` override authority (last column) applies regardless of `item.source` and is the only path that can transition out of `deadlocked`.
- **Forge `wont-fix` scope.** When `item.source` base is `assay` or `quench` (objective validation failure) or `human-appraise` (direct user instruction), forge may not `wont-fix` — it must `actioned`. Only `appraise`-sourced items are wont-fix-able by forge. This replaces the earlier tag-based restriction on `#validation` / `#human` tags.
- `tag` is categorical and display-only. The state machine consults `source`, not tags; `#validation` / `#human` tag-based restrictions are legacy and do not apply.
- **Reason required on** `rejected`, `wont-fix`, `deadlocked`, `resolved`. **Forbidden on** `open`. **Optional on** `actioned` (the code change is the reason).
- Sort is the only writer of `state: deadlocked`; it writes these via its internal pass, not through the plugin API.

See `new-feedback/2026-04-24-work-feedback-yaml-redesign.md` §5 for the authoritative rules.

### Transitions are made via the plugin API

No direct yaml editing. Every state change goes through one of:

- `foundry_feedback_add` (creates items from `assay`, `quench`, `appraise`, and `human-appraise`)
- `foundry_feedback_action` (forge: open/rejected -> actioned)
- `foundry_feedback_wontfix` (forge: open/rejected -> wont-fix)
- `foundry_feedback_resolve` (source stage: actioned/wont-fix -> resolved/rejected; or human-appraise deadlock override)

Sort is the only writer of `state: deadlocked`, and it writes snapshots via
its own internal pass — not through the plugin API.

### Persistence

Writes are atomic: `io.writeFile(path + '.tmp', body); io.rename(tmp, path)`.
A crash between the two steps leaves the live file untouched.

## Who writes what

| Section | Written by | Updated by |
|---------|-----------|------------|
| Frontmatter (`flow`, `cycle`, `goal`) | `foundry_workfile_create` (flow skill) | `foundry_workfile_delete` + re-create between cycles |
| Frontmatter (`stages`, `max-iterations`, `human-appraise`, `deadlock-appraise`, `deadlock-iterations`, `models`) | `foundry_orchestrate` (first call of each cycle, internally) | reset on each new cycle |
| Goal | `foundry_workfile_create` (flow skill) | nobody |
| Artefacts | `foundry_stage_finalize` (orchestrator, after forge closes) | `foundry_artefacts_set_status` (orchestrator → `done`/`blocked`) |
| `WORK.feedback.yaml` | `foundry_feedback_add` (`assay` / `quench` / `appraise` / `human-appraise`) | `foundry_feedback_action` / `foundry_feedback_wontfix` (forge), `foundry_feedback_resolve` (source stage / human-appraise override); sort writes only deadlocked snapshots |
| `WORK.history.yaml` | `foundry_orchestrate` | `foundry_orchestrate` |

Note: `foundry_artefacts_add` no longer exists as a public tool — artefact registration is automatic via `stage_finalize`, which scans the git diff and registers files matching the output type's `file-patterns` as `draft`.

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
| `open_feedback` | integer | yes on write | Count of non-resolved items in `WORK.feedback.yaml` at the time of write; deadlocked items are counted |

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
human-appraise: false
deadlock-appraise: true
deadlock-iterations: 5
---

# Goal

Write a haiku about autumn rain. Should evoke loneliness
and the sound of rain on leaves.

# Artefacts

| File | Type | Cycle | Status |
|------|------|-------|--------|
| petitions/autumn-rain-haiku.md | petition | haiku-ideation | done |
| haiku/autumn-rain.md | haiku | haiku-creation | draft |

```
