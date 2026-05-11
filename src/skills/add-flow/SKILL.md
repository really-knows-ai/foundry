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

### 2. Inventory existing configuration

Read existing flows, cycles, artefact types, laws, appraisers, and validators. Identify reusable pieces and conflicts.

### 3. Design the dependency set

Create missing dependencies in validation order:

1. Artefact type and file patterns.
2. Type-specific laws.
3. Deterministic validators attached to laws.
4. Appraisers or appraiser selection.
5. Cycles that produce the artefact types.
6. Flow tying starting cycles and cycle list together.

For the haiku example, default to a `haiku` artefact type, `haikus/*.md` file pattern, laws for form, imagery, and mood, a deterministic syllable validator where project dependencies allow it, two or three distinct appraisers, one cycle, and one flow.

### 4. Confirm ambiguous choices

Ask only for choices that affect the user's goal or safety. Reuse compatible existing configuration when it clearly fits.

### 5. Validate and create each piece

For each definition, validate first, resolve validation errors, then create it. Summarise each created file and commit hash in Foundry terms.

### 6. Final summary

Report the flow, starting cycles, artefact type, laws, validators, appraisers, and files created. Tell the user they can now ask the Foundry agent to run the flow.

## Safety Rules

- Do not create overlapping artefact file patterns.
- Do not skip dependency validation.
- Do not expose internal tool-call syntax to the user.
- Do not continue when a branch or worktree state could overwrite user changes.
