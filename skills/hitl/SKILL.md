---
name: hitl
type: atomic
description: Human-in-the-loop checkpoint. Pauses the cycle for human input before continuing.
---

# HITL

You are a human-in-the-loop checkpoint. Sort has routed to you because the cycle definition includes a pause point here. Your job is to present context, ask the human whatever needs asking, record their response, and return control to sort.

## Prerequisites

Before running this skill, verify that the `foundry/` directory exists in the project root. If it does not exist, stop and tell the user:

> Foundry is not initialized in this project. Run the `init-foundry` skill first to create the foundry/ directory structure.

## Protocol

1. Read `WORK.md` — understand the current state: goal, artefacts, feedback
2. Read the cycle definition from `foundry/cycles/<cycle-id>.md` — find the `hitl` configuration for your alias
3. Present to the human:
   - A summary of where we are in the cycle (what's happened so far, based on WORK.history.yaml)
   - The current state of the artefact (show it or summarise it)
   - Any feedback that exists
   - The prompt from the hitl configuration (or a sensible default)
4. Wait for the human's response
5. Record the response — if the human provided actionable direction, note it in WORK.md under the artefact's feedback section as context for the next forge pass
6. Append a history entry to `WORK.history.yaml`:

```yaml
- timestamp: "<ISO 8601 UTC>"
  cycle: <current-cycle-id>
  stage: <alias>
  iteration: <current iteration>
  comment: "<what the human said or decided — capture the substance>"
```

7. Return control to the sort skill

## Cycle definition hitl config

The cycle definition can include configuration for each hitl checkpoint:

```yaml
hitl:
  review-draft:
    prompt: "Here's the draft. Should we proceed to validation, or do you want changes?"
  accept-result:
    prompt: "The artefact has passed all checks. Accept and complete, or request further refinement?"
```

The key matches the alias (the part after `hitl:` in the stages list). If no config exists for a hitl alias, use a sensible default:

> The cycle has paused for your input. Here's the current state. How would you like to proceed?

## Human responses

The human might:
- **Approve** — "looks good, continue" → no changes needed, sort will route to next stage
- **Request changes** — "change X to Y" → add as feedback in WORK.md: `- [ ] <human's request> #hitl`
- **Provide context** — "keep in mind that..." → note in the history comment for future stages to reference
- **Abort** — "stop" → set artefact status to `blocked` in WORK.md, cycle ends

If the human adds change requests via hitl, these become feedback items tagged `#hitl`. The forge skill treats them like any other open feedback — it must address or wont-fix them.

## What you do NOT do

- You do not make decisions for the human — present the state and wait
- You do not modify the artefact — only WORK.md and WORK.history.yaml
- You do not skip the pause — the human must respond before continuing
- You do not filter or summarise away important details — show the full picture
