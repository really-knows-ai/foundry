# Orchestrate: replacing LLM-driven sort with a deterministic tool

**Status:** Design approved, pending implementation plan
**Target version:** v2.3.0 (hard break, no backward compatibility)
**Date:** 2026-04-20

## Problem

Every deferred bug in `HARDEN.md` through v2.2.1 (B, C, D, E, G) plus a newly-observed bug in session `ses_256c` has the same root shape: the orchestrator LLM misfollowed a rigid, deterministic protocol.

The `ses_256c` transcript is the clearest evidence. The MiniMax M2.5 orchestrator:
1. Called `foundry_sort` → got route + token
2. Dispatched forge subagent — haiku written successfully
3. Called `foundry_stage_finalize` — artefact registered
4. Called `foundry_git_commit` — disk changes recorded
5. Then tried `foundry_history_append` for the forge stage → rejected with *"stage forge:create-haiku does not match last sort route none"*

The skill's step 2 (pre-dispatch `history_append` recording what sort decided) was skipped. The enforcement in step 5 failed. Subsequent `foundry_sort` calls kept returning `forge:create-haiku` because history was empty. Cycle wedged, no recovery path.

This is a probabilistic system running deterministic code. The LLM adds failure modes to a sequence that has no decisions in it.

## Goal

Move the deterministic orchestration loop out of the LLM and into a single plugin tool. Keep LLM involvement only where it's structurally required: subagent dispatch (platform constraint) and human interaction.

## Non-goals

- Eliminate the LLM orchestrator entirely (impossible — `task` / subagent dispatch is a client-side tool)
- Preserve backward compatibility (v2.3.0 is not yet released to anyone)
- Migrate in-flight cycle state across the version boundary

## Architecture

### Before (v2.2.1)

```
flow skill          → workfile_create, git_branch
  cycle skill       → config_cycle, configure_from_cycle
    sort skill      → sort → history_append → task(dispatch) → stage_finalize → history_append → git_commit → loop
                       ↑ 7-step protocol the LLM must follow precisely
```

### After (v2.3.0)

```
flow skill          → workfile_create, git_branch  (unchanged)
  orchestrate skill → loop { r = foundry_orchestrate(lastResult); act(r) }
                       ↑ 3-line LLM loop; tool owns the protocol
    dispatch action → LLM calls task(subagent, prompt), reports back
    human action    → LLM invokes human-appraise skill, reports back
    terminal        → done | blocked | violation
```

The `cycle` and `sort` skills are deleted. Replaced by one thin `orchestrate` skill (~30 lines). All step-ordering invariants live inside `foundry_orchestrate`.

### Plugin split

**Registered tools** (exposed to LLM via `tool` map in plugin):
- Flow-level: `foundry_config_flow`, `foundry_git_branch`, `foundry_git_finish`, `foundry_workfile_create`, `foundry_workfile_get`, `foundry_workfile_delete`
- Cycle-level: `foundry_orchestrate`, `foundry_artefacts_set_status`
- Subagent-level: `foundry_stage_begin`, `foundry_stage_end`, `foundry_feedback_add`, `foundry_feedback_action`, `foundry_feedback_wontfix`, `foundry_feedback_resolve`, `foundry_feedback_list`, `foundry_validate_run`, `foundry_artefacts_list`, `foundry_config_laws`, `foundry_config_appraisers`, `foundry_config_artefact_type`, `foundry_config_validation`, `foundry_config_cycle`
- Debug: `foundry_history_list`

**Internal functions** (plain JS imports, never registered):
- `runSort` (was `foundry_sort`)
- `historyAppend` (was `foundry_history_append`)
- `gitCommit` (was `foundry_git_commit`)
- `stageFinalize` (was `foundry_stage_finalize`)
- `workfileConfigureFromCycle` (was `foundry_workfile_configure_from_cycle`)
- `workfileSet` (was `foundry_workfile_set`)

**Removed outright:**
- `foundry_artefacts_add` — no remaining callers; `stage_finalize` registers forge outputs
- `cycle` skill, `sort` skill

## `foundry_orchestrate` contract

### Input

```ts
foundry_orchestrate({
  lastResult?: {
    kind: 'dispatch' | 'human_appraise',
    ok: boolean,         // false if task tool errored or subagent crashed at platform level
    error?: string
  },
  cycleDef?: string      // test-mode: JSON cycle definition override (mirrors foundry_sort)
})
```

No `cycleId` — read from `WORK.md` frontmatter. Flow skill must have called `workfile_create` first.

