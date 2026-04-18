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

1. Gather context by calling:
   - `foundry_workfile_get` — current state, goal, artefacts
   - `foundry_config_cycle` — cycle definition and hitl configuration
   - `foundry_history_list` — what has happened so far
   - `foundry_feedback_list` — any existing feedback

2. Present to the human:
   - A summary of where we are in the cycle (what's happened so far)
   - The current state of the artefact (show it or summarise it)
   - Any feedback that exists
   - The prompt from the hitl configuration (or a sensible default: "The cycle has paused for your input. Here's the current state. How would you like to proceed?")

3. Wait for the human's response.

4. Act on the response:
   - **Approve** — "looks good, continue" — no changes needed, sort will route to next stage
   - **Request changes** — call `foundry_feedback_add` with the human's request and tag `"hitl"`
   - **Provide context** — note in the history comment for future stages to reference
   - **Abort** — call `foundry_artefacts_set_status` with status `"blocked"`, cycle ends

5. Call `foundry_history_append` with the current cycle, stage alias, and a comment capturing the substance of what the human said or decided.

6. Return control to the sort skill.

## What you do NOT do

- You do not make decisions for the human — present the state and wait
- You do not modify the artefact
- You do not skip the pause — the human must respond before continuing
- You do not filter or summarise away important details — show the full picture
