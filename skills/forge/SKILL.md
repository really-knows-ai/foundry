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
6. If the cycle declares `inputs`, discover input files by filesystem scan:
   - For each type listed in `inputs`, call `foundry_config_artefact_type` to get its `file-patterns`.
   - Glob the working tree against those patterns to enumerate candidate input files.
   - Read the goal (from `foundry_workfile_get`) and select the files that are relevant to this run. If the goal names specific files or slugs, use those; if it describes a category ("all the auth tests"), select the matching subset; if it's open-ended, you may consume all candidates or ask the user when the set is clearly ambiguous.
   - Read the selected files for context.
7. Produce the artefact, respecting all applicable laws from the start.
8. Write the artefact file to a location that matches the artefact type's `file-patterns`.
9. `foundry_stage_end({summary})`.

### Revision (feedback exists)

1. `foundry_stage_begin(...)`.
2. `foundry_feedback_list` — find unresolved feedback for the artefact.
3. Read the artefact file.
4. If the cycle declares `inputs`, discover them via filesystem scan against each input type's `file-patterns` (same protocol as first-generation step 6). Re-read the relevant files — they may have changed on disk since the previous iteration (nothing in this cycle wrote to them, but the user may have modified them between iterations).
5. For each unresolved feedback item, either:
   - Address it and call `foundry_feedback_action` (marks item `actioned`), or
   - Call `foundry_feedback_wontfix` with a justification — available only for `law:` / `human` tags (validation feedback must be actioned).
6. Update the artefact file.
7. `foundry_stage_end({summary})`.

## Write invariant

Forge may only write to:
- Files matching the output artefact type's `file-patterns`.
- `WORK.md` and `WORK.history.yaml` (tool-managed).

Everything else on disk — including files of the cycle's input types, files of unrelated artefact types, and files outside any artefact type — is read-only for this stage. This is not an honor-system rule: `foundry_stage_finalize` returns `{error: 'unexpected_files'}` and `sort`'s `checkModifiedFiles` routes a violation on the next call. Either outcome marks the cycle's target artefact `blocked` and you do not get a retry.

When a cycle's output type overlaps with one of its input types (e.g. a `refine-haiku` cycle with input `haiku` and output `haiku`), the overlap is intentional: the cycle's job is to modify existing files of that type. The write invariant still holds — you may only touch files matching the output type's patterns, which in this case includes the files you read as inputs.

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
- You do not write to any file outside the output artefact type's `file-patterns` (plus `WORK.md` / `WORK.history.yaml`). Input files are read-only unless the output type's patterns happen to cover them.
