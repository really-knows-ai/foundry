---
name: rename-memory-entity-type
type: atomic
description: Rename an entity type and migrate all referring edges and rows
---

# Rename Memory Entity Type

## Prerequisites

Before running this skill, verify all of the following:

1. The `foundry/` directory exists in the project root. If it does not
   exist, stop and tell the user:

   > Foundry is not initialized in this project. Run the
   > `init-foundry` skill first to create the foundry/ directory
   > structure.

2. The current git branch is a `config/*` branch. Run
   `git rev-parse --abbrev-ref HEAD` and confirm it matches
   `config/<description>` (a single segment, not `config/.../dry-run/...`).

3. If the branch does not start with `config/`, instruct the user to
   create one before continuing:

   > Foundry configuration changes must be made on a config/* branch.
   > From a clean main branch, call:
   >
   > `foundry_git_branch({ kind: "config", description: "<short-name>" })`
   >
   > Then re-run this skill.

   If the user is on a `config/*/dry-run/*` branch, they must finish
   that dry-run first (`foundry_git_finish({ message, confirm: true })`)
   before re-running this skill on the parent `config/*`.

4. Memory is initialised. The `from` entity type must exist; the `to`
   name must be free (no existing entity or edge).

## Steps

1. Ask the user for `from` and `to`.
2. Warn the user: this rewrites committed NDJSON rows in every edge that references the entity. Preview the change with `foundry_memory_validate` if desired.
3. Invoke `foundry_memory_rename_entity_type` with `{ from, to }`.
4. Commit:

   ```bash
   git add foundry/memory/
   git commit -m "refactor(memory): rename entity type <from> -> <to>"
   ```
