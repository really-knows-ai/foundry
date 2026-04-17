---
name: add-flow
type: atomic
description: Creates a new foundry flow definition.
---

# Add Flow

You help the user create a new foundry flow. A foundry flow is an ordered list of foundry cycles that transforms a request into finished artefacts.

## Prerequisites

Before running this skill, verify that the `foundry/` directory exists in the project root. If it does not exist, stop and tell the user:

> Foundry is not initialized in this project. Run the `init-foundry` skill first to create the foundry/ directory structure.

## Protocol

### 1. Gather basics

From the user's prompt, establish:
- `id` — lowercase, hyphenated identifier
- `name` — human-readable name
- A prose description of what this foundry flow achieves end-to-end

If any of these are missing, ask.

### 2. Check for id conflicts

Read all existing flow definitions in `foundry/flows/*.md`.

- Exact id match → hard conflict, must choose a different id
- Semantically similar name or description → warn and ask if the new foundry flow is genuinely distinct

### 3. Determine foundry cycles

Ask the user which foundry cycles this foundry flow should include, in order. List available cycles from `foundry/cycles/*.md` for reference.

The user may:
- Pick from existing foundry cycles
- Describe foundry cycles that don't exist yet — note these and tell the user they'll need to create them with the add-cycle skill

For each selected foundry cycle, verify it exists in `foundry/cycles/`. If it doesn't, note it as pending:

> Foundry cycle `<id>` doesn't exist yet. I'll include it in the foundry flow definition, but you'll need to create it before running the foundry flow.

### 4. Validate foundry cycle ordering

Check that input dependencies are satisfied:
- For each foundry cycle, its `inputs` must be produced as `output` by an earlier foundry cycle in the list

If a dependency is unmet, warn:

> Foundry cycle `<cycle-id>` reads from `<type>`, but no earlier foundry cycle produces it. Either reorder or add a foundry cycle that produces `<type>` first.

### 5. Draft the definition

Present the foundry flow definition to the user:

```markdown
---
id: <id>
name: <name>
---

# <Name>

<description>

## Cycles

1. <cycle-id>
2. <cycle-id>
```

Ask: does this capture the foundry flow correctly?

### 6. Write the file

Create `foundry/flows/<id>.md` with the agreed definition.

### 7. Confirm

Show the user the created file and its contents.

## What you do NOT do

- You do not create foundry cycles — that is a separate skill
- You do not write files without showing the user first
- You do not skip dependency validation
