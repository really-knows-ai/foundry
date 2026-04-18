---
name: flow
type: composite
description: Orchestrates foundry cycles on a work branch, driven by a foundry flow definition.
composes: [cycle]
---

# Flow

A foundry flow reads a flow definition, creates a work branch, initialises the work file, and executes each foundry cycle in sequence.

## Prerequisites

Before running this skill, verify that the `foundry/` directory exists in the project root. If it does not exist, stop and tell the user:

> Foundry is not initialized in this project. Run the `init-foundry` skill first to create the foundry/ directory structure.

## Starting a foundry flow

1. Call `foundry_config_flow` with the flow ID — get the flow definition
2. Call `foundry_git_branch` with name `work/<flow-id>-<short-description>` — create the work branch
3. Call `foundry_workfile_create` with the flow ID, first cycle ID, and goal from the flow definition + human context
4. Execute each cycle in order by invoking the cycle skill
5. Between cycles: call `foundry_workfile_set` with `key: "cycle"`, `value: <next-cycle-id>`
6. When all cycles are done: call `foundry_workfile_delete` — the artefacts and git history are the record

## Completing a foundry flow

When the flow is complete, the branch contains:
- The finished artefacts
- The full git history of micro commits showing every stage

The human decides whether to merge, open a PR, or discard.

## What you do NOT do

- You do not skip cycles
- You do not reorder cycles
- You do not modify artefacts directly — only cycles modify artefacts
- You do not delete or rewrite feedback history during the flow
