---
name: add-artefact-type
type: atomic
description: Creates a new artefact type, checking for conflicts with existing types.
---

# Add Artefact Type

You help the user create a new artefact type. You ensure it avoids conflicts with existing types, scaffold the directory structure, and walk the user through defining laws and their optional validators.

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

When invoked with pre-filled fields matching the `foundry_config_create_artefact_type` tool args, skip questions for provided fields. Missing fields trigger clarifying questions.

Context fields: `{id, name, filePatterns, description, appraisers?}`

When invoked with a context:
- If all required fields are present, skip the Understand phase and proceed to Plan → Confirm → Build.
- If only some fields are present, ask only for the missing ones.

### 1. Understand

Ask for each field one question at a time. Prefer multiple choice for `filePatterns`, deriving options from the artefact type name and common conventions (e.g. `haikus/*.md`, `haiku.md`, `output/haiku/*.md`). Ask about `appraisers` (optional) — either provide an existing appraiser ID or skip.

**Naming conflict check**: Read all existing artefact type definitions in `foundry/artefacts/*/definition.md`. Exact id match means a hard conflict — choose a different id. A semantically similar name or description triggers a warning:

> An artefact type `<existing-id>` already exists that seems similar:
> - Existing: <name> — <description summary>
> - New: <name> — <description summary>
>
> Is the new type genuinely distinct, or should you extend the existing one?

**File pattern overlap check**: For each existing artefact type, check whether the new type's `filePatterns` could match the same files as any existing type's patterns. Overlapping file patterns are a hard block:

> The file pattern `<new-pattern>` intersects with artefact type `<existing-id>` which uses `<existing-pattern>`.
>
> Overlapping file patterns break file modification enforcement — the foundry cycle cannot determine which artefact type owns a file change.
>
> Please choose a different file pattern that does not overlap with any existing type.

Do not proceed until the patterns are non-overlapping.

### 2. Plan

Present the definition to the user with these structured fields:

- `id` (string) — lowercase, hyphenated identifier. Must be unique across artefact types.
- `name` (string) — human-readable label.
- `filePatterns` (string[]) — glob patterns for files this type produces.
- `description` (string) — prose description of what this artefact type is.
- `appraisers` ({ count?: number, allowed?: string[] }, optional) — appraiser configuration.

Ask: does this capture the artefact type correctly? Iterate until the user is satisfied.

### 3. Confirm

Ask: "Proceed with this plan?" — wait for user answer before building. If the user rejects the plan, return to the Understand phase and adjust.

### 4. Build

1. **Validate**: Call `foundry_config_validate_artefact_type({ name: "<id>", body: "<assembled markdown>" })`. Assemble the body from the fields using the frontmatter format the tool produces internally. If the result is `{ ok: false, errors: [...] }`, address each error and re-run until `{ ok: true }`. Common issues: missing required frontmatter keys, references to artefact types or flows that do not exist yet.

2. **Create**: Call `foundry_config_create_artefact_type({ id: "<id>", name: "<name>", filePatterns: ["<pattern>"], description: "<description>" })`. The tool re-validates the body (TOCTOU), writes `foundry/artefacts/<id>/definition.md`, and produces one git commit on the current `config/*` branch. Show the user the resulting commit hash.

   If the tool returns `{ ok: false, errors }` because the target file already exists, read the existing file, incorporate the user's requested changes into the current body, propose the merged result for review, then write and commit the updated file.

3. **Type-specific laws**: Ask "Define any type-specific laws for this artefact type?" If yes, invoke the `add-law` protocol with context: `{target: {kind: "type-specific", typeId: "<new-type-id>"}}`. The `add-law` skill asks for the missing law fields (id, name, description, passing, failing) and creates the law at `foundry/artefacts/<typeId>/laws.md`.

4. **Appraisers**: Ask "How should appraisers be configured for this artefact type?" Offer the defaults (3 appraisers, any personality) or let the user specify preferences. List the available appraisers from `foundry/appraisers/*.md` so the user can see their options.

## What you do NOT do

- You do not create artefact types with overlapping file patterns — this is a hard block
- You do not skip the naming or glob checks
- You do not create laws without checking for conflicts (delegate to add-law pattern)
