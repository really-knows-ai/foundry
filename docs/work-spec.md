# WORK.md Spec

WORK.md is created at the start of a foundry flow on a work branch. It is the shared state between all stages in all foundry cycles. It is transient — it exists only for the duration of the foundry flow.

## Frontmatter

```yaml
---
flow: <flow-id>
cycle: <current-cycle-id>
stages: [forge:write-haiku, quench:check-syllables, appraise:evaluate-quality]
max-iterations: 3
human-appraise: false
deadlock-appraise: true
deadlock-iterations: 5
models:
  forge: anthropic/claude-opus-4.7
  appraise: openai/gpt-5
---
```

Fields:
- `flow` — the foundry flow being executed.
- `cycle` — the current cycle id.
- `stages` — the ordered route for this cycle. Each entry uses `base:alias` format where `base` is the stage type (`forge`, `quench`, `appraise`, or `human-appraise`) and `alias` is a human-readable name for what that stage does in this cycle. Derived from the cycle and artefact type: `forge` + `appraise` are always included, `quench` is included iff the artefact type has `validation.md`, `human-appraise` is included iff the cycle sets `human-appraise: true`.
- `max-iterations` — how many forge passes before the cycle is blocked (default: 3).
- `human-appraise` — run human-appraise every iteration (default: `false`).
- `deadlock-appraise` — route to human-appraise when LLM appraisers deadlock (default: `true`).
- `deadlock-iterations` — deadlock threshold (default: 5).
- `models` — optional per-stage model overrides; individual appraisers may further override via their own `model` field.

The `stages` list is the happy path. Sort follows it but loops back to `forge` when unresolved feedback demands it, and inserts a `human-appraise` stage on deadlock.

### Who sets what

- `flow`, `cycle`, `goal` — set by the `flow` skill via `foundry_workfile_create` at flow/cycle boundaries.
- `stages`, `max-iterations`, `human-appraise`, `deadlock-appraise`, `deadlock-iterations`, `models` — set by `foundry_orchestrate` on the first call of each cycle (via internal `workfile_configure_from_cycle`, reading the cycle definition).

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
- `#human` — from human-provided feedback at a human-appraise checkpoint

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

- Validation feedback (`#validation`) cannot be wont-fixed — deterministic rules are not negotiable.
- Human feedback (`#human`) cannot be wont-fixed — it takes absolute priority over LLM feedback.
- Feedback is never deleted — it stays as a record of the iteration history.
- New feedback is appended, not inserted.
- Items are grouped under the artefact they relate to.

## Who writes what

| Section | Written by | Updated by |
|---------|-----------|------------|
| Frontmatter (`flow`, `cycle`, `goal`) | `foundry_workfile_create` (flow skill) | `foundry_workfile_delete` + re-create between cycles |
| Frontmatter (`stages`, `max-iterations`, `human-appraise`, `deadlock-appraise`, `deadlock-iterations`, `models`) | `foundry_orchestrate` (first call of each cycle, internally) | reset on each new cycle |
| Goal | `foundry_workfile_create` (flow skill) | nobody |
| Artefacts | `foundry_stage_finalize` (orchestrator, after forge closes) | `foundry_artefacts_set_status` (orchestrator → `done`/`blocked`) |
| Feedback | `foundry_feedback_add` (quench / appraise / human-appraise) | `foundry_feedback_action` / `foundry_feedback_wontfix` (forge), `foundry_feedback_resolve` (quench / appraise / human-appraise) |

Note: `foundry_artefacts_add` no longer exists as a public tool — artefact registration is automatic via `stage_finalize`, which scans the git diff and registers files matching the output type's `file-patterns` as `draft`.

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
- `stage` — which stage just completed, in `base:alias` format (e.g. `forge:draft-petition`, `quench:validate-petition`, `appraise:review-petition`, `human-appraise:human-review`)
- `iteration` — the current iteration number (increments each time forge runs within a cycle)
- `comment` — brief description of what happened

### Rules

- Append-only — never edit or delete entries.
- Every stage produces an entry when it completes.
- Sort reads this to determine what has happened in the current cycle.
- Iteration is derived from counting forge entries for the current cycle.

### Who writes

History entries are written by `foundry_orchestrate` after each stage closes (via its internal `foundry_history_append` — the tool is not registered publicly). Sub-agents never append history directly.

## Example

A complete WORK.md mid-foundry flow:

```markdown
---
flow: make-haiku
cycle: haiku-creation
stages: [forge:write-haiku, quench:check-syllables, appraise:evaluate-quality]
max-iterations: 3
human-appraise: false
deadlock-appraise: true
deadlock-iterations: 5
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
