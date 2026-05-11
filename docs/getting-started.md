# Getting Started

End-to-end walkthrough for setting up Foundry and running your first flow.

---

## Prerequisites

- A git repository initialised with a clean working tree.
- Node.js ≥ 18.3.0 (for the plugin and validation scripts).
- [OpenCode](https://opencode.ai) (primary target — multi-model routing relies on OpenCode's agent files).

## Install

Add Foundry to `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["@really-knows-ai/foundry"]
}
```

OpenCode resolves the package itself — `npm install` is **not** required. Restart OpenCode (or reload plugins) so the plugin registers its tools and skills.

Optionally, if you want the package available to your project's local node_modules (for editor tooling or scripts), run:

```sh
npm install --save-dev @really-knows-ai/foundry
```

## Initialise

In your project, invoke the `init-foundry` skill. It:

1. Creates the `foundry/` directory structure:
   ```
   foundry/
     artefacts/.gitkeep
     flows/.gitkeep
     cycles/.gitkeep
     laws/.gitkeep
     appraisers/.gitkeep
   ```
2. Calls `foundry_refresh_agents()` to generate `.opencode/agents/foundry-*.md` — one per available model — so cycles can dispatch to specific models later.
3. Commits the scaffolding.

The `.foundry/` runtime directory (holding `.secret` for stage tokens) is created automatically on first plugin boot and added to `.gitignore`.

---

## Author the configuration

Foundry's configuration is five things: artefact types, laws, appraisers, cycles, and flows. You can write the files by hand, but the authoring skills do conflict checking, scaffolding, and validation — use them.

Before using any schema-writing skill, open a config branch. All schema-mutation tools (`foundry_config_create_*`, `foundry_memory_create_*`, `foundry_extractor_create`, the memory admin family) refuse off `main` and off flow branches:

```text
foundry_git_branch({ kind: "config", description: "<short-name>" })
```

This typically puts you on `config/<short-name>` from `main`. Make all the
edits below on this branch, then `foundry_git_finish({ message: "...",
baseBranch: "main", confirm: true })` squashes the work back to
`main` in one commit. To trial the in-progress edits against a real
flow before merging, see "Trial config edits with dry-run" below.

### 1. Define an artefact type

Run `add-artefact-type`. It walks you through:

- `id` (lowercase, hyphenated), `name`, prose description.
- `file-patterns` — glob patterns describing which files this type owns. Forge's write scope is exactly these patterns; anything written outside them violates the cycle. The skill refuses patterns that overlap with existing types.
- Appraiser config — how many appraisers evaluate this type and which personalities are allowed.
- Optional `laws.md` — type-specific criteria, with optional validators for deterministic checks.

Produces `foundry/artefacts/<id>/definition.md` (+ optional `laws.md`).

### 2. Write laws

Laws are subjective pass/fail criteria evaluated by appraisers. Two scopes:

- **Global** — `foundry/laws/*.md`. All files are concatenated and apply to every artefact.
- **Type-specific** — `foundry/artefacts/<type>/laws.md`.

Run `add-law` to create one with conflict detection. Each law is a `## heading` (its identifier, referenced as `law:<id>` in feedback) with a description, passing criteria, and failing criteria.

### 3. Create appraisers

Appraisers are independent evaluators with named personalities. Run `add-appraiser`. Each appraiser may override the cycle-level appraise model via a `model` field. Artefact types pick which appraisers may evaluate them (`appraisers.allowed`).

### 4. Define a cycle

Run `add-cycle`. A cycle produces one artefact type and declares:

- `output-type` — the artefact type (must already exist).
- `inputs` — a contract (`any-of` or `all-of`) over other types. Empty for starting cycles.
- `targets` — the cycle(s) that may run after this one. Empty for terminal cycles.
- `human-appraise` / `deadlock-appraise` / `deadlock-iterations` — human-gate config.
- `models` — optional per-stage model overrides.

Example:

```markdown
---
id: haiku-creation
name: Haiku Creation
output-type: haiku
inputs:
  type: any-of
  artefacts:
    - petition
targets: []
human-appraise: false
deadlock-appraise: true
deadlock-iterations: 5
models:
  appraise: openai/gpt-5
---

# Haiku Creation

Writes a haiku satisfying the petition produced by haiku-ideation.
```

The skill validates that every input type can be produced by some cycle in the flow and that targets are reachable.

### 5. Define a flow

Run `add-flow`. A flow groups cycles and declares starting points:

```markdown
---
id: make-haiku
name: Make a Haiku
starting-cycles:
  - haiku-ideation
---

# Make a Haiku

End-to-end flow: petition → haiku, with a human quality gate.

## Cycles

- haiku-ideation
- haiku-creation
```

Routing between cycles is owned by individual cycles via their `targets`, not by the flow.

### 6. Validate before writing (optional)

Each `add-*` skill writes and commits in one step. When you want to validate a draft body without committing it, call the matching validator first:

```text
foundry_config_validate_artefact_type({ name, body })
foundry_config_validate_law({ name, body })
foundry_config_validate_appraiser({ name, body })
foundry_config_validate_cycle({ name, body })
foundry_config_validate_flow({ name, body })
```

Validators return `{ok: true}` on success or
`{ok: false, errors: [...]}` on a parse / schema / overlap problem; nothing
is written either way. Once the validator is happy, call the
matching `_create_*` tool to commit it.

---

## Run the flow

Tell OpenCode something like:

> Run the `make-haiku` flow to write a haiku about autumn rain.

The `flow` skill will:

1. Check prerequisites and pick a starting cycle — matching your prose to a cycle's output type. If the request is ambiguous, it prompts (defaulting to `starting-cycles`). If a cycle's input contract can't be satisfied from files on disk, it won't be chosen.
2. Create a work branch and scaffold `WORK.md` with the goal.
3. Hand off to `orchestrate`, which drives the cycle:
   - **forge** writes the artefact.
   - **quench** runs CLI validators (if configured).
   - **appraise** dispatches parallel appraiser sub-agents and consolidates their `law:<id>` feedback.
   - **human-appraise** (if configured, or on deadlock) asks you for input.
   - If any unresolved feedback remains, another forge iteration begins.
4. When the cycle completes, the flow skill checks the cycle's `targets`. If a target's input contract is satisfied, it asks whether to proceed.
5. When all desired cycles are done, the flow skill summarises the output and asks how to finish — squash-merge, PR, or leave the branch.

Every stage ends with a micro-commit. Violations of the write invariant (writing to disallowed files) hard-stop the cycle.

---

## Trial config edits with dry-run

When you've changed a law, an appraiser, or a cycle on a `config/*`
branch and want to see how the change behaves end-to-end before
merging, use dry-run mode.

```text
# starting on a config/* branch with the in-progress edit
foundry_git_branch({ kind: "dry-run", flowId: "make-haiku",
                     description: "stricter-imagery-law" })
# now on dry-run/<parent>/make-haiku-stricter-imagery-law

# run the flow as you normally would
# every foundry_* call is traced to .foundry/trace/<branch>.jsonl

foundry_git_finish({ message: "trial: stricter imagery law", confirm: true })
# writes .snapshots/<run-id>/{README.md, work/WORK*, diff.patch, trace.jsonl}
# on the parent config/* working tree and force-deletes the dry-run branch
```

Inspect the snapshot at `.snapshots/<run-id>/`, decide whether to keep
the config edit, and either commit/merge from the parent `config/*`
branch or revise and trial again. Snapshots are local artefacts and
never committed by foundry. See the `dry-run` skill for the full loop.

---

## Inspecting progress

While a flow is running, the state of the world is in four places:

- `WORK.md` — current cycle, goal, and artefact table.
- `WORK.feedback.yaml` — feedback items and their lifecycle history.
- `WORK.history.yaml` — append-only stage execution log.
- `git log` — one commit per stage.

You can pause and resume: if the flow skill sees an existing `WORK.md` when you start, it asks whether to resume, discard, or abort. Resume is only offered if the existing flow and cycle match the current request.

### Recovering a failed flow

A guard violation, a broken extractor in `assay`, or any other
unrecoverable error marks the workfile failed (`status: failed` in
`WORK.md` frontmatter, with a `reason`). Ordinary mutating tools refuse
once that flag is set, but recovery and cleanup tools such as
`foundry_stage_end`, `foundry_stage_retry()`, and
`foundry_workfile_delete({ confirm: true })` remain available. Read-only
diagnostics (`foundry_workfile_get`, `foundry_history_list`,
`foundry_memory_*` read-side, read-only `foundry_config_*`, and
`foundry_config_validate_*`) keep working so you can figure out what
went wrong.

Recovery has two paths:

- `foundry_stage_retry()` clears the failed state, discards uncommitted in-memory changes, clears `.foundry/last-stage.json`, and lets you re-run the blocked stage. It requires a failed flow, no active stage, and a clean git working tree.
- `foundry_workfile_delete({ confirm: true })` abandons the cycle entirely by removing `WORK.md`, `WORK.feedback.yaml`, and `WORK.history.yaml` from the work branch.

Use `foundry_stage_retry()` when the underlying problem is fixed and you want to continue the current cycle. Use `foundry_workfile_delete({ confirm: true })` when you want to abandon the run and start again.

---

## Cleaning up

When a flow completes, `foundry_git_finish` handles integration with audit guarantees. On `work/*` branches, it commits `WORK.*` cleanup, preserves the branch as `archive/work/<flow>-<desc>-<hash>` for immutable forensic history, squash-merges to the base branch, and creates a signed commit whose message embeds the canonical Foundry attestation block. See [`docs/tools.md`](./tools.md#foundry_git_finish) for the full contract.

---

## Optional: flow memory

Foundry ships a typed, graph-shaped memory store that persists across cycles. Use it when your flows are codebase-aware, require multi-cycle discovery, reuse project facts across runs, or perform semantic search when embeddings are enabled. Memory is strictly opt-in — skip this section if your project doesn't need shared state across flows.

### Initialise

Memory init and vocabulary edits are schema mutations, so they run
on a config branch — open one first if you are not already on it
(`foundry_git_branch({ kind: "config", description: "memory-setup" })`).

Run the `init-memory` skill. It asks whether to enable embeddings (default: yes, targeting local Ollama `nomic-embed-text` on `http://localhost:11434/v1`) and then invokes `foundry_memory_init`, which deterministically:

- creates `foundry/memory/entities/` and `edges/` (each with `.gitkeep`) plus the top-level sibling `foundry-memory/relations/` for committed row data,
- writes `foundry/memory/config.md` (frontmatter driven by your embeddings choice) and `foundry/memory/schema.json`,
- appends `foundry/memory/memory.db*` entries to `.gitignore` (idempotent),
- probes the embedding provider if enabled; if the probe fails, the skill offers three remedies (install/start Ollama, point at a different OpenAI-compatible endpoint, or disable embeddings).

### Declare vocabulary

Two concepts: **entity types** (things memory knows about, e.g. `class`, `method`) and **edge types** (directed relationships, e.g. `calls`, `references`).

- `add-memory-entity-type` — name + prose body (naming convention, what `value` should contain, likely related edges). The body is injected into the prompt of every cycle that reads/writes this type, so write it for an LLM reader.
- `add-memory-edge-type` — name, `sources` (list of entity types or `any`), `targets` (list or `any`), and a prose body that describes **when** the edge holds and **what it does not cover**.

Both skills commit their work. The vocabulary lives in `foundry/memory/entities/` and `foundry/memory/edges/`; committed row data lives in the top-level sibling `foundry-memory/relations/<name>.ndjson`.

### Give cycles memory permissions

Memory is per-cycle opt-in. Add a `memory:` block to any cycle that should see it:

```yaml
---
id: extract-methods
output-type: method-notes
memory:
  read:  [class]
  write: [method]
---
```

- Types in `read` become visible (the cycle's dispatched prompt lists them along with `foundry_memory_get`, `foundry_memory_list`, `foundry_memory_neighbours`, `foundry_memory_query`, and — if embeddings are on — `foundry_memory_search`).
- Types in `write` additionally expose `foundry_memory_put`, `foundry_memory_relate`, `foundry_memory_unrelate`.
- **`read` and `write` are independent.** Entity reads check only the `read` set — a type listed in `write` only is writable but not readable. If the cycle needs to read entities of a type before writing them (the common case), list it in **both** `read` and `write`.
- Edges are visible when either endpoint type is in `read` *or* `write`, writable when either endpoint type is in `write`.
- A cycle with no `memory:` block sees no memory tools — same as before.

During a flow, forge stages write into memory and later cycles can read what earlier cycles learned. Out-of-stage memory writes flush to `relations/*.ndjson` immediately, assay flushes during the assay stage, and ordinary in-stage writes become durable at `foundry_stage_end`.

### Runtime population with assay

Use assay when memory should reflect what is actually present in the codebase before forge starts. An assay-enabled cycle declares memory permissions and the extractor names to run at iteration 0:

```yaml
memory:
  read:  [class, method]
  write: [class, method]
assay:
  extractors: [java-symbols]
```

Create the extractor definition with `add-extractor`. The definition lives at `foundry/memory/extractors/<name>.md`; its `command` runs from the project root and emits one JSON object per line. `foundry_assay_run` parses that JSONL, validates the rows against the extractor and cycle write scopes, and upserts the accepted entities and edges into flow memory.

Assay runs once before the first forge of the cycle. Successful extractor rows are flushed to `foundry-memory/relations/*.ndjson`, so later forge stages and downstream cycles can query the same committed facts. Extractor failures mark `WORK.md` failed because forge cannot fix instrumentation scripts inside an artefact revision. See [Extractor](concepts.md#extractor) for the JSONL contract and failure semantics.

### Maintenance

- **Destructive operations** (`drop-memory-entity-type`, `drop-memory-edge-type`) call their tool first with `confirm: false` (the default) to get a preview (`entityRows`, affected edges with `cascadeDrop` vs `prune`), ask for explicit confirmation, then call again with `confirm: true`.
- **Renames** (`rename-memory-entity-type`, `rename-memory-edge-type`) cascade through entity/edge files, relations, and schema.
- **`reset-memory`** purges all row data but preserves type definitions.
- **`change-embedding-model`** probes the new provider, re-embeds every entity, rewrites `schema.json` and `config.md`. Nothing is written on failure.
- The live `memory.db` is gitignored and always rebuildable from `relations/*.ndjson` on store open. Orphan relations from interrupted drops/renames are reconciled automatically.

### Further reading

- [docs/concepts.md](concepts.md) — the glossary entries for flow memory, entity/edge, permissions, embeddings.
- [docs/memory-maintenance.md](memory-maintenance.md) — Cozo 0.7 adaptations and session lifecycle constraints (contributor-facing).

---

## Next steps

- [docs/concepts.md](concepts.md) — concise glossary.
- [docs/work-spec.md](work-spec.md) — full WORK.md spec.
- [README.md](../README.md) — architecture, enforcement, design decisions.
- [CHANGELOG.md](../CHANGELOG.md) — version history.
