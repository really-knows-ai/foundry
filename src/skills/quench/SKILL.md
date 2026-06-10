---
name: quench
type: atomic
description: Deterministic validation of an artefact by running CLI commands. The orchestrator posts feedback to the store.
---

# Quench

You run deterministic checks on an artefact by executing the CLI commands defined in the law-based validators for the artefact's type. No judgment — commands pass or fail. The orchestrator handles posting validation results to the feedback store and resolving prior items.

## Prerequisites

Before running this skill, verify that the `foundry/` directory exists in the project root. If it does not exist, stop and tell the user:

> Restart OpenCode to initialise Foundry, then retry this command.

## Stage lifecycle (mandatory)

Quench runs inside an enforced stage. Your **first** and **last** tool calls are fixed:

1. **First:** `foundry_stage_begin({stage, cycle, token})` — copy the token verbatim from the dispatch prompt. Any other tool call before this will be blocked.
2. **Last:** `foundry_stage_end()`.

Quench makes **no disk writes**. All output goes through `foundry_stage_output`. The orchestrator's internal finalise step (run after `stage_end`) will flag any unexpected writes as a violation.

## Protocol

1. `foundry_stage_begin(...)`.
2. `foundry_workfile_get` — read the `cycle` from frontmatter.

   **Check for failed flow state.** If `foundry_workfile_get` returns `{status: "failed", reason: ...}`, STOP. Do not call any other tool. Tell the user:

   > The flow is in a failed state. Reason: `<reason>`.
   >
   > No further work is permitted. To recover:
   >
   >   1. `foundry_workfile_delete({confirm: true})` to abandon the cycle.
   >   2. Back out to main (`git checkout main`) and delete the work branch.
   >   3. Investigate and fix the root cause of the failure before restarting.

   Then return control to the user and stop.
3. `foundry_artefact_list({})` — enumerate the current cycle's branch artefact changes as `[{ file, state }]` entries.
4. For each artefact change:
    a. `foundry_validate_run({ typeId: '<type-id>' })` — executes all law-based validators for the artefact type. The tool returns `{ ok, validatorsRun, items, errors }`. `items` is the array of parsed feedback items; each entry carries `lawId`, `validatorId`, `file`, and `text` (plus optional `location` and `severity`). `errors` carries validator-level failures with `lawId`, `validatorId`, `type` (`parse` or `pattern-mismatch`), and `message`.
    b. For each entry in `items`: call `foundry_stage_output` with the violation details. The orchestrator reads these outputs and posts them to the feedback store with the appropriate tag (`law:<law-id>:<validator-id>`).
    c. If `errors` is non-empty, the validators themselves misbehaved (malformed JSONL or files outside the artefact type's `file-patterns`). Report these to the user; do not convert them to law-tagged feedback.
5. If every command passes for every artefact change, produce no output.
6. If the artefact list is empty, `foundry_stage_end()` and stop.
7. `foundry_stage_end()`.

## Feedback handling

The orchestrator handles all feedback transitions:

1. **Posting new validation feedback.** After `foundry_stage_end`, the orchestrator reads the stage outputs, de-duplicates against existing items, and posts new feedback to `WORK.feedback.yaml` with the appropriate source and tag.

2. **Resolving prior items.** The orchestrator compares current validation results against prior items whose `source` matches this stage. Items whose violations no longer appear are auto-resolved; items whose violations persist are left for forge to address.

You do not call any feedback tools directly. Your responsibility is to run validators and report results through `foundry_stage_output`.

## History

Do NOT call `foundry_history_append` or `foundry_git_commit` — `foundry_cycle_run` handles those (the tools are not registered publicly).

## What you do NOT do

- You do not write files — all output goes through `foundry_stage_output`.
- You do not call any feedback tools — the orchestrator handles transitions.
- You do not make subjective judgments.
- You do not revise the artefact (forge's job).
- You do not evaluate laws — that is the appraise skill's job.
- You do not invent validation rules — you only run commands from the law validators.
- You do not register artefacts — that happens automatically.
