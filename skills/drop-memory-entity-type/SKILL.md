---
name: drop-memory-entity-type
type: atomic
description: Delete an entity type; cascades to affected edges
---

# Drop Memory Entity Type

**Destructive.** This deletes all rows of this type and strips or removes any
edges that reference it.

## Steps

1. Ask the user for the type name.
2. Invoke `foundry_memory_drop_entity_type` with `{ name, confirm: false }` (or omit `confirm`). This returns `{ requiresConfirm: true, preview: { entityRows, affectedEdges: [...] } }`. Show the user:
   - `entityRows` — number of entities of this type that will be deleted.
   - For each `affectedEdges` entry: `cascadeDrop` means the whole edge type disappears; `prune` means `rowsAffected` rows will be removed but the edge type survives.
3. Require explicit "yes, delete it" confirmation.
4. Invoke `foundry_memory_drop_entity_type` again with `{ name, confirm: true }`.
5. Commit:

   ```bash
   git add -A foundry/memory/
   git commit -m "refactor(memory): drop entity type <name>"
   ```
