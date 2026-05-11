---
name: add-memory-edge-type
type: atomic
description: Create a new edge type between entity types in flow memory
---

# Add Memory Edge Type

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

4. Memory is initialised (`foundry/memory/` exists; run `init-memory`
   if not). Entity types referenced in `sources` and `targets` must
   already exist (or be added first).

## Steps

1. **Ask the user for**: edge name (snake_case), `sources` (list of entity types or `any`), `targets` (list of entity types or `any`), and a prose body describing what the edge represents.
2. **Push back on narrow wording**. A good edge description describes WHEN the edge holds and what it does NOT cover (boundary with related edges).
3. **Invoke `foundry_memory_create_edge_type`** with `{ name, sources, targets, body }`.
4. **Commit**:

   ```bash
   git add foundry/memory/edges/<name>.md foundry/memory/schema.json
   git commit -m "feat(memory): add edge type <name>"
   ```
