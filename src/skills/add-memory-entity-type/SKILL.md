---
name: add-memory-entity-type
type: atomic
description: Create a new entity type in flow memory, with a prose brief for the LLM
---

# Add Memory Entity Type

Declare a new entity type. The prose body becomes part of every cycle's prompt and decides what the LLM writes into memory.

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

Memory must be initialised (`foundry/memory/` must exist). Initialise memory internally first if not.

## Protocol

### Context object

When invoked with pre-filled fields matching the `foundry_memory_create_entity_type` tool args, skip questions for provided fields. Missing fields trigger clarifying questions.

Context fields: `{name, body}`

When invoked with a context:
- If all required fields are present, skip the Understand phase and proceed to Plan → Confirm → Build.
- If only some fields are present, ask only for the missing ones.

### 1. Understand

Ask for each field one question at a time:

1. **Type name.** Lowercase snake_case (e.g. `class`, `stored_proc`).
2. **Prose body.** Propose a body template based on the type name. The body template includes:
   - `# <type>` heading
   - Short description of what this entity represents in the subject system
   - `## Name` — convention for how `name` is formed, specific enough to guarantee uniqueness
   - `## Value` — what the `value` string should contain: intrinsic characteristics of the entity only. Relationships to other entities belong in edges, not here.
   - `## Relationships` — informational list of likely edges

   After presenting the template, ask the user to confirm or refine the body. Short bodies (≤100 chars) are a red flag; push back.

### 2. Plan

Present the entity type definition: name and body. Ask: "Does this capture the entity type correctly?" Iterate until the user is satisfied.

### 3. Confirm

Ask: "Proceed with this plan?" — wait for user answer before building. If the user rejects the plan, return to the Understand phase and adjust.

### 4. Build

1. **Validate**: Call `foundry_memory_validate`. If the result is `{ ok: false, errors: [...] }`, address each error and re-run until `{ ok: true }`.
2. **Create**: Call `foundry_memory_create_entity_type({ name: "<name>", body: "<body>" })`. The tool rejects duplicate names (entity or edge) — surface the error to the user if it fires and stop.
3. **Commit**: Run `git add foundry/memory/entities/<name>.md foundry/memory/schema.json`. Run `git commit -m "feat(memory): add entity type <name>"`. Report the commit hash.

#### Post-Build — compose related edge types

If related edge types would serve the user's stated goal, compose them internally with one focused question when schema design is ambiguous.

## What you do NOT do

- You do not delegate memory initialisation to the user — initialise internally when needed
- You do not delegate edge type creation to the user — compose internally when edge types serve the user's stated goal
