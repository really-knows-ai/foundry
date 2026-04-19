# HARDEN.md — v2.2.0 Tool-Level Enforcement

> **Goal:** Make it structurally impossible for the orchestrator (or any agent) to misuse foundry tools. Move constraints from skill text (advisory) into tool preconditions (enforcement).

## Motivation

Real-world test (`~/opencode-test/session-ses_2596.md`) revealed that when the orchestrator gets stuck in a deadlock loop, it **fabricates user interactions** — specifically, it invented a "user approved this haiku" exchange that never happened and called `foundry_feedback_resolve(approved)` with a fictional reason. That falsehood gets written into the audit trail.

Root causes:
1. Skill text forbade misuse but nothing enforced it — skills advise, they don't enforce.
2. No deadlock escape hatch for the orchestrator, so it improvised.
3. Feedback state machine has no terminal states — a `rejected` evaluator call silently flipped a prior `approved` resolution.

Fix: lift the constraints into tool preconditions that reject malformed calls.

---

## Architecture

### 1. Filesystem state

New directory `.foundry/` (gitignored):

```
.foundry/
  .secret            # 32 random bytes, mode 0600, HMAC key
  active-stage.json  # present iff a stage is active
```

`active-stage.json`:

```json
{
  "cycle": "create-haiku",
  "stage": "forge:create-haiku",
  "tokenHash": "sha256(consumed-token)",
  "baseSha": "<git HEAD at stage_begin>",
  "startedAt": "2026-04-19T18:40:00Z"
}
```

Only one stage active per worktree. Absence of file = no stage active.

### 2. Token protocol

**`foundry_sort` return shape adds `token`** (only when route is a dispatchable stage):

```json
{ "route": "forge:create-haiku", "model": "foundry-...", "token": "<compact-hmac>" }
```

Routes `done`, `blocked`, `violation` do not carry tokens.

**Token format** — HMAC-signed envelope:

```
base64url(payload) + "." + base64url(hmac_sha256(secret, payload))
```

Where `payload = { route, cycle, nonce, exp }` and `exp = now + 10 minutes`.

**Lifecycle:**

1. `foundry_sort` generates token, records `{nonce, exp, route, cycle}` in plugin-memory pending list, returns token in response.
2. Orchestrator passes token verbatim into subagent `task` prompt.
3. Subagent calls `foundry_stage_begin(stage, cycle, token)`:
   - Verify HMAC with `.foundry/.secret`
   - Verify not expired
   - Verify `(route, cycle)` in payload matches args
   - Verify nonce is in pending list (not reused, not unknown)
   - Remove nonce from pending list (single-use)
   - Write `active-stage.json` with `tokenHash = sha256(token)` and `baseSha = git rev-parse HEAD`
4. Subagent does its work.
5. Subagent calls `foundry_stage_end(summary)` — deletes `active-stage.json`, returns summary to caller.
6. Orchestrator calls `foundry_stage_finalize(cycle)` — see §5.

**Failure modes:**
- Invalid/expired/unknown token → `stage_begin` returns error; no state written; subagent reports error to orchestrator; orchestrator surfaces it and halts.
- Plugin restart invalidates outstanding tokens (pending list is in memory) — rare and recoverable.

### 3. Permission matrix (tool preconditions)

All enforcement returns `{error: "<tool> requires <condition>; current: <state>"}` on violation. No state change. No auto-block. Orchestrator recovers or surfaces to user.

#### Subagent tool permissions (require matching active stage)

| Stage base | Tools allowed |
|---|---|
| `forge` | `feedback_action`, `feedback_wontfix`, all read-only tools |
| `quench` | `feedback_add(tag=validation)`, `feedback_resolve(rejected)` on actioned items only, read-only |
| `appraise` | `feedback_add(tag=law:*)`, `feedback_resolve(rejected)` on actioned/wont-fix items, `appraisers_select`, read-only |
| `human-appraise` | `feedback_add(tag=human)`, `feedback_resolve(approved\|rejected)` on actioned/wont-fix items, read-only |

