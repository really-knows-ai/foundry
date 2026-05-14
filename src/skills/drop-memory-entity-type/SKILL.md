---
name: drop-memory-entity-type
type: atomic
description: Delete an entity type; cascades to affected edges
---

# Drop Memory Entity Type

**Destructive.** This deletes all rows of this type and strips or removes any
edges that reference it.

## Prerequisites

Before running this skill, verify all of the following:

1. The `foundry/` directory exists in the project root. If it does not
   exist, stop and tell the user:

   > Restart OpenCode to initialise Foundry, then retry this command.

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
   if not).

## Steps

1. Ask the user for the type name.
2. Invoke `foundry_memory_drop_entity_type` with `{ name, confirm: false }` (or omit `confirm`). This returns `{ requiresConfirm: true, preview: { entityRows, affectedEdges: [...] } }`. Show the user:
   - `entityRows` — number of entities of this type that will be deleted.
   - For each `affectedEdges` entry: `cascadeDrop` means the whole edge type disappears; `prune` means `rowsAffected` rows will be removed but the edge type survives.
3. Require explicit "yes, delete it" confirmation.
4. Invoke `foundry_memory_drop_entity_type` again with `{ name, confirm: true }`.
5. Commit:

   ```bash
   git add -A foundry/memory/ foundry-memory/relations/
   git commit -m "refactor(memory): drop entity type <name>"
   ```
