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

- `output` — the artefact type it produces (read-write).
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

Every stage runs inside a token-gated lifecycle (`foundry_stage_begin` / `foundry_stage_end` / `foundry_stage_finalize`). Mutation tools are stage-locked: a forge stage can't add feedback, a quench stage can't register artefacts. See the enforcement section of the [README](../README.md#enforcement-model).

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
- All feedback with its full lifecycle.

See [work-spec.md](work-spec.md) for the full spec.

## WORK.history.yaml

Append-only log of every stage execution, sitting next to WORK.md. Used by sort to reconstruct what has happened in the current cycle. See [work-spec.md](work-spec.md).

## Feedback

The communication mechanism between stages. Written as markdown checklist items in WORK.md, grouped by artefact file, tagged by source:

- `#validation` — from a deterministic quench command. Cannot be wont-fixed.
- `#law:<law-id>` — from an appraiser, tied to a specific law. May be wont-fixed with justification.
- `#human` — from a human-appraise stage. Takes absolute priority; cannot be wont-fixed.

Lifecycle: `open` → `actioned` / `wont-fix` → `approved` / `rejected`. `approved` is terminal; `rejected` re-opens. Items are never deleted.

## HITL / human-appraise

Human-in-the-loop checkpoint. A stage where Foundry pauses and asks a human for input. Two triggers:

1. **Every-iteration** — the cycle declares `human-appraise: true`. The `human-appraise` stage runs after LLM appraise each iteration.
2. **Deadlock** — the cycle declares `deadlock-appraise: true` (default). If forge and appraisers ping-pong on the same items for `deadlock-iterations` (default 5) iterations, sort inserts a `human-appraise` stage to break the tie.

Human feedback is tagged `#human` and takes priority over LLM feedback on the same topic.

## Micro-commit

Every stage ends with a commit made by the orchestrator. This enables two things: file-modification enforcement (the write-invariant check compares the stage's diff to its allowed patterns) and recoverability (a crash mid-flow leaves a clean commit boundary to resume from). Orchestration refuses to proceed if uncommitted work is lingering in `WORK.md`, `WORK.history.yaml`, or `.foundry/`.

## Stage token

A single-use HMAC-signed string, minted by `foundry_orchestrate` when a stage is dispatched. The sub-agent must redeem the token via `foundry_stage_begin`; mutation tools then check the active stage matches their role. Keys live in `.foundry/.secret` (mode 0600, gitignored, one per worktree). This prevents out-of-band mutations, replayed stages, and sub-agents skipping the lifecycle.

## `.foundry/` state directory

A gitignored directory created on first plugin boot, holding runtime state:

- `.secret` — the HMAC key.
- `active-stage.json` — present only during an active stage.
- `last-stage.json` — used by `foundry_stage_finalize` after `stage_end`.

## Custom tools

All deterministic pipeline operations are exposed as custom tools by the Foundry plugin. Skills call these tools instead of manipulating files directly. Tools are backed by shared library modules in `scripts/lib/` with injectable I/O so they can be unit-tested. This separation ensures state transitions and routing logic are tested code, not LLM interpretation. See the [README](../README.md#custom-tools) for the full catalogue.

## Skill

A self-contained workflow written as markdown with YAML frontmatter. Foundry ships pipeline skills (`flow`, `orchestrate`, `forge`, `quench`, `appraise`, `human-appraise`), authoring skills (`add-*`, `init-foundry`), utility skills (`list-agents`, `refresh-agents`, `upgrade-foundry`), and memory skills (`init-memory`, `add-memory-*`, `rename-memory-*`, `drop-memory-*`, `reset-memory`, `change-embedding-model`). Skills are either **atomic** (do one thing) or **composite** (orchestrate other skills).

---

## Flow memory

A typed, graph-shaped knowledge store shared across cycles in a project. Strictly opt-in: a project without `foundry/memory/` has no memory and behaves exactly as previous Foundry versions.

When present, memory is populated and consulted by cycles that declare read/write permissions in their frontmatter. Its vocabulary is injected into the dispatched stage's prompt, and its contents survive across flows as long as the NDJSON relations stay committed.

See also: [docs/memory-maintenance.md](memory-maintenance.md) for contributor-facing notes on Cozo 0.7 and session lifecycle.

## Entity / entity type

An **entity** is one row in memory: `{ type, name, value }`, where `value` is free text describing the entity's intrinsic characteristics (≤ 4 KB). Relationships belong in edges, not in the value.

An **entity type** is declared once per project in `foundry/memory/entities/<type>.md`. Its markdown body is a prose brief — naming convention, what `value` should contain, likely related edges — that becomes part of every cycle's prompt that reads or writes this type. Create types with `add-memory-entity-type`.

## Edge / edge type

An **edge** is one row relating two entities: `{ from_type, from_name, edge_type, to_type, to_name }`. Edges are directed.

An **edge type** declares allowed endpoints — `sources` and `targets` are either a list of entity types or the literal `any` — and a prose body describing when the edge holds. Declared in `foundry/memory/edges/<name>.md`. Create with `add-memory-edge-type`.

## Memory permissions

Per-cycle opt-in, specified in cycle frontmatter:

```yaml
memory:
  read:  [class, method]      # types this cycle can read
  write: [method]             # types this cycle can upsert into
```

A cycle with no `memory:` block gets no memory tools in its prompt. Edge permissions are derived: an edge is readable if either endpoint type is readable, writable if either endpoint type is writable. `foundry_memory_query` also restricts referenced `ent_*` / `edge_*` relations to the read set.

## `foundry/memory/` layout

```
foundry/memory/
├── config.md                 # frontmatter: enabled, validation, embeddings
├── schema.json               # canonical, deterministic, derived from entity/edge files
├── entities/<type>.md        # prose brief per entity type
├── edges/<name>.md           # frontmatter (sources/targets) + prose brief
├── relations/<type>.ndjson   # committed row data, one line per row
├── memory.db                 # live Cozo store (gitignored)
├── memory.db-wal             # WAL (gitignored)
└── memory.db-shm             # shared memory (gitignored)
```

`schema.json` is a **canonicalised** (fully key-sorted) derivation of the entity/edge files plus the active embedding configuration. It is a diff-friendly artefact of the vocabulary, not a source of truth — regenerated by the admin tools.

## Embeddings

Optional. When `embeddings.enabled: true` in `config.md`, entity values are embedded against an OpenAI-compatible endpoint (default: local Ollama) and stored in a typed `<F32; N>?` column backed by an HNSW index. The `foundry_memory_search` tool exposes semantic nearest-neighbour search over entity values; `change-embedding-model` re-embeds all entities when the model changes. With embeddings disabled, everything else (graph, query, neighbours) still works.
