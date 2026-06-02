---
name: appraise
type: atomic
description: Subjective evaluation of an artefact against laws via independent appraiser subagents.
---

# Appraise

**This skill is subagent-only.** It describes the protocol an appraiser subagent follows when dispatched via `task()` from the orchestrate loop. Do NOT load this skill and run appraise inline — the orchestrate skill returns a `dispatch_multi` action with pre-built prompts; call `task()` with each.

You evaluate artefacts against laws. Your dispatch prompt contains your personality and the artefact type ID. You discover artefact files, laws, and file-patterns via tool calls.

## Prerequisites

Before running this skill, verify that the `foundry/` directory exists in the project root. If it does not exist, stop and tell the user:

> Restart OpenCode to initialise Foundry, then retry this command.

## Stage lifecycle (mandatory)

Appraise runs inside an enforced stage. Your **first** and **last** tool calls are fixed:

1. **First:** `foundry_stage_begin({stage, cycle, token})` — copy the token verbatim from the dispatch prompt. No other tool call is permitted before this one.
2. **Last:** `foundry_stage_end()`.

Appraise makes **no disk writes**. Feedback output flows through `foundry_stage_output` calls. The orchestrator's internal consolidate step reads the outputs, posts feedback, and resolves prior items.

## Protocol

1. `foundry_stage_begin(...)` with the token from the dispatch prompt.
2. `foundry_config_artefact_type` with the type ID — get the artefact type definition and `file-patterns`.
3. `foundry_config_laws` with the type ID — get all applicable laws (prose only).
4. `foundry_artefacts_list` — enumerate the current cycle's branch artefact changes.
5. For each artefact file that matches the type's `file-patterns`, read the file from the worktree.
6. Evaluate each file against each law. For each law, either:
   - Note no issues (pass)
   - Describe the violation, quoting evidence from the artefact
7. For each violation, call `foundry_stage_output({ file, law, text, evidence })`.
   `file`, `law`, and `text` are required — `law` identifies the law the violation breaches and supplies its feedback tag. `evidence` is recommended and quotes the offending passage. Optional extra fields (`severity`, `location`) are passed through unchanged.

   If no issues, call `foundry_stage_end()` directly — no `stage_output` calls needed.

   Do NOT write JSONL as text. Call the tool.

8. `foundry_stage_end()`.

## Feedback handling

You do NOT call `foundry_feedback_add` or `foundry_feedback_resolve`. The orchestrator's consolidate step reads your stage outputs, de-duplicates across all appraisers, posts feedback items with tag `law:<slug>`, and resolves prior appraise-sourced feedback.

## What you do NOT do

- You do not write files — feedback output goes through `foundry_stage_output`, not `foundry_feedback_add`.
- You do not revise the artefact — that is the forge skill's job.
- You do not run deterministic validators — that is the quench skill's job.
- You do not call `foundry_feedback_add`, `foundry_feedback_action`, `foundry_feedback_wontfix`, or `foundry_feedback_resolve`.
- You do not call `foundry_history_append` or `foundry_git_commit` — `foundry_run` handles those.
- You do not register artefacts — that happens automatically.
- You do not output YAML, markdown, or prose — use `foundry_stage_output` for structured data.
