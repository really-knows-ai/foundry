---
name: orchestrate
description: Runs a foundry cycle by calling foundry_orchestrate in a loop and acting on the returned action.
---

# Orchestrate

You drive a foundry cycle by calling `foundry_orchestrate` repeatedly and acting on each returned `action`. The tool owns all step-ordering, history, committing, and routing. Your job is to dispatch subagents, run human-appraise when asked, and report terminal states.

## Prerequisites

Before running this skill, verify that `foundry/` exists in the project root and `WORK.md` has been created by the flow skill (with `flow`, `cycle`, and `goal` fields). If not, stop and tell the user to run the flow skill first.

### Check for failed flow state

Before iterating, call `foundry_workfile_get` once. If it returns `{status: "failed", reason: ...}`, STOP. Do not call any other tool. Tell the user:

> The flow is in a failed state. Reason: `<reason>`.
>
> No further work is permitted. To recover:
>
>   1. `foundry_workfile_delete({confirm: true})` to abandon the cycle.
>   2. Back out to main (`git checkout main`) and delete the work branch.
>   3. Investigate and fix the root cause of the failure before restarting.

Then return control to the user and stop.

## Protocol

Loop until `foundry_orchestrate` returns a terminal action (`done`, `blocked`, or `violation`):

1. Call `foundry_orchestrate({lastResult})`. Omit `lastResult` on the first iteration. On subsequent iterations, pass `{ok, error?}` reflecting the previous action's outcome.

2. Switch on the returned `action`:

### `dispatch`

Payload: `{stage, subagent_type, prompt}`.

Call the `task` tool. Do NOT load the forge, quench, or appraise skills yourself — the subagent will use them internally:

```
task tool:
  subagent_type: <subagent_type-from-payload>
  description: "Run <stage> for <cycle>"
  prompt: <prompt-from-payload — pass verbatim>
```

**Critical for forge dispatch:** The orchestrator dispatches one feedback item per forge subagent call. The `prompt` already contains exactly one `FEEDBACK ITEM TO ADDRESS`. Pass the prompt verbatim — do NOT read quench output, do NOT add additional feedback items, do NOT inject validator results. The orchestrator will dispatch a separate `task()` call for each unresolved item.

When the task returns, call `foundry_orchestrate({lastResult: {ok: true}})`. If the task tool itself errored or reported a subagent crash, pass `{ok: false, error: '<message>'}`.

### `dispatch_multi`

Payload: `{stage, cycle, tasks}`.

Fire all tasks in parallel by making multiple `task` tool calls in a single response. Do NOT load stage skills yourself:

```
task tool:
  subagent_type: <task.subagent_type>
  description: "Appraise <artefact> for <cycle>"
  prompt: <task.prompt — pass verbatim>
```

Repeat for every entry in the `tasks` array. If `tasks` is empty, call
`foundry_orchestrate({lastResults: []})` directly — no dispatch needed.

When all tasks complete, collect their outputs into a `lastResults` array:

- Task succeeded: `{ok: true, output: "<subagent output text>"}`
- Task failed: `{ok: false, error: "<error message>"}`

Then call `foundry_orchestrate({lastResults})`.

Each appraiser sub-agent prompt already contains the appraiser personality,
artefact content, and applicable laws. Do NOT inject additional instructions.
Do NOT call `foundry_stage_begin` or `foundry_stage_end` — the appraise
module handles lifecycle internally.

### `human_appraise`

Payload: `{stage, token, context}`.

Invoke the `human-appraise` skill inline, passing `{cycle, token, context}`. The skill will prompt the user, collect feedback, and call `foundry_stage_output({ verdict: "approved" })` then `foundry_stage_end()`.

When it returns, call `foundry_orchestrate({lastResult: {ok: true}})`.

### `done`

Payload: `{cycle, artefact_file, next_cycles}`.

1. Report to the user: "Cycle `<cycle>` complete. Output: `<artefact_file>`. Next cycles available: `<next_cycles>`."
2. Return control to the flow skill.

### `blocked`

Payload: `{cycle, artefact_file, reason}`.

Report to the user: "Cycle `<cycle>` blocked on `<artefact_file>`: `<reason>`." Return control to the flow skill. The cycle is blocked.

### `violation`

Payload: `{details, affected_files}`.

Report to the user: "Cycle halted (violation): `<details>`. Affected files: `<affected_files>`." Return control to the flow skill. The cycle is halted by the violation; no per-artefact status is written.

## What you do NOT do

- You do NOT inline forge work. Always dispatch forge via `task`. Quench runs internally in the orchestrator. Appraise uses `dispatch_multi` for parallel subagent dispatch followed by internal consolidation.
- You do NOT mint, modify, or cache tokens. The `prompt` from orchestrate already contains the token verbatim.
- `foundry_history_append`, `foundry_git_commit`, `foundry_stage_finalize`, and `foundry_sort` are not registered tools; orchestrate handles them internally via the loop.
- You do NOT reorder the protocol. `foundry_orchestrate` returns, you act, you call back. Nothing else between.
- You do NOT add extra feedback items to the forge dispatch prompt. The orchestrator dispatches one item at a time. Each prompt already contains exactly one `FEEDBACK ITEM TO ADDRESS`. Do not read quench output and inject additional items.

## Feedback visibility

The orchestrator manages forge feedback transitions directly. After each
forge subagent completes, `enforceForgeStage` inspects the outcome — a
version change or a wont-fix status in the stage output — and transitions the
feedback item to `actioned` or `wont-fix`. Forge subagents do not call
`foundry_feedback_action` or `foundry_feedback_wontfix`; those are the
orchestrator's responsibility. If you want to inspect feedback state for
diagnostic purposes, call `foundry_feedback_list` — the response shape is
`[{ id, file, tag, text, source, state, depth, reason? }]`. This is
read-only and does not affect the loop's dispatch decisions.
