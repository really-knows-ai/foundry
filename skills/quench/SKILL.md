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

## Protocol

1. Call `foundry_workfile_get` to identify the artefact and its type.
2. Call `foundry_config_validation` with the artefact type ID. If it returns null, output SKIP and stop — there is no validation for this type.
3. Call `foundry_validate_run` with the type ID and artefact file path. It executes all validation commands and returns results.
4. For each failure: call `foundry_feedback_add` with the artefact file path, a description of the failure, and tag `"validation"`.
5. If all commands pass, add no new feedback.

## Reviewing actioned feedback

On subsequent passes, review previously actioned items:

1. Call `foundry_feedback_list` to find `actioned` items tagged `validation` for this artefact.
2. Re-run the relevant command via `foundry_validate_run`.
3. If the check now passes: call `foundry_feedback_resolve` with disposition `"approved"`.
4. If it still fails: call `foundry_feedback_resolve` with disposition `"rejected"` and a reason.

There is no wont-fix for validation feedback. Deterministic rules are not negotiable.

## History

After completing validation, call `foundry_history_append` with the current cycle, stage alias, and a brief summary (e.g., "2 validation issues found" or "Validation passed").

## What you do NOT do

- You do not make subjective judgments
- You do not revise the artefact
- You do not evaluate laws — that is the appraise skill's job
- You do not invent validation rules — you only run commands from the validation config
- You do not duplicate feedback that already exists
