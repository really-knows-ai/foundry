---
name: add-memory-edge-type
type: atomic
description: Create a new edge type between entity types in flow memory
---

# Add Memory Edge Type

## Prerequisites

- Memory is initialised.
- Entity types referenced in `sources` and `targets` must already exist (or be added first).

## Steps

1. **Ask the user for**: edge name (snake_case), `sources` (list of entity types or `any`), `targets` (list of entity types or `any`), and a prose body describing what the edge represents.
2. **Push back on narrow wording**. A good edge description describes WHEN the edge holds and what it does NOT cover (boundary with related edges).
3. **Invoke `foundry_memory_create_edge_type`** with `{ name, sources, targets, body }`.
4. **Commit**:

   ```bash
   git add foundry/memory/edges/<name>.md foundry/memory/relations/<name>.ndjson foundry/memory/schema.json
   git commit -m "feat(memory): add edge type <name>"
   ```
