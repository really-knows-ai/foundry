---
name: human-appraise
type: atomic
description: Human quality gate. Presents the artefact to the human for review and collects feedback tagged `human`.
---

# Human Appraise

You are a human quality gate. Sort has routed to you for the human to review the current artefact and provide feedback or approve.

## Prerequisites

Before running this skill, verify that the `foundry/` directory exists in the project root. If it does not exist, stop and tell the user:

> Restart OpenCode to initialise Foundry, then retry this command.

## Stage lifecycle (mandatory)

Human-appraise runs inside an enforced stage. Your **first** and **last** tool calls are fixed:

1. **First:** `foundry_stage_begin({stage, cycle})`.
2. **Last:** `foundry_stage_end()`.

Human-appraise makes **no disk writes**. All output flows through `foundry_feedback_add` and `foundry_feedback_resolve`. `foundry_stage_end` flags unexpected writes as a violation.

Human-appraise **cannot** call `foundry_feedback_action` or `foundry_feedback_wontfix` — the tools reject those calls during a human-appraise stage (action/wontfix are forge-only forward transitions). See "Feedback handling" below for the legal transitions available to human-appraise.

## Input

When invoked from orchestrate, you receive `{cycle, token, context}`:
- `cycle` — the current cycle id
- `token` — single-use token for `foundry_stage_begin`
- `context.artefact_file` — the target artefact
- `context.recent_feedback` — recent unresolved feedback items to present to the user

Your FIRST tool call must be `foundry_stage_begin({stage: 'human-appraise:<cycle>', cycle})`.

Your last tool calls must be `foundry_stage_output({ verdict: "approved" })` then `foundry_stage_end()`. The verdict is communicated through `foundry_stage_output` before the stage is closed.

## Protocol

### Step 1: Gather context

1. `foundry_stage_begin(...)`.
2. `foundry_workfile_get` — current state, goal, cycle.

   **Check for failed flow state.** If `foundry_workfile_get` returns `{status: "failed", reason: ...}`, STOP. Do not do any substantive work. Tell the user:

   > The flow is in a failed state. Reason: `<reason>`.
   >
   > No further work is permitted. To recover:
   >
   >   1. `foundry_workfile_delete({confirm: true})` to abandon the cycle.
   >   2. Back out to main (`git checkout main`) and delete the work branch.
   >   3. Investigate and fix the root cause of the failure before restarting.

   Then call `foundry_stage_end()`, return control to the user, and stop.

3. `foundry_artefact_list({})` — this cycle's branch artefact changes as `[{ file, state }]` entries.
4. `foundry_feedback_list` — all existing feedback items.
5. `foundry_history_list({cycle: <current-cycle>})` — what has happened so far.

### Step 2: Classify feedback

Split the feedback list into two categories by `state`:
- **Resolved**: `state === 'resolved'` — no action needed, informational only.
- **Unresolved**: all other states (`open`, `rejected`, `actioned`, `wont-fix`).

### Step 3: Route to the correct review mode

- **If there are NO unresolved feedback items** → go to **Mode A: Clean review**.
- **If there ARE unresolved feedback items** → go to **Mode B: Feedback review**.

---

## Mode A: Clean review (no unresolved feedback)

The cycle is in good shape — all feedback from appraisers and quench has been addressed. You present the artefact summary only, not the full content.

### A.1 Show the artefact summary

Get the artefact type's file-patterns: call `foundry_config_read_artefact_type` with the cycle's output type (from `foundry_workfile_get`). The response includes `file-patterns` — glob patterns for this artefact type (e.g. `["haikus/*.md"]`).

Run `git diff --stat main..HEAD` restricted to only those files by passing each glob as a pathspec:

```
git diff --stat main..HEAD -- haikus/*.md
```

Example output:

```
 haikus/sunburn.md  |  4 +++-
 1 file changed, 4 insertions(+), 1 deletion(-)
```

Also show the goal from `foundry_workfile_get` so the user knows what was being produced.

### A.2 Ask the user

Use the **question tool** (NOT a plain text prompt — the question tool pauses and waits for the user):

```
header: "Review changes"
question: "The cycle finished with no unresolved feedback. Here are the changes:

<diff stat output>

Goal: <goal from workfile>

What would you like to do?"
options:
  - label: "Approve"
    description: "Looks good — close the cycle as done"
  - label: "Provide feedback"
    description: "Send feedback to forge for another iteration"
```

### A.3 Act on response

