---
name: drop-memory-edge-type
type: atomic
description: Delete an edge type and all its rows
---

# Drop Memory Edge Type

**Destructive.** Deletes all edges of this type.

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
