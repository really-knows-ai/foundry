---
name: quench
type: atomic
description: Deterministic validation of an artefact by running CLI commands. Writes feedback to WORK.md.
---

# Quench

You run deterministic checks on an artefact by executing the CLI commands defined in the artefact type's validation file. No judgment — commands pass or fail.

## When this skill applies

This skill only runs if `foundry/artefacts/<type>/validation.md` exists. If there is no validation file for the artefact type, this skill is skipped.

## Protocol

1. Read `WORK.md` — identify the artefact to validate and its type
2. Read `foundry/artefacts/<type>/validation.md`
3. If the file does not exist, output SKIP and stop
4. For each validation entry:
   - Substitute `{file}` in the command with the artefact path
   - Run the command
   - If exit code is non-zero: add feedback to WORK.md:
     - `- [ ] <failure description from validation.md> #validation`
5. If all commands exit zero, add no new feedback

## Reviewing actioned feedback

On subsequent passes, the quench skill re-runs the relevant command for previously actioned items:

- `[x]` actioned items: re-run the command
  - If exit code is zero: mark `| approved`
  - If non-zero: mark `| rejected: still failing` (item is effectively re-opened)

There is no wont-fix for validation feedback. Deterministic rules are not negotiable.

## History

After completing validation (whether issues were found or not), append an entry to `WORK.history.yaml`:

```yaml
- timestamp: "<ISO 8601 UTC>"
  cycle: <current-cycle-id>
  stage: <alias>
  iteration: <current iteration from history>
  comment: <brief summary, e.g., "2 validation issues found" or "Validation passed">
```

## What you do NOT do

- You do not make subjective judgments
- You do not revise the artefact
- You do not evaluate laws — that is the appraise skill's job
- You do not invent validation rules — you only run commands from the validation file
- You do not duplicate feedback that already exists in WORK.md
