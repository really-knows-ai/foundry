# Phase 5 — Skill Updates

> Update the skill prose to use the new lifecycle protocol. The tools now *enforce* correctness; skills remain the teaching layer, but their instructions must match reality.

**Prereqs:** Phases 1–4 complete (tools behave as documented here).

**Test command:** None — these are markdown edits. Smoke-test by reading each revised skill end-to-end and checking for:
- Stage lifecycle bracketing (first and last tool calls in each subagent skill).
- Removal of references to `foundry_artefacts_add`.
- Tokens passed through in sort's dispatch prompt.

Each task is: read current skill → rewrite relevant sections → commit.

Rather than prescribe exact markdown (skills have strong voice/style that must be preserved), each task below gives the **semantic diff** that must land.

---

## Task 16: `skills/forge/SKILL.md`

**Files:**
- Modify: `skills/forge/SKILL.md`

**Semantic diff:**

1. **First action**: call `foundry_stage_begin(stage, cycle, token)` with the token passed in by the orchestrator. This must precede any file writes or feedback mutations.
2. **Last action**: call `foundry_stage_end(summary)` before returning control.
3. **Feedback actions allowed within forge**: `feedback_action` (mark fix applied), `feedback_wontfix` (decline with reason). **No** `feedback_add`, **no** `feedback_resolve`.
4. **Remove**: any instructions to call `foundry_artefacts_add`. Artefact registration is automatic via `stage_finalize` (orchestrator-side); forge just writes the file.
5. **File-pattern hygiene**: explicit note — writes must match the cycle's output artefact type `file-patterns`; unexpected writes cause the orchestrator to mark the cycle `blocked`.
6. **Token handling**: the token arrives in the dispatch prompt; copy it verbatim into `foundry_stage_begin`. Never generate or modify tokens.

**Steps:**

- [ ] **Step 1**: Read current `skills/forge/SKILL.md`.
- [ ] **Step 2**: Apply the six changes above. Preserve existing voice and checklist patterns.
- [ ] **Step 3**: Re-read to confirm no lingering `artefacts_add` references and lifecycle brackets are in place.
- [ ] **Step 4**: Commit

```bash
git add skills/forge/SKILL.md
git commit -m "docs(harden): update forge skill for stage lifecycle protocol"
```

---

## Task 17: `skills/quench/SKILL.md`, `skills/appraise/SKILL.md`, `skills/human-appraise/SKILL.md`

Each of these three skills needs the **same** structural edit. Do them as one task with three commits (or one combined commit if prose changes are trivial).

**Semantic diff (all three):**

1. **First action**: `foundry_stage_begin(stage, cycle, token)`.
2. **Last action**: `foundry_stage_end(summary)`.
3. **No disk writes** — explicit reinforcement that validators/appraisers produce feedback via `foundry_feedback_add`, not files.
4. **Feedback tag restrictions** (enforced at tool level, documented in skill):
   - `quench` → `tag: 'validation'` only; may `feedback_resolve` (`actioned → approved|rejected`) on actioned items.
   - `appraise` → `tag: 'law:<id>'`; may `feedback_resolve` on actioned OR wont-fix items (→ approved|rejected).
   - `human-appraise` → `tag: 'human'`; may `feedback_resolve` on actioned OR wont-fix items.
5. **Remove** any leftover references to manual artefact registration.

**Steps:**

- [ ] **Step 1**: Read and revise `skills/quench/SKILL.md`. Commit.

```bash
git add skills/quench/SKILL.md
git commit -m "docs(harden): update quench skill for stage lifecycle + tag restrictions"
```

- [ ] **Step 2**: Read and revise `skills/appraise/SKILL.md`. Commit.

```bash
git add skills/appraise/SKILL.md
git commit -m "docs(harden): update appraise skill for stage lifecycle + tag restrictions"
```

- [ ] **Step 3**: Read and revise `skills/human-appraise/SKILL.md`. Commit.

```bash
git add skills/human-appraise/SKILL.md
git commit -m "docs(harden): update human-appraise skill for stage lifecycle + tag restrictions"
```

