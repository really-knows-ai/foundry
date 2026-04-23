---
name: init-memory
type: atomic
description: Initialize flow memory by creating the foundry/memory/ directory structure
---

# Initialize Flow Memory

Scaffold `foundry/memory/` in the current project. This prepares the directory
for entity types, edge types, committed NDJSON relations, and a gitignored
Cozo database.

## Prerequisites

- `foundry/` must already exist. If it does not, stop and tell the user to run
  `init-foundry` first.
- `foundry/memory/` must not already exist.

## Steps

1. **Ask the user** whether to enable embeddings (semantic search).
   - Default: **yes**, targeting a local Ollama instance
     (`http://localhost:11434/v1`, `nomic-embed-text`, 768 dims).
   - If the user declines, note it and pass `embeddings_enabled: false` in
     step 2.

2. **Invoke `foundry_memory_init`** with `{ embeddings_enabled, probe: true }`.

   The tool deterministically:
   - creates `entities/`, `edges/`, `relations/` with `.gitkeep`,
   - writes `config.md` (frontmatter set from the embeddings choice),
   - writes `schema.json` (`embeddings: {...}` when enabled, `null` when not),
   - appends the three `foundry/memory/memory.db*` entries to `.gitignore`
     idempotently,
   - probes the embedding provider (only when enabled) and returns the result.

   It fails if `foundry/memory/` already exists.

3. **Handle the probe result** (field `probe` in the return value).
   - `probe == null`: embeddings disabled, skip.
   - `probe.ok == true`: continue.
   - `probe.ok == false`: present the user with these options:
     1. Install/start Ollama and `ollama pull nomic-embed-text`, then invoke
        `foundry_memory_validate` to re-check.
     2. Edit `foundry/memory/config.md` frontmatter to point at a different
        OpenAI-compatible endpoint, then invoke `foundry_memory_validate`.
     3. Set `embeddings.enabled: false` in `foundry/memory/config.md`.

4. **Commit the scaffold**:

   ```bash
   git add foundry/memory/ .gitignore
   git commit -m "feat: initialise flow memory"
   ```

5. **Tell the user what is next**:

   > Flow memory is scaffolded. Next steps:
   >
   > - Use `add-memory-entity-type` to declare entity types (e.g. `class`,
   >   `method`, `table`).
   > - Use `add-memory-edge-type` to declare edge types (e.g. `calls`,
   >   `writes`, `references`).
