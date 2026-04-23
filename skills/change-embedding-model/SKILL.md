---
name: change-embedding-model
type: atomic
description: Swap the embedding model for memory and re-embed all existing entities
---

# Change Embedding Model

Update `foundry/memory/config.md` to target a new OpenAI-compatible endpoint / model
and re-embed every existing entity.

## Prerequisites

- Memory is initialised and enabled.
- The new provider is reachable from this machine.
- Enough time and bandwidth to re-embed (O(#entities) requests in batches).

## Steps

1. **Ask the user for**: `model`, `dimensions`, optionally new `baseURL`, `apiKey`.
2. **Invoke `foundry_memory_change_embedding_model`** with `{ model, dimensions, baseURL?, apiKey? }`.
   The tool probes the new provider, re-embeds every entity, rewrites
   `schema.json`, and then updates `foundry/memory/config.md` frontmatter to
   match. On probe or re-embed failure, nothing is written.
3. **Verify** by invoking `foundry_memory_search` with a sample query.
4. **Commit**:

   ```bash
   git add foundry/memory/config.md foundry/memory/schema.json foundry/memory/relations/
   git commit -m "chore(memory): change embedding model to <model>"
   ```