---

## Task 18: `skills/sort/SKILL.md`

**Files:**
- Modify: `skills/sort/SKILL.md`

**Semantic diff:**

1. **Include the token in the dispatch**: the `task` prompt to the subagent MUST include the token string verbatim, alongside `cycle`, `stage`, and `file-patterns` for forge stages.
2. **Post-stage `stage_finalize`**: after the subagent `task` call returns, the orchestrator (sort skill) MUST call `foundry_stage_finalize(cycle)`. Handle three outcomes:
   - `{ok: true, artefacts: [...]}` → proceed to `history_append` then `git_commit`.
   - `{error: 'unexpected_files', files: [...]}` → mark the cycle's target artefact `blocked` (via `foundry_artefacts_set_status`) with a violation feedback tag, then return to cycle skill.
   - Any other error → surface to user, halt.
3. **Strip redundant "do not" prose**: many advisory prohibitions are now tool-enforced. Trim those — keep only the workflow narrative.
4. **Violation handling**: explicit section covering the `unexpected_files` path, the `blocked` marking, and the "do not attempt to re-run the stage" rule.
5. **Token verbatim rule**: never invent, edit, or re-sign tokens. Treat them as opaque strings.

**Steps:**

- [ ] **Step 1**: Read current `skills/sort/SKILL.md`.
- [ ] **Step 2**: Apply changes. Preserve the skill's existing structure and decision tree (it's the most procedural skill and must stay readable).
- [ ] **Step 3**: Commit

```bash
git add skills/sort/SKILL.md
git commit -m "docs(harden): sort skill dispatches tokens and calls stage_finalize"
```

---

## Task 19: `skills/cycle/SKILL.md`

**Files:**
- Modify: `skills/cycle/SKILL.md`

**Semantic diff:**

1. Reflect that sort now owns post-stage duties (`stage_finalize`, `history_append`, `git_commit`) — cycle skill only orchestrates the dispatch loop.
2. Remove any instructions that told cycle to perform artefact registration itself.
3. Mention the new deadlock/violation exit paths (sort returning `blocked` or a `stage_finalize` `unexpected_files` error).

**Steps:**

- [ ] **Step 1**: Read and revise.
- [ ] **Step 2**: Commit

```bash
git add skills/cycle/SKILL.md
git commit -m "docs(harden): cycle skill reflects sort's post-stage ownership"
```

---

## Task 20: `skills/upgrade-foundry/SKILL.md`

**Files:**
- Modify: `skills/upgrade-foundry/SKILL.md`
- Modify: `.gitignore`

**Semantic diff:**

1. On upgrade to v2.2.0, create `.foundry/` directory (if absent).
2. Generate `.foundry/.secret` (delegate to `readOrCreateSecret` behavior — in practice this happens automatically on first plugin boot, but the skill should document that).
3. Add `.foundry/` to `.gitignore` (append, don't duplicate).
4. Note: fresh state — no migration needed for WORK.md or existing artefacts.
5. If an in-flight `active-stage.json` exists from pre-upgrade (impossible since pre-upgrade didn't write it, but future-proof the prose), leave it alone — new plugin will treat its absence as "no stage".

**Steps:**

- [ ] **Step 1**: Update `.gitignore` to append `.foundry/`:

```bash
# Current:
# node_modules/
# __pycache__/
# .DS_Store
# *.tgz

# After:
# node_modules/
# __pycache__/
# .DS_Store
# *.tgz
# .foundry/
```

- [ ] **Step 2**: Read and revise `skills/upgrade-foundry/SKILL.md`. Add a v2.2.0 section describing the above.

- [ ] **Step 3**: Commit

```bash
git add skills/upgrade-foundry/SKILL.md .gitignore
git commit -m "docs(harden): upgrade skill creates .foundry/ + gitignores it"
```

---

## Phase 5 complete

All six subagent/orchestrator skills now describe behavior that matches the enforced tool surface. Proceed to [PHASE_6.md](PHASE_6.md).
