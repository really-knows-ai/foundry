---
name: systematic-fix-and-review
description: Fix every item in an existing REVIEW.md through strict fix → reviewer cycles. Use when you have a review checklist and need every issue addressed with no shortcuts.
---

# Systematic Fix and Review

Read an existing `plans/<project>/REVIEW.md` checklist, then fix each item through strict fix → reviewer cycles. Each item is fixed by invoking the `fix-review-item` skill (commit skipped), then reviewed by a `@reviewer` subagent. Items loop until approved before proceeding.

This skill composes the `fix-review-item` skill as its inner fix loop. Compared to running `fix-review-item` standalone, it adds a reviewer gate between the fix and the commit. The `- [x]` mark and the commit are deferred until the reviewer approves.

## Workflow

### 1. Read the review checklist

Read `plans/<project>/REVIEW.md`. Determine the project directory under `plans/`. If `REVIEW.md` does not exist or contains no incomplete items (`- [ ]`), stop and report nothing to do.

### 2. Fix each item, one at a time

For each incomplete item in `REVIEW.md` in order, run the inner fix-review cycle:

#### a. Fix the item (deferring the commit)

Invoke the `fix-review-item` skill, but skip step 4 (the commit). When invoking `fix-review-item`, override the implementer prompt:

- Replace the instruction to mark the item as `- [x]` with an instruction to leave the checkbox alone. The systematic skill owns the marking — it happens only after reviewer approval in step 2d.
- Everything else in the `fix-review-item` workflow runs as normal: find the first `- [ ]`, dispatch the `@implementer` with SPEC.md context, and return the changed files and the implementer's report.

If `fix-review-item` marks the item as `- [~]` (wont-fix), the item still requires review. The reviewer evaluates the wont-fix justification against the original review feedback, not the code.

#### b. Review the outcome

Issue a `@reviewer` subagent to review the outcome.

**For a code fix** (item was not marked wont-fix), instruct the reviewer:

- Read `AGENTS.md` before reviewing.
- Review only the files changed by the implementer.
- Approve or provide concrete, actionable feedback.

**For a wont-fix** (item marked `- [~]`), instruct the reviewer:

- Provide the original review feedback that prompted the item.
- Provide the wont-fix justification written by the implementer.
- The reviewer decides whether the justification is sound. Approve it, or reject it with reasoning.

#### c. Handle review outcome

- If the reviewer **approves**, proceed to commit (step 2d).
- If the reviewer **rejects** with feedback, dispatch the implementer directly (not via `fix-review-item`) to resolve the specific feedback, then re-review. Provide the item text and the reviewer's feedback. If the item was previously marked wont-fix, the implementer must now produce a code fix instead. Repeat until approved.

#### d. Commit and close the item

When the reviewer approves:

1. Mark the item as `- [x]` in `REVIEW.md`.
2. Stage every changed file **except** `plans/<project>/REVIEW.md`.
3. Commit with a concise message describing the fix.

```
git add [changed files, excluding REVIEW.md]
git commit -m "fix: [brief description of the fix]"
```

If the approved item is a wont-fix (`- [~]`), skip the commit — the `- [~]` mark and justification are already in place.

#### e. Move to the next item

Return to step 2a for the next incomplete item. Each invocation of `fix-review-item` automatically selects the next `- [ ]` item.

### 3. Report completion

When every item is fixed and approved, delete `REVIEW.md`. Report:

- Total items fixed.
- Number of fix-reviewer cycles used (one cycle = one implementer fix + reviewer approve).
- Number of items that required rework (reviewer rejected at least once).

## Hard Rules

- Read `REVIEW.md` at the start. If it is missing, stop and ask the user to produce one first.
- Fix items strictly in list order.
- Compose `fix-review-item` for each item, skipping the commit step and overriding the implementer prompt to defer the `- [x]` mark. Re-dispatch the implementer directly (not via the skill) on reviewer rejection to focus on the specific feedback.
- Do not skip, batch, reorder, or deprioritise items.
- Defer the `- [x]` mark and the commit until the reviewer approves.
- Wont-fix items (`- [~]`) still go through review — the reviewer evaluates the justification. If the justification is rejected, the implementer must produce a code fix instead. No commit is needed for approved wont-fix items.
- If a subagent errors (not rejects), report the failure and stop. Do not silently skip the item.
- Do not commit `REVIEW.md`.
- Delete `REVIEW.md` only when every item is approved.

## Common Mistakes

- **Committing before review.** The commit only happens after the reviewer approves.
- **Letting the implementer mark `- [x]`.** The systematic skill owns the mark. Override the `fix-review-item` implementer prompt to leave the checkbox alone.
- **Re-dispatching `fix-review-item` on reviewer rejection.** On rejection, dispatch the implementer directly with the feedback — do not re-invoke the `fix-review-item` skill from scratch.
- **Dropping items from REVIEW.md.** If an item seems wrong or minor, fix it anyway.
- **Interleaving items.** Fix item 1, then item 2, then item 3. Do not start item 3 while item 1 is still in progress.
- **Batching fixes.** Each implementer call fixes exactly one item.
- **Reviewing wont-fix code instead of the justification.** Wont-fix items go through review of the justification — the reviewer evaluates whether the reasoning holds against the original feedback. Reviewing the code is irrelevant; there is no code change.
