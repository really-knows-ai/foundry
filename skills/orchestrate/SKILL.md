---
name: orchestrate
description: Runs a foundry cycle by calling foundry_orchestrate in a loop and acting on the returned action.
---

# Orchestrate

You drive a foundry cycle by calling `foundry_orchestrate` repeatedly and acting on each returned `action`. The tool owns all step-ordering, history, committing, and routing. Your job is to dispatch subagents, run human-appraise when asked, and report terminal states.

## Prerequisites

Before running this skill, verify that `foundry/` exists in the project root and `WORK.md` has been created by the flow skill (with `flow`, `cycle`, and `goal` fields). If not, stop and tell the user to run the flow skill first.

## Protocol

Loop until `foundry_orchestrate` returns a terminal action (`done`, `blocked`, or `violation`):

1. Call `foundry_orchestrate({lastResult})`. Omit `lastResult` on the first iteration. On subsequent iterations, pass `{kind, ok}` reflecting the previous action's outcome.

2. Switch on the returned `action`:

### `dispatch`

Payload: `{stage, subagent_type, prompt}`.

Call the `task` tool:
```
task tool:
  subagent_type: <subagent_type-from-payload>
  description: "Run <stage> for <cycle>"
  prompt: <prompt-from-payload — pass verbatim>
```

When the task returns, call `foundry_orchestrate({lastResult: {kind: 'dispatch', ok: true}})`. If the task tool itself errored or reported a subagent crash, pass `{kind: 'dispatch', ok: false, error: '<message>'}`.

### `human_appraise`

Payload: `{stage, token, context}`.

Invoke the `human-appraise` skill inline, passing `{cycle, token, context}`. The skill will prompt the user, collect feedback, and call `foundry_stage_end({summary})`.

When it returns, call `foundry_orchestrate({lastResult: {kind: 'human_appraise', ok: true}})`.

### `done`

Payload: `{cycle, artefact_file, next_cycles}`.

1. Call `foundry_artefacts_set_status({file: artefact_file, status: 'done'})`.
2. Report to the user: "Cycle `<cycle>` complete. Output: `<artefact_file>`. Next cycles available: `<next_cycles>`."
3. Return control to the flow skill.

### `blocked`

Payload: `{cycle, artefact_file, reason}`.

Report to the user: "Cycle `<cycle>` blocked on `<artefact_file>`: `<reason>`." Return control to the flow skill. The artefact has already been marked blocked.

### `violation`

Payload: `{details, affected_files}`.

Report to the user: "Cycle halted (violation): `<details>`. Affected files: `<affected_files>`." Return control to the flow skill. Affected artefacts have already been marked blocked.

## What you do NOT do

- You do NOT inline forge / quench / appraise work. Always dispatch via `task`.
- You do NOT mint, modify, or cache tokens. The `prompt` from orchestrate already contains the token verbatim.
- You do NOT call `foundry_history_append`, `foundry_git_commit`, `foundry_stage_finalize`, or `foundry_sort`. These are not registered tools in v2.3+; orchestrate handles them internally.
- You do NOT reorder the protocol. `foundry_orchestrate` returns, you act, you call back. Nothing else between.
