---
name: change-embedding-model
type: atomic
description: Swap the embedding model for memory and re-embed all existing entities
---

# Change Embedding Model

Update `foundry/memory/config.md` to target a new OpenAI-compatible endpoint / model
and re-embed every existing entity.

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
   > From a clean main branch, call:
   >
   > `foundry_git_branch({ kind: "config", description: "<short-name>" })`
   >
   > Then re-run this skill.

   If the user is on a `dry-run/*/*` branch, they must finish
   that dry-run first (`foundry_git_finish({ message, confirm: true })`)
   before re-running this skill on the parent `config/*`.

4. Memory is initialised and enabled. The new provider is reachable
   from this machine. Allow enough time and bandwidth to re-embed
   (O(#entities) requests in batches).

## Steps

1. **Ask the user for**: `model`, `dimensions`, optionally new `baseURL`, `apiKey`.
2. **Invoke `foundry_memory_change_embedding_model`** with `{ model, dimensions, baseURL?, apiKey? }`.
   The tool probes the new provider, re-embeds every entity, rewrites
   `schema.json`, and then updates `foundry/memory/config.md` frontmatter to
   match. On probe or re-embed failure, nothing is written.
3. **Verify** by invoking `foundry_memory_search` with a sample query.
4. **Commit**:

   ```bash
   git add foundry/memory/config.md foundry/memory/schema.json foundry-memory/relations/
   git commit -m "chore(memory): change embedding model to <model>"
   ```
