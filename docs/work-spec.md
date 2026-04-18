# WORK.md Spec

WORK.md is created at the start of a foundry flow on a work branch. It is the shared state between all stages in all foundry cycles. It is transient — it exists only for the duration of the foundry flow.

## Frontmatter

```yaml
---
flow: <flow-id>
cycle: <current-cycle-id>
stages: [forge:write-haiku, quench:check-syllables, appraise:evaluate-quality]
max-iterations: 3
---
```

Fields:
- `flow` — the foundry flow being executed
- `cycle` — the current foundry cycle id
- `stages` — the ordered route for this foundry cycle, set when the foundry cycle starts. Each entry uses `base:alias` format where `base` is the stage type (`forge`, `quench`, `appraise`, or `hitl`) and `alias` is a human-readable name for what that stage does in this cycle. Determined from the artefact type: if `validation.md` exists, include `quench`; always include `forge` and `appraise`. A `hitl` stage can be included for human-in-the-loop checkpoints.
- `max-iterations` — how many forge passes before the foundry cycle is blocked (default: 3)

The `stages` list is the happy path. Sort follows it but loops back to `forge` when unresolved feedback demands it.

### Who sets what

- `flow` — set by the foundry flow skill at foundry flow start, never changes
- `cycle` — set by the foundry flow skill when starting each foundry cycle
- `stages` — set by the foundry cycle skill when starting each foundry cycle (reads artefact type to determine if quench is needed)
- `max-iterations` — set by the foundry cycle skill (default 3, could be overridden in foundry cycle definition)

## Sections

### Goal

Free text describing what the foundry flow is producing and any context the human provided. Written once at foundry flow start, not modified after.

### Artefacts

A table tracking every artefact produced by the foundry flow.

```markdown
# Artefacts

| File | Type | Cycle | Status |
|------|------|-------|--------|
| petitions/login-change.md | petition | write-petition | draft |
| features/login-change.feature | gherkin | petition-to-gherkin | draft |
```

Statuses:
- `draft` — artefact exists but has not cleared all stages
- `done` — artefact has cleared all stages
- `blocked` — artefact hit iteration limit or a violation

### Feedback

Grouped by artefact file path. Each item is a checklist entry with a tag indicating its source.

```markdown
# Feedback

## petitions/login-change.md

- [ ] Missing "Acceptance Criteria" section #validation
- [x] Justification is circular #law:justified-change | approved
- [~] Could be more concise #law:clear-language | wont-fix: brevity would lose necessary context | approved
```

#### Tags

- `#validation` — from a deterministic quench command
- `#law:<law-id>` — from subjective appraise, tied to a specific law
- `#hitl` — from human-provided feedback at a hitl checkpoint

#### Lifecycle states

```
- [ ] issue #tag                                    open, needs forge action
- [x] issue #tag                                    actioned, needs approval
- [~] issue #tag | wont-fix: <reason>               declined by forge, needs approval (appraise only)
- [x] issue #tag | approved                         resolved
- [~] issue #tag | wont-fix: <reason> | approved    resolved
- [x] issue #tag | rejected: <reason>               re-opened
- [~] issue #tag | wont-fix: <reason> | rejected    re-opened
```

#### Rules

- Validation feedback (`#validation`) cannot be wont-fixed
- Feedback is never deleted — it stays as a record of the iteration history
- New feedback is appended, not inserted
- Items are grouped under the artefact they relate to

## Who writes what

| Section | Written by | Updated by |
|---------|-----------|------------|
| Frontmatter (`flow`) | `foundry_workfile_create` (flow skill) | nobody |
| Frontmatter (`cycle`, `stages`, `max-iterations`) | `foundry_workfile_set` (cycle skill) | `foundry_workfile_set` (reset on each new cycle) |
| Goal | `foundry_workfile_create` (flow skill) | nobody |
| Artefacts | `foundry_artefacts_add` (forge skill) | `foundry_artefacts_set_status` (cycle skill) |
| Feedback | `foundry_feedback_add` (quench/appraise/hitl) | `foundry_feedback_action`/`foundry_feedback_wontfix` (forge), `foundry_feedback_resolve` (quench/appraise/hitl) |

## WORK.history.yaml

A separate file (`WORK.history.yaml`) alongside WORK.md. Append-only log of every stage execution.

```yaml
- timestamp: "2026-04-17T14:32:01Z"
  cycle: write-petition
  stage: forge:draft-petition
  iteration: 1
  comment: Initial petition draft created

- timestamp: "2026-04-17T14:32:45Z"
  cycle: write-petition
  stage: quench:validate-petition
  iteration: 1
  comment: 2 validation issues found

- timestamp: "2026-04-17T14:33:12Z"
  cycle: write-petition
  stage: forge:draft-petition
  iteration: 2
  comment: Addressed 2 validation issues

- timestamp: "2026-04-17T14:33:30Z"
  cycle: write-petition
  stage: quench:validate-petition
  iteration: 2
  comment: Validation passed

- timestamp: "2026-04-17T14:34:00Z"
  cycle: write-petition
  stage: appraise:review-petition
  iteration: 2
  comment: No issues found, cycle complete
```

### Fields

- `timestamp` — ISO 8601 UTC
- `cycle` — which foundry cycle this entry belongs to
- `stage` — which stage just completed, in `base:alias` format (e.g. `forge:draft-petition`, `quench:validate-petition`, `appraise:review-petition`, `hitl:human-review`)
- `iteration` — the current iteration number (increments each time forge runs within a cycle)
- `comment` — brief description of what happened

### Rules

- Append-only — never edit or delete entries
- Every stage skill appends an entry when it completes
- The sort tool reads this to determine what has happened in the current foundry cycle
- Iteration is derived from counting forge entries for the current foundry cycle

### Who writes

Every stage skill (forge, quench, appraise, hitl) appends an entry when it finishes via the `foundry_history_append` tool.

## Example

A complete WORK.md mid-foundry flow:

```markdown
---
flow: make-haiku
cycle: haiku-creation
stages: [forge:write-haiku, quench:check-syllables, appraise:evaluate-quality]
max-iterations: 3
---

# Goal

Write a haiku about autumn rain. Should evoke loneliness
and the sound of rain on leaves.

# Artefacts

| File | Type | Cycle | Status |
|------|------|-------|--------|
| petitions/autumn-rain-haiku.md | petition | haiku-ideation | done |
| haiku/autumn-rain.md | haiku | haiku-creation | draft |

# Feedback

## petitions/autumn-rain-haiku.md

- [x] Acceptance criteria should mention seasonal reference #law:clear-acceptance-criteria | approved

## haiku/autumn-rain.md

- [ ] Line 2 has 8 syllables, expected 7 #validation
- [x] No seasonal reference detected #law:seasonal-reference | approved
```
