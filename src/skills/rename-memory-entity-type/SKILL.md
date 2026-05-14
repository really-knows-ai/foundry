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

4. Memory is initialised. The `from` entity type must exist; the `to`
   name must be free (no existing entity or edge).

## Protocol

### 1. Understand

Ask for `from` and `to` one question at a time. List existing entity types as multiple choice options for `from`. Warn about the destructive nature: this rewrites committed NDJSON rows in every edge that references the entity.

### 2. Plan

Present a summary: "Rename entity type `<from>` → `<to>`."

### 3. Confirm

Ask: "Proceed?" — wait for the user's answer. Do not proceed to Build unless the user says yes. If the user rejects the plan, return to the Understand phase and adjust.

### 4. Build

1. **Validate**: Check that `<to>` does not conflict with existing entity or edge types. Call `foundry_memory_validate` if desired.
2. **Execute**: Call `foundry_memory_rename_entity_type({ from: "<from>", to: "<to>" })`.
3. **Commit**: Run `git add -A foundry/memory/ foundry-memory/relations/`. Run `git commit -m "refactor(memory): rename entity type <from> -> <to>"`. Report the commit hash.
