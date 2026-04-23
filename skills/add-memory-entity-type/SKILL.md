---
name: add-memory-entity-type
type: atomic
description: Create a new entity type in flow memory, with a prose brief for the LLM
---

# Add Memory Entity Type

Declare a new entity type. The prose body becomes part of every cycle's prompt and
decides what the LLM writes into memory.

## Prerequisites

- Memory is initialised (`foundry/memory/` exists; run `init-memory` if not).

## Steps

1. **Ask the user for the type name** (lowercase snake_case, e.g. `class`, `stored_proc`).
2. **Propose a prose body template** for the user to edit. Sections required: Name (naming convention for this type), Value (what goes in the value field, must state that relationships belong in edges), Relationships (informational list of likely edges). Example:

   ```markdown
   # <type>

   Short description of what this entity represents in the subject system.

   ## Name
   Convention for how `name` is formed. Be specific enough to guarantee uniqueness.

   ## Value
   Describe what the `value` string should contain: intrinsic characteristics of
   the entity only. Relationships to other entities belong in edges, not here.

   ## Relationships
   - `<edge>` to `<type>`: brief semantic note
   ```

3. **Confirm the body with the user.** Short bodies (≤100 chars) are a red flag; push back.
4. **Create the type** by invoking `foundry_memory_create_entity_type` with `{ name, body }`. The tool rejects duplicate names (entity or edge) — surface the error to the user if it fires and stop.
5. **Commit**:

   ```bash
   git add foundry/memory/entities/<name>.md foundry/memory/relations/<name>.ndjson foundry/memory/schema.json
   git commit -m "feat(memory): add entity type <name>"
   ```

6. **Guidance to the user**: suggest they also add relevant edge types using `add-memory-edge-type`.
