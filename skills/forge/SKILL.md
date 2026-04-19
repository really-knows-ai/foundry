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

## Stage lifecycle (mandatory)

Forge runs inside an enforced stage. Your **first** and **last** tool calls are fixed:

1. **First:** `foundry_stage_begin({stage, cycle, token})` — the orchestrator hands you `stage`, `cycle`, and an opaque `token` string in the dispatch prompt. Copy the token verbatim; never invent, edit, or re-sign it. No other tool call is permitted before this one. Any writes before `stage_begin` will be blocked by preconditions.
2. **Last:** `foundry_stage_end({summary})` — return control to the orchestrator. After `stage_end`, the orchestrator calls `foundry_stage_finalize` which scans the disk and registers your output artefact. **You do not register artefacts yourself.**

## Protocol

### First generation (no artefact registered yet)

1. `foundry_stage_begin(...)` with the token from the dispatch prompt.
2. `foundry_workfile_get` — understand the goal.
3. `foundry_config_cycle` — understand what to produce and what inputs are available.
4. `foundry_config_artefact_type` with the output type ID — get the artefact type definition, especially its `file-patterns`.
5. `foundry_config_laws` — get all applicable laws (global + type-specific).
6. If the cycle has inputs, read the input artefacts (read-only context).
7. Produce the artefact, respecting all applicable laws from the start.
8. Write the artefact file to a location that matches the artefact type's `file-patterns`.
9. `foundry_stage_end({summary})`.

### Revision (feedback exists)

1. `foundry_stage_begin(...)`.
2. `foundry_feedback_list` — find unresolved feedback for the artefact.
3. Read the artefact file.
4. If the cycle has inputs, read the input artefacts (read-only context).
5. For each unresolved feedback item, either:
   - Address it and call `foundry_feedback_action` (marks item `actioned`), or
   - Call `foundry_feedback_wontfix` with a justification — available only for `law:` / `human` tags (validation feedback must be actioned).
6. Update the artefact file.
7. `foundry_stage_end({summary})`.

## File-pattern hygiene

Writes during forge must match the output artefact type's `file-patterns`. Writing to any other path causes `foundry_stage_finalize` to return `{error: 'unexpected_files'}` and the orchestrator will mark the cycle's target artefact `blocked`. You will not get a retry. Plus `WORK.md` and `WORK.history.yaml` (managed by tools). Nothing else.

## Unresolved feedback

An item is unresolved if it is:
- `open` — not yet addressed
- `rejected` — actioned or wont-fixed but rejected by appraiser, effectively re-opened

An item is resolved if it is `approved`.

## #human feedback

Feedback tagged `human` (from the human-appraise stage) takes absolute priority:
- You MUST address it — you cannot wont-fix `#human` feedback.
- When `#human` feedback contradicts LLM appraiser feedback on the same topic, follow the human's direction.
- Acknowledge the human's input in your revision.

## What you do NOT do

- You do not add feedback — that is the quench and appraise skills' job. (`foundry_feedback_add` is blocked for you at the tool layer.)
- You do not `foundry_feedback_resolve` — that belongs to quench/appraise/human-appraise.
- You do not register artefacts — `foundry_stage_finalize` handles that automatically.
- You do not call `foundry_history_append` or `foundry_git_commit` — the sort skill does.
- You do not evaluate or score the artefact.
- You do not mark feedback as actioned unless you actually changed the artefact to address it.
- You do not wont-fix validation feedback.
- You do not modify input artefacts — they are read-only.