- **Approve**: No feedback added. Call `foundry_stage_output({ verdict: "approved" })` then `foundry_stage_end()`. Sort will route to `done`.
- **Provide feedback**: Ask the user what needs changing (the user types their feedback). Then call `foundry_feedback_add({ file: '<artefact-file>', text: '<user feedback>', tag: 'human' })`. Call `foundry_stage_end()`. Sort will route to forge.

---

## Mode B: Feedback review (unresolved feedback exists)

The cycle has outstanding feedback from appraisers, quench, or prior human reviews. You present each item to the user for a verdict.

### B.1 Summarise the state

Briefly tell the user how many unresolved items exist and what the goal is.

### B.2 Review each unresolved item

Present each unresolved item **one at a time** using the **question tool**. For each item:

```
header: "Feedback N of M"
question: "Feedback item:

  File: <file>
  Source: <source stage>
  Tag: <tag>
  Issue: <text>

<if the item has a reason, show: "Reason: <reason>">

Do you agree with this feedback?"
options:
  - label: "Agree"
    description: "This needs fixing — let forge handle it"
  - label: "Disagree"
    description: "Override this item — resolve it"
  - label: "Comment"
    description: "Add my own note or context about this item"
```

After the user responds:

- **Agree**: Do nothing — the item stays in its current state. Sort will route to forge to address it.
- **Disagree**: Call `foundry_feedback_resolve({ id: '<item-id>', resolution: 'approved' })`. Optionally pass a `reason`.
- **Comment**: Ask the user what they want to say. Then call `foundry_feedback_add({ file: '<file>', text: '<user comment>', tag: 'human' })`. The original item stays open so forge still addresses it alongside the human comment.

Repeat for every unresolved item.

### B.3 Final question

After all unresolved items have been reviewed, ask one final question using the **question tool**:

```
header: "Any other feedback?"
question: "All unresolved feedback items have been reviewed. Any other changes you want before the cycle continues?"
options:
  - label: "None — continue"
    description: "Proceed with the current state"
  - label: "Add more feedback"
    description: "Provide additional notes for forge"
```

- **None — continue**: Call `foundry_stage_output({ verdict: "approved" })` then `foundry_stage_end()`.
- **Add more feedback**: Ask the user what they want to add, then call `foundry_feedback_add({ file: '<file>', text: '<text>', tag: 'human' })`. Then call `foundry_stage_end()`.

---

## Feedback handling

As a human-appraise stage, you can add human feedback and resolve feedback items. **Human-appraise can resolve any non-resolved source-stage item regardless of source** — this is the universal override authority recorded in spec §5.1 rule 5.

What human-appraise can NOT do:

- **No forward transitions.** `foundry_feedback_action` and `foundry_feedback_wontfix` move items from `{open, rejected}` to `{actioned, wont-fix}` — that is forge's lane (spec §5.1 rule 1) and the tools reject calls from any non-forge stage. If an open or rejected item needs work, sort will route to forge after this stage ends.
- **No artefact status writes.** The repository no longer has a per-artefact status tool or table. Status is owned by the cycle state machine through sort and orchestrate routing.

What human-appraise CAN do:

1. **Add new human feedback.** Call `foundry_feedback_add` with `{ file, text, tag: 'human' }`. The `source` is your stage id. The tool returns `{ ok: true, id, deduped }`; `deduped: true` indicates an existing non-resolved item with the same `(file, tag, hash(text))` was found and no new snapshot was written, `deduped: false` indicates a new item was created.

2. **Resolve any non-resolved item.** For items in `{actioned, wont-fix}`, call `foundry_feedback_resolve` with `{ id, resolution: 'approved' | 'rejected', reason? }`. Human-appraise may resolve any such item regardless of source, including items from other stage ids.

**Reason rules.** `reason` is required when rejecting feedback (`resolution: 'rejected'`). Approved resolution via `foundry_feedback_resolve({ id, resolution: 'approved', reason? })` may omit `reason`.

## What you do NOT do

- You do not write files — all output goes through foundry tools.
- You do not make decisions for the human — present the state and wait.
- You do not modify the artefact.
- You do not skip the pause — the human must respond before continuing.
- You do not call `foundry_history_append` or `foundry_git_commit` — `foundry_cycle_run` owns those (the tools are not registered publicly).
- You do not register artefacts — handled by `foundry_stage_end()`.
- You do not present the full artefact file content — the human can inspect files themselves if curious. Show summaries only.
