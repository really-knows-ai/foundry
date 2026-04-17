---
name: cycle
type: composite
description: Runs a foundry cycle by delegating all routing to the sort skill.
composes: [sort, forge, quench, appraise, hitl]
---

# Cycle

A foundry cycle reads its definition from `foundry/cycles/<cycle-id>.md`, sets up WORK.md for routing, then hands control to the sort skill which drives the forge → quench → appraise loop.

## Cycle definition

The cycle definition (`foundry/cycles/<cycle-id>.md`) specifies:
- `output` — the artefact type this foundry cycle produces (read-write)
- `inputs` — artefact types from previous foundry cycles that are read-only context
- `stages` — (optional) explicit stage list with aliases in `base:alias` format (e.g., `[forge:write-haiku, quench:check-syllables, appraise:evaluate-quality]`)
- `hitl` — (optional) configuration for human-in-the-loop stages, including prompts
- `models` — (optional) map of stage base names to model IDs for multi-model routing (e.g., `{ appraise: openai/gpt-4o }`). Stages not listed use the session's default model. If a specified model has no matching `foundry-*` agent, the cycle fails with an error.

If `stages` is not provided, the cycle skill generates default aliases from the cycle id and artefact type.

## Starting a foundry cycle

1. Read the cycle definition from `foundry/cycles/<cycle-id>.md`
2. Read the output artefact type definition from `foundry/artefacts/<type>/definition.md`
3. Determine the stage route using `base:alias` format:
   - Build the stages list from the cycle definition's `stages` field if present
   - Otherwise, generate defaults: always `forge`, add `quench` if `foundry/artefacts/<type>/validation.md` exists, always `appraise`
   - Cycle definitions can include `hitl` entries in the stages list for human-in-the-loop checkpoints
   - Examples:
     - `[forge:write-haiku, quench:check-syllables, appraise:evaluate-quality]`
     - `[forge:write-petition, appraise:evaluate-petition]`
     - `[forge:draft-proposal, hitl:review-proposal, appraise:evaluate-proposal]`
4. Update WORK.md frontmatter:
   - Set `cycle` to the cycle id
   - Set `stages` to the determined route (e.g., `[forge:write-haiku, quench:check-syllables, appraise:evaluate-quality]`)
   - Set `max-iterations` (default 3, or from cycle definition if overridden)
   - If the cycle definition has a `models` map, set `models` in WORK.md frontmatter (e.g., `models: { appraise: openai/gpt-4o }`)
5. Invoke the sort skill

## Sort drives everything

Once sort is invoked, it runs `scripts/sort.js` to determine the next stage, invokes the corresponding skill, then runs sort again. This repeats until sort returns `done` or `blocked`.

The cycle skill does not contain routing logic — sort owns all of that.

## Completing a foundry cycle

When sort returns `done`:
- Update the artefact status in WORK.md to `done`
- Return control to the foundry flow skill

When sort returns `blocked`:
- Update the artefact status in WORK.md to `blocked`
- Return control to the foundry flow skill (the foundry flow decides how to handle it)

## HITL stages

Cycle definitions can include `hitl` entries in their stages list to pause for human input. The cycle definition's `hitl:` config section specifies prompts shown to the human at each hitl checkpoint.

When sort routes to a `hitl` stage:
- The hitl skill presents the configured prompt to the human
- The human provides feedback, which is recorded in WORK.md and WORK.history.yaml
- Sort then determines the next stage based on the feedback

HITL stages follow the same file modification rules as quench/appraise — only WORK.md and WORK.history.yaml may be modified.

## Micro commits

Every stage must end with a micro commit. Commit message format: `[<cycle-id>] <base>:<alias>: <brief description>`

Examples:
- `[haiku-creation] forge:write-haiku: initial draft`
- `[haiku-creation] quench:check-syllables: checked syllable pattern`
- `[haiku-creation] forge:write-haiku: addressed validation feedback`
- `[haiku-creation] hitl:review-draft: recorded human feedback`

## File modification enforcement

File modification enforcement is handled automatically by the sort script (`scripts/sort.js`). Before routing to the next stage, sort checks the git diff from the last commit against allowed file patterns:

- After forge: output artefact file patterns + WORK.md + WORK.history.yaml
- After quench/appraise/hitl: only WORK.md + WORK.history.yaml
- Input artefact files are never allowed (read-only)

Sort reads the cycle definition and artefact type definition to determine allowed patterns. If a violation is detected, sort returns `violation` (with details on stderr) and the cycle halts.

A violation is a hard stop. The foundry cycle sets artefact status to `blocked` and surfaces the issue to the human.

## Feedback states

```
open         - [ ] issue #tag                              → needs generator action
actioned     - [x] issue #tag                              → needs approval
wont-fix     - [~] issue #tag | wont-fix: <reason>         → needs approval (appraisal only)
approved     - [x] issue #tag | approved                   → resolved
approved     - [~] issue #tag | wont-fix: <reason> | approved → resolved
rejected     - [x] issue #tag | rejected: <reason>         → re-opened
rejected     - [~] issue #tag | wont-fix: <reason> | rejected → re-opened
```

Tag types: `#validation` (from quench), `#law:<law-id>` (from appraise), `#hitl` (from human) — indicates the source and category of feedback.

## What you do NOT do

- You do not make routing decisions — sort does that
- You do not change the laws mid-cycle
- You do not decide the artefact is "close enough" — it passes or it doesn't
- You do not proceed past a file modification violation
- You do not modify input artefacts — they are read-only
