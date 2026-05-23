---
name: add-flow
type: atomic
description: Creates a new foundry flow definition.
---

# Add Flow

You help the user create a complete Foundry flow for their stated outcome. A flow may require artefact types, laws, validators, appraisers, and cycles before the flow file itself can validate. Work backwards from the requested outcome and create missing dependencies in validation order.

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

### 1. Understand the outcome

Extract or ask for the flow purpose, expected final artefact, output location, and any quality constraints. Prefer practical defaults for common requests.

**Flow basics**: Gather the flow's own required fields:
- `id` — lowercase, hyphenated identifier. Reject duplicate IDs — if a flow with the same ID already exists, choose a different ID. Warn about semantic duplicates (different ID but near-identical purpose) and ask whether the new flow is genuinely distinct.
- `name` — human-readable name
- `description` — prose description of the flow purpose

**What the flow produces**: Ask about the artefact type the flow should produce. Determine whether it needs a new artefact type or whether an existing one fits.

**Quality constraints**: Ask about the laws that govern quality. For each law: what it checks, whether it applies globally or to a specific artefact type, and which elements can be checked with validators.

**Appraisers**: Ask about the appraisers that evaluate quality. Determine how many are needed and whether existing appraisers fit or new ones are needed.

**Cycles**: Ask about the cycles that process the artefact. Determine how many cycles there are and what each produces.

**Starting cycles**: Identify which cycle IDs begin the flow.

**Cycle graph validation**: After designing the cycles, validate the cycle graph: verify each non-starting cycle is reachable from a starting cycle through the `targets` graph, and verify each cycle's input contracts can be satisfied by other cycles in the flow. Warn about unreachable cycles or unsatisfiable contracts before proceeding.

**Inventory**: Read existing flows in `foundry/flows/*.md`, cycles in `foundry/cycles/*.md`, artefact types in `foundry/artefacts/*/definition.md`, laws in `foundry/laws/*.md`, and appraisers in `foundry/appraisers/*.md`. Identify reusable pieces and conflicts.

### 2. Gather requirements for each dependency

For each dependency type in dependency order, ask questions to build a context object. This is the Understand phase for each sub-skill — the answers are captured and passed along when building.

Create missing dependencies in validation order:

1. **Artefact types** (no sub-dependencies): For each new artefact type, gather `id`, `name`, `filePatterns`, `description`, and whether it needs type-specific laws or appraiser configuration. Context object: `{id, name, filePatterns, description, appraisers?}`.

2. **Laws** (may reference artefact types): For each new law, gather `id`, `name`, `description`, `passing`, `failing`, the target (global file or type-specific with `typeId`), and which elements can be checked with validators. Determine whether validators are needed. Context object: `{id, name, description, passing, failing, target: {kind, file|typeId}, validators?}`.

3. **Appraisers** (may reference models): For each new appraiser, gather `id`, `name`, `description`, and optional `model` preference. Context object: `{id, name, description, model?}`.

4. **Cycles** (reference artefact types, laws, appraisers): For each new cycle, gather `id`, `name`, `outputType`, `description`, and any optional settings (inputs, targets, appraise, assay, memory, models). Context object: `{id, name, outputType, description, inputs?, targets?, alwaysHumanAppraise?, deadlockHumanAppraise?, deadlockIterations?, maxIterations?, assay?, memory?, models?}`. For a source cycle that starts from the user's run goal and has no upstream artefact dependency, omit `inputs` entirely; never pass `inputs` with an empty `artefacts` array.

For the haiku example, default to a `haiku` artefact type, `haikus/*.md` file pattern, laws for form, imagery, and mood, a deterministic syllable validator where project dependencies allow it, two or three distinct appraisers, one cycle, and one flow.

For each dependency, determine whether it already exists (user says "use the existing haiku artefact type") or needs to be created. If it already exists, capture its id for reference. If it needs creating, capture the context object fields.

### 3. Present the combined plan

Show the full dependency tree as a structured summary:

```text
Flow: <id> — <name>
  Starting cycles: <cycle-id>, ...
  Description: <description>
  Artefact Types:
    · <id> (<name>) — <filePatterns>
  Laws:
    · <id> — <description>
      validators: <validator-id> (if any)
  Appraisers:
    · <id> — <description>
  Cycles:
    · <id> → <outputType> — <description>
      inputs/models: <omitted or explicit settings>
```

Ask "Proceed with this plan?" — do not build anything until the user confirms.

If the user rejects the plan, return to the Understand phase and adjust.

### 4. Build dependencies in order

For each dependency, invoke the sub-skill's protocol with the captured context object. The context object for each sub-skill matches the args of the corresponding `foundry_config_create_*` tool, with fields populated from the Understand and Gather phases.

