---
name: rename-memory-edge-type
type: atomic
description: Rename an edge type (does not touch row data)
---

# Rename Memory Edge Type

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

4. Memory is initialised. The `from` edge type must exist; the `to`
   name must be free.

## Steps

1. Ask the user for `from` and `to`.
2. Invoke `foundry_memory_rename_edge_type` with `{ from, to }`.
3. Commit:

   ```bash
   git add -A foundry/memory/ foundry-memory/relations/
   git commit -m "refactor(memory): rename edge type <from> -> <to>"
   ```
