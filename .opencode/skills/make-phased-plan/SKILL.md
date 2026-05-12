---
name: make-phased-plan
description: Use when you have a spec in plans/specs/ that needs a phased implementation plan written as PLAN.md and PHASE_XX.md files.
---

# Make Phased Plan

Turn a spec from `plans/specs/` into a phased implementation plan. The resulting plan lives under `plans/` and is designed for execution in a new session via subagent-driven development.

## Workflow

### 1. Select a spec

List files in `plans/specs/`. If the directory is missing or empty, ask the user for the spec path. If multiple specs exist and the user has not specified one, present the list and ask which to plan. If exactly one spec exists, use it.

Read the chosen spec in full. Understand its scope, deliverables, and constraints before planning.

### 2. Choose a plan directory

Create a unique directory under `plans/` named after the spec:

```
plans/<spec-slug>/
```

Use the spec filename (without extension) as the slug. If the directory already exists, append a numeric suffix (`-02`, `-03`, etc.) to avoid collisions.

### 3. Draft the plan with @implementer

Dispatch a subagent using the platform's subagent mechanism, such as `@implementer` or `subagent_type: "implementer"`, with this prompt:

```
You are drafting a phased implementation plan. Read the spec below and produce a PLAN.md and one PHASE_XX.md file per phase.

**Spec:**
[full spec content]

**Requirements:**
- Break the work into discrete phases. Each phase must be independently testable and reviewable.
- Each phase produces concrete, verifiable deliverables — not vague milestones.
- Order phases by dependency: foundational work first, downstream work later.
- Name phases descriptively (e.g., PHASE_01_core_schema.md, PHASE_02_api_layer.md).
- Each PHASE_XX.md must state: goal, deliverables, verification steps, and acceptance criteria.
- PLAN.md must list all phases in order, state the execution method (subagent-driven development), and include a "How to Execute" section that instructs the executing session to use the subagent-driven-development skill.
- Do not omit handoff instructions between phases — state what the next phase depends on from the prior one.
- Use British English spelling throughout.

**Output format:**
Return the full content of PLAN.md followed by each PHASE_XX.md, clearly separated by headings.
```

### 4. Review with @reviewer

Dispatch a subagent using the platform's subagent mechanism, such as `@reviewer` or `subagent_type: "reviewer"`, with this prompt:

```
Review the following phased implementation plan against its spec for completeness, correctness, and execution readiness.

**Spec:**
[full spec content]

**Proposed plan:**
[draft plan from Step 3 — PLAN.md and all PHASE_XX.md files]

Check for:
1. Every requirement in the spec maps to at least one phase deliverable.
2. Each phase has concrete, verifiable acceptance criteria.
3. Phases are ordered by dependency with clear handoff instructions.
4. PLAN.md states execution uses subagent-driven development.
5. No phase is vague or untestable.
6. The plan covers edge cases and error handling mentioned in the spec.

Respond with one of:
- "APPROVED" (plan meets spec requirements)
- A numbered list of specific issues to fix
```

### 5. Iterate or finalise

If the reviewer returns "APPROVED", write the plan files and stop.

If the reviewer raises issues, dispatch the @implementer again with the issues and original spec, receive the revised plan, and re-review. Maximum two review cycles before stopping and reporting unresolved issues to the user.

### 6. Write files

Write `PLAN.md` and each `PHASE_XX.md` to the chosen plan directory. Confirm the files are written by listing the directory contents.

Report to the user:
- The plan directory path
- Number of phases
- Confirmation that execution should use a new session with subagent-driven development

## Output file requirements

### PLAN.md

Contains:
- Plan title and spec reference
- Execution method: subagent-driven development
- Ordered list of phases with one-line descriptions
- "How to Execute" section instructing the executing session to load the `subagent-driven-development` skill and follow it

### PHASE_XX.md

Each phase file contains:
- Phase title and goal
- Deliverables (concrete, verifiable)
- Verification steps (commands, assertions, test outcomes)
- Acceptance criteria (pass/fail conditions)
- Dependencies on prior phases (if any)

## Common mistakes

- **Committing plans/**: The `plans/` directory is untracked. Do not stage or commit anything under `plans/`.
- **One giant plan file**: The plan must be split into `PLAN.md` plus individual `PHASE_XX.md` files. A single file defeats phased execution.
- **Omitting the reviewer**: The @reviewer step is mandatory. A plan without review remains a draft.
- **Vague phase deliverables**: "Implement the API" is not a deliverable. "Create `src/routes/users.ts` with GET, POST, DELETE handlers and input validation" is.
- **Missing handoff instructions**: Each phase must state what it depends on from prior phases. The executing session needs this context.
- **Ignoring the execution method**: PLAN.md must explicitly state that execution uses subagent-driven development. Without this instruction, the executing session may attempt a different approach.