Each `foundry_config_create_*` tool commits every pending change under `foundry/`, not just the file it creates. If you edit a config file directly between tool calls (for example, to add appraiser configuration to an artefact type after those appraisers are created), the next `foundry_config_create_*` call picks it up. After the final tool call `git status` is always clean — no further checks are needed.

Build order (dependency order):

1. **Artefact types**: For each new artefact type, invoke the `add-artefact-type` protocol with the captured context. Example:

   > Invoke the add-artefact-type protocol with context: `{id: "haiku", name: "Haiku", filePatterns: ["haikus/*.md"], description: "A traditional Japanese poem"}`.
   > The add-artefact-type skill checks its Context object section. If all required fields are present, it proceeds directly to Build, skipping Understand, Plan, and Confirm. If only some fields are present, it asks only for the missing ones and proceeds to Build — it skips Plan and Confirm since the parent's combined plan already handled confirmation.

2. **Laws**: For each new law, invoke the `add-law` protocol with the captured context. Example:

   > Invoke the add-law protocol with context: `{id: "three-lines", name: "Three Lines", description: "must have exactly three lines", passing: "...", failing: "...", target: {kind: "type-specific", typeId: "haiku"}}`.
   > If all required fields are present, the sub-skill proceeds directly to Build. Otherwise it asks only for the missing required fields, then proceeds to Build.

3. **Appraisers**: For each new appraiser, invoke the `add-appraiser` protocol with the captured context.

   > Invoke the add-appraiser protocol with context: `{id: "haiku-critic", name: "Haiku Critic", description: "Evaluates haiku structure and imagery"}`.
   > If all required fields are present, proceed directly to Build. Otherwise ask for missing required fields only.

4. **Cycles**: For each new cycle, invoke the `add-cycle` protocol with the captured context.

   > Invoke the add-cycle protocol with context: `{id: "haiku-cycle", name: "Haiku Cycle", outputType: "haiku", description: "Generates haiku poems", models: {forge: "opencode-go/deepseek-v4-flash", appraise: "opencode-go/qwen3.6-plus"}}`.
   > If all required fields are present, proceed directly to Build. Otherwise ask for missing required fields only.

   Preserve every user-selected stage model in the cycle context. If the cycle has no upstream artefact input, leave `inputs` absent from the context.

**Build-only mode**: When all required fields for a sub-skill are present in the context, the sub-skill skips Understand, Plan, and Confirm — proceeding directly to validate → create → commit. When only some required fields are present, the sub-skill enters its Understand phase to ask only for those missing required fields, then proceeds to Build (still skipping Plan and Confirm since the parent's combined plan already handled confirmation). Optional fields that are missing are silently skipped.

**Error handling during build**: If a sub-skill's Build phase fails (validation error or tool error), surface the error to the user:

> Build of `<piece>` failed: `<error>`. Retry, skip this piece, or abort?

Do not silently skip or auto-resolve.

### 5. Build the flow

After all dependencies are built, create the flow itself:

1. **Validate**: Call `foundry_config_validate_flow({ name: "<id>", body: "<assembled markdown>" })`. Assemble the body from the fields using the frontmatter format the tool produces internally. If the result is `{ ok: false, errors: [...] }`, address each error and re-run until `{ ok: true }`. Common issues: missing required frontmatter keys, references to artefact types or cycles that do not exist yet.

2. **Create**: Call `foundry_config_create_flow({ id: "<id>", name: "<name>", startingCycles: ["<cycle-id>", ...], description: "<description>" })`. The tool:
   - re-validates the body (TOCTOU);
   - writes `foundry/flows/<id>.md`;
   - produces one git commit on the current `config/*` branch.

   If the tool returns `{ ok: false, errors }` because the target file already exists, read the existing flow file, incorporate the user's requested changes into the current body, propose the merged result for review, then write and commit the updated file.

3. **Report and offer next steps**: Show the user the flow file and the commit hash. Summarise each dependency that was created, with its commit hash. Then present these options:

> The flow is built on the `config/*` branch. Before merging to main, you can:
>
> 1. **Dry-run the flow** — test it safely from the config branch without touching main. I'll run a dry-run: `dry-run/haiku-flow/01`.
> 2. **Merge to main** — commit the configuration and make the flow available for normal runs.
> 3. **Leave it on this branch** — you can review the configuration or come back later.
>
> Which would you like?

Do NOT automatically merge or call `foundry_git_finish` unless the user explicitly asks for it.

## Safety Rules

- Do not create overlapping artefact file patterns.
- Do not skip dependency validation.
- Do not expose internal tool-call syntax to the user.
- Do not continue when a branch or worktree state could overwrite user changes.
- Do not merge or call `foundry_git_finish` unless the user explicitly asks — always offer to dry-run first.
