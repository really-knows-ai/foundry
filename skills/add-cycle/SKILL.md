---
name: add-cycle
type: atomic
description: Creates a new foundry cycle within a foundry flow, specifying the output artefact type and any input artefact types.
---

# Add Cycle

You help the user create a new foundry cycle and add it to an existing foundry flow. A foundry cycle produces one artefact type (read-write), declares its input contract, targets the next cycle(s), and optionally enables human-appraise as a quality gate.

## Prerequisites

Before running this skill, verify both of the following:

1. The `foundry/` directory exists in the project root. If it does not exist, stop and tell the user:

   > Foundry is not initialized in this project. Run the `init-foundry` skill first to create the foundry/ directory structure.

2. The current git branch is not a work branch. Run `git rev-parse --abbrev-ref HEAD` — if it starts with `work/`, stop and tell the user:

   > You're on a work branch (`<branch>`). Foundry configuration changes must be made on the base branch (usually `main`). Complete or discard the in-flight flow (`foundry_git_finish`, or switch branches and delete it), then re-run this skill from the base branch.

## Protocol

### 1. Identify the foundry flow

From the user's prompt, identify which foundry flow this foundry cycle belongs to. If not specified, list available flows from `foundry/flows/` and ask.

Verify the flow exists. If it doesn't, tell the user and ask if they want to create the foundry flow first (separate skill).

### 2. Gather basics

From the user's prompt, establish:
- `id` — lowercase, hyphenated identifier for the foundry cycle
- `name` — human-readable name
- `output` — the artefact type this foundry cycle produces (must exist in `foundry/artefacts/`)
- `inputs` — artefact types this cycle reads, with a contract type:
  - `type`: `any-of` (at least one must exist) or `all-of` (all must exist)
  - `artefacts`: list of artefact type IDs
  - May be empty for starting cycles
- `targets` — cycle(s) to route to after this cycle completes (may be empty for terminal cycles)
- A prose description of what this foundry cycle does

If any of these are missing, ask.

### 3. Gather model configuration

For each stage in the cycle (forge, quench, appraise), ask the user if they want to specify a model:

> Each stage can optionally run on a specific model for model diversity. Available models are listed as `foundry-*` agent files in `.opencode/agents/`. Run the `list-agents` skill to see them.
>
> For each stage, specify a model ID (e.g., `openai/gpt-4o`) or leave blank to use the session's default model:
> - forge: ___
> - quench: ___
> - appraise: ___

Only stages with an explicitly specified model are included in the `models` frontmatter map.

### 4. Configure human appraise

Ask the user:

> Human-appraise has two independent knobs:
>
> 1. `human-appraise` — should a human review the artefact every iteration? Default: no.
> 2. `deadlock-appraise` — should a human be pulled in only when LLM appraisers deadlock? Default: yes.
> 3. If either is enabled, `deadlock-iterations` sets the deadlock threshold (default: 5).
>
> - human-appraise: yes/no (default no)
> - deadlock-appraise: yes/no (default yes)
> - deadlock-iterations: number (default 5)

### 5. Validate artefact types

For `output` and each entry in `inputs`:
- Verify the artefact type exists in `foundry/artefacts/<type>/definition.md`
- If it doesn't, tell the user and ask if they want to create it first (separate skill)

### 6. Validate against the foundry flow

Read the flow definition from `foundry/flows/<flow-id>.md`. Check:

- No existing foundry cycle in the foundry flow already outputs the same artefact type. Two foundry cycles producing the same type in one foundry flow is a conflict — the file modification enforcement can't distinguish which foundry cycle owns the files.
- Each `input` artefact type is produced by an earlier foundry cycle in the foundry flow. If an input references an artefact type that no prior foundry cycle outputs, warn:

> Input `<type>` is not produced by any earlier foundry cycle in this foundry flow. The artefact won't exist when this foundry cycle runs.
>
> Options:
> 1. Add a foundry cycle that produces `<type>` before this one
> 2. Remove `<type>` from inputs (this foundry cycle won't have that context)
> 3. Proceed anyway (the artefact may exist from a previous foundry flow run)

### 7. Check for id conflicts

Read all existing cycle definitions in `foundry/cycles/*.md`.

- Exact id match → hard conflict, must choose a different id

### 8. Check for semantic overlap

For foundry cycles already in this foundry flow, check whether the new foundry cycle overlaps in purpose:
- Does another foundry cycle already transform the same inputs into a similar output?
- Would the new foundry cycle's description make sense as a revision of an existing foundry cycle rather than a new one?

If overlap is found, present it and ask the user to confirm the distinction is real.

### 9. Draft the definition

Present the foundry cycle definition to the user:

```markdown
---
id: <id>
name: <name>
output: <artefact-type-id>
inputs:
  type: <any-of|all-of>
  artefacts:
    - <artefact-type-id>
targets:
  - <cycle-id>
human-appraise: <true|false>
deadlock-appraise: <true|false>
deadlock-iterations: <number>
models:
  appraise: <model-id>
---

# <Name>

<description>
```

Ask: does this capture the foundry cycle correctly?

### 10. Validate target routing

For each target cycle:
- Verify the target cycle exists in `foundry/cycles/`
- Verify this cycle's output type satisfies at least one of the target's input artefacts
- If the target doesn't exist yet, note it as pending

For input validation:
- Verify that at least one cycle in the flow has the input artefact type(s) as its output
- If using `all-of`, verify all input types are producible

### 11. Write files

- Create `foundry/cycles/<id>.md` with the cycle definition
- Update `foundry/flows/<flow-id>.md` to add the cycle to the `## Cycles` list (if not already present)

### 12. Confirm

Show the user the created/modified files and their contents.

## What you do NOT do

- You do not create foundry cycles that output an artefact type already produced by another foundry cycle in the same foundry flow
- You do not write files without showing the user first
- You do not skip artefact type validation
- You do not create artefact types — that is a separate skill
- You do not create foundry flows — that is a separate skill
