---
name: flow
type: composite
description: Runs a defined foundry flow to produce artefacts. Use this whenever the user references a flow by id, name, or paraphrase (e.g. "use the creative flow", "run creative-flow"). Do not brainstorm — the flow's cycles already define the work. The user's request is the goal to pass in.
composes: [cycle]
---

# Flow

A foundry flow reads a flow definition, creates a work branch, and executes cycles by following the dependency graph — each cycle declares its own targets and input contracts.

## Prerequisites

Before running this skill, verify that the `foundry/` directory exists in the project root. If it does not exist, stop and tell the user:

> Foundry is not initialized in this project. Run the `init-foundry` skill first to create the foundry/ directory structure.

## Starting a flow

1. Call `foundry_config_flow` with the flow ID — get the flow definition
2. Call `foundry_git_branch` with the flow ID and a short description — create the work branch
3. Determine the starting cycle:
   - If only one starting cycle, use it
   - If multiple starting cycles, check whether the user's request makes the choice obvious (e.g., "write a haiku" clearly maps to `create-haiku`)
   - If ambiguous, prompt the user to choose
4. Call `foundry_workfile_create` with **only** the flow ID, chosen cycle ID, and goal — do **not** pass `stages` or `maxIterations`. The `cycle` skill will read the cycle definition and populate those via `foundry_workfile_set` in the next step.
5. Execute the cycle by invoking the cycle skill

## Between cycles

When a cycle completes (sort returns `done`):

1. Read the completed cycle's definition to find its `targets`
2. If no targets → this branch of the flow is done. Proceed to "Completing a flow"
3. If one target:
   - Read the target cycle's definition
   - Check input contract: `any-of` requires at least one listed artefact type to exist as a completed artefact; `all-of` requires all
   - If satisfied → ask the user if they want to proceed, or run another starting cycle first
   - If not satisfied → inform the user which artefacts are missing, offer to run cycles that produce them
4. If multiple targets:
   - Present the options to the user
   - Check input contracts for each
   - The user chooses which target to pursue (or which to pursue first)
5. Set up the next cycle:
   - Call `foundry_workfile_set` with `key: "cycle"`, `value: <next-cycle-id>`
   - Reset stages and iteration count for the new cycle
   - Execute the cycle by invoking the cycle skill

## Completing a flow

When all desired cycles are done:

1. Present a summary of what was produced (all artefacts and their status)
2. Ask the user how they want to finish:
   - **Squash merge** — call `foundry_git_finish` with a commit message and base branch
   - **Keep the branch** — leave as-is for manual handling
   - **Create a PR** — push and create a pull request
3. Execute the chosen option

## What you do NOT do

- You do not skip input contract validation
- You do not modify artefacts directly — only cycles modify artefacts
- You do not delete or rewrite feedback history during the flow
- You do not route to a target cycle whose input contract is not met
- You do not assume cycle order — follow the targets declared by each cycle
