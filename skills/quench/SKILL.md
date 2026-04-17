---
name: quench
type: atomic
description: Deterministic validation of an artefact by running CLI commands. Writes feedback to WORK.md.
---

# Quench

You run deterministic checks on an artefact by executing the CLI commands defined in the artefact type's validation file. No judgment — commands pass or fail.

## Prerequisites

Before running this skill, verify that the `foundry/` directory exists in the project root. If it does not exist, stop and tell the user:

> Foundry is not initialized in this project. Run the `init-foundry` skill first to create the foundry/ directory structure.

## When this skill applies

This skill only runs if `foundry/artefacts/<type>/validation.md` exists. If there is no validation file for the artefact type, this skill is skipped.

## Protocol

1. Read `WORK.md` — identify the artefact to validate and its type
2. Read `foundry/artefacts/<type>/validation.md`
3. If the file does not exist, output SKIP and stop
4. For each validation entry:
   - Substitute `{file}` in the command with the artefact path
   - Run the command
   - If exit code is non-zero: add feedback to WORK.md under the artefact's file heading
5. If all commands exit zero, add no new feedback

## Feedback format

Feedback MUST be scoped to the artefact file it applies to. Under `## Feedback`, create a `### <file-path>` sub-heading matching the artefact's File column from the artefacts table, then write feedback items beneath it:

```markdown
## Feedback

### foundry/output/haiku/pissed-off-spaghetti.md
- [ ] The haiku does not have exactly 3 lines. #validation
- [ ] One or more lines do not match the 5-7-5 syllable pattern. #validation
```

If the `## Feedback` section or the file sub-heading already exists, append items under the existing heading. Never write feedback items without a file sub-heading — the sort script cannot parse them.

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
- You do not write feedback items without a file sub-heading under `## Feedback`