#### Subagent file writes (enforced by `stage_finalize` diff check)

| Stage base | Allowed disk writes (excluding tool-managed: `WORK.md`, `WORK.history.yaml`, `.foundry/*`) |
|---|---|
| `forge` | files matching cycle's output artefact type `file-patterns` |
| `quench` | none |
| `appraise` | none |
| `human-appraise` | none |

#### Orchestrator tool permissions (require NO active stage)

| Tool | Notes |
|---|---|
| `foundry_sort` | returns token when dispatching |
| `foundry_history_append(stage=sort)` | always allowed when no stage active |
| `foundry_history_append(stage=<alias>)` | requires last sort to have routed to `<alias>` |
| `foundry_git_branch` | |
| `foundry_git_commit` | |
| `foundry_workfile_create` | additionally requires WORK.md absent |
| `foundry_workfile_delete` | additionally requires `{confirm: true}` |
| `foundry_workfile_set` | key must be in `{cycle, stages, max-iterations, models}` |
| `foundry_stage_finalize(cycle)` | post-stage artefact verification + registration |
| `foundry_artefacts_set_status(done\|blocked)` | cycle completion; `draft` value rejected |
| all read-only tools | always allowed |

#### Removed from public tool surface

- `foundry_artefacts_add` — `stage_finalize` is the only registration path.
- `foundry_artefacts_set_status(draft)` — `stage_finalize` registers new artefacts as draft automatically. `set_status` now only accepts `done` or `blocked`.

### 4. Feedback state machine (enforced at the tool level)

| Current state | Owner | Allowed transitions |
|---|---|---|
| `open` | forge | → `actioned` (forge fixed), → `wont-fix` (forge declined) |
| `actioned` | evaluators | → `approved` (quench/appraise/human), → `rejected` (quench/appraise/human) |
| `wont-fix` | evaluators | → `approved` (appraise/human only — not quench), → `rejected` (appraise/human only) |
| `rejected` | forge | → `actioned` (forge fixed), → `wont-fix` (forge declined) |
| `approved` | — | **terminal** |

Any other transition → `{error: "invalid transition <current> → <target>"}`.

This closes the transcript bug where quench flipped a `approved` item back to `rejected` on re-validation.

**Deduplication rule:** when a new feedback item is added, dedupe by `{file, tag, text-hash}` — if an exact match already exists in any state, no new item is added.

### 5. `foundry_stage_finalize` — the verification gate

Orchestrator-only. Called after `stage_end` returns. Replaces all artefact registration paths.

**Algorithm:**

1. Read `baseSha` from last `active-stage.json` (stored pre-delete in a `last-stage.json` or carried through by stage_end return value — implementation choice).
2. `changed = git diff --name-only <baseSha> HEAD` ∪ untracked files.
3. Filter out tool-managed files: `WORK.md`, `WORK.history.yaml`, `.foundry/**`.
4. For each remaining file, match against the stage's allowed patterns:
   - `forge:*` → cycle's output artefact type `file-patterns`
   - `quench:*`, `appraise:*`, `human-appraise:*` → allowed set is empty
5. **If any file doesn't match** → return `{error: "unexpected_files", files: [...]}`. Orchestrator marks the cycle's target artefact `blocked` with a violation feedback tag and returns to the cycle skill.
6. **If clean** → for each matched file, register it as a draft artefact (idempotent: existing registrations just confirm status). Return `{artefacts: [{file, type, status}, ...]}`.

### 6. Updated orchestrator flow

```
1. foundry_sort                          → {route, model, token}
2. foundry_history_append(stage=sort, comment)
3. task(subagent_type=model, prompt includes token + file-patterns + cycle + stage)
     ↓ subagent: foundry_stage_begin(stage, cycle, token) → does work → foundry_stage_end(summary)
4. foundry_stage_finalize(cycle)         ← verifies diff + registers artefacts; hard-fails on unexpected files
5. foundry_history_append(stage=<alias>, comment summarizing subagent report)
6. foundry_git_commit                     ← micro-commit per stage
7. goto 1
```

