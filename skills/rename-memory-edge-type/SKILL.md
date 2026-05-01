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
   > From a clean main branch, call:
   >
   > `foundry_git_branch({ kind: "config", description: "<short-name>" })`
   >
   > Then re-run this skill.

   If the user is on a `dry-run/*/*` branch, they must finish
   that dry-run first (`foundry_git_finish({ message, confirm: true })`)
   before re-running this skill on the parent `config/*`.

4. Memory is initialised. The `from` edge type must exist; the `to`
   name must be free.

## Steps

1. Ask the user for `from` and `to`.
2. Invoke `foundry_memory_rename_edge_type` with `{ from, to }`.
3. Commit:

   ```bash
   git add foundry/memory/ foundry-memory/relations/
   git commit -m "refactor(memory): rename edge type <from> -> <to>"
   ```
