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

## Protocol

### 1. Understand

Ask for `name`. List existing edge types as multiple choice options. Warn about the destructive nature: this deletes all edges of this type.

### 2. Plan

Present a preview: call `foundry_memory_drop_edge_type({ name: "<name>", confirm: false })`. This returns `{ requiresConfirm: true, preview: { rows } }` — show the user the row count that will be deleted.

Summarise: "Drop edge type `<name>` — this will delete the edge type and all its edges. This action cannot be undone."

### 3. Confirm

Ask: "Proceed?" with explicit confirmation required. Wait for the user's answer. Do not proceed to Build unless the user says yes. If the user rejects the plan, return to the Understand phase and adjust.

### 4. Build

1. **Execute**: Call `foundry_memory_drop_edge_type({ name: "<name>", confirm: true })`.
2. **Commit**: Run `git add -A foundry/memory/ foundry-memory/relations/`. Run `git commit -m "refactor(memory): drop edge type <name>"`. Report the commit hash.
