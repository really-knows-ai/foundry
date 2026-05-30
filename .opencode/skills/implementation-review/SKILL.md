---
name: implementation-review
description: Review the current repository state against a project's SPEC.md in plans/<project-name>/ and produce a checklist of issues in REVIEW.md. Use when you need a methodical spec-compliance audit of the present codebase.
---

# Implementation Review

Read a project's `SPEC.md` from `plans/<project-name>/`, then dispatch parallel `@reviewer` subagents—one per spec section—to audit the current repository state for compliance. Consolidate every finding into `plans/<project-name>/REVIEW.md` as a plain checklist of items to address.

## Workflow

### 1. Read the spec

Read `plans/<project-name>/SPEC.md`. If the directory or file does not exist, stop and report the missing path.

### 2. Divide the spec into sections

Break `SPEC.md` into its top-level logical sections. Each section becomes an independent review target.

### 3. Delete any existing review

If `plans/<project-name>/REVIEW.md` already exists, delete it now so the new review is a clean, single source of truth.

### 4. Dispatch one reviewer per section

For each spec section, launch an `@reviewer` subagent in parallel with the others. Every subagent receives this prompt:

```
Review the current repository state against this single section of the spec.

**Spec section:**
[verbatim section text]

**Repository:**
Review the current HEAD / working-tree state of the repository. Do not look at git diff, commit history, or branch comparisons. Assess the code as it exists now.

**Task:**
- Identify every place where the present implementation does not satisfy this spec section.
- List each deviation as a concrete, actionable item.
- Do not judge severity. If the implementation differs from the spec in any way, that is an issue.
- Do not include a summary, a compliance judgement, or severity ratings.
- If this section is fully satisfied, return exactly: "No issues."
```

### 5. Collect and consolidate

When all subagents return, gather every non-empty finding. If every reviewer returns "No issues." (or equivalent), respond to the user with:

> No issues.

and do **not** write a `REVIEW.md` file.

Otherwise, merge all findings into a single checklist in `plans/<project-name>/REVIEW.md`:

- Write each issue as a top-level checklist item: `- [ ] ...`
- Preserve the exact wording returned by the reviewers when possible.
- Do not group, deduplicate, or reclassify items.
- Do not add a summary, a compliance score, or any preamble beyond the checklist itself.
- Do not add severity labels.

## Hard Rules

- Reviewers must assess the **current repository state**, not diffs or history.
- Every spec section gets its own reviewer, and all reviewers run in parallel.
- `REVIEW.md` is a plain checklist. No summaries, no scores, no severity labels, no compliance judgement.
- If there are no issues at all, output nothing to disk and reply with "No issues."
- An existing `REVIEW.md` is deleted before the new one is written, so there is never stale data.

## Common Mistakes

- **Looking at git diff instead of the present state.** The review is of the codebase as it exists, not what changed recently.
- **Running reviewers sequentially.** They must run in parallel so each section is audited independently.
- **Writing REVIEW.md when there are no issues.** If every section is fully satisfied, do not create the file.
- **Adding severity or compliance commentary.** The output is a checklist of items to fix, full stop.
