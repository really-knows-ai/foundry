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

## Protocol

1. Gather context:
   - Call `foundry_workfile_get` — identify the artefact to appraise and its type
   - Call `foundry_config_laws` — get all applicable laws (global + type-specific)
   - Call `foundry_config_artefact_type` with the type ID — get the artefact type definition
   - Call `foundry_appraisers_select` with the type ID — returns selected appraiser personalities with their raw model IDs

2. Dispatch each appraiser as an independent sub-agent (see Dispatch below)

3. Collect results from all appraisers

4. Consolidate (this is judgment):
   - Union of all issues — if any one appraiser flags it, it's feedback
   - De-duplicate: merge overlapping observations into a single feedback item
   - Preserve which appraiser(s) raised each issue (for traceability)

5. For each consolidated issue: call `foundry_feedback_add` with the artefact file path, the issue description, and tag `law:<law-id>`

6. If no appraiser found any issues, the artefact clears appraisal

## Reviewing actioned and wont-fix feedback

On subsequent passes, review previously actioned and wont-fix items:

1. Call `foundry_feedback_list` to find `actioned` and `wontfix` items for this artefact
2. For each item, the appraiser sub-agents evaluate whether the change addresses the issue (actioned) or the justification is sound (wont-fix)
3. Call `foundry_feedback_resolve` with disposition `"approved"` or `"rejected"` (with reason) for each

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

Do NOT call `foundry_history_append` — the sort skill (your caller) is responsible for writing history. Instead, return a clear summary of what you found (e.g., "3 issues found across 2 appraisers" or "No issues found") so sort can log it.

### Human override awareness

When reviewing an artefact, check the feedback history for `#human` tagged items. If a human has already ruled on a topic in a prior iteration, do not re-raise the same issue — the human's decision is final.

## What you do NOT do

- You do not revise the artefact
- You do not check deterministic rules — that is the quench skill's job
- You do not filter out feedback because only one appraiser raised it — one is enough
