---
name: appraise
type: atomic
description: Subjective evaluation of an artefact against laws via independent appraiser subagents.
---

# Appraise

**This skill is subagent-only.** It describes the protocol an appraiser subagent follows when dispatched via `task()` from the orchestrate loop. Do NOT load this skill and run appraise inline — the orchestrate skill builds per-unit prompts for each scoped evaluation; call `task()` with each.

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
3. `foundry_artefacts_list` — enumerate the current cycle's branch artefact changes.
4. For each artefact file that matches the type's `file-patterns`, read the file from the worktree.
5. Your dispatch prompt embeds the law or laws you must evaluate (the *scoped unit*). If the prompt contains multiple laws (bundle mode), evaluate every artefact against every law in the unit. If it contains a single law (law-by-law mode), evaluate against that specific law only.
6. For each violation of a scoped law, call `foundry_stage_output` with a violation record:

   ```json
   {
     "file": "<path>",
     "law": "<law-id>",
     "text": "<description of the violation>",
     "group": "<group-name>",
     "appraiser": "<appraiser-id>",
     "pass": <pass-index>
   }
   ```

   `file`, `law`, `text`, `group`, `appraiser`, and `pass` are required. `evidence` is recommended and quotes the offending passage. Optional extra fields (`severity`, `location`) are passed through unchanged.

   The `group`, `appraiser`, and `pass` values are provided by your
   dispatch prompt — the executor supplies them from the scoped unit's
   identity context. Use the exact values from your prompt; do not
   guess or derive them.

   When the artefact complies with every scoped law, produce **no output** — call no tool. The executor records completion; you emit no verdict.

   Do NOT write JSONL as text. Call the tool.

7. `foundry_stage_end()`.

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
