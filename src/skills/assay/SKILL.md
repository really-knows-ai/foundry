---
name: assay
type: atomic
description: Deterministic population of flow memory by running project-authored extractor scripts. Writes JSONL output into entities and edges via foundry tools.
---

# Assay

Runs the `assay` stage of a cycle. An assay stage executes every extractor listed in the cycle's `assay.extractors` frontmatter, in order. Each extractor is a project-authored CLI script at the path given in its definition file — see the `foundry/memory/extractors/<name>.md` files for what each one does.

The assay stage is **deterministic**. This skill does **not** interpret extractor output. It only calls `foundry_assay_run`, which handles spawning, parsing, validation, and memory upserts. On any failure (extractor non-zero exit, parse error, permission violation, timeout, or post-run memory sync failure), `foundry_assay_run` marks the workfile failed (`status: failed`) with a reason describing the failure, and returns `{error, flow_failed: true, ...}`. The cycle is over — extractor scripts live outside any artefact's `file-patterns`, so forge cannot fix them. The user must fix the extractor and start a new cycle. Your job is to wrap the lifecycle cleanly: end the stage and stop.

## Protocol

You have been dispatched to run an assay stage. The dispatch prompt contains a stage identifier like `assay:<cycle>` and a token.

Follow these steps exactly and in order.

### 1. Begin the stage

Call `foundry_stage_begin({ stage, cycle, token })` with the values from the dispatch prompt. If the result is not `{ok: true}`, stop and report the error — something is wrong with the token or an already-active stage.

### 2. Read WORK.md to find the extractor list

Call `foundry_workfile_get()`. Read `frontmatter.assay.extractors`. This is an ordered array of extractor names. If it is missing or empty, this is a routing bug — end the stage (step 4) with an error describing the missing extractor list.

### Check for failed flow state

If `foundry_workfile_get` returns `{status: "failed", reason: ...}`, STOP. Do not call any other tool. Tell the user:

> The flow is in a failed state. Reason: `<reason>`.
>
> No further work is permitted. To recover:
>
   >   1. `foundry_workfile_delete({confirm: true})` to abandon the cycle.
   >   2. Investigate and fix the root cause of the failure before restarting.

Then return control to the user and stop.

### 3. Run the extractors

Call `foundry_assay_run({ cycle, extractors })` passing exactly those values. Do not modify the list. Do not split it into multiple calls. The tool returns one of:

- `{ok: true, perExtractor: [{name, rowsUpserted, durationMs}, ...]}` — all extractors succeeded.
- `{error, flow_failed: true, aborted: true, failedExtractor, reason, stderr, perExtractor: [...]}` — the run aborted on an extractor failure. The workfile is already marked failed; no further work is permitted until the user abandons the cycle.
- `{error, flow_failed: true}` — post-run memory sync failed. Same recovery path: workfile is failed, user must abandon.
- `{error: "..."}` (without `flow_failed`) — a precondition failed (not an active assay stage, etc.). This should not happen if step 1 succeeded; treat as an error and end the stage (step 4).

### 4. End the stage

Call `foundry_stage_end()`. Always end the stage, whether the run succeeded or aborted. The stage lifecycle must close cleanly so the orchestrator can commit.

Do not add feedback items — assay stages cannot file feedback. Extractor failure is recorded directly on the workfile (`status: failed`).

## What this skill must not do

- **Must not** read or parse extractor output files itself.
- **Must not** call any memory write tools (`foundry_memory_put`, `foundry_memory_relate`, etc.). All writes go through `foundry_assay_run`.
- **Must not** file feedback. Assay stages cannot file feedback; extractor failure is signalled by the workfile's `status: failed` field.
- **Must not** modify any artefact files. The assay stage writes only to flow memory.

## If something unexpected happens

If `foundry_assay_run` throws an unrelated error (e.g. `error: memory not enabled`), that is a programming error in the cycle configuration — not an expected extractor failure. Do not retry. End the stage and stop.
