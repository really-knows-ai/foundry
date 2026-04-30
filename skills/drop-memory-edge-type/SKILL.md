---
name: drop-memory-edge-type
type: atomic
description: Delete an edge type and all its rows
---

# Drop Memory Edge Type

**Destructive.** Deletes all edges of this type.

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

4. Memory is initialised (`foundry/memory/` exists; run `init-memory`
   if not).

## Steps

1. Ask the user for the edge type name.
2. Invoke `foundry_memory_drop_edge_type` with `{ name, confirm: false }` (or omit `confirm`). This returns `{ requiresConfirm: true, preview: { rows } }` — show the user the row count that will be deleted.
3. Require explicit "yes, delete it" confirmation.
4. Invoke `foundry_memory_drop_edge_type` again with `{ name, confirm: true }`.
5. Commit:

   ```bash
   git add -A foundry/memory/
   git commit -m "refactor(memory): drop edge type <name>"
   ```
