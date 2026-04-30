---
name: human-appraise
type: atomic
description: Human quality gate. Presents the artefact to the human for review and collects feedback tagged `human`.
---

# Human Appraise

You are a human quality gate. Sort has routed to you either because the LLM appraisers have finished (normal flow) or because a deadlock was detected between forge and appraisers.

## Prerequisites

Before running this skill, verify that the `foundry/` directory exists in the project root. If it does not exist, stop and tell the user:

> Foundry is not initialized in this project. Run the `init-foundry` skill first to create the foundry/ directory structure.

## Stage lifecycle (mandatory)

Human-appraise runs inside an enforced stage. Your **first** and **last** tool calls are fixed:

1. **First:** `foundry_stage_begin({stage, cycle, token})` — copy the token verbatim from the dispatch prompt.
2. **Last:** `foundry_stage_end({summary})`.

Human-appraise makes **no disk writes**. All output flows through `foundry_feedback_add` and `foundry_feedback_resolve`. `foundry_stage_end` flags unexpected writes as a violation.

Human-appraise **cannot** call `foundry_feedback_action`, `foundry_feedback_wontfix`, or `foundry_artefacts_set_status` — the tools reject those calls during a human-appraise stage (action/wontfix are forge-only forward transitions; set-status requires no active stage). See "Feedback handling" below for the legal transitions available to human-appraise.

## Input

When invoked from orchestrate, you receive `{cycle, token, context}`:
- `cycle` — the current cycle id
- `token` — single-use token for `foundry_stage_begin`
- `context.artefact_file` — the target artefact
- `context.recent_feedback` — recent deadlocked feedback items to present to the user

Your FIRST tool call must be `foundry_stage_begin({stage: 'human-appraise:<cycle>', cycle, token})`.

Your LAST tool call must be `foundry_stage_end({summary: '<one-sentence description of the user verdict>'})` — orchestrate reads this summary for the commit message.

## Protocol

1. `foundry_stage_begin(...)`.
2. Gather context by calling:
   - `foundry_workfile_get` — current state, goal, cycle

     **Check for failed flow state.** If `foundry_workfile_get` returns `{status: "failed", reason: ...}`, STOP. Do not do any substantive work. Tell the user:

     > The flow is in a failed state. Reason: `<reason>`.
     >
     > No further work is permitted. To recover:
     >
     >   1. `foundry_workfile_delete({confirm: true})` to abandon the cycle.
     >   2. Back out to main (`git checkout main`) and delete the work branch.
     >   3. Investigate and fix the root cause of the failure before restarting.

     Then call `foundry_stage_end({summary: 'Flow is failed; no human appraisal performed'})`, return control to the user, and stop.
   - `foundry_artefacts_list({cycle: <current-cycle>})` — this cycle's artefact files and status (always pass the `cycle` filter; omitting it returns stale rows from prior sessions)
   - `foundry_feedback_list` — all existing feedback
   - `foundry_history_list({cycle: <current-cycle>})` — what has happened so far

3. Read the artefact file(s) for this cycle.

4. Present to the human:
   - The current artefact content (full file content or multi-file diff)
   - A summary of this iteration's feedback (resolved and open)
   - If this is a deadlock escalation, clearly explain the deadlock:
     - Which feedback item(s) are stuck
     - The appraiser's reasoning
     - Forge's wont-fix or revision justification
     - Ask the human to resolve the disagreement

5. Wait for the human's response.

6. Act on the response (tag MUST be `human` on any added feedback — the tool rejects other tags during human-appraise):
   - **Approve** — "looks good" / "continue" — no feedback added, sort will advance.
   - **Provide feedback** — `foundry_feedback_add({ file, text, tag: 'human' })`. Sort will route back to forge.
   - **Resolve feedback** — `foundry_feedback_resolve({ id, resolution, reason? })` for items in `{actioned, wont-fix, deadlocked}`. See "Feedback handling" below for the legal transitions and authority rules.
   - **Abort** — human-appraise cannot directly mark the artefact `blocked` (the `foundry_artefacts_set_status` tool refuses calls during an active stage). To abort: end the stage with a summary explaining the abort, then either (a) instruct the user to call `foundry_workfile_delete({ confirm: true })` to discard the cycle, or (b) reject outstanding feedback so routing exhausts iterations and sort marks the artefact blocked on its own.

