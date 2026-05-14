---
name: add-memory-edge-type
type: atomic
description: Create a new edge type between entity types in flow memory
---

# Add Memory Edge Type

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

Memory must be initialised (`foundry/memory/` must exist). Initialise memory internally first if not. Entity types referenced in `sources` and `targets` must already exist — create or compose them internally when they are part of the user's stated goal, or ask one focused question when schema design is ambiguous.

## Protocol

### Context object

When invoked with pre-filled fields matching the `foundry_memory_create_edge_type` tool args, skip questions for provided fields. Missing fields trigger clarifying questions.

Context fields: `{name, sources, targets, body}`

When invoked with a context:
- If all required fields are present, skip the Understand phase and proceed to Plan → Confirm → Build.
- If only some fields are present, ask only for the missing ones.

### 1. Understand

Ask for each field one question at a time:

1. **Edge name.** Lowercase snake_case.
2. **Sources.** The entity types this edge originates from. List existing entity types from `foundry/memory/entities/` as multiple-choice options. Allow `any`.
3. **Targets.** The entity types this edge points to. List existing entity types as multiple-choice options. Allow `any`.
4. **Prose body.** A description of what this edge represents. Push back on narrow wording — a good edge description describes when the edge holds and what it does not cover (boundary with related edges). Suggest a clearer alternative when the user provides vague wording and ask before proceeding.

### 2. Plan

Present the edge type definition: name, sources, targets, body. Ask: "Does this capture the edge type correctly?" Iterate until the user is satisfied.

### 3. Confirm

Ask: "Proceed with this plan?" — wait for user answer before building. If the user rejects the plan, return to the Understand phase and adjust.

### 4. Build

1. **Validate**: Call `foundry_memory_validate`. If the result is `{ ok: false, errors: [...] }`, address each error and re-run until `{ ok: true }`.
2. **Create**: Call `foundry_memory_create_edge_type({ name: "<name>", sources: ["<type>", ...], targets: ["<type>", ...], body: "<body>" })`.
3. **Commit**: Run `git add foundry/memory/edges/<name>.md foundry/memory/schema.json`. Run `git commit -m "feat(memory): add edge type <name>"`. Report the commit hash.

## What you do NOT do

- You do not delegate memory initialisation to the user — initialise internally when needed
- You do not create edge types with sources or targets that don't exist — compose them internally when they serve the user's stated goal
