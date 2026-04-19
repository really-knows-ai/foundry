# Flow DAG, Human Appraise, and Branch Management

## Summary

Three changes to Foundry's architecture:

1. Flows become dependency graphs (DAGs) instead of ordered lists
2. HITL is replaced by a human-appraise stage that acts as an optional quality gate and deadlock breaker
3. Deterministic branch management tools for starting and finishing flow work

## 1. Flow as DAG

### Current model

Flows define an ordered list of cycles executed sequentially. The flow skill enforces order and prohibits skipping.

### New model

A flow declares which cycles are included and which are starting cycles. Cycles own their own routing — each cycle declares its inputs, output, and target cycle(s).

### Flow definition format

```markdown
---
id: creative-flow
name: Creative Flow
starting-cycles: [create-haiku, create-limerick]
---

# Creative Flow

Produces poems and optionally a short story inspired by them.

## Cycles

- create-haiku
- create-limerick
- create-short-story
```

The `starting-cycles` field lists which cycles can be entered first. `## Cycles` lists all cycles in the flow (no ordering implied).

### Cycle routing fields

Cycles gain two new frontmatter fields:

```markdown
---
id: create-haiku
output: haiku
targets: [create-short-story]
---
```

```markdown
---
id: create-short-story
output: short-story
inputs:
  type: any-of
  artefacts: [haiku, limerick]
targets: []
---
```

- `targets` — cycle(s) to route to after this cycle completes. Empty means terminal.
- `inputs.type` — `any-of` (at least one must exist) or `all-of` (all must exist)
- `inputs.artefacts` — list of artefact types required as input

### Routing rules

1. **Flow start:** If one starting cycle, begin it. If multiple, check if the user's request makes the choice obvious (e.g., "write a haiku" → `create-haiku`). If ambiguous, prompt the user.

2. **Between cycles:** When a cycle completes, check its `targets`:
   - No targets → flow is done for this branch
   - One target → check if input contract is satisfied, proceed if so
   - Multiple targets → prompt the user if ambiguous

3. **Input contract validation:** Before entering a target cycle, verify its input contract is met:
   - `any-of` — at least one of the listed artefact types exists as a completed artefact
   - `all-of` — all listed artefact types exist as completed artefacts
   - If not met, inform the user which artefacts are missing

4. **Multiple paths converging:** If `create-haiku` and `create-limerick` both target `create-short-story`, and the short story requires `any-of [haiku, limerick]`, then completing either poem satisfies the contract. The user decides whether to write the other poem first or proceed to the story.

### What changes

- `add-flow` skill: updated to collect starting cycles instead of ordered list
- `add-cycle` skill: updated to collect `targets` and `inputs` contract
- `flow` skill: rewritten from sequential execution to graph traversal with human disambiguation
- Flow definition format: `starting-cycles` replaces ordered `## Cycles` list (list remains for reference only)

## 2. Human Appraise

### Current model

HITL is a distinct stage type (`hitl:*`) with its own skill, routing logic in sort, and history handling.

### New model

HITL is removed. It is replaced by `human-appraise` — an optional appraisal stage that runs after LLM appraisers, with a human acting as a special appraiser.

### Cycle configuration

```markdown
---
id: create-haiku
output: haiku
human-appraise:
  enabled: true
  deadlock-threshold: 3
---
```

- `enabled` — whether human-appraise is available for this cycle (default: false)
- `deadlock-threshold` — after this many iterations with unresolved feedback loops, sort escalates to human-appraise (default: 3)

### Stage ordering within a cycle

```
forge → quench → appraise → human-appraise (optional) → done/loop
```

Stages in a cycle become: `[forge, quench, appraise, human-appraise]`. The `human-appraise` stage is only included when enabled.

### Human-appraise behaviour

**Normal trigger (after appraise passes):**
1. Present the artefact to the human (file content or multi-file diff)
2. Show any resolved feedback from this iteration for context
3. Human either approves or provides feedback
4. If approved → sort advances (to targets or done)
5. If feedback → tagged `#human`, sort routes back to forge

**Deadlock trigger:**
1. Sort detects a deadlock: the same feedback item has been actioned/wont-fixed and rejected N times (where N = `deadlock-threshold`)
2. Instead of returning `blocked`, sort routes to `human-appraise`
3. Present the deadlocked feedback: the appraiser's reasoning, forge's justification
4. Human decides: dismiss the feedback, side with the appraiser, or provide alternative guidance
5. Human feedback tagged `#human` overrides the deadlock

**If human-appraise is NOT enabled** and deadlock is detected, sort returns `blocked` as today.

### #human tag priority

- Forge MUST address `#human` feedback — it cannot wont-fix it
- When `#human` feedback contradicts LLM appraiser feedback on the same topic, forge follows the human's direction
- Appraisers should note when their feedback was overridden by a human decision in a prior iteration

### What changes

- Remove `hitl` skill entirely
- Remove `hitl` routing from sort
- Add `human-appraise` as a new stage type in sort routing
- Add deadlock detection to sort: count iterations where the same feedback item cycles between actioned/wont-fixed and rejected
- Create new `human-appraise` skill (simpler than old hitl — just present artefact, collect feedback with `#human` tag)
- Update `add-cycle` skill to offer human-appraise configuration
- Update cycle skill to include human-appraise in stages when enabled
- Forge skill updated to treat `#human` feedback as non-negotiable