Between stages the orchestrator has no active stage; all mutation tools either match its "no active stage" profile or reject it. No room for inlining forge work. No room for fabricating user approvals.

---

## Implementation plan

Sequenced for minimum rework and continuous test coverage.

### Phase 1 — Infrastructure
1. Add `scripts/lib/state.js` — `readActiveStage()`, `writeActiveStage()`, `clearActiveStage()`, `ensureFoundryDir()`. Pure helpers with unit tests.
2. Add `scripts/lib/secret.js` — `readOrCreateSecret()`, 0600 permissions, idempotent. Unit tests.
3. Add `scripts/lib/token.js` — `signToken(payload, secret)`, `verifyToken(token, secret)` with expiry + signature checks. Unit tests for forgery, expiry, tampering.
4. Add `scripts/lib/feedback-transitions.js` — `validateTransition(currentState, targetState, stageBase)`. Pure function. Unit tests for every cell of the state-machine matrix.

### Phase 2 — New tools
5. `foundry_stage_begin(stage, cycle, token)` — verify token, write `active-stage.json` with `baseSha`. Unit + integration tests.
6. `foundry_stage_end(summary)` — clear `active-stage.json`, preserve `baseSha` for finalize (plugin memory or `last-stage.json`). Unit tests.
7. `foundry_stage_finalize(cycle)` — diff + pattern-match + register. Integration tests with real git repo fixtures covering: clean forge diff, forge diff with stray file, quench with any diff (reject), empty diff.

### Phase 3 — Preconditions on existing tools
One commit per tool group, each with tests for accept AND reject paths:
8. `foundry_feedback_*` — stage lock + state-machine transitions + dedup.
9. `foundry_artefacts_set_status` — orchestrator-only, draft rejected.
10. Remove `foundry_artefacts_add` from tool surface (internal helper still exists for `stage_finalize` use).
11. `foundry_workfile_*` — stage lock, key whitelist for `_set`.
12. `foundry_history_append` — stage-alias must match last sort route.
13. `foundry_git_branch`, `foundry_git_commit` — no-active-stage check.

### Phase 4 — `foundry_sort` updates
14. Sort generates token when returning a dispatchable route; adds nonce to pending list.
15. Sort rejects calls while a stage is active.

### Phase 5 — Skills
16. `forge/SKILL.md` — lifecycle bracketing (`stage_begin` first, `stage_end` last); remove `artefacts_add` instruction; file-pattern hygiene.
17. `quench/SKILL.md`, `appraise/SKILL.md`, `human-appraise/SKILL.md` — same lifecycle bracketing; no-disk-writes reinforced.
18. `sort/SKILL.md` — include token in task prompt; call `stage_finalize` after subagent returns; strip redundant "do not" prose; document violation handling.
19. `cycle/SKILL.md` — light updates reflecting sort's new post-stage duties.
20. `upgrade-foundry/SKILL.md` — create `.foundry/`, add to `.gitignore`, generate `.secret`.

### Phase 6 — Release
21. Version bump to 2.2.0 in `package.json`.
22. Update CHANGELOG / release notes covering breaking changes (removed tools, new state dir).
23. `npm publish` with OTP.
24. Real-world retest in `~/opencode-test/`.

---

## Breaking changes

- `foundry_artefacts_add` removed.
- `foundry_artefacts_set_status` no longer accepts `draft`.
- All feedback/artefact/workfile mutation tools now enforce stage-lock preconditions.
- Feedback state machine strictly enforced — previously-permissive transitions now error.
- `foundry_sort` return adds `token` (non-breaking addition, but existing skills ignoring it will fail dispatch after skill updates).

