# Concepts

This is the glossary. Every term here has a single definition and links out to the spec document that elaborates it. Concepts are arranged roughly top-down: flows contain cycles, cycles contain stages, stages operate on artefacts, artefacts are governed by laws and evaluated by appraisers.

---

## Flow

The top-level unit of work. Defined in `foundry/flows/*.md`. A flow declares:

- A `starting-cycles` list — hints about which cycles can be entered first when the flow begins.
- A set of cycles (listed under `## Cycles`). Order is not implied — routing between cycles is owned by cycles themselves via their `targets` field.

Running a flow creates a work branch and a `WORK.md`. The flow completes when no more reachable cycles remain to run, or when the user decides to stop.

## Cycle

An iterative loop that produces a single artefact type. Defined in `foundry/cycles/*.md`. A cycle declares:

- `output-type` — the artefact type it produces (read-write).
- `inputs` — a contract (`any-of` / `all-of`) over other artefact types. Inputs are discovered on disk; they are read-only unless the output type's patterns happen to cover them.
- `targets` — the cycle(s) that may run after this one. May be empty (terminal cycle).
- `human-appraise` — whether a human quality gate runs every iteration (default: `false`).
- `deadlock-appraise` — whether a human is pulled in when LLM appraisers deadlock (default: `true`).
- `deadlock-iterations` — deadlock threshold (default: `5`).
- `models` — optional per-stage model overrides.

A cycle runs **forge → quench → appraise** (and optionally **human-appraise**), looping until all feedback is resolved or `max-iterations` is hit.

## Stage

A single step within a cycle. Every stage is referenced as `base:alias` (e.g. `forge:write-haiku`, `quench:check-syllables`) — the base is the stage type; the alias makes the stage's role self-documenting in WORK.md.

Stage bases:

