---
name: human-appraise
type: atomic
description: Human quality gate. Presents the artefact to the human for review and collects feedback tagged #human.
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

Human-appraise makes **no disk writes**. All output flows through `foundry_feedback_add` / `foundry_feedback_resolve` / `foundry_artefacts_set_status`. `foundry_stage_end` flags unexpected writes as a violation.

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

     **Check for failed flow state.** If `foundry_workfile_get` returns `{status: "failed", reason: ...}`, STOP. Do not call any other tool. Tell the user:

     > The flow is in a failed state. Reason: `<reason>`.
     >
     > No further work is permitted. To recover:
     >
     >   1. `foundry_workfile_delete({confirm: true})` to abandon the cycle.
     >   2. Back out to main (`git checkout main`) and delete the work branch.
     >   3. Investigate and fix the root cause of the failure before restarting.

     Then return control to the user and stop.
   - `foundry_artefacts_list({cycle: <current-cycle>})` — this cycle's artefact files and status (always pass the `cycle` filter; omitting it returns stale rows from prior sessions)
   - `foundry_feedback_list` — all existing feedback
   - `foundry_history_list` — what has happened so far

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
   - **Transition feedback** — use the id-based feedback tools described below. Human-appraise may transition any non-resolved item to any legal target state regardless of source.
   - **Abort** — `foundry_artefacts_set_status({ file, status: 'blocked' })`, cycle ends.

7. `foundry_stage_end({summary})` — describe what the human decided so sort can log it.

## Feedback handling

As a human-appraise stage, you can add human feedback, transition feedback,
and resolve deadlocks as a special case of feedback transition. **Human-appraise
can override any non-resolved item regardless of source** — this is the
universal override authority recorded in spec §5.1 rule 5. It is not
limited to deadlocked items, though in practice most overrides today are
on deadlocked items because default sort routing only surfaces deadlocked
items to human-appraise (see §17 future-work note below).

1. **Adding new human feedback.** Call `foundry_feedback_add` with
   `{ file, text, tag: 'human' }`. The `source` is your stage id. The tool
   returns `{ ok: true, id, deduped }`; `deduped: true` indicates an
   existing non-resolved item with the same `(file, tag, hash(text))` was
   found and no new snapshot was written, `deduped: false` indicates a new
   item was created.

2. **Transitioning any non-resolved item.** Unlike appraise and quench, you
   are NOT restricted to items whose `source` matches your stage id.
   You may transition any non-resolved item to any legal target state:
   - From `{open, rejected}`: call `foundry_feedback_action({ id })` or
     `foundry_feedback_wontfix({ id, reason: '...' })` as appropriate
     (forwards toward `{actioned, wont-fix}`).
   - From `{actioned, wont-fix}`: call `foundry_feedback_resolve` with
     `{ id, resolution: 'approved' | 'rejected', reason? }`.
   - From `deadlocked`: call `foundry_feedback_resolve` with
     `{ id, resolution: 'approved' | 'rejected', reason: '...' }`.
     `reason` is always required on deadlock override — it documents why
     the deadlock is being broken.

3. **Deadlock resolution specifically.** When items reach
   `state: deadlocked` (written by sort when an item's history depth hits
   `deadlock-iterations`), human-appraise is the ONLY stage authorised to
   resolve them. After human-appraise resolves every deadlocked item, the
   cycle resumes normal forge/appraise routing. If deadlocks remain after
   human-appraise, the cycle blocks (per spec §5.2).

**Reason rules.** `reason` is required when rejecting feedback, when
transitioning feedback to `wont-fix`, and when overriding a deadlocked
item. `reason` is forbidden on `open` and optional on `actioned` (the code
change is the reason). Non-deadlocked approved resolution via
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
- You do not call `foundry_history_append` or `foundry_git_commit` — sort owns those.
- You do not register artefacts — handled by `foundry_stage_end({summary})`.
