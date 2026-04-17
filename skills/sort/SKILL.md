---
name: sort
type: atomic
description: Deterministic routing for a foundry cycle. Runs scripts/sort.js and returns the next stage.
---

# Sort

You are the central dispatcher for a foundry cycle. You run the sort script to determine what stage to execute next, then invoke that stage's skill.

## Prerequisites

Before running this skill, verify that the `foundry/` directory exists in the project root. If it does not exist, stop and tell the user:

> Foundry is not initialized in this project. Run the `init-foundry` skill first to create the foundry/ directory structure.

## Protocol

1. Run the sort script:

```
node scripts/sort.js --work WORK.md --history WORK.history.yaml --foundry-dir foundry [--cycle-def <path>]
```

The `--cycle-def` argument is optional. It tells the script where to find the cycle definition file for file modification enforcement. Resolution order: `--cycle-def` CLI arg → `cycle-def` frontmatter field in WORK.md → `<foundry-dir>/cycles/<cycle-id>.md`. Only needed if the cycle definition file has a non-standard name or location.

2. Read the output: a full alias (e.g., `forge:write-haiku`, `quench:write-haiku`, `hitl:review-draft`) or a bare status (`done`, `blocked`, `violation`)

3. Append a sort entry to `WORK.history.yaml`:

```yaml
- timestamp: "<ISO 8601 UTC>"
  cycle: <current-cycle-id>
  stage: sort
  iteration: <current iteration>
  comment: "<your reasoning — why this route was chosen, what feedback state you observed>"
```

Write the comment yourself in natural language. Explain what the script returned and why it makes sense given the current state. This is your audit trail — if something goes wrong, this comment is what someone will read to understand what happened.

4. Act on the result:
   - `forge:*` → dispatch the forge skill as a sub-agent, passing the full alias. Use model-specific dispatch (see Model dispatch below).
   - `quench:*` → dispatch the quench skill as a sub-agent, passing the full alias. Use model-specific dispatch.
   - `appraise:*` → dispatch the appraise skill as a sub-agent, passing the full alias. Use model-specific dispatch. Note: the appraise skill handles its own per-appraiser model resolution internally.
   - `hitl:*` → invoke the hitl skill, passing the full alias (no model dispatch — human stage)
   - `done` → foundry cycle is complete, return to the cycle skill
   - `blocked` → foundry cycle is blocked (iteration limit hit with unresolved feedback), return to the cycle skill
   - `violation` → file modification or tag validation violation detected (details on stderr). The cycle halts — log the violation in WORK.md, set artefact status to `blocked`, and return to the cycle skill

### Model dispatch

When dispatching a stage as a sub-agent, check WORK.md frontmatter for a `models` map. Extract the stage's base name (e.g., `forge` from `forge:write-haiku`).

- If `models.<base>` is set (e.g., `models.forge: openai/gpt-4o`):
  - Convert to agent name: `foundry-openai-gpt-4o`
  - Dispatch with `subagent_type: "foundry-openai-gpt-4o"`
  - If no agent with that name exists, **hard fail**: "Cycle specifies model `<model>` for stage `<base>` but no matching agent `foundry-<name>` is registered. Check your OpenCode provider config."
- If `models.<base>` is not set:
  - Dispatch with `subagent_type: "general"` (inherits session model)

5. After the invoked skill completes, run sort again. Repeat until sort returns `done`, `blocked`, or `violation`.

## Enforcement checks

The sort script runs two enforcement checks before routing:

1. **File modification enforcement** — verifies the last commit only touched files allowed for that stage
2. **Tag validation** — verifies all feedback tags match `#validation`, `#law:<id>`, or `#hitl`, and that referenced law IDs exist in `foundry/laws/` or the artefact type's `laws.md`

Either check failing produces `violation` on stdout with details on stderr.

Tag validation is also available as a standalone script:

```
node scripts/validate-tags.js --work WORK.md --foundry-dir foundry
```

## What you do NOT do

- You do not make routing decisions yourself — the script decides
- You do not skip running the script
- You do not override the script's output
- You do not skip writing the history entry — every sort invocation must be logged