No `summary` field. Subagents already call `foundry_stage_end({summary})` as their last tool call; orchestrate reads the summary from plugin state keyed by the active token.

### Output action enum

```ts
// Dispatch a forge/quench/appraise subagent
{ action: 'dispatch',
  stage: string,              // e.g. 'forge:create-haiku'
  subagent_type: string,      // e.g. 'foundry-github-copilot-claude-sonnet-4-6' or 'general'
  prompt: string              // fully rendered dispatch prompt (token embedded)
}

// Run human-appraise skill inline
{ action: 'human_appraise',
  stage: string,              // e.g. 'human-appraise:create-haiku'
  token: string,
  context: {
    cycle: string,
    artefact_file: string,
    recent_feedback: object[] // what the appraisers deadlocked on
  }
}

// Cycle finished successfully
{ action: 'done',
  cycle: string,
  artefact_file: string,      // LLM calls artefacts_set_status(file, 'done')
  next_cycles: string[]       // from cycle def's `targets` — flow skill uses these
}

// Iteration limit hit with unresolved feedback
{ action: 'blocked',
  cycle: string,
  artefact_file: string,      // already marked blocked by orchestrate
  reason: string
}

// Unrecoverable: file-pattern violation, missing subagent, orphaned stage, etc.
{ action: 'violation',
  details: string,
  recoverable: false,
  affected_files: string[]    // already marked blocked
}
```

### Internal flow

**First call** (no history entries yet):
1. Read `WORK.md` → get `cycle` from frontmatter
2. If `stages` field missing → run setup:
   - Call `config_cycle`
   - Probe `config_validation` for the output artefact type
   - Synthesize stage list (always `forge`; `quench` if validation exists; always `appraise`; append `human-appraise` if `human-appraise: true` in cycle def)
   - Call `workfileConfigureFromCycle`
3. Commit setup changes: `[<cycle>] setup: configure stages`
4. Call `runSort` → get route + token
5. If route is `forge|quench|appraise`: render dispatch prompt, return `{action: 'dispatch', ...}`
6. If `human-appraise`: return `{action: 'human_appraise', ...}`
7. If `done|blocked|violation`: handle as below

**Subsequent call** (`lastResult` present):
1. Read `WORK.md` → find active token in plugin state
2. If `lastResult.ok === false`: treat as violation, mark artefact blocked, return `violation`
3. Call `stageFinalize`:
   - `{ok: true}` → proceed
   - `{error: 'unexpected_files', files}` → mark artefact blocked, return violation
   - Other error → return violation
