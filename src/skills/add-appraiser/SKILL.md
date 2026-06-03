---
name: add-appraiser
type: atomic
description: Creates a new appraiser personality, checking for semantic overlap with existing appraisers.
---

# Add Appraiser

You help the user create a new appraiser personality. You ensure it's genuinely distinct from existing appraisers and scaffold the definition file.

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

When invoked with pre-filled fields matching the `foundry_config_create_appraiser` tool args, skip questions for provided fields. Missing fields trigger clarifying questions.

Context fields: `{id, name, description, model?}`

When invoked with a context:
- If all required fields are present, skip the Understand phase and proceed to Plan → Confirm → Build.
- If only some fields are present, ask only for the missing ones.

### 1. Understand

Ask for `id`, `name`, and `description` one at a time. Ask about `model` (optional) — offer the default model as the recommended choice.

**Id conflict check**: Read all existing appraiser definitions in `foundry/appraisers/*.md`. Exact id match means a hard conflict — choose a different id.

**Semantic overlap check**: For each existing appraiser, compare the new personality against it. If significant overlap is found, present it to the user:

> The new appraiser `<new-id>` seems to overlap with existing appraiser `<existing-id>`:
> - New: <name> — <personality summary>
> - Existing: <name> — <personality summary>
> - Overlap: <what makes them similar>
>
> Appraiser diversity matters — similar personalities produce redundant feedback.
>
> Options:
> 1. Proceed anyway (the distinction is meaningful enough)
> 2. Adjust the new personality to be more distinct
> 3. Replace the existing appraiser with a revised version
> 4. Cancel

Do not proceed until the user has decided.

### 2. Plan

Present a quick inline summary: id, name, personality description. Include the model if one was specified. Ask: "Does this capture the personality correctly?" Iterate until the user is satisfied.

### 3. Confirm

Ask: "Proceed with this plan?" — wait for user answer before building. If the user rejects the plan, return to the Understand phase and adjust.

### 4. Build

1. **Validate**: Call `foundry_config_validate_appraiser({ name: "<id>", body: "<assembled markdown>" })`. Assemble the body from the fields using the frontmatter format the tool produces internally. If the result is `{ ok: false, errors: [...] }`, address each error and re-run until `{ ok: true }`. Common issues: missing required frontmatter keys, references to artefact types or flows that do not exist yet.

2. **Create**: Call `foundry_config_create_appraiser({ id: "<id>", name: "<name>", description: "<description>" })`. The tool re-validates the body (TOCTOU), writes `foundry/appraisers/<id>.md`, and produces one git commit on the current `config/*` branch. Show the user the resulting commit hash.

   If the tool returns `{ ok: false, errors }` because the target file already exists, read the existing file, incorporate the user's requested changes into the current body, propose the merged result for review, then write and commit the updated file.

3. **Artefact type configuration**: After creating the appraiser, offer to connect it to relevant artefact-type configuration when doing so supports the user's stated goal. If the user confirms, add the appraiser id to the relevant group's `appraisers` list in the artefact type's frontmatter on the same config branch.

## What you do NOT do

- You do not skip the semantic overlap check
- You do not modify artefact type definitions without the user's confirmation
- You do not create appraisers with duplicate ids
