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

   **Check for failed flow state.** If `foundry_workfile_get` returns `{status: "failed", reason: ...}`, STOP. Do not call any other tool. Tell the user:

   > The flow is in a failed state. Reason: `<reason>`.
   >
   > No further work is permitted. To recover:
   >
   >   1. `foundry_workfile_delete({confirm: true})` to abandon the cycle.
   >   2. Back out to main (`git checkout main`) and delete the work branch.
   >   3. Investigate and fix the root cause of the failure before restarting.

   Then return control to the user and stop.
3. `foundry_artefacts_list({cycle: <current-cycle>})` — enumerate the artefacts produced by **this** cycle. Always pass the `cycle` filter; omitting it returns rows from prior sessions and validates stale files. Skip rows whose status is `done` or `blocked`.
4. For each remaining row:
   a. `foundry_config_validation` with the row's type. If it returns null, skip this row.
   b. `foundry_validate_run` with the type ID and the row's file path — executes all validation commands and returns results.
   c. For each failure: `foundry_feedback_add(file, text, tag: 'validation')`. Tag MUST be `validation` — the tool rejects other tags during quench.
5. If every command passes for every row, add no new feedback.
6. If the artefact table has no rows for this cycle, `foundry_stage_end({summary: 'SKIP: no artefacts registered for this cycle'})` and stop.
7. `foundry_stage_end({summary})`.

## Feedback handling

As a quench stage, you have two feedback responsibilities:

1. **Adding new validation feedback.** If a validation command surfaces
   an issue, call `foundry_feedback_add` with `{ file, text, tag: 'validation' }`.
   The `source` is automatically recorded as your stage id. The tool rejects
   any tag other than `validation` during a quench stage; do not attempt
   `tag: 'quench-lint'` or similar — the tool will return an error.

   The tool returns `{ ok: true, id, deduped }` on success. `deduped: true`
   means an existing non-resolved item with the same `(file, tag,
   hash(text))` was found; the returned `id` is the existing item's id and
   no new snapshot was written. `deduped: false` means a new item was
   created. Either way, `id` is usable for follow-up calls.

2. **Resolving items you sourced.** Call `foundry_feedback_list` to see items
   whose `source` matches your stage id. For items whose current state is
   `actioned` or `wont-fix`, decide whether forge's response is acceptable:
   - Acceptable: call `foundry_feedback_resolve` with `{ id, resolution: 'approved' }`.
     `reason` is optional here.
   - Not acceptable: call `foundry_feedback_resolve` with `{ id, resolution: 'rejected', reason: '...' }`.
     `reason` is required on `rejected`. Forge will see the item back in
     the `rejected` state on the next pass.

**Reason rules.** `reason` is required when resolving a deadlocked item
(deadlock override — but quench never does this; only human-appraise does),
or when `resolution: 'rejected'`. On `resolution: 'approved'` for a
non-deadlocked item, `reason` is optional.

You cannot resolve items sourced by other stages, and you cannot touch
deadlocked items (only human-appraise can override those).

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
