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

## Protocol

### Context object

When invoked with pre-filled fields matching the `foundry_config_create_cycle` tool args, skip questions for provided fields. Missing fields trigger clarifying questions.

Context fields: `{id, name, outputType, description, inputs?, targets?, alwaysHumanAppraise?, deadlockHumanAppraise?, maxIterations?, assay?, memory?, models?}`

`inputs` is optional. A source cycle that starts from the user's run goal and has no upstream artefact dependency omits `inputs` entirely. Empty input contracts are invalid: do not pass `inputs: {type: "any-of", artefacts: []}`.

`models` is a map of stage names to model IDs. Preserve user-selected model overrides exactly, for example `{forge: "opencode-go/deepseek-v4-flash", appraise: "opencode-go/qwen3.6-plus"}`.

When invoked with a context:
- If all required fields are present, skip the Understand phase and proceed to Plan → Confirm → Build.
- If only some fields are present, ask only for the missing ones.

### 1. Understand

**Identify the flow**: From the user's prompt, identify which foundry flow this cycle belongs to. If not specified, list available flows from `foundry/flows/` and ask.

If the parent flow or required artefact type is missing and the user's goal clearly requires it, create that dependency first. If multiple designs are plausible, ask one focused question before creating it.

**Required fields** — Gather each required field one question at a time:
- `id` — lowercase, hyphenated identifier for the cycle
- `name` — human-readable name
- `outputType` — the artefact type this cycle produces. List existing artefact types from `foundry/artefacts/*/definition.md` as multiple-choice options.
- `description` — prose description of what this cycle does

**Id conflict check**: Read all existing cycle definitions in `foundry/cycles/*.md`. An exact id match is a hard conflict — choose a different id.

**Output-type conflict check**: Read the flow definition from `foundry/flows/<flow-id>.md`. Check that no cycle in the flow already outputs the same artefact type. Two cycles producing the same type in one flow is a conflict — the file modification enforcement cannot distinguish which cycle owns the files. If a conflict exists, present it:

> A cycle `<existing-id>` already produces `<outputType>` in this flow. Two cycles producing the same artefact type creates a conflict.
>
> Options:
> 1. Choose a different `outputType`
> 2. Choose a different flow
> 3. Proceed anyway if the types are intentionally distinct

**Input reachability check**: For each input artefact type, verify that a reachable predecessor in the flow's `targets` graph produces it. If an input references a type that no reachable predecessor outputs, warn:

> Input `<type>` is not produced by any reachable predecessor of this cycle in the flow's `targets` graph. The artefact will not exist when this cycle runs.
>
> Options:
> 1. Add a cycle that produces `<type>` and route to this cycle via `targets`
> 2. Remove `<type>` from inputs (this cycle will not have that context)
> 3. Proceed anyway (the artefact may exist from a previous flow run)

**Validate target routing**: For each target cycle, verify the target exists in `foundry/cycles/` and that this cycle's output type satisfies at least one of the target's input artefacts. If a target does not exist yet, note it as pending.

**Optional clusters** — After each cluster, ask whether the user wants to configure it; if not, skip:

- **Routing**: `inputs` (input contract: `{type: "any-of"|"all-of", artefacts: string[]}`; omit for source cycles with no upstream artefact dependency), `targets` (cycle IDs to route to after completion), `maxIterations` (maximum iterations before forced progression)
- **Human-appraise**: `alwaysHumanAppraise` (boolean, default false) — human reviews every iteration; when true, `max-iterations` is not enforced. `deadlockHumanAppraise` (boolean, default true) — route to human for review when the iteration cap is reached, instead of blocking the cycle. Only applies when `alwaysHumanAppraise` is false.
- **Memory and models**: `assay` (assay configuration), `memory` (memory configuration), `models` (stage-specific model overrides, e.g. `{forge: "openai/gpt-4o", appraise: "openai/gpt-4o"}`). For models, offer each stage (forge, quench, appraise) individually. If the user has no preference, omit the `models` map and use the session defaults.

### 2. Plan

Present a structured summary of the cycle definition: id, name, outputType, description, and any configured optional fields (inputs, targets, alwaysHumanAppraise, deadlockHumanAppraise, maxIterations, assay, memory, models). Include only fields that have values.

Ask: "Does this capture the cycle correctly?" Iterate until the user is satisfied.

### 3. Confirm

Ask: "Proceed with this plan?" — wait for user answer before building. If the user rejects the plan, return to the Understand phase and adjust.

### 4. Build

1. **Validate**: Call `foundry_config_validate_cycle({ name: "<id>", body: "<assembled markdown>" })`. Assemble the body from the fields using the frontmatter format the tool produces internally. If the result is `{ ok: false, errors: [...] }`, address each error and re-run until `{ ok: true }`. Common issues: missing required frontmatter keys, references to artefact types or flows that do not exist yet.

2. **Create**: Call `foundry_config_create_cycle({ id: "<id>", name: "<name>", outputType: "<type>", description: "<description>", targets: ..., alwaysHumanAppraise: ..., deadlockHumanAppraise: ..., maxIterations: ..., assay: ..., memory: ..., models: ... })`. Include `inputs` only when the cycle reads upstream artefacts, and include `models` whenever the user selected stage-specific model overrides. The tool:
   - re-validates the body (TOCTOU);
   - writes `foundry/cycles/<id>.md`;
   - produces one git commit on the current `config/*` branch.

   If the tool returns `{ ok: false, errors }` because the target file already exists, read the existing cycle file, apply any necessary updates, write it back, and commit on this `config/*` branch.

3. **Add to flow cycle list**: `foundry_config_create_cycle` writes the cycle file only. The cycle still needs to appear in the parent flow's `## Cycles` list. Read the existing flow file from `foundry/flows/<flow-id>.md`. Add the new cycle id under `## Cycles` if not already present. Write the updated file back and commit on this same `config/*` branch.

4. Show the user the cycle file, the updated flow file, and both commit hashes.

## What you do NOT do

- You do not create cycles that output an artefact type already produced by another cycle in the same flow
- You do not skip artefact type validation
- You do not create dependencies (artefact types, flows) unless the user's stated goal clearly requires them; ask one focused question when multiple designs are plausible
