---
name: add-cycle
type: atomic
description: Creates a new foundry cycle within a foundry flow, specifying the output artefact type and any input artefact types.
---

# Add Cycle

You help the user create a new foundry cycle and add it to an existing foundry flow. A foundry cycle produces one artefact type (read-write) and optionally reads from artefact types produced by earlier foundry cycles (read-only).

## Protocol

### 1. Identify the foundry flow

From the user's prompt, identify which foundry flow this foundry cycle belongs to. If not specified, list available flows from `foundry/flows/` and ask.

Verify the flow exists. If it doesn't, tell the user and ask if they want to create the foundry flow first (separate skill).

### 2. Gather basics

From the user's prompt, establish:
- `id` — lowercase, hyphenated identifier for the foundry cycle
- `name` — human-readable name
- `output` — the artefact type this foundry cycle produces (must exist in `foundry/artefacts/`)
- `inputs` — artefact types from earlier foundry cycles that this foundry cycle reads (may be empty)
- A prose description of what this foundry cycle does

If any of these are missing, ask.

### 3. Gather model configuration

For each stage in the cycle (forge, quench, appraise), ask the user if they want to specify a model:

> Each stage can optionally run on a specific model for model diversity. Available models are registered as `foundry-*` agents by the Foundry plugin.
>
> For each stage, specify a model ID (e.g., `openai/gpt-4o`) or leave blank to use the session's default model:
> - forge: ___
> - quench: ___
> - appraise: ___

Only stages with an explicitly specified model are included in the `models` frontmatter map.

### 4. Validate artefact types

For `output` and each entry in `inputs`:
- Verify the artefact type exists in `foundry/artefacts/<type>/definition.md`
- If it doesn't, tell the user and ask if they want to create it first (separate skill)

### 5. Validate against the foundry flow

Read the flow definition from `foundry/flows/<flow-id>.md`. Check:

- No existing foundry cycle in the foundry flow already outputs the same artefact type. Two foundry cycles producing the same type in one foundry flow is a conflict — the file modification enforcement can't distinguish which foundry cycle owns the files.
- Each `input` artefact type is produced by an earlier foundry cycle in the foundry flow. If an input references an artefact type that no prior foundry cycle outputs, warn:

> Input `<type>` is not produced by any earlier foundry cycle in this foundry flow. The artefact won't exist when this foundry cycle runs.
>
> Options:
> 1. Add a foundry cycle that produces `<type>` before this one
> 2. Remove `<type>` from inputs (this foundry cycle won't have that context)
> 3. Proceed anyway (the artefact may exist from a previous foundry flow run)

### 6. Check for id conflicts

Read all existing cycle definitions in `foundry/cycles/*.md`.

- Exact id match → hard conflict, must choose a different id

### 7. Check for semantic overlap

For foundry cycles already in this foundry flow, check whether the new foundry cycle overlaps in purpose:
- Does another foundry cycle already transform the same inputs into a similar output?
- Would the new foundry cycle's description make sense as a revision of an existing foundry cycle rather than a new one?

If overlap is found, present it and ask the user to confirm the distinction is real.

### 8. Draft the definition

Present the foundry cycle definition to the user:

```markdown
---
id: <id>
name: <name>
output: <artefact-type-id>
inputs:
  - <artefact-type-id>
models:
  appraise: <model-id>       # optional, only if specified
---

# <Name>

<description — what this foundry cycle does, what it reads, what it produces>
```

Ask: does this capture the foundry cycle correctly?

### 9. Determine position in foundry flow

The foundry cycle needs a position in the foundry flow's ordered cycle list. Based on its inputs:
- If no inputs: it can go first (or early)
- If it reads from other foundry cycles: it must come after those foundry cycles

Propose a position and confirm with the user:

> This foundry cycle reads from `<inputs>`, which are produced by `<cycle-ids>`. It should go after those foundry cycles.
>
> Proposed order:
> 1. <existing-cycle>
> 2. <existing-cycle>
> 3. <new-cycle> ← here
>
> Does this look right?

### 10. Write files

- Create `foundry/cycles/<id>.md` with the foundry cycle definition
- Update `foundry/flows/<flow-id>.md` to add the foundry cycle at the agreed position

### 11. Confirm

Show the user the created/modified files and their contents.

## What you do NOT do

- You do not create foundry cycles that output an artefact type already produced by another foundry cycle in the same foundry flow
- You do not write files without showing the user first
- You do not skip artefact type validation
- You do not create artefact types — that is a separate skill
- You do not create foundry flows — that is a separate skill