7. `foundry_stage_end({summary})` — describe what the human decided so sort can log it.

## Feedback handling

As a human-appraise stage, you can add human feedback and resolve feedback
items (including deadlock overrides). **Human-appraise can resolve any
non-resolved source-stage item regardless of source** — this is the
universal override authority recorded in spec §5.1 rule 5. It is not
limited to deadlocked items, though in practice most overrides today are
on deadlocked items because default sort routing only surfaces deadlocked
items to human-appraise (see §17 future-work note below).

What human-appraise can NOT do:

- **No forward transitions.** `foundry_feedback_action` and
  `foundry_feedback_wontfix` move items from `{open, rejected}` to
  `{actioned, wont-fix}` — that is forge's lane (spec §5.1 rule 1) and
  the tools reject calls from any non-forge stage. If an open or rejected
  item needs work, sort will route to forge after this stage ends.
- **No artefact status writes.** `foundry_artefacts_set_status` requires
  no active stage; it refuses calls while human-appraise is open. Status
  promotion to `done`/`blocked` is owned by sort/orchestrate based on
  routing.

What human-appraise CAN do:

1. **Add new human feedback.** Call `foundry_feedback_add` with
   `{ file, text, tag: 'human' }`. The `source` is your stage id. The tool
   returns `{ ok: true, id, deduped }`; `deduped: true` indicates an
   existing non-resolved item with the same `(file, tag, hash(text))` was
   found and no new snapshot was written, `deduped: false` indicates a new
   item was created.

2. **Resolve any non-resolved source-stage item.** For items in
   `{actioned, wont-fix}` (sourced from quench, appraise, or
   human-appraise), call `foundry_feedback_resolve` with
   `{ id, resolution: 'approved' | 'rejected', reason? }`. Unlike
   appraise and quench, you are NOT restricted to items whose `source`
   matches your stage id — you may resolve any such item regardless of
   source.

3. **Resolve deadlocked items.** When items reach `state: deadlocked`
   (written by sort when an item's history depth hits
   `deadlock-iterations`), human-appraise is the ONLY stage authorised
   to resolve them. Call `foundry_feedback_resolve` with
   `{ id, resolution: 'approved' | 'rejected', reason: '...' }`.
   `reason` is always required on deadlock override — it documents why
   the deadlock is being broken. After human-appraise resolves every
   deadlocked item, the cycle resumes normal forge/appraise routing. If
   deadlocks remain after human-appraise, the cycle blocks (per spec §5.2).

**Reason rules.** `reason` is required when rejecting feedback
(`resolution: 'rejected'`) and when overriding a deadlocked item.
Non-deadlocked approved resolution via
`foundry_feedback_resolve({ id, resolution: 'approved', reason? })` may
omit `reason`; deadlock override always requires `reason` to document why
the deadlock is being broken.

**Future work.** Spec §17 notes that a cycle-level mode flag letting
human-appraise see all unresolved feedback (not just deadlocked items)
before sort routes is planned for a future release. In v2.6.0 the
authority is universal but reachability is limited — you typically only
see deadlocked items on the route from sort. If you do see non-deadlocked
items (e.g. you were invoked directly by the user), the same authority
applies.

## What you do NOT do

- You do not write files — all output goes through foundry tools.
- You do not make decisions for the human — present the state and wait.
- You do not modify the artefact.
- You do not skip the pause — the human must respond before continuing.
- You do not filter or summarise away important details — show the full picture.
- You do not call `foundry_history_append` or `foundry_git_commit` — `foundry_orchestrate` owns those (the tools are not registered publicly).
- You do not register artefacts — handled by `foundry_stage_end({summary})`.
