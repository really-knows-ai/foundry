---
name: cycle
type: composite
description: Runs a foundry cycle by delegating all routing to the sort skill.
composes: [sort, forge, quench, appraise, hitl]
---

# Cycle

A foundry cycle reads its definition, sets up the work file for routing, then hands control to the sort skill which drives the forge/quench/appraise loop.

## Prerequisites

Before running this skill, verify that the `foundry/` directory exists in the project root. If it does not exist, stop and tell the user:

> Foundry is not initialized in this project. Run the `init-foundry` skill first to create the foundry/ directory structure.

## Starting a foundry cycle

1. Call `foundry_config_cycle` with the cycle ID — get the cycle definition
2. Call `foundry_config_artefact_type` with the output type ID — get the artefact type definition
3. Determine the stage route:
   - Use the cycle definition's `stages` field if present
   - Otherwise generate defaults: always `forge`, add `quench` if `foundry_config_validation` returns non-null for the type, always `appraise`
   - Cycle definitions can include `hitl` entries for human-in-the-loop checkpoints
4. Call `foundry_workfile_set` to configure the work file:
   - `key: "cycle"`, `value: <cycle-id>`
   - `key: "stages"`, `value: <determined stages list>`
   - `key: "max-iterations"`, `value: <default 3 or from cycle definition>`
   - If the cycle definition has a `models` map: `key: "models"`, `value: <models map>`
5. Invoke the sort skill

## Sort drives everything

Once sort is invoked, it calls `foundry_sort` to determine the next stage, invokes the corresponding skill, then calls sort again. This repeats until sort returns `done` or `blocked`.

The cycle skill does not contain routing logic — sort owns all of that.

## Completing a foundry cycle

When sort returns `done`:
- Call `foundry_artefacts_set_status` with status `"done"`
- Return control to the flow skill

When sort returns `blocked`:
- Call `foundry_artefacts_set_status` with status `"blocked"`
- Return control to the flow skill (the flow decides how to handle it)

## HITL stages

Cycle definitions can include `hitl` entries in their stages list to pause for human input. When sort routes to a `hitl` stage, the hitl skill presents the configured prompt and records the human's response.

## Micro commits

Every stage must end with a micro commit. Call `foundry_git_commit` with message format: `[<cycle-id>] <base>:<alias>: <brief description>`

Examples:
- `[haiku-creation] forge:write-haiku: initial draft`
- `[haiku-creation] quench:check-syllables: checked syllable pattern`
- `[haiku-creation] forge:write-haiku: addressed validation feedback`

## Feedback states

```
open         - needs generator action
actioned     - needs approval
wont-fix     - needs approval (appraisal only)
approved     - resolved
rejected     - re-opened
```

Tag types: `validation` (from quench), `law:<law-id>` (from appraise), `hitl` (from human) — indicates the source and category of feedback.

## What you do NOT do

- You do not make routing decisions — sort does that
- You do not change the laws mid-cycle
- You do not decide the artefact is "close enough" — it passes or it doesn't
- You do not proceed past a file modification violation
- You do not modify input artefacts — they are read-only
