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

   > Restart OpenCode to initialise Foundry, then retry this command.

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

## Protocol

### 1. Understand

Warn about the destructive nature: this permanently deletes all memory data including entity types, edge types, and embeddings. This action cannot be undone.

Ask the user to type "reset" to confirm intent. The user must type "reset" to proceed past the Understand phase.

### 2. Plan

Present a destructive-action summary: "This will permanently delete all memory data including entity types, edge types, and embeddings. This action cannot be undone."

### 3. Confirm

Ask: "Proceed?" — this is the final gate. Wait for the user's answer. Do not proceed to Build unless the user says yes. If the user rejects the plan, return to the Understand phase.

### 4. Build

1. **Execute**: Call `foundry_memory_reset({ confirm: true })`.
2. **Commit**: Run `git add foundry-memory/relations/ foundry/memory/schema.json`. Run `git commit -m "chore(memory): reset memory data"`. Report the commit hash.
