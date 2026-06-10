---
name: forge
type: atomic
description: Produces or revises an artefact, guided by WORK.md and the foundry cycle definition.
---

# Forge

**This skill is subagent-only.** It describes the protocol a forge subagent follows when dispatched via `task()` from the orchestrate loop. Do NOT load this skill and run forge inline — the orchestrate skill returns a `dispatch` action with a pre-built prompt; call `task()` with it.

You produce or revise artefacts. You read the work file to understand the goal and follow the feedback item in the dispatch prompt, and read the foundry cycle definition to understand what you're producing and what inputs you can read.

## Prerequisites

Before running this skill, verify that the `foundry/` directory exists in the project root. If it does not exist, stop and tell the user:

> Restart OpenCode to initialise Foundry, then retry this command.

## Stage lifecycle (mandatory)

Forge runs inside an enforced stage. Your **first** and **last** tool calls are fixed:

1. **First:** `foundry_stage_begin({stage, cycle, tokenFile})` — the orchestrator hands you `stage`, `cycle`, and a `tokenFile` filename in the dispatch prompt. Pass the filename verbatim; never invent or edit it. No other tool call is permitted before this one. Any writes before `stage_begin` will be blocked by preconditions.
2. **Last:** `foundry_stage_end()` — return control to the orchestrator. After `stage_end`, the orchestrator's internal finalise step scans the disk and registers your output artefact. **You do not register artefacts yourself.**

## Protocol

### First generation (no artefact registered yet)

1. `foundry_stage_begin({stage, cycle, tokenFile})` with the `tokenFile` from the dispatch prompt.
2. `foundry_workfile_get` — understand the goal.

   **Check for failed flow state.** If `foundry_workfile_get` returns `{status: "failed", reason: ...}`, STOP. Do not call any other tool. Tell the user:

   > The flow is in a failed state. Reason: `<reason>`.
   >
   > No further work is permitted. To recover:
   >
   >   1. `foundry_workfile_delete({confirm: true})` to abandon the cycle.
   >   2. Back out to main (`git checkout main`) and delete the work branch.
   >   3. Investigate and fix the root cause of the failure before restarting.

   Then return control to the user and stop.
3. `foundry_config_read_cycle` — understand what to produce and what inputs are available.
4. `foundry_config_read_artefact_type` with the output type ID — get the artefact type definition, `file-patterns`, and any example. When the response includes an `example` field, its structure is normative — your output must follow the same format (no extra headings, metadata blocks, or free-form prose that the example does not include).
5. `foundry_config_read_laws` — get all applicable laws (global + type-specific).
6. If the cycle declares `inputs`, discover input files by filesystem scan:
   - For each type listed in `inputs`, call `foundry_config_read_artefact_type` to get its `file-patterns`.
   - Glob the working tree against those patterns to enumerate candidate input files.
   - Read the goal (from `foundry_workfile_get`) and select the files that are relevant to this run. If the goal names specific files or slugs, use those; if it describes a category ("all the auth tests"), select the matching subset; if it's open-ended, you may consume all candidates or ask the user when the set is clearly ambiguous.
   - Read the selected files for context.
7. Produce the artefact, respecting all applicable laws from the start.
8. Write the artefact file to a location that matches the artefact type's `file-patterns`.
9. `foundry_stage_output({ status: "done" })` then `foundry_stage_end()`.

### Revision (feedback exists)

1. `foundry_stage_begin(...)`.
2. Read the artefact file.
3. If the cycle declares `inputs`, discover them via filesystem scan against each input type's `file-patterns` (same protocol as first-generation step 6). Re-read the relevant files — they may have changed on disk since the previous iteration (nothing in this cycle wrote to them, but the user may have modified them between iterations).
4. Address the single feedback item from the dispatch prompt following the feedback handling rules below.
5. Update the artefact file (if fixing), or skip (if WONT-FIX).
6. `foundry_stage_output({ status: "actioned" })` then `foundry_stage_end()` — file was changed to address the feedback.
   Or: `foundry_stage_output({ status: "wont-fix", reason: "<justification>" })` then `foundry_stage_end()` — item already resolved or does not apply.
   Call `foundry_stage_output` with the correct status object. Write nothing else — format is validated by the tool.

## Feedback handling

The dispatch prompt contains one feedback item to address.

**To fix the issue** — change the artefact file and call
`foundry_stage_output({ status: "actioned" })` then `foundry_stage_end()`.

**If the issue is already resolved** — call
`foundry_stage_output({ status: "wont-fix", reason: "<justification>" })` then `foundry_stage_end()`.
Do NOT change the file.

**If the issue does not apply** (appraise judgement you disagree with) — same
`wont-fix` flow.

The status is validated by the tool. No descriptions, no explanations.

Do NOT call `foundry_feedback_action`, `foundry_feedback_wontfix`, or
`foundry_feedback_resolve`. The orchestrator handles transitions automatically.

## Write invariant

Forge may only write to:
- Files matching the output artefact type's `file-patterns`.
- `WORK.md`, `WORK.feedback.yaml`, and `WORK.history.yaml` (tool-managed).

Everything else on disk — including files of the cycle's input types, files of unrelated artefact types, and files outside any artefact type — is read-only for this stage. This rule is tool-enforced: the orchestrator's internal finalise step returns `{error: 'unexpected_files'}` and the orchestrator's modified-file check routes a violation on the next call. Either outcome marks the cycle's target artefact `blocked` and you do not get a retry.

When a cycle's output type overlaps with one of its input types (e.g. a `refine-haiku` cycle with input `haiku` and output `haiku`), the overlap is intentional: the cycle's job is to modify existing files of that type. The write invariant still holds — you may only touch files matching the output type's patterns, which in this case includes the files you read as inputs.

## Resolution vocabulary

An item is **unresolved** if its `history[0].state` is one of `open`,
`rejected`, `actioned`, `wont-fix`, or `deadlocked`. An item is
**resolved** only when `history[0].state === 'resolved'` (terminal).
Forge only acts on `open` and `rejected` items; it never sees `resolved`
items in the list output.

## What you do NOT do

- You normally do not add feedback — that is the quench and appraise skills' job.
- You do not `foundry_feedback_resolve` — that belongs to quench/appraise/human-appraise.
- You do not register artefacts — the orchestrator's internal finalise step handles that automatically.
- You do not call `foundry_history_append` or `foundry_git_commit` — `foundry_cycle_run` does (those tools are not registered publicly).
- You do not evaluate or score the artefact.
- You do not mark feedback as actioned or wont-fix via tool calls — the orchestrator handles feedback transitions based on your artefact changes and stage output.
- You do not write to any file outside the output artefact type's `file-patterns` (plus `WORK.md` / `WORK.feedback.yaml` / `WORK.history.yaml`). Input files are read-only unless the output type's patterns happen to cover them.
