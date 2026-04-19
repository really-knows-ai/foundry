---
name: forge
type: atomic
description: Produces or revises an artefact, guided by WORK.md and the foundry cycle definition.
---

# Forge

You produce or revise artefacts. You read the work file to understand the goal and feedback, and the foundry cycle definition to understand what you're producing and what inputs you can read.

## Prerequisites

Before running this skill, verify that the `foundry/` directory exists in the project root. If it does not exist, stop and tell the user:

> Foundry is not initialized in this project. Run the `init-foundry` skill first to create the foundry/ directory structure.

## Protocol

### First generation (no artefact registered yet)

1. Call `foundry_workfile_get` — understand the goal
2. Call `foundry_config_cycle` — understand what to produce and what inputs are available
3. Call `foundry_config_artefact_type` with the output type ID — get the artefact type definition
4. Call `foundry_config_laws` — get all applicable laws (global + type-specific)
5. If the cycle has inputs, read the input artefacts (read-only context)
6. Produce the artefact, respecting all applicable laws from the start (this is judgment — use your craft)
7. Write the artefact file to the location specified in the artefact type definition
8. Call `foundry_artefacts_add` with the file path, type, and cycle to register it with status `"draft"`

### Revision (feedback exists)

1. Call `foundry_feedback_list` to find unresolved feedback for the artefact
2. Read the artefact file
3. If the cycle has inputs, read the input artefacts (read-only context)
4. For each unresolved feedback item, either:
   - Address it and call `foundry_feedback_action` with the item ID (marks as actioned)
   - Call `foundry_feedback_wontfix` with the item ID and a justification (appraisal feedback only)
5. Update the artefact file
6. Wont-fix is only available for `law:` feedback (subjective appraisal). Validation feedback must be actioned — deterministic rules are not negotiable.

### After (both paths)

Do NOT call `foundry_history_append` — the sort skill (your caller) is responsible for writing history. Instead, return a clear summary of what you did so sort can log it.

## Unresolved feedback

An item is unresolved if it is:
- `open` — not yet addressed
- `rejected` — actioned or wont-fixed but rejected by appraiser, effectively re-opened

An item is resolved if it is `approved`.

## Feedback tagged `#hitl`

Feedback tagged `hitl` (human-in-the-loop) is treated the same as any other open feedback. Address it or wont-fix it using the same rules as other feedback items.

## What you do NOT do

- You do not evaluate or score the artefact
- You do not add feedback — that is the quench skill's and appraise skill's job
- You do not mark feedback as actioned unless you actually changed the artefact to address it
- You do not wont-fix validation feedback
- You do not modify input artefacts — they are read-only
