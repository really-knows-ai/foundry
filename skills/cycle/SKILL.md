---
name: cycle
type: composite
description: Runs a foundry cycle by delegating all routing to the sort skill.
composes: [sort, forge, quench, appraise, human-appraise]
---

# Cycle

A foundry cycle reads its definition, sets up the work file for routing, then hands control to the sort skill which drives the forge/quench/appraise/human-appraise loop.

## Prerequisites

Before running this skill, verify that the `foundry/` directory exists in the project root. If it does not exist, stop and tell the user:

> Foundry is not initialized in this project. Run the `init-foundry` skill first to create the foundry/ directory structure.

## Starting a foundry cycle

1. Call `foundry_config_cycle` with the cycle ID — get the cycle definition
2. Call `foundry_config_artefact_type` with the output type ID — get the artefact type definition
3. Determine the stage route:
   - Use the cycle definition's `stages` field if present
   - Otherwise generate defaults: always `forge`, add `quench` if `foundry_config_validation` returns non-null for the type, always `appraise`
   - If the cycle definition has `human-appraise: true`, append `human-appraise` as the final stage (runs every iteration). If `human-appraise: false` (default), do NOT include it in `stages` — sort will synthesize `human-appraise:<cycle>` on deadlock when needed.
   - Stages should use `base:alias` format (e.g. `forge:write-haiku`, `quench:check-syllables`). If you pass bare names, the tool will auto-append the cycle ID as the alias.
4. Call `foundry_workfile_set` to configure the work file:
   - `key: "cycle"`, `value: <cycle-id>`
   - `key: "stages"`, `value: <determined stages list>`
   - `key: "max-iterations"`, `value: <default 3 or from cycle definition>`
   - `key: "human-appraise"`, `value: <true|false from cycle def, default false>`
   - `key: "deadlock-appraise"`, `value: <true|false from cycle def, default true>`
   - `key: "deadlock-iterations"`, `value: <number from cycle def, default 5>`
   - If the cycle definition has a `models` map: `key: "models"`, `value: <models map>`
5. Invoke the sort skill

## Sort drives everything

Once sort is invoked, it calls `foundry_sort` to determine the next stage, dispatches the corresponding skill to a fresh subagent with a single-use token, calls `foundry_stage_finalize` to register outputs (or detect file-pattern violations), writes history, and commits. This repeats until sort returns `done`, `blocked`, or `violation`.

The cycle skill does not contain routing, finalization, history, or commit logic — sort owns all of that. The cycle skill only sets up the work file and reacts to sort's terminal result.

## Completing a foundry cycle

When sort returns `done`:
- Call `foundry_artefacts_set_status(file, 'done')` for the cycle's output artefact.
- Return control to the flow skill.

When sort returns `blocked`:
- The target artefact is usually already marked `blocked` by sort (on violations) or by human-appraise (on explicit abort). If not, call `foundry_artefacts_set_status(file, 'blocked')`.
- Return control to the flow skill — the flow decides how to handle it.

When sort returns `violation` (e.g., `stage_finalize` `unexpected_files`, missing subagent, or file-pattern violation):
- Sort has already marked affected artefacts blocked and returned. Treat as the blocked path.
- Return control to the flow skill.

## Human Appraise

Human-appraise is controlled by two flat cycle-def keys:

- `human-appraise: true` — human-appraise runs every iteration as part of the normal stage flow (appended to `stages`).
- `deadlock-appraise: true` (default) — if LLM appraisers deadlock on the same feedback for `deadlock-iterations` rounds (default 5), sort routes to human-appraise to resolve it, even when it isn't in `stages`.
- `deadlock-appraise: false` — no human intervention; deadlock → `blocked`.

## Micro commits

Every stage ends with a micro commit, written by sort (not cycle, not subagents). The message format is `[<cycle-id>] <base>:<alias>: <brief description>`.

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

Tag types: `validation` (from quench), `law:<law-id>` (from appraise), `human` (from human-appraise) — indicates the source and category of feedback.

## What you do NOT do

- You do not make routing decisions — sort does that.
- You do not register artefacts — `foundry_stage_finalize` does that (invoked by sort).
- You do not write history or commits — sort does that.
- You do not change the laws mid-cycle.
- You do not decide the artefact is "close enough" — it passes or it doesn't.
- You do not proceed past a file modification violation — honor sort's `violation`/`blocked` return.
- You do not modify input artefacts — they are read-only.
