---
name: assay
type: atomic
description: Deterministic population of flow memory by running project-authored extractor scripts. Writes JSONL output into entities and edges via foundry tools.
---

# Assay

Runs the `assay` stage of a cycle. An assay stage executes every extractor listed in the cycle's `assay.extractors` frontmatter, in order. Each extractor is a project-authored CLI script at the path given in its definition file — see the `foundry/memory/extractors/<name>.md` files for what each one does.

The assay stage is **deterministic**. This skill does **not** interpret extractor output. It only calls `foundry_assay_run`, which handles spawning, parsing, validation, and memory upserts. On any failure, `foundry_assay_run` writes a `#validation` feedback row against `WORK.md` and returns an aborted result. Your job is to wrap the lifecycle cleanly.

## Protocol

You have been dispatched to run an assay stage. The dispatch prompt contains a stage identifier like `assay:<cycle>` and a token.

Follow these steps exactly and in order.

### 1. Begin the stage

Call `foundry_stage_begin({ stage, cycle, token })` with the values from the dispatch prompt. If the result is not `{ok: true}`, stop and report the error — something is wrong with the token or an already-active stage.

### 2. Read WORK.md to find the extractor list

Call `foundry_workfile_get()`. Read `frontmatter.assay.extractors`. This is an ordered array of extractor names. If it is missing or empty, this is a routing bug — return to step 5 with an error summary.

### 3. Run the extractors

Call `foundry_assay_run({ cycle, extractors })` passing exactly those values. Do not modify the list. Do not split it into multiple calls. The tool returns one of:

- `{ok: true, perExtractor: [{name, rowsUpserted, durationMs}, ...]}` — all extractors succeeded.
- `{ok: false, aborted: true, failedExtractor, reason, stderr, perExtractor: [...]}` — the run aborted. The failure has already been recorded as `#validation` feedback against `WORK.md`.
- `{error: "..."}` — a precondition failed (not an active assay stage, memory not enabled, etc.). This should not happen if step 1 succeeded; treat as an error and proceed to step 5 with the error text.

### 4. Prepare the summary

Build a short summary string for `foundry_stage_end`. Examples:

- On success: `"ran 2 extractors, upserted 47 rows in 1420ms"`.
- On abort: `"aborted on extractor 'java-symbols': extractor exited with exit code 2"`.

Do not add extra feedback items, do not call `foundry_feedback_add`. The tool has already done that on failure.

### 5. End the stage

Call `foundry_stage_end({ summary })` with the summary from step 4. Always end the stage, whether the run succeeded or aborted. The stage lifecycle must close cleanly so the orchestrator can commit.

## What this skill must not do

- **Must not** read or parse extractor output files itself.
- **Must not** call any memory write tools (`foundry_memory_put`, `foundry_memory_relate`, etc.). All writes go through `foundry_assay_run`.
- **Must not** invoke `foundry_feedback_add` — `foundry_assay_run` handles failure feedback on its own.
- **Must not** modify any artefact files. The assay stage writes only to flow memory.

## If something unexpected happens

If `foundry_assay_run` throws an unrelated error (e.g. `error: memory not enabled`), that is a programming error in the cycle configuration — not an expected extractor failure. Do not retry. End the stage with a summary quoting the error, and let the human see the failure through the usual `#validation` channel.
