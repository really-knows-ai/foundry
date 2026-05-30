---
name: systematic-fix-and-review
description: Fix every item in an existing REVIEW.md through strict implementer → reviewer cycles. Use when you have a review checklist and need every issue addressed with no shortcuts.
---

# Systematic Fix and Review

Read an existing `REVIEW.md` checklist, then fix each item through strict implementer → reviewer cycles until every item is approved.

## Workflow

### 1. Read the review checklist

Read `REVIEW.md`. If it does not exist, stop and ask the user to run a review first (for example, the `implementation-review` skill).

### 2. Fix each item, one at a time

For each item in `REVIEW.md` in order:

1. Pick the next unfixed item from the list.
2. Issue an `@implementer` subagent to fix that specific item. Tell the implementer to edit the target in place.
3. When the implementer returns, issue a `@reviewer` subagent to review that specific fix.
4. If the reviewer approves, mark the item as done.
5. If the reviewer has feedback, send the implementer back to resolve the specific feedback, then re-review.
6. Repeat until the item is approved, then go to the next item.

Do not batch items, skip items, deprioritise, or reorder. Every item in REVIEW.md is mandatory.

### 3. Report completion

When every item is fixed and approved, delete `REVIEW.md`. Report:
- Total items fixed.
- Number of implementer-reviewer cycles used (one cycle = one implementer + approve).
- Number of items that required multiple implementer attempts (rework).

## Hard Rules

- Read `REVIEW.md` at the start. If it is missing, stop and ask the user to produce one first.
- Fix items strictly in list order.
- For each item, run implementer then reviewer. If the reviewer rejects, go back to implementer. Do not skip, batch, reorder, or deprioritise.
- Do not modify REVIEW.md to remove or reclassify items — only append `✓` to mark items complete.
- Delete REVIEW.md only when every item is approved.

## Common Mistakes

- **Starting without a REVIEW.md.** This skill consumes an existing checklist; it does not produce one.
- **Dropping items from REVIEW.md.** If an item seems wrong or minor, fix it anyway. That is the point of the process — every concern is addressed.
- **Interleaving items.** Fix item 1, then item 2, then item 3. Do not start item 3 while item 1 is still in progress.
- **Letting the implementer fix multiple items in one call.** Each implementer call fixes exactly one item from the list.
