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
2. Run `foundry_memory_dump` on the type to show them the data that will be deleted.
3. Require explicit "yes, delete it" confirmation.
4. Invoke `foundry_memory_drop_entity_type` with `{ name, confirm: true }`.
5. Commit:

   ```bash
   git add -A foundry/memory/
   git commit -m "refactor(memory): drop entity type <name>"
   ```
