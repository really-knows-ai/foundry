---
name: flow
type: composite
description: Orchestrates foundry cycles on a work branch, driven by a foundry flow definition.
composes: [cycle]
---

# Flow

A foundry flow reads a flow definition from `foundry/flows/`, creates a work branch, initialises WORK.md, and executes each foundry cycle in sequence.

## Prerequisites

Before running this skill, verify that the `foundry/` directory exists in the project root. If it does not exist, stop and tell the user:

> Foundry is not initialized in this project. Run the `init-foundry` skill first to create the foundry/ directory structure.

## Starting a foundry flow

1. Read the flow definition from `foundry/flows/<flow-id>.md`
2. Create a branch off main: `work/<flow-id>-<short-description>`
3. Create `WORK.md` in the project root with this structure:

   ```markdown
   ---
   flow: <flow-id>
   cycle: <first-cycle-id>
   stages: [<determined by cycle skill>]
   max-iterations: 3
   ---

   # Goal

   <goal from flow definition + human context>

   ## Artefacts

   | File | Type | Cycle | Status |
   |------|------|-------|--------|

   ## Feedback
   ```

   - `flow` — set once, never changes
   - `cycle` — current cycle id, updated when each cycle starts
   - `stages` — the ordered route for the cycle, set by the cycle skill. Each entry uses `base:alias` format (e.g. `forge:write-haiku`, `quench:check-syllables`). Determined from the artefact type: if `validation.md` exists, include `quench`; always include `forge` and `appraise`. `hitl` stages are optional.
   - `max-iterations` — how many forge passes before the cycle is blocked (default: 3, can be overridden in cycle definition)
   - Feedback is grouped under `### <file-path>` sub-headings matching the artefact's File column. See the quench and appraise skills for the format.
4. Execute each foundry cycle in order by reading its definition from `foundry/cycles/<cycle-id>.md`
5. Update the frontmatter cursor as each foundry cycle starts (set `cycle` to the new cycle id)
6. When all foundry cycles are done, delete WORK.md — the artefacts and git history are the record

## Completing a foundry flow

When the foundry flow is complete, the branch contains:
- The finished artefacts
- The full git history of micro commits showing every stage

The human decides whether to merge, open a PR, or discard.

## What you do NOT do

- You do not skip foundry cycles
- You do not reorder foundry cycles
- You do not modify artefacts directly — only foundry cycles modify artefacts
- You do not delete or rewrite feedback history in WORK.md during the foundry flow
