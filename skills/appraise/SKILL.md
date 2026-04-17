---
name: appraise
type: atomic
description: Subjective evaluation of an artefact against laws via multiple independent appraisers.
---

# Appraise

You orchestrate subjective appraisal of an artefact by dispatching independent sub-agent appraisers, then consolidating their feedback into WORK.md.

## Prerequisites

Before running this skill, verify that the `foundry/` directory exists in the project root. If it does not exist, stop and tell the user:

> Foundry is not initialized in this project. Run the `init-foundry` skill first to create the foundry/ directory structure.

## Appraiser configuration

Appraiser personalities are defined in `foundry/appraisers/` (the appraiser directory). Each markdown file defines:
- `id` — identifier
- `model` — (optional) specific model ID to use for this appraiser, overriding the cycle-level appraise model

The artefact type definition (`foundry/artefacts/<type>/definition.md`) controls how appraisers are assigned via its `appraisers` frontmatter:

```yaml
appraisers:
  count: 3                              # how many appraisers (default: 3)
  allowed: [pedantic, pragmatic]        # which personalities (default: all available)
```

### Appraiser selection

1. Read the `appraisers` config from the artefact type definition
2. If `allowed` is specified, filter to only those personalities. Otherwise use all in `foundry/appraisers/`.
3. If `count` is omitted, default to 3
4. Distribute evenly across available personalities for maximum diversity:
   - 3 appraisers, 3 personalities → 1 of each
   - 6 appraisers, 3 personalities → 2 of each
   - 4 appraisers, 3 personalities → 2, 1, 1 (round-robin)
5. If count > available personalities, wrap around (same personality, still independent sub-agents)

Model diversity is configured at two levels: the cycle definition sets a default model for the appraise stage (which should differ from the forge model), and individual appraisers can optionally override with their own model. If no models are configured, the session's default model is used — personality diversity still adds value but model diversity is lost.

## Protocol

1. Read `WORK.md` — identify the artefact to appraise and its type
2. Read all files in `foundry/laws/` — identify global laws
3. Read `foundry/artefacts/<type>/laws.md` — identify type-specific laws (if it exists)
4. Read `foundry/artefacts/<type>/definition.md` — for context and appraiser config
5. Select appraisers (see Appraiser selection above)
6. Dispatch each appraiser as a sub-agent (see Dispatch below)
7. Collect results from all appraisers
8. Consolidate:
   - Union of all issues — if any one appraiser flags it, it's feedback
   - De-duplicate: merge overlapping observations into a single feedback item
   - Preserve which appraiser(s) raised each issue (for traceability)
9. Write consolidated feedback to WORK.md under the artefact's file heading:

   Feedback MUST be scoped to the artefact file. Under `## Feedback`, create a `### <file-path>` sub-heading matching the artefact's File column from the artefacts table, then write feedback items beneath it:

   ```markdown
   ## Feedback

   ### foundry/output/haiku/pissed-off-spaghetti.md
   - [ ] The imagery lacks originality #law:vivid-imagery
   ```

   If the `## Feedback` section or the file sub-heading already exists (e.g., quench already wrote validation feedback there), append items under the existing heading. Never write feedback items without a file sub-heading — the sort script cannot parse them.
10. If no appraiser found any issues, the artefact clears appraisal

## Dispatch

Each appraiser is dispatched as an independent sub-agent. The sub-agent receives a prompt containing:
- The appraiser's personality (from their definition file)
- The artefact content
- All applicable laws (global + type-specific)
- Instructions to evaluate the artefact against each law and return issues as a structured list

### Model resolution

For each appraiser being dispatched, resolve the model in this order:
1. **Appraiser `model` field** — if the appraiser definition specifies a `model`, use it
2. **Cycle `models.appraise`** — if the cycle definition specifies a model for the appraise stage, use it (read from WORK.md frontmatter or the cycle definition)
3. **Default** — use `subagent_type: "general"` (inherits the session's model)

If a model is resolved (options 1 or 2), convert it to an agent name: `foundry-<provider-id>-<model-key>` (e.g., `openai/gpt-4o` → `foundry-openai-gpt-4o`). If no agent with that name exists, **hard fail** with an error:

> Appraiser `<appraiser-id>` specifies model `<model-id>` but no matching agent `foundry-<agent-name>` is registered. Check your OpenCode provider config.

### OpenCode dispatch

Use the Task tool to dispatch each appraiser:

```
Task tool call for each appraiser:
- subagent_type: "<resolved agent name>" or "general" if no model specified
- prompt: contains personality, artefact, laws, evaluation instructions
```

Dispatch all appraisers in parallel (multiple Task calls in a single response).

### Sub-agent prompt template

```
You are an appraiser. Your personality:

<contents of foundry/appraisers/<id>.md>

Evaluate the following artefact against each law below. For each law, either:
- Note no issues (pass)
- Describe the issue, quoting evidence from the artefact

## Artefact

<artefact content>

## Laws

<all applicable laws>

## Output

Return a list of issues. For each issue:
- law: <law-id>
- issue: <description>
- evidence: <quote from artefact>

If there are no issues, return an empty list.
```

## Reviewing actioned and wont-fix feedback

On subsequent passes, appraisers also evaluate previously actioned and wont-fix items under the artefact's `### <file-path>` heading:

- `[x]` actioned items: appraiser checks whether the change actually addresses the issue
  - If yes: mark `| approved`
  - If no: mark `| rejected: <reason>` (item is effectively re-opened)
- `[~]` wont-fix items: appraiser reads the justification
  - If the justification is sound: mark `| approved`
  - If not: mark `| rejected` (item is effectively re-opened)

## History

After completing the appraisal consolidation, append an entry to `WORK.history.yaml`:

```yaml
- timestamp: "<ISO 8601 UTC>"
  cycle: <current-cycle-id>
  stage: <alias>
  iteration: <current iteration from history>
  comment: <brief summary, e.g., "3 issues found across 2 appraisers" or "No issues found, cycle complete">
```

## What you do NOT do

- You do not revise the artefact
- You do not check deterministic rules — that is the quench skill's job
- You do not filter out feedback because only one appraiser raised it — one is enough
- You do not write feedback items without a file sub-heading under `## Feedback`
