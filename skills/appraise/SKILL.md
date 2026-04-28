---
name: appraise
type: atomic
description: Subjective evaluation of an artefact against laws via multiple independent appraisers.
---

# Appraise

You orchestrate subjective appraisal of an artefact by dispatching independent sub-agent appraisers, then consolidating their feedback.

## Prerequisites

Before running this skill, verify that the `foundry/` directory exists in the project root. If it does not exist, stop and tell the user:

> Foundry is not initialized in this project. Run the `init-foundry` skill first to create the foundry/ directory structure.

## Stage lifecycle (mandatory)

Appraise runs inside an enforced stage. Your **first** and **last** tool calls are fixed:

1. **First:** `foundry_stage_begin({stage, cycle, token})` — copy the token verbatim from the dispatch prompt.
2. **Last:** `foundry_stage_end({summary})`.

Appraise makes **no disk writes**. Feedback output flows through `foundry_feedback_add` and `foundry_feedback_resolve`. The orchestrator's internal finalize step flags any unexpected writes as a violation.

## Protocol

1. `foundry_stage_begin(...)`.
2. Gather context:
   - `foundry_workfile_get` — read the `cycle` from frontmatter

     **Check for failed flow state.** If `foundry_workfile_get` returns `{status: "failed", reason: ...}`, STOP. Do not call any other tool. Tell the user:

     > The flow is in a failed state. Reason: `<reason>`.
     >
     > No further work is permitted. To recover:
     >
     >   1. `foundry_workfile_delete({confirm: true})` to abandon the cycle.
     >   2. Back out to main (`git checkout main`) and delete the work branch.
     >   3. Investigate and fix the root cause of the failure before restarting.

     Then return control to the user and stop.
   - `foundry_artefacts_list({cycle: <current-cycle>})` — enumerate this cycle's artefacts. Always pass the `cycle` filter; omitting it returns stale rows from prior sessions. Skip rows whose status is `done` or `blocked`.
   - For each remaining row, gather its type-specific context:
     - `foundry_config_laws` with the row's type — applicable laws (global + type-specific)
     - `foundry_config_artefact_type` with the type ID — the artefact type definition
     - `foundry_appraisers_select` with the type ID — selected appraiser personalities with their raw model IDs

3. Dispatch each appraiser as an independent sub-agent (see Dispatch below). If this cycle produced multiple artefacts, appraisers evaluate each.

4. Collect results from all appraisers

5. Consolidate (this is judgment):
   - Union of all issues — if any one appraiser flags it, it's feedback
   - De-duplicate: merge overlapping observations into a single feedback item
   - Preserve which appraiser(s) raised each issue (for traceability)

6. For each consolidated issue: `foundry_feedback_add` with `{ file, text, tag: 'law:<slug>' }`. Tags must match `law:<slug>`, and dedup uses the non-resolved `(file, tag, hash(text))` semantics described in Feedback handling.

7. If no appraiser found any issues, the artefact clears appraisal.

8. `foundry_stage_end({summary})`.

## Feedback handling

As an appraise stage, you have two feedback responsibilities:

1. **Adding new law-violation feedback.** For each unmet law, call
   `foundry_feedback_add` with `{ file, text, tag: 'law:<slug>' }`.
   The `source` is automatically your stage id (e.g. `appraise:write-check`).
   The tool rejects any tag not matching `law:<slug>` during an appraise
   stage; do not attempt bare `'appraise'` or `'review'` tags.

   The tool returns `{ ok: true, id, deduped }` on success. `deduped: true`
   means an existing non-resolved item with the same `(file, tag,
   hash(text))` was found (no new snapshot written); `deduped: false`
   means a new item was created. Resolved items are NOT considered for
   dedup — a re-added item after a resolution is a legitimate new item
   (regression feedback).

2. **Resolving items you sourced.** Call `foundry_feedback_list` and look
   at items whose `source` exactly matches your stage id. For items whose
   current state is `actioned` or `wont-fix`:
   - Approve: `foundry_feedback_resolve` with `{ id, resolution: 'approved' }`.
     `reason` is optional.
   - Reject: `foundry_feedback_resolve` with `{ id, resolution: 'rejected', reason: '...' }`.
     `reason` is required. A rejection sends the item back to forge for
     another attempt (the `rejected` state is a legal forge input per
     §5.1 rule 2).

**Reason rules.** `reason` is required on `resolution: 'rejected'` and on
any deadlock-override transition. On `resolution: 'approved'` for a
non-deadlocked item, `reason` is optional.

**Source-authorship rule.** You can only resolve/reject items whose `source`
matches your own stage id — not every appraise stage in the cycle, just yours.
This prevents a second appraise stage from rubber-stamping work it didn't
request. For deadlocked items, only human-appraise has the override authority.

**Future work.** Spec §17 notes a planned cycle-level mode that would let
human-appraise see non-deadlocked unresolved feedback before sort routes.
Not available in v2.6.0; appraise stages today are the sole resolver of
their own non-deadlocked items.

## Dispatch

Each appraiser is dispatched as an independent sub-agent. The sub-agent receives a prompt containing:
- The appraiser's personality (from their definition)
- The artefact content
- All applicable laws (global + type-specific)
- Instructions to evaluate the artefact against each law and return issues as a structured list

### Model resolution

`foundry_appraisers_select` returns raw model IDs for each appraiser. Convert each to an agent name: `foundry-<model.replace(/[/.]/g, '-')>` — both `/` and `.` are replaced with `-`. Examples:
- `openai/gpt-4o` → `foundry-openai-gpt-4o`
- `github-copilot/claude-sonnet-4.6` → `foundry-github-copilot-claude-sonnet-4-6`

- If a model is specified: dispatch with `subagent_type: "foundry-<converted-name>"`. If no agent with that name exists, **hard fail**.
- If no model is specified: dispatch with `subagent_type: "general"` (inherits session model).

Note: per-appraiser `model` overrides are applied here at dispatch time. The cycle-level `models.appraise` value (if set) is read by sort.js for routing-time agent-file validation only; this skill does not consult it when iterating appraisers.

Dispatch all appraisers in parallel (multiple Task calls in a single response).

### Sub-agent prompt template

```
You are an appraiser. Your personality:

<contents of appraiser personality>

Evaluate the following artefact against each law below. For each law, either:
- Note no issues (pass)
- Describe the issue, quoting evidence from the artefact

## Artefact

<artefact content>

## Laws

<all applicable laws>

## Output

Return a list of issues. For each issue:
- law: <law-id>
- issue: <description>
- evidence: <quote from artefact>

If there are no issues, return an empty list.
```

## History

Do NOT call `foundry_history_append` or `foundry_git_commit` — `foundry_orchestrate` handles those (the tools are not registered publicly). Return a summary via `foundry_stage_end` (e.g., "3 issues found across 2 appraisers" or "No issues found").

### Human override awareness

When reviewing an artefact, check the feedback history for `#human` tagged items. If a human has already ruled on a topic in a prior iteration, do not re-raise the same issue — the human's decision is final.

## What you do NOT do

- You do not write files — feedback output goes through `foundry_feedback_add` and `foundry_feedback_resolve`.
- You do not revise the artefact.
- You do not check deterministic rules — that is the quench skill's job.
- You do not filter out feedback because only one appraiser raised it — one is enough.
- You do not register artefacts — that happens automatically via the orchestrator's internal finalize step.
