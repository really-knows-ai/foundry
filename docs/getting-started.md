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
  "packages": {
    "@really-knows-ai/foundry": "latest"
  }
}
```

Restart OpenCode (or reload plugins) so the plugin registers its tools and skills.

## Initialize

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
2. Runs `refresh-agents` to generate `.opencode/agents/foundry-*.md` — one per available model — so cycles can dispatch to specific models later.
3. Commits the scaffolding.

The `.foundry/` runtime directory (holding `.secret` for stage tokens) is created automatically on first plugin boot and added to `.gitignore`.

---

## Author the configuration

Foundry's configuration is five things: artefact types, laws, appraisers, cycles, and flows. You can write the files by hand, but the authoring skills do conflict checking, scaffolding, and validation — use them.

### 1. Define an artefact type

Run `add-artefact-type`. It walks you through:

- `id` (lowercase, hyphenated), `name`, prose description.
- `file-patterns` — glob patterns describing which files this type owns. The skill refuses patterns that overlap with existing types.
- `output-dir` — where forge should write new files.
- Appraiser config — how many appraisers evaluate this type and which personalities are allowed.
- Optional `laws.md` — type-specific criteria.
- Optional `validation.md` — CLI commands for quench (non-zero exit = failure).

Produces `foundry/artefacts/<id>/definition.md` (+ optional `laws.md`, `validation.md`).

### 2. Write laws

Laws are subjective pass/fail criteria evaluated by appraisers. Two scopes:

- **Global** — `foundry/laws/*.md`. All files are concatenated and apply to every artefact.
- **Type-specific** — `foundry/artefacts/<type>/laws.md`.

Run `add-law` to create one with conflict detection. Each law is a `## heading` (its identifier, referenced as `#law:<id>` in feedback) with a description, passing criteria, and failing criteria.

### 3. Create appraisers

Appraisers are independent evaluators with named personalities. Run `add-appraiser`. Each appraiser may override the cycle-level appraise model via a `model` field. Artefact types pick which appraisers may evaluate them (`appraisers.allowed`).

### 4. Define a cycle

Run `add-cycle`. A cycle produces one artefact type and declares:

- `output` — the artefact type (must already exist).
- `inputs` — a contract (`any-of` or `all-of`) over other types. Empty for starting cycles.
- `targets` — the cycle(s) that may run after this one. Empty for terminal cycles.
- `human-appraise` / `deadlock-appraise` / `deadlock-iterations` — human-gate config.
- `models` — optional per-stage model overrides.

Example:

```markdown
---
id: haiku-creation
name: Haiku Creation
output: haiku
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
   - **appraise** dispatches parallel appraiser sub-agents and consolidates their `#law:<id>` feedback.
   - **human-appraise** (if configured, or on deadlock) asks you for input.
   - If any unresolved feedback remains, another forge iteration begins.
4. When the cycle completes, the flow skill checks the cycle's `targets`. If a target's input contract is satisfied, it asks whether to proceed.
5. When all desired cycles are done, the flow skill summarises the output and asks how to finish — squash-merge, PR, or leave the branch.

Every stage ends with a micro-commit. Violations of the write invariant (writing to disallowed files) hard-stop the cycle.

---

## Inspecting progress

While a flow is running, the state of the world is in three places:

- `WORK.md` — current cycle, goal, artefact table, all feedback with full lifecycle.
- `WORK.history.yaml` — append-only log of every stage execution.
- `git log` — one commit per stage.

You can pause and resume: if the flow skill sees an existing `WORK.md` when you start, it asks whether to resume, discard, or abort. Resume is only offered if the existing flow and cycle match the current request.

---

## Cleaning up

Before squash-merging the work branch back into main, **delete `WORK.md` and `WORK.history.yaml`** — they're ephemeral per-flow state, not artefacts. `.foundry/` is gitignored and doesn't need cleanup.

If you used `foundry_git_finish`, it handles this for you.

---

## Optional: flow memory

Foundry ships a typed, graph-shaped memory store that persists across cycles. It's strictly opt-in — skip this section if your project doesn't need shared state across flows.

### Initialize

Run the `init-memory` skill. It asks whether to enable embeddings (default: yes, targeting local Ollama `nomic-embed-text` on `http://localhost:11434/v1`) and then invokes `foundry_memory_init`, which deterministically:

- creates `foundry/memory/entities/`, `edges/`, and `relations/` (each with `.gitkeep`),
- writes `foundry/memory/config.md` (frontmatter driven by your embeddings choice) and `foundry/memory/schema.json`,
- appends `foundry/memory/memory.db*` entries to `.gitignore` (idempotent),
- probes the embedding provider if enabled; if the probe fails, the skill offers three remedies (install/start Ollama, point at a different OpenAI-compatible endpoint, or disable embeddings).

### Declare vocabulary

Two concepts: **entity types** (things memory knows about, e.g. `class`, `method`) and **edge types** (directed relationships, e.g. `calls`, `references`).

- `add-memory-entity-type` — name + prose body (naming convention, what `value` should contain, likely related edges). The body is injected into the prompt of every cycle that reads/writes this type, so write it for an LLM reader.
- `add-memory-edge-type` — name, `sources` (list of entity types or `any`), `targets` (list or `any`), and a prose body that describes **when** the edge holds and **what it does not cover**.

Both skills commit their work. The vocabulary lives in `foundry/memory/entities/` and `foundry/memory/edges/`; committed row data lives in `foundry/memory/relations/<name>.ndjson`.

### Give cycles memory permissions

Memory is per-cycle opt-in. Add a `memory:` block to any cycle that should see it:

```yaml
---
id: extract-methods
output: method-notes
memory:
  read:  [class]
  write: [method]
---
```

- Types in `read` become visible (the cycle's dispatched prompt lists them along with `foundry_memory_get`, `foundry_memory_list`, `foundry_memory_neighbours`, `foundry_memory_query`, and — if embeddings are on — `foundry_memory_search`).
- Types in `write` additionally expose `foundry_memory_put`, `foundry_memory_relate`, `foundry_memory_unrelate`.
- Edges are visible when either endpoint type is readable, writable when either endpoint type is writable.
- A cycle with no `memory:` block sees no memory tools — same as before.

During a flow, forge stages write into memory; subsequent cycles read what previous cycles learned. All writes flush to `relations/*.ndjson` so the knowledge is committed alongside the artefacts.

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
