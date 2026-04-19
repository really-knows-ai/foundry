---
name: sort
type: atomic
description: Deterministic routing for a foundry cycle. Runs the foundry_sort tool and returns the next stage.
---

# Sort

You are the central dispatcher for a foundry cycle. You call the `foundry_sort` tool to determine what stage to execute next, then dispatch that stage to a fresh subagent.

## Prerequisites

Before running this skill, verify that the `foundry/` directory exists in the project root. If it does not exist, stop and tell the user:

> Foundry is not initialized in this project. Run the `init-foundry` skill first to create the foundry/ directory structure.

## Protocol

1. Call `foundry_sort` (optionally passing `cycleDef` if the cycle definition has a non-standard path). It returns `{route, model?, details?}`.

2. Call `foundry_history_append` with the current cycle, stage `"sort"`, and a comment explaining the routing decision in natural language. This is your audit trail — if something goes wrong, this comment is what someone will read to understand what happened.

3. Act on the route:
   - `forge:*` — **dispatch** (see §Dispatch below)
   - `quench:*` — **dispatch**
   - `appraise:*` — **dispatch**. Note: the appraise skill handles its own per-appraiser model resolution internally.
   - `human-appraise:*` — invoke the human-appraise skill inline (human stage, no subagent)
   - `done` — foundry cycle is complete, return to the cycle skill
   - `blocked` — foundry cycle is blocked (iteration limit hit with unresolved feedback), return to the cycle skill
   - `violation` — a validation, file-modification, or missing-subagent violation was detected (see `details`). The cycle halts — call `foundry_artefacts_set_status` with status `"blocked"` for each affected artefact, and return to the cycle skill. If `details` mentions a missing subagent, tell the user to run the `refresh-agents` skill and restart.

4. After the subagent completes, call `foundry_history_append` with the current cycle, the **dispatched stage alias** (e.g., `forge:write-haiku`), and a comment summarizing what the subagent reported doing. This is critical — sort is the only reliable writer of stage history. Subagents must NOT write their own history entries.

5. After logging the stage history, call `foundry_sort` again. Repeat from step 1 until it returns `done`, `blocked`, or `violation`.

## Dispatch

Every forge, quench, and appraise stage runs in a **fresh subagent**. Never inline the stage work in the orchestrator conversation — even if the chosen model happens to match the orchestrator's model. The orchestrator's job is to route and log, nothing else.

### Choosing the subagent

- If `foundry_sort` returned a `model` field in its response, use that value verbatim as `subagent_type`. It is already in `foundry-<slug>` form (the tool does the slug computation by replacing both `/` and `.` with `-` in the model ID).
- If `foundry_sort` returned **no** `model` field (the cycle has no `models:` map, or no entry for this stage base), dispatch to the default general-purpose subagent: `general`.

### Dispatch call shape

Use the `task` tool:

```
task tool:
  subagent_type: <model-slug-from-foundry_sort-response, or "general">
  description: "Run <stage-alias> for <cycle-id>"
  prompt: |
    You are a Foundry stage agent. Invoke the <stage-base> skill and follow its instructions exactly.

    Current cycle: <cycle-id>
    Current stage: <stage-alias>
    Working directory: <worktree>

    When done, report back a brief summary of what you did. Do NOT call foundry_history_append — the orchestrator handles history.
```

Substitute:
- `<stage-alias>` — the full route string from `foundry_sort` (e.g., `forge:write-haiku`)
- `<stage-base>` — the base of the alias (e.g., `forge`, `quench`, `appraise`)
- `<cycle-id>` — the current cycle ID from WORK.md frontmatter
- `<worktree>` — the current working directory

### Missing subagent (fail-fast)

The `foundry_sort` tool verifies that the required `.opencode/agents/foundry-<slug>.md` file exists before returning a `model`. If it doesn't, sort returns `{route: 'violation', details: 'Missing required subagent: ...'}`. Handle this as described in step 3 above — halt the cycle, mark artefacts blocked, and instruct the user to run the `refresh-agents` skill.

## What you do NOT do

- You do not make routing decisions yourself — the tool decides.
- You do not skip calling `foundry_sort`.
- You do not override the tool's output.
- You do not skip the history entry — every sort invocation gets a `sort` entry, and every completed stage gets a stage entry (e.g., `forge:write-haiku`). You are the sole writer of history.
- You do **not** inline forge/quench/appraise work — always dispatch to a subagent via the `task` tool, even when the resolved model matches the orchestrator's own model.