- **forge** — produce or revise the artefact.
- **quench** — run deterministic CLI checks (skipped if the artefact type has no `validation.md`).
- **appraise** — subjective evaluation by multiple appraiser sub-agents.
- **human-appraise** — human quality gate. Can run every iteration, only on deadlock, or both.
- **assay** — deterministic population of flow memory by running project-authored extractor scripts (iteration 0 only, opt-in per cycle). See the [Assay](#assay) and [Extractor](#extractor) entries below.

Every stage runs inside a token-gated lifecycle bracketed by `foundry_stage_begin` and `foundry_stage_end`, with an internal finalize step run by `foundry_orchestrate` after `stage_end` to scan the disk and register artefacts. Mutation tools are stage-locked: a forge stage can't add feedback, a quench stage can't register artefacts. See the enforcement section of the [README](../README.md#enforcement-model).

## Assay

A deterministic stage that runs before the first `forge` of a cycle. For each extractor listed in the cycle's `assay.extractors` frontmatter, it runs the extractor's `command`, parses the JSONL output, and upserts rows into flow memory via the existing memory write tools.

In metallurgy, to *assay* an ore or alloy is to determine its composition before working it. The stage plays the same role for a codebase: it determines what is there so forge can plan against reality instead of guessing.

Properties:

- **Opt-in per cycle.** A cycle declares `assay: { extractors: [name, ...] }`. Cycles without this block behave exactly as they always have.
- **Iteration 0 only.** Runs once, before the first forge. Re-extraction on later iterations is out of scope for v1.
- **Requires memory.** A cycle with `assay:` but no `foundry/memory/` fails to load with a clear error.
- **Strict failure.** Any non-zero exit, parse error, permission violation, or timeout marks the workfile failed and aborts the cycle. The user must fix the extractor and start a new cycle.

See also: [Extractor](#extractor).

## Artefact type

A definition of what is being produced. Lives in `foundry/artefacts/<type>/`:

- `definition.md` — identity, file patterns, output directory, appraiser config, prose description.
- `laws.md` *(optional)* — type-specific subjective criteria.
- `validation.md` *(optional)* — CLI commands for deterministic quench checks.

File patterns must not overlap with any other artefact type's patterns — the write-invariant enforcer needs to know which type owns a given file.

## Law

A subjective pass/fail criterion. Two scopes:

- **Global** — `foundry/laws/*.md`, all files concatenated, applies to every artefact.
- **Type-specific** — `foundry/artefacts/<type>/laws.md`.

Each law is a `## heading` (its identifier, used in feedback tags as `#law:<id>`) with a description, passing criteria, and failing criteria.

## Appraiser

An independent evaluator with a defined personality. Lives in `foundry/appraisers/*.md`. Appraisers may specify a `model` field to override the cycle-level appraise model. Each artefact type picks which appraisers may evaluate it (`appraisers.allowed`) and how many run per iteration (`appraisers.count`). Selection distributes evenly across allowed personalities.

## WORK.md

The transient shared state for a flow. Created on the work branch by the flow skill, it tracks:

- Current position (flow, cycle, stage list, iteration limits) in frontmatter.
- The goal (prose — written once).
- An artefact registry (file, type, cycle, status).
- Feedback state lives alongside it in `WORK.feedback.yaml`.

See [work-spec.md](work-spec.md) for the full spec.

## WORK.history.yaml

Append-only log of every stage execution, sitting next to WORK.md. Used by sort to reconstruct what has happened in the current cycle. See [work-spec.md](work-spec.md).

## Feedback

Feedback items live in `WORK.feedback.yaml` — a yaml file at the worktree
root, alongside `WORK.md`. Every item has a ULID, a source stage, and a
full history of state transitions (open → actioned → resolved, or variants
including wont-fix / rejected / deadlocked).

Plugins read and write feedback through the `foundry_feedback_*` tools;
skills never edit the yaml directly. Sort-side detection of deadlocked
items (per-item history depth) replaces the earlier global-iteration
counter.

See `docs/work-spec.md` for the full schema and state machine.

## HITL / human-appraise

Human-in-the-loop checkpoint. A stage where Foundry pauses and asks a human for input. Two triggers:

1. **Every-iteration** — the cycle declares `human-appraise: true`. The `human-appraise` stage runs after LLM appraise each iteration.
2. **Deadlock** — the cycle declares `deadlock-appraise: true` (default). If forge and appraisers ping-pong on the same items for `deadlock-iterations` (default 5) iterations, sort inserts a `human-appraise` stage to break the tie.

Human feedback is tagged `#human` and takes priority over LLM feedback on the same topic.

## Micro-commit

Every stage ends with a commit made by the orchestrator. This enables two things: file-modification enforcement (the write-invariant check compares the stage's diff to its allowed patterns) and recoverability (a crash mid-flow leaves a clean commit boundary to resume from). Orchestration refuses to proceed if uncommitted work is lingering in `WORK.md`, `WORK.feedback.yaml`, `WORK.history.yaml`, or `.foundry/`.

## Branch namespaces

Foundry partitions mutation across three disjoint branch kinds, and the
plugin enforces the split at tool-call time.

- **`config/<description>`** — schema and config mutation. Owns
  `foundry/`. Created from `main` via
  `foundry_git_branch({ kind: "config", description })`. The
  `foundry_config_create_*`, `foundry_memory_create_*`,
  `foundry_extractor_create`, and the schema-mutating memory admin
  tools all refuse off this kind.
- **`work/<flowId>-<description>`** — flow-data mutation. Owns
  `WORK.md`, `WORK.feedback.yaml`, `WORK.history.yaml`, and
  `foundry-memory/` row data. Created from `main` via
  `foundry_git_branch({ kind: "work", flowId, description })`. The
  `foundry_orchestrate`, workfile, feedback, artefact-status,
  assay/validate/appraisers-select, stage-begin/end, and
  `foundry_memory_put`/`_relate`/`_unrelate` tools refuse off this
  kind (and off dry-run, see below).
- **`dry-run/<parentConfig>/<flowId>-<description>`** — trial run of
  in-progress config against a real flow. Created from a `config/*`
  branch via
  `foundry_git_branch({ kind: "dry-run", flowId, description })`. Has
  the same flow-data write permissions as `work/*`, but on
  `foundry_git_finish` it writes a forensic snapshot
  (`README.md`, `work/WORK*`, `diff.patch`, `trace.jsonl`) under
  `.snapshots/<run-id>/` on the parent `config/*` working tree and
  force-deletes the dry-run branch. No merge, no commit. The two
  spaces stay deliberately disjoint.

## Branch guards

The plugin enforces the branch-namespace split at tool-call time
through a small library of guards in `scripts/lib/branch-guard.js`.
Every mutating tool composes one of three guards before its handler
runs:

- **`requireOnConfigBranch`** — accepts only `config/<description>`.
  Schema-mutation tools (`foundry_config_create_*`,
  `foundry_memory_create_*`, `foundry_extractor_create`, the memory
  admin family) use this guard. `dry-run/<x>/<y>` is rejected by
  design — schema must change on a real config branch so the change
  can be merged to `main`.
- **`requireOnFlowBranch`** — accepts `work/<flow>-<desc>` or
  `dry-run/<x>/<y>`. Flow-data tools (`foundry_orchestrate`, the
  workfile / feedback / artefact-status / assay / appraisers
  families, `foundry_memory_put` / `_relate` / `_unrelate`) use this
  guard.
- **`requireOnConfigOrFlowBranch`** — accepts any of the three
  namespaces. Read-only diagnostic tools that touch files in either
  tree use this guard.

`currentBranch()` resolves the active branch in a single place,
including unborn HEADs (fresh repos with no commits) and detached
HEAD. When no branch can be resolved the guards return a structured
refusal envelope rather than throwing, so the LLM sees the same
shape for branch refusals as for any other tool failure.

## Stage token

A single-use HMAC-signed string, minted by `foundry_orchestrate` when a stage is dispatched. The sub-agent must redeem the token via `foundry_stage_begin`; mutation tools then check the active stage matches their role. Keys live in `.foundry/.secret` (mode 0600, gitignored, one per worktree). This prevents out-of-band mutations, replayed stages, and sub-agents skipping the lifecycle.

## `.foundry/` state directory

A gitignored directory created on first plugin boot, holding runtime state:

- `.secret` — the HMAC key.
- `active-stage.json` — present only during an active stage.
- `last-stage.json` — used by `foundry_stage_finalize` after `stage_end`.
- `trace/<branch-slug>.jsonl` — per-branch tool-call trace (see Tracing).

## Tracing

Every `foundry_*` tool call made on a `dry-run/<x>/<y>` branch appends
one JSONL record to `.foundry/trace/<branch-slug>.jsonl`, where the
slug is the branch name with `/` replaced by `-`. The trace captures
tool name, args, result envelope, and timing — enough to reconstruct
what the dry-run did without rerunning it. The trace file is created
fresh when the dry-run branch starts (any prior content is truncated)
and is captured into the snapshot at finish-time. Records on `work/*`
and `config/*` branches are not written; tracing is a dry-run-only
concept. Implementation: `scripts/lib/tracing.js`.

## Dry-run

Trial execution of an in-progress `config/*` branch against a real
flow. Driven by the `dry-run` skill. The user creates a
`dry-run/<parentConfig>/<flowId>-<description>` branch from the
config branch via
`foundry_git_branch({ kind: "dry-run", flowId, description })`,
then runs the flow normally. The dry-run branch has the same
flow-data write permissions as `work/*` (forge can edit artefacts,
memory rows can be written), but `foundry_git_finish` on it neither
merges nor commits — it captures a snapshot and force-deletes the
branch. Schema-mutation tools refuse on dry-run by design, so
config changes always land through `config/*` → `main`. Nesting is
forbidden: `dry-run/<x>/<y>/<z>` is rejected by the same regex that
gates depth.

## Snapshot

The forensic record of a finished dry-run, materialised as a
plain-files directory at `.snapshots/<runId>/` on the parent
`config/*` working tree. Each snapshot contains:

- `README.md` — rendered metadata (branch, parent, flow, goal,
  timestamps, exit reason, commit log).
- `work/WORK.md`, `work/WORK.history.yaml`, `work/WORK.feedback.yaml` —
  the workfile triple captured before branch deletion (any of these
  may be absent if the dry-run did not produce them).
- `diff.patch` — the full `git diff parent...HEAD` from the dry-run.
- `trace.jsonl` — the full tool-call trace.

`runId` is `<branch-slug>-<ulid>`. Snapshots are gitignored
(`.snapshots/` is added to `.gitignore` by `init-foundry`) and
accumulate locally; `foundry_snapshot_list` enumerates them,
`foundry_snapshot_show` returns a structured summary,
`foundry_snapshot_delete` removes one, and
`foundry_snapshot_prune` removes those older than a given age.
Implementation: `scripts/lib/snapshot/`.

## Custom tools

All deterministic pipeline operations are exposed as custom tools by the Foundry plugin. Skills call these tools instead of manipulating files directly. Tools are backed by shared library modules in `scripts/lib/` with injectable I/O so they can be unit-tested. This separation ensures state transitions and routing logic are tested code, not LLM interpretation. See the [README](../README.md#custom-tools) for the full catalogue.

## Skill

A self-contained workflow written as markdown with YAML frontmatter. Foundry ships pipeline skills (`flow`, `orchestrate`, `forge`, `quench`, `appraise`, `human-appraise`), authoring skills (`add-*`, `init-foundry`), utility skills (`list-agents`, `refresh-agents`, `upgrade-foundry`), and memory skills (`init-memory`, `add-memory-*`, `rename-memory-*`, `drop-memory-*`, `reset-memory`, `change-embedding-model`). Skills are either **atomic** (do one thing) or **composite** (orchestrate other skills).

---

## Flow memory

A typed, graph-shaped knowledge store shared across cycles in a project. Strictly opt-in: a project without `foundry/memory/` has no memory and behaves exactly as previous Foundry versions.

When present, memory is populated and consulted by cycles that declare read/write permissions in their frontmatter. Its vocabulary is injected into the dispatched stage's prompt, and its contents survive across flows as long as the NDJSON relations stay committed.

Memory can be populated at runtime by the [Assay](#assay) stage via [Extractors](#extractor), which run project-authored CLI scripts before the first forge of an opted-in cycle.

See also: [docs/memory-maintenance.md](memory-maintenance.md) for contributor-facing notes on Cozo 0.7 and session lifecycle.

## Entity / entity type

An **entity** is one row in memory: `{ type, name, value }`, where `value` is free text describing the entity's intrinsic characteristics (≤ 4 KB). Relationships belong in edges, not in the value.

An **entity type** is declared once per project in `foundry/memory/entities/<type>.md`. Its markdown body is a prose brief — naming convention, what `value` should contain, likely related edges — that becomes part of every cycle's prompt that reads or writes this type. Create types with `add-memory-entity-type`.

## Edge / edge type

An **edge** is one row relating two entities: `{ from_type, from_name, edge_type, to_type, to_name }`. Edges are directed.

An **edge type** declares allowed endpoints — `sources` and `targets` are either a list of entity types or the literal `any` — and a prose body describing when the edge holds. Declared in `foundry/memory/edges/<name>.md`. Create with `add-memory-edge-type`.

## Extractor

A project-authored CLI that emits JSONL describing entities and edges to upsert into flow memory. Defined in `foundry/memory/extractors/<name>.md`:

- `command` — path to the executable (or shell command) to run. Stdout is parsed as JSONL.
- `memory.write` — entity types the extractor is permitted to populate. Edge permissions are derived: an edge is permitted if either endpoint's entity type is in this list (mirroring the cycle-level rule).
- `timeout` (optional, default 60s) — hard kill if the script exceeds it.

The markdown body is a prose brief injected into the `forge` prompt of any cycle that uses this extractor, so the LLM knows what is in memory and where it came from. Extractors are run by the [Assay](#assay) stage.

Create with `add-extractor`.

### JSONL output contract

Extractors emit one JSON object per line on stdout, discriminated by a required `kind` field. Two row shapes are recognised:

**Entity row:**

```json
{"kind":"entity","type":"<entity-type>","name":"<id>","value":"<string>"}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `kind` | `"entity"` | yes | Discriminator. |
| `type` | string | yes | Must match a declared entity type in the project's vocabulary. |
| `name` | string | yes | Stable identifier for the entity within its type. |
| `value` | string | yes | Free text describing the entity's intrinsic characteristics. **Max 4096 bytes** (UTF-8). |

No other fields are permitted; unknown keys raise a parse error.

**Edge row:**

```json
{"kind":"edge","from":{"type":"<t1>","name":"<n1>"},"edge":"<edge-type>","to":{"type":"<t2>","name":"<n2>"}}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `kind` | `"edge"` | yes | Discriminator. |
| `from` | object `{type,name}` | yes | Source endpoint. Both inner fields required and non-empty. |
| `edge` | string | yes | Edge type name (must exist in vocabulary). |
| `to` | object `{type,name}` | yes | Target endpoint. Both inner fields required and non-empty. |

No other fields are permitted on edge rows.

**Line handling:**

- Blank lines and lines starting with `#` (after trimming whitespace) are ignored — useful for header comments.
- Each remaining line must be a valid JSON object (not an array, not a primitive).
- Parsing is line-numbered: errors include the line number for easy debugging.

**Failure semantics:**

Any of the following mark the workfile failed (`status: failed` with a `reason`) and abort the cycle. No feedback item is written — extractor scripts live outside any artefact's `file-patterns`, so forge cannot fix them. The user must fix the extractor and start a new cycle (`foundry_workfile_delete` to abandon, then re-run the flow):

- Extractor exits non-zero.
- Extractor exceeds the configured `timeout`.
- Output contains a malformed JSON line, an unknown `kind`, an unknown field, a missing required field, or an entity `value` exceeding 4096 bytes.
- An entity row references a `type` not in the extractor's `memory.write` set, or an edge row's endpoint types are both outside that set (permission violation).

The complete reference parser is `scripts/lib/assay/parse-jsonl.js`.

## Memory permissions

Per-cycle opt-in, specified in cycle frontmatter:

```yaml
memory:
  read:  [class, method]      # types this cycle can read
  write: [method]             # types this cycle can upsert into
```

A cycle with no `memory:` block gets no memory tools in its prompt. Entity reads check the `read` set only — a type listed in `write` only is writable but not readable, so list a type in both lists to get both. Edge permissions are derived: an edge is readable if either endpoint type is in `read` or `write`, writable if either endpoint type is in `write`. `foundry_memory_query` also restricts referenced `ent_*` / `edge_*` relations to the read set.

## Memory layout

Memory uses a two-tree split: configuration lives under `foundry/memory/`
and is committed alongside the rest of the foundry config; row data
lives under `foundry-memory/relations/`, a top-level sibling of
`foundry/`, so it can be tracked or replaced independently.

```
foundry/memory/                # config (committed)
├── config.md                  # frontmatter: enabled, validation, embeddings
├── schema.json                # canonical, deterministic, derived from entity/edge files
├── entities/<type>.md         # prose brief per entity type
├── edges/<name>.md            # frontmatter (sources/targets) + prose brief
├── extractors/<name>.md       # extractor definitions (assay stage)
├── memory.db                  # live Cozo store (gitignored)
├── memory.db-wal              # WAL (gitignored)
└── memory.db-shm              # shared memory (gitignored)

foundry-memory/                # row data (committed)
└── relations/<type>.ndjson    # one line per row, source of truth for memory contents
```

`schema.json` is a **canonicalised** (fully key-sorted) derivation of the entity/edge files plus the active embedding configuration. It is a diff-friendly artefact of the vocabulary, not a source of truth — regenerated by the admin tools.

## Embeddings

Optional. When `embeddings.enabled: true` in `config.md`, entity values are embedded against an OpenAI-compatible endpoint (default: local Ollama) and stored in a typed `<F32; N>?` column backed by an HNSW index. The `foundry_memory_search` tool exposes semantic nearest-neighbour search over entity values; `change-embedding-model` re-embeds all entities when the model changes. With embeddings disabled, everything else (graph, query, neighbours) still works.
