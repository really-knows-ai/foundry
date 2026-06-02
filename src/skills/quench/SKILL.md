---
name: quench
type: atomic
description: Deterministic validation of an artefact by running CLI commands. Writes feedback via foundry tools.
---

# Quench

You run deterministic checks on an artefact by executing the CLI commands defined in the law-based validators for the artefact's type. No judgment — commands pass or fail.

## Prerequisites

Before running this skill, verify that the `foundry/` directory exists in the project root. If it does not exist, stop and tell the user:

> Restart OpenCode to initialise Foundry, then retry this command.

## Stage lifecycle (mandatory)

Quench runs inside an enforced stage. Your **first** and **last** tool calls are fixed:

1. **First:** `foundry_stage_begin({stage, cycle, token})` — copy the token verbatim from the dispatch prompt. Any other tool call before this will be blocked.
2. **Last:** `foundry_stage_end()`.

Quench makes **no disk writes**. You produce feedback via `foundry_feedback_add`, never by creating or modifying files. The orchestrator's internal finalize step (run after `stage_end`) will flag any unexpected writes as a violation.

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
3. `foundry_artefacts_list({})` — enumerate the current cycle's branch artefact changes as `[{ file, state }]` entries.
4. For each artefact change:
    a. `foundry_validate_run({ typeId: '<type-id>' })` — executes all law-based validators for the artefact type. The tool returns `{ ok, validatorsRun, items, errors }`. `items` is the array of parsed feedback items; each entry carries `lawId`, `validatorId`, `file`, and `text` (plus optional `location` and `severity`). `errors` carries validator-level failures with `lawId`, `validatorId`, `type` (`parse` or `pattern-mismatch`), and `message`.
   b. For each entry in `items`: call `foundry_feedback_add` with `{ file: item.file, text: item.text, tag: 'law:' + item.lawId + ':' + item.validatorId }`. The tag uses the law ID and validator ID returned by the tool so operators reading `WORK.feedback.yaml` can identify exactly which validator produced each item.
   c. If `errors` is non-empty, the validators themselves misbehaved (malformed JSONL or files outside the artefact type's `file-patterns`). Report these to the user; do not convert them to law-tagged feedback.
5. Call `foundry_feedback_list`. For items whose `source` matches your stage id and whose state is `actioned` or `wont-fix`, use the validation results from step 4 to resolve them by id: approve when the relevant validation now passes or the deterministic issue is gone; reject with a reason when it still fails.
6. If every command passes for every artefact change, add no new feedback.
7. If the artefact list is empty, `foundry_stage_end()` and stop.
8. `foundry_stage_end()`.

## Feedback handling

As a quench stage, you have two feedback responsibilities:

1. **Adding new validation feedback.** For each entry returned in the `items`
   array from `foundry_validate_run`, call `foundry_feedback_add` with
   `{ file: item.file, text: item.text, tag: 'law:' + item.lawId + ':' + item.validatorId }`.
   The `source` is automatically recorded as your stage id. Feedback tags must
   follow the `law:<law-id>:<validator-id>` format to identify which law and
   which validator on that law produced the feedback.

   The tool returns `{ ok: true, id, deduped }` on success. `deduped: true`
   means an existing non-resolved item with the same `(file, tag,
   hash(text))` was found; the returned `id` is the existing item's id and
   no new snapshot was written. `deduped: false` means a new item was
   created. Either way, `id` is usable for follow-up calls.

2. **Resolving items you sourced.** Call `foundry_feedback_list` to see items
   whose `source` matches your stage id. For items whose current state is
   `actioned` or `wont-fix`, use deterministic validation results to decide
   whether the issue is gone:
   - Validation now passes / issue is gone: call `foundry_feedback_resolve` with `{ id, resolution: 'approved' }`.
     `reason` is optional here.
   - Validation still fails / issue remains: call `foundry_feedback_resolve` with `{ id, resolution: 'rejected', reason: '...' }`.
     `reason` is required on `rejected`. Forge will see the item back in
     the `rejected` state on the next pass.

**Reason rules.** `reason` is required when resolving a deadlocked item
(deadlock override — but quench never does this; only human-appraise does),
or when `resolution: 'rejected'`. On `resolution: 'approved'` for a
non-deadlocked item, `reason` is optional.

You cannot resolve items sourced by other stages, and you cannot touch
deadlocked items (only human-appraise can override those).

## History

Do NOT call `foundry_history_append` or `foundry_git_commit` — `foundry_run` handles those (the tools are not registered publicly).

## What you do NOT do

- You do not write files — all output goes through `foundry_feedback_add`.
- You do not make subjective judgments.
- You do not revise the artefact (forge's job).
- You do not evaluate laws — that is the appraise skill's job.
- You do not invent validation rules — you only run commands from the law validators.
- You do not duplicate feedback that already exists (the tool de-duplicates by text-hash, but don't rely on it).
- You do not register artefacts — that happens automatically.
