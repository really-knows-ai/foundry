---
name: drop-memory-edge-type
type: atomic
description: Delete an edge type and all its rows
---

# Drop Memory Edge Type

**Destructive.** Deletes all edges of this type.

## Steps

1. Ask the user for the edge type name.
2. Confirm.
3. Invoke `foundry_memory_drop_edge_type` with `{ name, confirm: true }`.
4. Commit:

   ```bash
   git add -A foundry/memory/
   git commit -m "refactor(memory): drop edge type <name>"
   ```
