---
name: rename-memory-edge-type
type: atomic
description: Rename an edge type (does not touch row data)
---

# Rename Memory Edge Type

## Prerequisites

- The `from` edge type must exist.
- The `to` name must be free.

## Steps

1. Ask the user for `from` and `to`.
2. Invoke `foundry_memory_rename_edge_type` with `{ from, to }`.
3. Commit:

   ```bash
   git add foundry/memory/
   git commit -m "refactor(memory): rename edge type <from> -> <to>"
   ```
