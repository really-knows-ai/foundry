---
name: reset-memory
type: atomic
description: Purge all memory data (entities and edges) while keeping type definitions
---

# Reset Memory

**Destructive.** Empties every relation file and deletes the live `.db`. Type
definitions are preserved.

## Steps

1. Warn the user of the scope.
2. Require explicit confirmation.
3. Invoke `foundry_memory_reset` with `{ confirm: true }`.
4. Commit:

   ```bash
   git add foundry/memory/relations/ foundry/memory/schema.json
   git commit -m "chore(memory): reset memory data"
   ```
