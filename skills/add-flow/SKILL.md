---
name: add-flow
type: atomic
description: Creates a new foundry flow definition.
---

# Add Flow

You help the user create a new foundry flow. A foundry flow is a set of foundry cycles with declared starting points — cycles own their own routing via targets and input contracts.

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

### 3. Determine foundry cycles and starting cycles

Ask the user which foundry cycles this flow includes. List available cycles from `foundry/cycles/*.md` for reference.

Then ask: which of these are **starting cycles** — the cycles that can be entered first when the flow begins?

- Starting cycles typically have no input dependencies
- Multiple starting cycles are fine — the user (or context) determines which one to run first

### 4. Validate cycle graph

For each non-starting cycle, verify it is reachable:
- At least one other cycle in the flow has it as a target
- Its input contract can be satisfied by cycles in the flow

If a cycle is unreachable (no cycle targets it and it's not a starting cycle), warn:

> Cycle `<id>` is not a starting cycle and no other cycle targets it. It will never be reached in this flow.

### 5. Draft the definition

Present the flow definition to the user:

```markdown
---
id: <id>
name: <name>
starting-cycles:
  - <cycle-id>
---

# <Name>

<description>

## Cycles

- <cycle-id>
- <cycle-id>
```

The `starting-cycles` field lists entry points. `## Cycles` lists all cycles in the flow (no ordering implied — routing is owned by individual cycle definitions via their `targets` field).

Ask: does this capture the flow correctly?

### 6. Write the file

Create `foundry/flows/<id>.md` with the agreed definition.

### 7. Confirm

Show the user the created file and its contents.

## What you do NOT do

- You do not create foundry cycles — that is a separate skill
- You do not write files without showing the user first
- You do not skip dependency validation
