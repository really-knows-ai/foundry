---
name: quench
type: atomic
description: Deterministic validation of an artefact by running CLI commands. Writes feedback via foundry tools.
---

# Quench

You run deterministic checks on an artefact by executing the CLI commands defined in the artefact type's validation config. No judgment — commands pass or fail.

## Prerequisites

Before running this skill, verify that the `foundry/` directory exists in the project root. If it does not exist, stop and tell the user:

> Foundry is not initialized in this project. Run the `init-foundry` skill first to create the foundry/ directory structure.

## Stage lifecycle (mandatory)

Quench runs inside an enforced stage. Your **first** and **last** tool calls are fixed:

1. **First:** `foundry_stage_begin({stage, cycle, token})` — copy the token verbatim from the dispatch prompt. Any other tool call before this will be blocked.
2. **Last:** `foundry_stage_end({summary})`.

Quench makes **no disk writes**. You produce feedback via `foundry_feedback_add`, never by creating or modifying files. `foundry_stage_finalize` (run by the orchestrator after you return) will flag any unexpected writes as a violation.

## Protocol

1. `foundry_stage_begin(...)`.
2. `foundry_workfile_get` — read the `cycle` from frontmatter.
3. `foundry_artefacts_list({cycle: <current-cycle>})` — enumerate the artefacts produced by **this** cycle. Always pass the `cycle` filter; omitting it returns rows from prior sessions and validates stale files. Skip rows whose status is `done` or `blocked`.
4. For each remaining row:
   a. `foundry_config_validation` with the row's type. If it returns null, skip this row.
   b. `foundry_validate_run` with the type ID and the row's file path — executes all validation commands and returns results.
   c. For each failure: `foundry_feedback_add(file, text, tag: 'validation')`. Tag MUST be `validation` — the tool rejects other tags during quench.
5. If every command passes for every row, add no new feedback.
6. If the artefact table has no rows for this cycle, `foundry_stage_end({summary: 'SKIP: no artefacts registered for this cycle'})` and stop.
7. `foundry_stage_end({summary})`.

## Reviewing actioned feedback

On subsequent passes, review previously actioned items:

1. `foundry_feedback_list` — find `actioned` items tagged `validation` for artefacts in this cycle (use the file list from step 3 above).
2. Re-run the relevant command via `foundry_validate_run`.
3. If the check now passes: `foundry_feedback_resolve(file, index, resolution: 'approved')`.
4. If it still fails: `foundry_feedback_resolve(file, index, resolution: 'rejected', reason)`.

There is no wont-fix for validation feedback — deterministic rules are not negotiable. Quench may only resolve items in state `actioned`; the feedback tool enforces this.

## History

Do NOT call `foundry_history_append` or `foundry_git_commit` — the sort skill handles those. Return a clear summary via `foundry_stage_end` (e.g., "2 validation issues found" or "Validation passed").

## What you do NOT do

- You do not write files — all output goes through `foundry_feedback_add`.
- You do not make subjective judgments.
- You do not revise the artefact (forge's job).
- You do not evaluate laws — that is the appraise skill's job.
- You do not invent validation rules — you only run commands from the validation config.
- You do not duplicate feedback that already exists (the tool de-duplicates by text-hash, but don't rely on it).
- You do not register artefacts — that happens automatically.
