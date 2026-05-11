---
name: reset-memory
type: atomic
description: Purge all memory data (entities and edges) while keeping type definitions
---

# Reset Memory

**Destructive.** Empties every relation file and deletes the live `.db`. Type
definitions are preserved.

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

3. If the branch does not start with `config/`, move to a suitable
   `config/*` branch internally when the current branch is safe. If
   the current branch is `work/*` or `dry-run/*/*`, stop and explain
   the active work must be finished first. When unrelated uncommitted
   changes could be affected by branching or writing files, ask before
   proceeding.

4. Memory is initialised (`foundry/memory/` exists; initialise it
   internally if not). After the reset completes, continue the user's
   original request from context.

## Steps

1. Warn the user of the scope.
2. Require explicit confirmation.
3. Invoke `foundry_memory_reset` with `{ confirm: true }`.
4. Commit:

   ```bash
   git add foundry-memory/relations/ foundry/memory/schema.json
   git commit -m "chore(memory): reset memory data"
   ```