## 3. Branch Management

### Current state

Branch creation exists (`foundry_git_branch`). Cleanup is entirely manual — the test run showed WORK.history.yaml leaking into merges and requiring manual branch force-deletion.

### New tools

**`foundry_workfile_delete` fix:**
Currently only deletes `WORK.md`. Must also delete `WORK.history.yaml`.

**`foundry_git_finish` tool:**
Deterministic cleanup for completing a flow's work branch:

1. Delete `WORK.md` and `WORK.history.yaml`
2. Commit the cleanup: `[flow] cleanup: remove work files`
3. Checkout the base branch (main/master)
4. Squash merge the work branch with a provided message
5. Force-delete the work branch (required after squash merge)
6. Return the merge commit hash

Parameters:
- `message` — squash merge commit message
- `baseBranch` — target branch (default: `main`)

This replaces the multi-step manual process that leaked files and required `-D` for branch deletion.

### What changes

- Fix `foundry_workfile_delete` to also remove `WORK.history.yaml`
- Add `foundry_git_finish` tool to plugin
- Update `flow` skill to use `foundry_git_finish` on completion
- Update `finishing-a-development-branch` integration (the superpowers skill) to be aware of the foundry tool

## 5. Upgrade Foundry Skill

### Purpose

After a user updates the `@really-knows-ai/foundry` package, their existing `foundry/` directory may contain configuration that uses old formats. The `upgrade-foundry` skill analyses the entire foundry setup — flows, cycles, artefact types, laws, appraisers, and validation — and migrates everything to the current version, asking for clarification where needed.

### When to use

- After upgrading the foundry package to a new version
- When the user asks to migrate or upgrade their foundry configuration

### Protocol

1. **Scan entire foundry directory:**
   - Read all flow definitions in `foundry/flows/*.md`
   - Read all cycle definitions in `foundry/cycles/*.md`
   - Read all artefact type definitions in `foundry/artefacts/*/definition.md`
   - Read all artefact laws in `foundry/artefacts/*/laws.md`
   - Read all artefact validation in `foundry/artefacts/*/validation.md`
   - Read all global laws in `foundry/laws/*.md`
   - Read all appraisers in `foundry/appraisers/*.md`
   - Identify the format version by checking for presence/absence of expected fields

2. **Detect what needs migration across all config types:**
   - **Flows:** ordered `## Cycles` lists but no `starting-cycles` → needs DAG migration
   - **Cycles:** missing `targets` field → needs target routing; `hitl` in stages → needs human-appraise migration; missing `inputs` contract type → needs `any-of`/`all-of`
   - **Artefact types:** missing or outdated frontmatter fields; validation commands with deprecated format
   - **Appraisers:** missing required frontmatter fields; references to removed stage types (e.g., hitl)
   - **Laws:** structural issues; references to deprecated concepts
   - **Validation:** commands using deprecated format; scripts that could benefit from library recommendations

3. **For each flow — migrate to DAG format:**
   - Present the current ordered cycle list to the user
   - Ask: which cycles are starting cycles?
   - For cycles that were adjacent in the old list, suggest the predecessor's target should be the successor
   - Ask the user to confirm or adjust the target routing for each cycle

4. **For each cycle — add targets and input contracts:**
   - Infer targets from the old flow ordering (cycle N targets cycle N+1)
   - Present the inferred targets and ask the user to confirm
   - If a target cycle has inputs, ask whether the contract is `any-of` or `all-of`
   - If a cycle had no inputs declared, check if target cycles need its output type

5. **For cycles with hitl stages:**
   - Ask: do you want to enable `human-appraise` on this cycle?
   - If yes, ask for `deadlock-threshold` (suggest default: 3)
   - Remove `hitl` from the cycle's stage list
   - Remove any hitl-specific configuration

6. **For artefact types, appraisers, laws, and validation:**
   - Check each file against the current expected format
   - Flag any issues or deprecated patterns
   - Suggest fixes with explanations

7. **Present the migration plan:**
   - Show a summary of all changes before writing anything
   - Group by category (flows, cycles, artefact types, appraisers, laws, validation)
   - List each file that will be modified and what changes
   - Ask for confirmation

8. **Apply changes:**
   - Update all affected files
   - Commit with message: `[foundry] upgrade: migrate to vX.Y format`

### What it does NOT do

- It does not create new cycles, artefact types, or appraisers
- It does not delete existing files without confirmation
- It does not modify artefact content (the produced artefacts, not config)
- It does not run automatically — the user invokes it explicitly

## 6. Existing bugs to fix alongside

- **nextAfterAppraise returns `done` instead of advancing:** `nextAfterAppraise` in `sort.js` returns `done` when all feedback is resolved, without checking if remaining stages (like human-appraise) exist. This will be addressed naturally by the human-appraise routing changes.

## 7. Migration

- Existing flow definitions with ordered cycle lists continue to work — the flow skill treats them as a linear graph where each cycle targets the next
- Existing cycles without `targets` field are assumed terminal unless the flow provides ordering
- `hitl` stages in existing cycle configs are deprecated — a warning is emitted suggesting migration to `human-appraise`
