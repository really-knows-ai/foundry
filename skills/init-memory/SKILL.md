---
name: init-memory
type: atomic
description: Initialize flow memory by creating the foundry/memory/ directory structure
---

# Initialize Flow Memory

Scaffold `foundry/memory/` in the current project. This prepares the directory for
entity types, edge types, committed NDJSON relations, and a gitignored Cozo database.

## Prerequisites

- `foundry/` must already exist. If it does not, stop and tell the user to run `init-foundry` first.
- `foundry/memory/` must not already exist. If it does, stop and tell the user.

## Steps

1. **Verify preconditions**
   - If `foundry/` is missing: stop with the message "Run `init-foundry` first."
   - If `foundry/memory/` exists: stop with the message "Memory is already initialised."

2. **Create the directory tree**

   ```
   foundry/memory/
     entities/.gitkeep
     edges/.gitkeep
     relations/.gitkeep
   ```

3. **Write `foundry/memory/config.md`** with this exact content:

   ```markdown
   ---
   enabled: true
   validation: strict
   embeddings:
     enabled: true
     baseURL: http://localhost:11434/v1
     model: nomic-embed-text
     dimensions: 768
     apiKey: null
     batchSize: 64
     timeoutMs: 30000
   ---

   # Memory configuration

   This project uses Foundry flow memory. Add prose notes here if helpful.

   Embedding provider defaults to a local Ollama instance. The embedding probe
   and semantic-search features are added in a later plan; for now, memory can
   be authored and read as a structural knowledge graph.
   ```

4. **Write `foundry/memory/schema.json`** with this exact content:

   ```json
   {
     "version": 1,
     "entities": {},
     "edges": {},
     "embeddings": {
       "model": "nomic-embed-text",
       "dimensions": 768
     }
   }
   ```

   Note: no trailing whitespace, Unix newlines, trailing newline at end of file.
   If `embeddings.enabled` is set to `false` in `config.md`, write `"embeddings": null` instead.

5. **Probe the embedding provider**

   Invoke `foundry_memory_validate`. Then:

   - If `embeddings.enabled` is true in the freshly-written config, invoke a probe using `foundry_memory_search` with `{ query_text: "probe", k: 1 }`. If it returns an error indicating the provider is unreachable or the dimension does not match, stop and show the user these options:
     1. Install and start Ollama, then run `ollama pull nomic-embed-text`, then retry `init-memory`.
     2. Edit `foundry/memory/config.md` to point at a different OpenAI-compatible endpoint (or set `embeddings.enabled: false`), then retry `init-memory`.
   - If the probe succeeds, continue.

6. **Append `.gitignore` entries** (create `.gitignore` if missing; otherwise append only if entries are not already present):

   ```
   foundry/memory/memory.db
   foundry/memory/memory.db-wal
   foundry/memory/memory.db-shm
   ```

7. **Commit the scaffold**

   ```bash
   git add foundry/memory/ .gitignore
   git commit -m "feat: initialise flow memory"
   ```

8. **Tell the user what is next**

   > Flow memory is scaffolded. Next steps:
   >
   > - Use the `add-memory-entity-type` skill (available in a later plan) to declare entity types such as `class`, `method`, `table`.
   > - Use the `add-memory-edge-type` skill (available in a later plan) to declare edge types such as `calls`, `writes`, `references`.
   > - Memory tools are not wired up yet in this phase.
