---
name: init-memory
type: atomic
description: Initialise flow memory by creating the foundry/memory/ and foundry-memory/ directory structures
---

# Initialise Flow Memory

Scaffold `foundry/memory/` (config) and `foundry-memory/relations/` (row data)
in the current project. `foundry/memory/` holds entity-type and edge-type
definitions, the schema, the config, and the gitignored Cozo database.
`foundry-memory/relations/` is a top-level sibling of `foundry/` that holds
the committed NDJSON relations.

## Prerequisites

Before running this skill, verify all of the following:

1. The `foundry/` directory exists in the project root. If it does not
   exist, stop and tell the user:

   > Foundry is not initialized in this project. Run the
   > `init-foundry` skill first to create the foundry/ directory
   > structure.

2. The current git branch is a `config/*` branch. Run
   `git rev-parse --abbrev-ref HEAD` and confirm it matches
   `config/<description>`.

3. If the branch does not start with `config/`, instruct the user to
   create one before continuing:

   > Foundry configuration changes must be made on a config/* branch.
   > If configuration changes are needed, move to a suitable `config/*`
   > branch internally when the current branch is safe. If the current
   > branch is `work/*` or `dry-run/*/*`, stop and explain the active
   > work must be finished first.
   >
   > After the prerequisite is handled, continue the user's original
   > request from the current context.

Neither `foundry/memory/` nor `foundry-memory/` may already exist.

## Steps

1. **Ask the user** whether to enable embeddings (semantic search).
   - Default: **yes**, targeting a local Ollama instance
     (`http://localhost:11434/v1`, `nomic-embed-text`, 768 dims).
   - If the user declines, note it and pass `embeddings_enabled: false` in
     step 2.

2. **Invoke `foundry_memory_init`** with `{ embeddings_enabled, probe: true }`.

   The tool deterministically:
   - creates `foundry/memory/entities/` and `foundry/memory/edges/` with `.gitkeep`,
   - creates `foundry-memory/relations/` (top-level sibling of `foundry/`) with `.gitkeep`,
   - writes `foundry/memory/config.md` (frontmatter set from the embeddings choice),
   - writes `foundry/memory/schema.json` (`embeddings: {...}` when enabled, `null` when not),
   - appends the three `foundry/memory/memory.db*` entries to `.gitignore`
     idempotently,
   - probes the embedding provider (only when enabled) and returns the result.

   It fails if either `foundry/memory/` or `foundry-memory/` already exists.

3. **Handle the probe result** (field `probe` in the return value).
   - `probe == null`: embeddings disabled, skip.
   - `probe.ok == true`: display `✓ Embedding provider responded (dimensions: N)` 
     where N is `probe.dimensions`, then continue.
   - `probe.ok == false`: present the user with these options:
     1. Install/start Ollama and `ollama pull nomic-embed-text`, then invoke
        `foundry_memory_validate` to re-check.
     2. Edit `foundry/memory/config.md` frontmatter to point at a different
        OpenAI-compatible endpoint, then invoke `foundry_memory_validate`.
     3. Set `embeddings.enabled: false` in `foundry/memory/config.md`.

4. **Commit the scaffold**:

   ```bash
   git add foundry/memory/ foundry-memory/ .gitignore
   git commit -m "feat: initialise flow memory"
   ```

5. **Continue the user's original request**:

   > Flow memory is scaffolded. The Foundry agent will continue to define
   > memory entity and edge types as needed to support your goal.
