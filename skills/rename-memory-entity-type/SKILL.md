---
name: rename-memory-entity-type
type: atomic
description: Rename an entity type and migrate all referring edges and rows
---

# Rename Memory Entity Type

## Prerequisites

- The `from` entity type must exist.
- The `to` name must be free (no existing entity or edge).

## Steps

1. Ask the user for `from` and `to`.
2. Warn the user: this rewrites committed NDJSON rows in every edge that references the entity. Preview the change with `foundry_memory_validate` if desired.
3. Invoke `foundry_memory_rename_entity_type` with `{ from, to }`.
4. Commit:

   ```bash
   git add foundry/memory/
   git commit -m "refactor(memory): rename entity type <from> -> <to>"
   ```
