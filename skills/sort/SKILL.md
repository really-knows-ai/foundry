---
name: sort
type: atomic
description: Deterministic routing for a foundry cycle. Runs the foundry_sort tool and returns the next stage.
---

# Sort

You are the central dispatcher for a foundry cycle. You call `foundry_sort` to determine what stage to execute next, dispatch that stage to a fresh subagent, finalize the stage's disk output, and log history. You are the sole writer of history and git commits.

## Prerequisites

Before running this skill, verify that the `foundry/` directory exists in the project root. If it does not exist, stop and tell the user:

> Foundry is not initialized in this project. Run the `init-foundry` skill first to create the foundry/ directory structure.

## Protocol

1. Call `foundry_sort` (optionally passing `cycleDef`). It returns `{route, model?, token?, details?}`. For dispatchable routes (`forge|quench|appraise|human-appraise:*`) the tool mints a single-use, time-limited `token`.

2. Call `foundry_history_append({cycle, stage: 'sort', comment, route})` — the `route` field records what sort decided, and **subsequent** `history_append` calls for non-sort stages are enforced to match this route. This is your audit trail.

3. Act on the route:
   - `forge:*` / `quench:*` / `appraise:*` — **dispatch** (see §Dispatch).
   - `human-appraise:*` — invoke the human-appraise skill inline (human stage, no subagent) but still pass the `token`; the skill must call `foundry_stage_begin` with it.
   - `done` — cycle is complete, return to the cycle skill.
   - `blocked` — iteration limit hit with unresolved feedback, return to the cycle skill.
   - `violation` — a validation, file-modification, or missing-subagent violation was detected (see `details`). Halt the cycle: call `foundry_artefacts_set_status(file, 'blocked')` for each affected artefact, and return to the cycle skill. If `details` mentions a missing subagent, tell the user to run `refresh-agents` and restart.

4. **After** the dispatched subagent returns, call `foundry_stage_finalize({cycle})`. Handle three outcomes:
   - `{ok: true, artefacts: [...]}` — the tool has already registered output artefact rows in WORK.md. Proceed to step 5.
   - `{error: 'unexpected_files', files: [...]}` — the subagent wrote outside the artefact type's `file-patterns`. Mark the cycle's target artefact `blocked` via `foundry_artefacts_set_status` and do **not** re-run the stage. Add a `violation` feedback item describing the offending files, then return to the cycle skill.
   - Any other error — surface it to the user and halt.

5. Call `foundry_history_append({cycle, stage: <dispatched-stage-alias>, comment})` summarizing what the subagent reported. The tool enforces that the stage alias matches the most recent sort's `route` — this is why step 2's `route` field matters.

6. Call `foundry_git_commit({cycle, stage, description})` to record the stage's disk changes.

7. Return to step 1. Repeat until `done`, `blocked`, or `violation`.

## Dispatch

Every forge, quench, and appraise stage runs in a **fresh subagent**. Never inline the stage work in the orchestrator conversation — even if the chosen model matches the orchestrator's. The orchestrator's job is to route, dispatch, finalize, and log. Nothing else.

### Choosing the subagent

- If `foundry_sort` returned a `model` field, use it verbatim as `subagent_type`. It is already in `foundry-<slug>` form.
- If no `model` field, dispatch to `general`.

### Token handling

The `token` returned by `foundry_sort` is an opaque signed string. Pass it through the dispatch prompt verbatim. **Never** invent, edit, or re-sign tokens. The subagent's first tool call must be `foundry_stage_begin({stage, cycle, token})` using this exact string; `stage_begin` verifies the signature, expiry, and single-use nonce.

### Dispatch call shape

Use the `task` tool:

```
task tool:
  subagent_type: <model-slug-from-foundry_sort, or "general">
  description: "Run <stage-alias> for <cycle-id>"
  prompt: |
    You are a Foundry stage agent. Invoke the <stage-base> skill and follow its instructions exactly.

    Stage: <stage-alias>
    Cycle: <cycle-id>
    Token: <token-verbatim>
    Working directory: <worktree>
    File patterns (forge only): <file-patterns-list>

    Your FIRST tool call MUST be foundry_stage_begin({stage, cycle, token}) using the values above.
    Your LAST tool call MUST be foundry_stage_end({summary}).

    When done, report back a brief summary. Do NOT call foundry_history_append, foundry_git_commit, or foundry_artefacts_add — the orchestrator handles all of those.
```

Substitute:
- `<stage-alias>` — the full route string from `foundry_sort` (e.g., `forge:write-haiku`)
- `<stage-base>` — the base of the alias
- `<cycle-id>` — current cycle ID from WORK.md frontmatter
- `<token-verbatim>` — exactly the `token` string from `foundry_sort` — no quoting transforms, no re-encoding
- `<file-patterns-list>` — for forge stages, read via `foundry_config_artefact_type` and include so the subagent can avoid violations
- `<worktree>` — current working directory

### Missing subagent (fail-fast)

`foundry_sort` verifies that `.opencode/agents/foundry-<slug>.md` exists before returning a `model`. If it doesn't, sort returns `{route: 'violation', details: 'Missing required subagent: ...'}`. Handle as in step 3 above.

## Violation handling

If `foundry_stage_finalize` returns `{error: 'unexpected_files', files}`:

- The stage wrote outside its permitted `file-patterns`. This is unrecoverable within the current cycle.
- Mark the target artefact `blocked`: `foundry_artefacts_set_status(file, 'blocked')`.
- Add a feedback item describing the offense: `foundry_feedback_add(file, text: 'unexpected files: …', tag: 'violation')` (if permitted by your stage), or log in the history comment.
- Do NOT attempt to re-run the stage — the subagent already consumed the stage slot.
- Return to the cycle skill so the operator can intervene.

## What you do NOT do

- You do not inline forge/quench/appraise work — always dispatch.
- You do not mint, modify, or cache tokens — they come from `foundry_sort` and go straight to `foundry_stage_begin`.
- You do not skip `foundry_stage_finalize` — it is the only mechanism that registers artefacts and detects file-pattern violations.
- You do not let subagents call `foundry_history_append`, `foundry_git_commit`, or `foundry_artefacts_add` (the last has been removed anyway).
