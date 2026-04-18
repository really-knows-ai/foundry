---
name: sort
type: atomic
description: Deterministic routing for a foundry cycle. Runs the foundry_sort tool and returns the next stage.
---

# Sort

You are the central dispatcher for a foundry cycle. You call the `foundry_sort` tool to determine what stage to execute next, then invoke that stage's skill.

## Prerequisites

Before running this skill, verify that the `foundry/` directory exists in the project root. If it does not exist, stop and tell the user:

> Foundry is not initialized in this project. Run the `init-foundry` skill first to create the foundry/ directory structure.

## Protocol

1. Call `foundry_sort` (optionally passing `cycleDef` if the cycle definition has a non-standard path). It returns `{route, model?, details?}`.

2. Call `foundry_history_append` with the current cycle, stage `"sort"`, and a comment explaining the routing decision in natural language. This is your audit trail — if something goes wrong, this comment is what someone will read to understand what happened.

3. Act on the route:
   - `forge:*` — dispatch the forge skill as a sub-agent. Use model dispatch (see below).
   - `quench:*` — dispatch the quench skill as a sub-agent. Use model dispatch.
   - `appraise:*` — dispatch the appraise skill as a sub-agent. Use model dispatch. Note: the appraise skill handles its own per-appraiser model resolution internally.
   - `hitl:*` — invoke the hitl skill (no model dispatch — human stage)
   - `done` — foundry cycle is complete, return to the cycle skill
   - `blocked` — foundry cycle is blocked (iteration limit hit with unresolved feedback), return to the cycle skill
   - `violation` — file modification or tag validation violation detected (see `details`). The cycle halts — call `foundry_artefacts_set_status` with status `"blocked"`, and return to the cycle skill

### Model dispatch

Use the `model` field from the `foundry_sort` result to determine sub-agent routing:

- If `model` is set (e.g., `openai/gpt-4o`):
  - Convert to agent name: `foundry-openai-gpt-4o`
  - Dispatch with `subagent_type: "foundry-openai-gpt-4o"`
  - If no agent with that name exists, **hard fail**: "Cycle specifies model `<model>` for stage `<base>` but no matching agent `foundry-<name>` is registered. Check your OpenCode provider config."
- If `model` is null:
  - Dispatch with `subagent_type: "general"` (inherits session model)

4. After the invoked skill completes, call `foundry_sort` again. Repeat until it returns `done`, `blocked`, or `violation`.

## What you do NOT do

- You do not make routing decisions yourself — the tool decides
- You do not skip calling `foundry_sort`
- You do not override the tool's output
- You do not skip the history entry — every sort invocation must be logged via `foundry_history_append`
