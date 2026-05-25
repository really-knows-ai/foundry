---
name: systematic-fix-and-review
description: Run a thorough review on a target, consolidate all findings into a list, then fix each one individually with implementer → reviewer cycles. Use when you need every issue addressed with no shortcuts.
---

# Systematic Fix and Review

Run three parallel reviewers on a target, consolidate all findings into a single exhaustive list, then fix each one through strict implementer → reviewer cycles.

## Workflow

### 1. Run three parallel reviews

Dispatch three `@reviewer` subagents simultaneously. Each receives the same prompt asking for a thorough review of the target. Do not tell them other reviewers exist or that they are running in parallel. The prompt should ask for all issues — blockers, gaps, inconsistencies, wording, edge cases, anything — with no minimum severity threshold.

### 2. Consolidate into REVIEW.md

Read all three review outputs. Merge them into a single exhaustive list in `REVIEW.md` at the repository root.
Do not consolidate items — there is no way for all three reviewers to catch the same thing but merging them into one bullet is fine. Each item is one bullet at the top level with a unique number.

The consolidated list must:

- Include **every** finding from every reviewer. Do not discard items you consider minor, duplicates, or out of scope — all go in.
- Prefix each item with a sequential number (e.g. `1.`, `2.`, `3.`).
- Group items only by the suffix `[blocker]` or `[non-blocker]` if the reviewer explicitly labelled them as such. Otherwise leave unlabelled.
- List items in the order they appear across reviews as far as possible, to avoid time wasted hunting for related items.
- End with a count: `## Summary` line showing `X items across Y reviews Z blockers`.

Write the file. Do not change anything — produce the list. Do not add any additional items.

### 3. Fix each item, one at a time

For each item in `REVIEW.md` in order:

1. Pick the next unfixed item from the list.
2. Issue an `@implementer` subagent to fix that specific item. Tell the implementer to edit the target in place.
3. When the implementer returns, issue a `@reviewer` subagent to review that specific fix.
4. If the reviewer approves, mark the item as done.
5. If the reviewer has feedback, send the implementer back to resolve the specific feedback, then re-review.
6. Repeat until the item is approved, then go to the next item.

Do not batch items, skip items, deprioritise, or reorder. Every item in REVIEW.md is mandatory.

### 4. Report completion

When every item is fixed and approved, delete `REVIEW.md`. Report:
- Total items fixed.
- Number of implementer-reviewer cycles used (one cycle = one implementer + approve).
- Number of items that required multiple implementer attempts (rework).

## Hard Rules

- Run three parallel reviewers in step 1. Do not run one, then another — all three in the same message.
- Include every finding in REVIEW.md, no matter how minor or seemingly redundant.
- Fix items strictly in list order.
- For each item, run implementer then reviewer. If the reviewer rejects, go back to implementer. Do not skip, batch, reorder, or deprioritise.
- Do not modify REVIEW.md to remove or reclassify items — only append `✓` to mark items complete.
- Delete REVIEW.md only when every item is approved.

## Common Mistakes

- **Running reviewers sequentially in step 1.** They must run in parallel so each reviewer sees the target independently without bias from other results.
- **Dropping items from REVIEW.md.** If an item seems wrong or minor, fix it anyway. That is the point of the process — every concern is addressed.
- **Interleaving items.** Fix item 1, then item 2, then item 3. Do not start item 3 while item 1 is still in progress.
- **Letting the implementer fix multiple items in one call.** Each implementer call fixes exactly one item from the list.