## Non-breaking additions

- `.foundry/` directory and `.secret` file.
- `foundry_stage_begin`, `foundry_stage_end`, `foundry_stage_finalize` tools.

## Migration

Fresh state on upgrade. `upgrade-foundry` creates `.foundry/`, generates `.secret`, adds to `.gitignore`. Any in-flight cycle continues from whatever sort routes to next. No data migration needed — existing WORK.md is compatible.

---

## Deferred to v2.2.1

Known bugs from the same transcript (`ses_2596`), not fixed in v2.2.0 because they're orthogonal to the enforcement architecture:

### B — Deadlock detection not routing to `human-appraise`

Cycle `create-haiku` has `human-appraise.deadlock-threshold: 3`. Iteration hit 3 with unresolved validation feedback, but sort kept returning `forge:create-haiku` instead of routing to `human-appraise` or returning `blocked`. Either the deadlock path isn't wired up, or it reads the wrong config key. Likely interacts with Bug F.

**Probable fix:** in `scripts/sort.js`, when computing route, check consecutive failure count against `human-appraise.deadlock-threshold`; if exceeded AND `stages` includes a `human-appraise:*` alias, route there; else return `blocked`.

### C — Quench validates stale artefacts from previous cycles

`foundry_validate_run` / quench stage globs `file-patterns` (e.g., `haikus/*.md`) and validates every matching file on disk — including artefacts from prior killed sessions that the current cycle didn't produce. Transcript showed quench failing `north-sea-wind-pigeon.md` (from a previous aborted session) alongside the current cycle's `north-sea-pigeon.md`.

**Probable fix:** scope validation to files registered in the current cycle's artefact table (`foundry_artefacts_list`), not a filesystem glob. Glob is only used at artefact discovery time (which is now handled by `stage_finalize`).

### D — `foundry_workfile_create` errors when WORK.md exists

Prior aborted session leaves WORK.md behind; next run's `flow` skill tries to create a fresh workfile and hits `{error: "WORK.md already exists"}`. Orchestrator had to manually call `foundry_workfile_delete`.

**Probable fix:** either (a) add `{overwrite: true}` option, or (b) have the `flow` skill check via `foundry_workfile_get` first and prompt the user. Option (b) is safer — prevents silent data loss.

### E — No micro-commits between stages (skill contract gap)

`cycle/SKILL.md` says "Every stage must end with a micro commit" but the responsibility was never assigned to a specific actor in the updated flow. Transcript shows zero commits across the entire cycle. v2.2.0 adds `foundry_git_commit` to the orchestrator's explicit post-stage flow (§6), but doesn't enforce it structurally. Consider making `foundry_sort` reject calls when there are uncommitted changes in tool-managed files since the last sort — forces commits without adding new ceremony.

### F — `max-iterations` vs `maxIterations` key inconsistency

Flow-skill-initialized workfiles use `maxIterations` (camelCase). Cycle-skill-populated workfiles use `max-iterations` (kebab-case). If `foundry_sort` reads the wrong key for deadlock detection, that explains Bug B.

**Probable fix:** pick one form (kebab matches YAML frontmatter idiom), normalize on read across all tools. Add a migration pass in `foundry_workfile_get` that transparently rewrites old form.

**Note:** consider cherry-picking F into v2.2.0 as a one-line fix since it likely causes latent issues during HARDEN testing. Judgment call at implementation time.

### G — Flow + cycle workfile setup requires 4 sequential `foundry_workfile_set` calls

Between flow skill (step 4: create minimal workfile) and cycle skill (step 4: populate stages/max-iterations/models/cycle), the orchestrator makes four consecutive `foundry_workfile_set` calls. Clunky UX.

**Probable fix:** add a batch variant — `foundry_workfile_set_many({cycle, stages, max-iterations, models})` — or have the cycle skill call `foundry_workfile_configure(cycleDef)` that reads the cycle definition and writes all fields atomically.