4. Read stage_end summary from plugin state
5. Write sort-history entry AND stage-history entry (atomically — this is the fix for today's bug)
6. `gitCommit` with `[<cycle>] <stage>: <summary>`
7. Call `runSort` again → next route
8. Return next action

All step-ordering invariants live in this function. No LLM protocol to violate.

### Dispatch prompt rendering

Orchestrate pre-renders the prompt the LLM passes to `task`:

```
You are a Foundry stage agent. Invoke the <stage-base> skill and follow its instructions exactly.

Stage: <stage-alias>
Cycle: <cycle-id>
Token: <token-verbatim>
Working directory: <cwd>
File patterns (forge only): <file-patterns-list>

Your FIRST tool call MUST be foundry_stage_begin({stage, cycle, token}) using the values above.
Your LAST tool call MUST be foundry_stage_end({summary}).

When done, report back a brief summary. Do NOT call foundry_history_append, foundry_git_commit, or foundry_artefacts_add — the orchestrator handles all of those.
```

LLM copies this verbatim into the `task` call's `prompt` parameter. No templating logic on the LLM side.

## Skill changes

### `flow` skill (minor changes)

- Step 6 and between-cycles step 5: "invoke the cycle skill" → "invoke the **orchestrate** skill"
- `foundry_workfile_create` still called with only `{flow, cycle, goal}` — orchestrate handles setup on first call
- All other logic (resume pre-check, input contract validation, between-cycles prompting, completing-a-flow) unchanged

### `cycle` skill — deleted

### `sort` skill — deleted (scripts/sort.js retained; only the SKILL.md file goes away)

### `orchestrate` skill — new (~30 lines)

```markdown
# Skill: orchestrate

1. Loop until terminal:
   a. Call foundry_orchestrate({lastResult})  // omit lastResult on first iteration
   b. If action='dispatch': call task({subagent_type, description: 'Run <stage> for <cycle>', prompt})
      → set lastResult = {kind: 'dispatch', ok: <task-succeeded>}
   c. If action='human_appraise': invoke human-appraise skill with {cycle, token, context}
      → set lastResult = {kind: 'human_appraise', ok: true}
   d. If action='done': call foundry_artefacts_set_status(file, 'done'); exit loop; report next_cycles
   e. If action='blocked' or 'violation': report to user; exit loop

What you do NOT do:
- Do not inline forge/quench/appraise work — always dispatch
- Do not mint, modify, or cache tokens
- Do not call foundry_history_append, foundry_git_commit, or foundry_stage_finalize (not registered anyway)
```

### `forge`, `quench`, `appraise` skills — unchanged

### `human-appraise` skill — minor tweak

- Entry signature: accepts `{cycle, token, context}` from orchestrate
- Must call `foundry_stage_end({summary})` before returning so orchestrate can read the summary
- No other changes

## Migration (upgrade-foundry)

`upgrade-foundry` skill gains a v2.3.0 section with pre-flight checks:

1. **Branch check** — current branch must be `main` (or user's configured default). Abort if on `work/*`: *"You're on a work branch. Switch to main and complete or discard any in-flight flow before upgrading."*
2. **Working tree check** — must be clean. Abort if dirty: *"Uncommitted changes. Commit or stash before upgrading."*
3. **In-flight workfile check** — `WORK.md` must not exist. Abort: *"In-flight workfile detected. Delete it (foundry_workfile_delete) or complete the cycle before upgrading."*
4. All green → proceed with plugin swap + skill file swap.

No state migration. No in-flight resume. Clean base only.

## Error recovery & edge cases

| Scenario | Behavior |
|---|---|
| LLM calls orchestrate without WORK.md | `{action: 'violation', details: 'no WORK.md; flow skill must create it first'}` |
| LLM forgets `lastResult` after dispatch (today's bug) | Orchestrate sees active token with no stage_end → returns `violation` "prior stage orphaned" |
| Subagent crashed mid-stage | `task` errors → LLM passes `lastResult.ok: false` → orchestrate marks artefact blocked, returns `violation` |
| `stage_end` never called by subagent | `stageFinalize` returns `{error: 'stage_not_ended'}` → orchestrate returns `violation` |
| Uncommitted tool-managed files | Impossible via orchestrate path (atomic commits). Sort's Bug E check retained as belt-and-suspenders for manual edits. |
| LLM calls orchestrate twice in a row without dispatching | Second call sees active token with no stage_end → `violation` |
| User aborts mid-cycle (Ctrl+C) | WORK.md + partial commits remain. Flow skill's resume logic handles on next run. |

## Testing approach

### Keeps working unchanged

- `tests/sort.test.js` — routing unchanged, still imports `runSort` directly
- `tests/plugin/preconditions.test.js` — tests for tools that remain registered
- Subagent-layer tool tests (stage_begin/end, feedback, etc.)

### New

`tests/plugin/orchestrate.test.js` covers:

- First call on fresh WORK.md → runs setup, commits, returns `dispatch` for forge
- Subsequent call with `lastResult.ok: true` → finalize + history + commit + next sort
- `lastResult.ok: false` → violation path, artefact marked blocked
- `stageFinalize` returns `unexpected_files` → artefact blocked, returns violation
- Route `human-appraise:*` → returns `{action: 'human_appraise', context}` without dispatching
- Route `done` → returns `done` with `next_cycles` from cycle def
- Missing subagent → sort returns violation → orchestrate forwards
- Orphaned stage detection: call twice without dispatching → second call returns violation
- Full happy-path cycle end-to-end (forge → quench → appraise → done) driven programmatically
- `cycleDef` test-mode parameter works symmetrically with `runSort`'s

### Removed

- Any existing direct skill-orchestration tests

## Open questions

None. All decisions resolved in brainstorm:

- **Scope:** sort loop + cycle setup (flow transitions stay LLM-driven)
- **Tool shape:** single `foundry_orchestrate` with action enum
- **Subagent result passing:** read summary from `stage_end` state
- **Internal tool protection:** split plugin, internals never registered
- **Human-appraise:** parallel to dispatch (LLM invokes skill inline, reports back)
- **Versioning:** v2.3.0 hard break, no backward compat
- **Migration:** upgrade-foundry does pre-flight cleanliness checks, no state migration
- **Bug E check:** retained as belt-and-suspenders
- **`cycleDef` test-mode input:** supported, mirrors `foundry_sort`

## Implementation plan

Deferred to `writing-plans` skill. This spec is the input.
