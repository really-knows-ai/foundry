---
name: flow
type: composite
description: Runs a defined foundry flow to produce artefacts. Use this whenever the user references a flow by id, name, or paraphrase (e.g. "use the creative flow", "run creative-flow"). Do not brainstorm — the flow's cycles already define the work. The user's request is the goal to pass in.
---

# Flow

A foundry flow reads a flow definition, creates a work branch, and executes cycles by following the dependency graph — each cycle declares its own targets and input contracts.

**Testing uncommitted config changes:** If you are on a `config/<x>` branch with in-progress edits to artefact types, laws, cycles, or flows and want to trial-run a flow against those changes without committing them, use the `dry-run` skill instead. Dry-run creates an isolated `dry-run/<x>/<y>` branch, runs the flow, captures a forensic snapshot, and discards the branch — leaving your config branch clean.

## Prerequisites

Before running this skill, verify that the `foundry/` directory exists in the project root. If it does not exist, stop and tell the user:

> Restart OpenCode to initialise Foundry, then retry this command.

## Starting a flow

1. Call `foundry_config_read_flow` with the flow ID — get the flow definition
2. Create a work branch for the flow using the flow ID and a short description
3. Determine the starting cycle:
   - Any cycle listed in the flow can be the starting cycle. The flow's `starting-cycles` list is a hint for when the user's request is ambiguous.
   - Map the user's goal to a cycle by matching the requested output (e.g. "write a short story from the tennis haiku" → `create-short-story`; "write a haiku" → `create-haiku`).
   - If the goal is ambiguous, prompt the user to choose from the flow's cycles, defaulting the recommendation to entries in `starting-cycles`.
   - A cycle whose `inputs` contract cannot be satisfied from files already on disk should not be chosen as the starting cycle. If no other cycle matches, inform the user which input types are missing and offer to run a cycle that produces them first.
4. Pre-check for an existing workfile (prevents silent data loss from an aborted prior session):
   a. Call `foundry_workfile_get`.
   b. If it returns `{error: ...}` (no WORK.md), proceed to step 5.
   c. If it returns an existing workfile, present its `flow`, `cycle`, and `goal` to the user alongside the values just requested, then prompt for one of:
      - **Resume** — keep the existing workfile and skip to step 6. **Only offer resume if the existing `flow` AND `cycle` match what the user just asked for.** If either differs, do not offer resume — running the wrong cycle against stale state corrupts the workflow.
      - **Discard** — call `foundry_workfile_delete`, then proceed to step 5.
      - **Abort** — stop the skill without modifying anything.
   d. Check for failed flow state. If `foundry_workfile_get` returns `{status: "failed", reason: ...}`, STOP. Do not call any other tool. Tell the user:

      > The flow is in a failed state. Reason: `<reason>`.
      >
      > No further work is permitted. To recover:
      >
      >   1. `foundry_workfile_delete({confirm: true})` to abandon the cycle.
      >   2. Back out to main (`git checkout main`) and delete the work branch.
      >   3. Investigate and fix the root cause of the failure before restarting.

      Then return control to the user and stop.
5. Call `foundry_workfile_create` with **only** the flow ID, chosen cycle ID, and goal — do **not** pass `stages` or `maxIterations`. The initial `foundry_run` call will detect it is a new cycle, read the cycle definition, and handle setup automatically.
6. Execute the relay loop: call `foundry_run({ flow, goal, inputs? })`, then read the returned `action`. If `"prompt_user"`, present the prompt to the user, capture their response, and call `foundry_continue()`. Repeat until the action is `"done"` or `"violation"`.

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
   - Call `foundry_workfile_delete` to clear the completed cycle's WORK.md.
    - Call `foundry_workfile_create` with **only** the flow ID, the next cycle ID, and the goal — do **not** pass `stages` or `maxIterations`. The `foundry_run` call will detect `needsSetup` on its first call and bootstrap the rest of the frontmatter from the cycle definition.
    - Do **not** register the completed cycle's output as an input to the next cycle. The output file is on disk and the next cycle's forge discovers it through the input type's `file-patterns` — see the forge skill's input-discovery protocol.
    - Execute the relay loop: call `foundry_run({ flow, goal, inputs? })`, then read the returned `action`. If `"prompt_user"`, present the prompt to the user, capture their response, and call `foundry_continue()`. Repeat until the action is `"done"` or `"violation"`.

## Completing a flow

When all desired cycles are done:

1. Present a summary of what was produced (all artefacts and their status)
2. Ask the user how they want to finish:
   - **Squash merge** — call `foundry_git_finish` with a commit message and base branch. The flow skill always lands on `work/<flow>-<desc>`, so the tool dispatches to its `work` mode. **Audit-aware**: commits `WORK.*` cleanup on the work branch, preserves the branch as `archive/work/<flow>-<desc>-<hash>` for immutable forensic history, squash-merges to the base branch, and creates a signed commit embedding the canonical Foundry attestation block. Requires `confirm: true` (without it returns a plan); refuses dirty worktrees; on merge conflict aborts and preserves the work branch. (`foundry_git_finish` self-classifies by current branch — `config/<x>` finishes integrate without WORK cleanup, and `dry-run/<x>/<y>` finishes write a snapshot. The flow skill exits on `work/<x>`, so only the `work`-mode behaviour applies here.)
   - **Keep the branch** — leave as-is for manual handling
   - **Create a PR** — push and create a pull request
3. Execute the chosen option

## What you do NOT do

- You do not skip input contract validation
- You do not modify artefacts directly — only cycles modify artefacts
- You do not delete or rewrite feedback history during the flow
- You do not route to a target cycle whose input contract is not met
- You do not assume cycle order — follow the targets declared by each cycle
