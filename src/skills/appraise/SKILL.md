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
2. **Last:** `foundry_stage_end({summary})`.

Appraise makes **no disk writes**. Feedback output flows through JSONL returned in your response text. The orchestrator's internal consolidate step parses the JSONL, posts feedback, and resolves prior items.

## Protocol

1. `foundry_stage_begin(...)` with the token from the dispatch prompt.
2. `foundry_config_artefact_type` with the type ID — get the artefact type definition and `file-patterns`.
3. `foundry_config_laws` with the type ID — get all applicable laws (prose only).
4. `foundry_artefacts_list` — enumerate the current cycle's branch artefact changes.
5. For each artefact file that matches the type's `file-patterns`, read the file from the worktree.
6. Evaluate each file against each law. For each law, either:
   - Note no issues (pass)
   - Describe the violation, quoting evidence from the artefact
7. Output JSONL. Each line is one JSON object:

   ```json
   {"file": "<path>", "law": "<law-slug>", "text": "<issue description>", "evidence": "<quote from artefact>"}
   ```

   `file` and `text` are required. `law` and `evidence` are recommended — `law` tells the orchestrator which law tag to use, `evidence` quotes the offending passage. Optional extra fields (`severity`, `location`) are passed through unchanged.

   If there are no issues, output nothing (empty response).

   Your response text is ONLY JSONL — one JSON object per line. No markdown headings, no code blocks, no commentary, no YAML.

8. `foundry_stage_end({summary})`. The summary describes how many issues were found (e.g. "3 issues found" or "No issues found").

## Output examples

Good (issues found):

```
{"file": "haikus/mountain.md", "law": "syllable-count", "text": "Line 2 has 8 syllables, expected 7", "evidence": "A frog jumps into the pond", "location": "2:1"}
{"file": "haikus/mountain.md", "law": "nature-imagery", "text": "Contains industrial imagery violating nature-only requirement", "evidence": "The rusty old machine"}
```

Good (no issues found — empty response, then stage_end):

(no output text)

## Feedback handling

You do NOT call `foundry_feedback_add` or `foundry_feedback_resolve`. The orchestrator's consolidate step reads your JSONL output, de-duplicates across all appraisers, posts feedback items with tag `law:<slug>`, and resolves prior appraise-sourced feedback.

## What you do NOT do

- You do not write files — feedback output goes through JSONL, not `foundry_feedback_add`.
- You do not revise the artefact — that is the forge skill's job.
- You do not run deterministic validators — that is the quench skill's job.
- You do not call `foundry_feedback_add`, `foundry_feedback_action`, `foundry_feedback_wontfix`, or `foundry_feedback_resolve`.
- You do not call `foundry_history_append` or `foundry_git_commit` — `foundry_orchestrate` handles those.
- You do not register artefacts — that happens automatically.
- You do not output YAML, markdown, or prose — only JSONL.
