---
name: forge
type: atomic
description: Produces or revises an artefact, guided by WORK.md and the foundry cycle definition.
---

# Forge

You produce or revise artefacts. You read the work file to understand the goal, call `foundry_feedback_list` to understand feedback, and read the foundry cycle definition to understand what you're producing and what inputs you can read.

## Prerequisites

Before running this skill, verify that the `foundry/` directory exists in the project root. If it does not exist, stop and tell the user:

> Foundry is not initialized in this project. Run the `init-foundry` skill first to create the foundry/ directory structure.

## Stage lifecycle (mandatory)

Forge runs inside an enforced stage. Your **first** and **last** tool calls are fixed:

1. **First:** `foundry_stage_begin({stage, cycle, token})` — the orchestrator hands you `stage`, `cycle`, and an opaque `token` string in the dispatch prompt. Copy the token verbatim; never invent, edit, or re-sign it. No other tool call is permitted before this one. Any writes before `stage_begin` will be blocked by preconditions.
2. **Last:** `foundry_stage_end({summary})` — return control to the orchestrator. After `stage_end`, the orchestrator's internal finalize step scans the disk and registers your output artefact. **You do not register artefacts yourself.**

## Protocol

### First generation (no artefact registered yet)

1. `foundry_stage_begin(...)` with the token from the dispatch prompt.
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
2. `foundry_feedback_list` — find feedback whose state is `open` or `rejected` for the current cycle.
3. Read the artefact file.
4. If the cycle declares `inputs`, discover them via filesystem scan against each input type's `file-patterns` (same protocol as first-generation step 6). Re-read the relevant files — they may have changed on disk since the previous iteration (nothing in this cycle wrote to them, but the user may have modified them between iterations).
5. For each item whose state is `open` or `rejected`, follow the feedback handling rules below.
6. Update the artefact file.
7. `foundry_stage_end({summary})`.

## Feedback handling

Call `foundry_feedback_list` to see feedback items for the current cycle.
Each entry has shape `{ id, file, tag, text, source, state, depth, reason? }`.
Action every item whose `state` is `open` or `rejected`:

- If you address the feedback in the artefact: call `foundry_feedback_action`
  with `{ id }`. This marks the item `actioned`. The tool returns
  `{ ok: true }` on success; keep using the original list entry's `id` for
  any follow-up.
- If you decide not to address the feedback: call `foundry_feedback_wontfix`
  with `{ id, reason }`. The reason is required. **You may only mark
  `wont-fix` on items whose `source` stage base is `appraise`.** If the
  item's source base is `quench` (objective validation failure) or
  `human-appraise` (direct user instruction), you must action it — the
  tool will return an error if you attempt `wont-fix`. This replaces the
  old tag-based restriction (`#validation`/`#human` tag check); tags are
  now categorical/display-only and not consulted by the state machine.

`foundry_feedback_add` (if you ever call it — forge normally does not)
returns `{ ok, id, deduped }`. `deduped: true` means an existing
non-resolved item with the same `(file, tag, hash(text))` was found and no
new item was written; the returned `id` is the existing item's id.
`deduped: false` means a new item was created.

You cannot resolve or reject items — only the stage that created the item
(the `source` on each list entry) can do that, with the exception that
human-appraise can override any non-resolved item. You also cannot action
items whose state is `actioned`, `wont-fix`, `deadlocked`, or `resolved`.

## Write invariant

Forge may only write to:
- Files matching the output artefact type's `file-patterns`.
- `WORK.md`, `WORK.feedback.yaml`, and `WORK.history.yaml` (tool-managed).

Everything else on disk — including files of the cycle's input types, files of unrelated artefact types, and files outside any artefact type — is read-only for this stage. This is not an honor-system rule: the orchestrator's internal finalize step returns `{error: 'unexpected_files'}` and the orchestrator's between-stage modified-files audit returns action `violation` on the next call. Either outcome marks the cycle's target artefact `blocked` and you do not get a retry.

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
- You do not register artefacts — the orchestrator's internal finalize step handles that automatically.
- You do not call `foundry_history_append` or `foundry_git_commit` — `foundry_orchestrate` does (those tools are not registered publicly).
- You do not evaluate or score the artefact.
- You do not mark feedback as actioned unless you actually changed the artefact to address it.
- You do not wont-fix items whose `source` stage base is `quench` or `human-appraise`.
- You do not write to any file outside the output artefact type's `file-patterns` (plus `WORK.md` / `WORK.feedback.yaml` / `WORK.history.yaml`). Input files are read-only unless the output type's patterns happen to cover them.
