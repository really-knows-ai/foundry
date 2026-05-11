---
name: add-cycle
type: atomic
description: Creates a new foundry cycle within a foundry flow, specifying the output artefact type and any input artefact types.
---

# Add Cycle

You help the user create a new foundry cycle and add it to an existing foundry flow. A foundry cycle produces one artefact type (read-write), declares its input contract, targets the next cycle(s), and optionally enables human-appraise as a quality gate.

## Foundry Agent Preflight

If you are clearly operating as the Foundry agent, continue.

If you are not clearly operating as the Foundry agent, pause and tell the user:

> This work is best handled by the Foundry agent. Restart OpenCode if you have just initialised Foundry, switch to the **Foundry** agent, and continue this request there.

This is an advisory guard. Continue only when the active instructions make it clear you are the Foundry agent or the user explicitly asks to proceed here.

## Config Branch Handling

Before writing Foundry configuration:

- Confirm `foundry/` exists. If it is missing, initialise Foundry first when that serves the user's goal.
- Check the current branch.
- On `main` or another clean non-work branch, create a `config/<short-description>` branch internally.
- On `config/*`, continue on the current branch.
- On `work/*`, stop and explain that active flow work must be finished before configuration changes.
- On `dry-run/*/*`, stop and explain that the dry run must be finished before configuration changes.
- If unrelated uncommitted changes could be affected by branching or writing files, ask before proceeding.

Do not tell the user to call branch tools directly.

## Prerequisites

Before running this skill, verify all three of the following:

1. The `foundry/` directory exists in the project root. If it does not
   exist, stop and tell the user:

   > Foundry is not initialized in this project. Run the
   > `init-foundry` skill first to create the foundry/ directory
   > structure.

2. The current git branch is a `config/*` branch. Run
   `git rev-parse --abbrev-ref HEAD` and confirm it matches
   `config/<description>`.

3. If the branch does not start with `config/`, stop and explain that configuration changes require a `config/*` branch. Handle branch creation internally without exposing tool syntax.

## Protocol

### 1. Identify the foundry flow

From the user's prompt, identify which foundry flow this foundry cycle belongs to. If not specified, list available flows from `foundry/flows/` and ask.

If the parent flow or required artefact type is missing and the user's goal clearly requires it, create that dependency first. If multiple designs are plausible, ask one focused question before creating it.

### 2. Gather basics

From the user's prompt, establish:
- `id` — lowercase, hyphenated identifier for the foundry cycle
- `name` — human-readable name
- `output-type` — the artefact type this foundry cycle produces (must exist in `foundry/artefacts/`)
- `inputs` — artefact types this cycle reads, with a contract type:
  - `type`: `any-of` (at least one must exist) or `all-of` (all must exist)
  - `artefacts`: list of artefact type IDs
  - May be empty for starting cycles
- `targets` — cycle(s) to route to after this cycle completes (may be empty for terminal cycles)
- A prose description of what this foundry cycle does

If any of these are missing, ask.

### 3. Gather model configuration

For each stage in the cycle (forge, quench, appraise), ask the user if they want to specify a model:

> Each stage can optionally run on a specific model for model diversity. Available models are listed as `foundry-*` agent files in `.opencode/agents/`.
>
> For each stage, specify a model ID (e.g., `openai/gpt-4o`) or leave blank to use the session's default model:
> - forge: ___
> - quench: ___
> - appraise: ___

Only stages with an explicitly specified model are included in the `models` frontmatter map.

List available `.opencode/agents/foundry-*.md` files directly when model selection matters. If the user has no preference, omit the `models` map and use the session defaults.

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

For `output-type` and each entry in `inputs`:
- Verify the artefact type exists in `foundry/artefacts/<type>/definition.md`
- If the parent flow or required artefact type is missing and the user's goal clearly requires it, create that dependency first. If multiple designs are plausible, ask one focused question before creating it.

### 6. Validate against the foundry flow

Read the flow definition from `foundry/flows/<flow-id>.md`. Check:

- No existing foundry cycle in the foundry flow already outputs the same artefact type. Two foundry cycles producing the same type in one foundry flow is a conflict — the file modification enforcement can't distinguish which foundry cycle owns the files.
- Each `input` artefact type is produced by some cycle that can run before this one according to the flow's `targets` graph (a reachable predecessor). If an input references an artefact type that no reachable predecessor outputs, warn:

> Input `<type>` is not produced by any reachable predecessor of this foundry cycle in the flow's `targets` graph. The artefact won't exist when this foundry cycle runs.
>
> Options:
> 1. Add a foundry cycle that produces `<type>` and route to this cycle via `targets`
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
output-type: <artefact-type-id>
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

### 11. Validate the draft

Call `foundry_config_validate_cycle({ name: "<id>", body: "<full markdown>" })`.

If the result is `{ ok: false, errors: [...] }`, address each error (adjust the body) and re-run until you get `{ ok: true }`. Common issues: missing required frontmatter keys, references to artefact types or flows that don't exist yet.

### 12. Create the cycle file

Call `foundry_config_create_cycle({ name: "<id>", body: "<full markdown>" })`. The tool:

- re-validates the body (TOCTOU);
- writes `foundry/cycles/<id>.md`;
- produces one git commit on the current `config/*` branch.

If the tool returns `{ ok: false, errors }` because the target file already exists, the user should edit the file by hand on this `config/*` branch — `foundry_config_create_cycle` does not support updates.

Show the user the resulting commit hash from the response.

### 13. Add the cycle to the flow's cycle list

`foundry_config_create_cycle` writes the cycle file only. The cycle still needs to appear in the parent flow's `## Cycles` list.

Edit `foundry/flows/<flow-id>.md` by hand on this same `config/*` branch using the `Edit` tool. Add the new cycle id under `## Cycles` (if not already present). Commit that edit by hand as a separate microcommit, e.g.:

```
git add foundry/flows/<flow-id>.md
git commit -m "config(flow): add <cycle-id> to <flow-id>"
```

### 14. Confirm

Show the user the cycle file, the updated flow file, and both commit hashes.

## What you do NOT do

- You do not create foundry cycles that output an artefact type already produced by another foundry cycle in the same foundry flow
- You do not skip artefact type validation
- You do not create dependencies (artefact types, flows) unless the user's stated goal clearly requires them; ask one focused question when multiple designs are plausible
