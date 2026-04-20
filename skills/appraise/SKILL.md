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

Appraise makes **no disk writes**. All output flows through `foundry_feedback_add`. `foundry_stage_finalize` flags any unexpected writes as a violation.

## Protocol

1. `foundry_stage_begin(...)`.
2. Gather context:
   - `foundry_workfile_get` — read the `cycle` from frontmatter
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

6. For each consolidated issue: `foundry_feedback_add(file, text, tag: 'law:<law-id>')`. Tag MUST start with `law:` — the tool rejects other tags during appraise. The tool also de-duplicates by text-hash.

7. If no appraiser found any issues, the artefact clears appraisal.

8. `foundry_stage_end({summary})`.

## Reviewing actioned and wont-fix feedback

On subsequent passes, review previously actioned and wont-fix items:

1. `foundry_feedback_list` — find `actioned` and `wont-fix` items for this artefact.
2. Appraiser sub-agents evaluate whether the change addresses the issue (`actioned`) or the justification is sound (`wont-fix`).
3. `foundry_feedback_resolve(file, index, resolution: 'approved'|'rejected', reason?)`. Appraise is the only stage (other than human-appraise) allowed to resolve `wont-fix` items.

## Dispatch

Each appraiser is dispatched as an independent sub-agent. The sub-agent receives a prompt containing:
- The appraiser's personality (from their definition)
- The artefact content
- All applicable laws (global + type-specific)
- Instructions to evaluate the artefact against each law and return issues as a structured list

### Model resolution

`foundry_appraisers_select` returns raw model IDs for each appraiser. Convert each to an agent name: `foundry-<model.replace(/\//g, '-')>` (e.g., `openai/gpt-4o` becomes `foundry-openai-gpt-4o`).

- If a model is specified: dispatch with `subagent_type: "foundry-<converted-name>"`. If no agent with that name exists, **hard fail**.
- If no model is specified: dispatch with `subagent_type: "general"` (inherits session model).

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

Do NOT call `foundry_history_append` or `foundry_git_commit` — the sort skill handles those. Return a summary via `foundry_stage_end` (e.g., "3 issues found across 2 appraisers" or "No issues found").

### Human override awareness

When reviewing an artefact, check the feedback history for `#human` tagged items. If a human has already ruled on a topic in a prior iteration, do not re-raise the same issue — the human's decision is final.

## What you do NOT do

- You do not write files — all output goes through `foundry_feedback_add`.
- You do not revise the artefact.
- You do not check deterministic rules — that is the quench skill's job.
- You do not filter out feedback because only one appraiser raised it — one is enough.
- You do not register artefacts — that happens automatically via `foundry_stage_finalize`.
