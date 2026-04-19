# Phase 6 — Release

> Version bump, changelog, publish, retest.

**Prereqs:** Phases 1–5 complete, all tests green.

---

## Task 21: Version bump to 2.2.0

**Files:**
- Modify: `package.json`

- [ ] **Step 1**: Edit `package.json` line 3:

```diff
-  "version": "2.1.0",
+  "version": "2.2.0",
```

- [ ] **Step 2**: Run `npm install --package-lock-only` to update `package-lock.json` version field.

- [ ] **Step 3**: Commit

```bash
git add package.json package-lock.json
git commit -m "chore(release): 2.2.0"
```

---

## Task 22: CHANGELOG

**Files:**
- Create: `CHANGELOG.md`
- Modify: `package.json` `files` array to include it.

- [ ] **Step 1**: Create `CHANGELOG.md` with this content:

```markdown
# Changelog

## 2.2.0 — 2026-04-19

### Breaking changes

- **`foundry_artefacts_add` removed.** Artefact registration now happens exclusively via `foundry_stage_finalize` after a forge stage closes.
- **`foundry_artefacts_set_status` no longer accepts `draft`.** Only `done` and `blocked` are valid. New artefacts are registered as `draft` automatically by `stage_finalize`.
- **Feedback / artefact / workfile mutation tools now enforce stage-lock preconditions.** Tools callable by subagents require an active stage matching their role; tools callable by the orchestrator require no active stage. Out-of-band calls return a structured error instead of mutating state.
- **Feedback state machine strictly enforced.** `approved` is terminal. `quench` cannot approve/reject `wont-fix` items. See `HARDEN.md` §4 for the full matrix.
- **`foundry_sort` dispatchable routes now return a `token` field.** Subagents must redeem the token via `foundry_stage_begin`; forged or replayed tokens are rejected.

### New

- **`foundry_stage_begin(stage, cycle, token)`** — subagents open a work stage by consuming a single-use HMAC-signed token.
- **`foundry_stage_end(summary)`** — subagents close a stage; preserves `baseSha` for finalize.
- **`foundry_stage_finalize(cycle)`** — orchestrator verifies stage output against allowed file patterns, registers matching files as draft artefacts, rejects stray writes with `{error: "unexpected_files", files: [...]}`.
- **`.foundry/` state directory** (gitignored) — holds `.secret` (per-worktree HMAC key, mode 0600), `active-stage.json` (present only during an active stage), `last-stage.json` (for finalize lookup).

### Fixed

- Normalized `maxIterations` → `max-iterations` across workfile read/write paths (previously inconsistent between flow and cycle skills, causing latent deadlock-detection issues).

### Migration

Upgrade with the `upgrade-foundry` skill. `.foundry/` is created automatically on first plugin boot; `.secret` is generated idempotently. No data migration required — existing `WORK.md` and `foundry/*` configs are compatible.
```

- [ ] **Step 2**: Update `package.json` `files` array to include `"CHANGELOG.md"`.

- [ ] **Step 3**: Commit

```bash
git add CHANGELOG.md package.json
git commit -m "docs(release): changelog for 2.2.0"
```

---

## Task 23: Publish

**Do not execute automatically — requires maintainer presence for OTP.**

- [ ] **Step 1**: Dry-run to confirm package contents:

```bash
npm pack --dry-run
```

Expected: includes `.opencode/`, `skills/`, `scripts/`, `docs/work-spec.md`, `docs/concepts.md`, `docs/getting-started.md`, `README.md`, `LICENSE`, `CHANGELOG.md`. Confirm no test files and no `node_modules`.

- [ ] **Step 2**: Run the full test suite one final time:

```bash
node --test tests/
```

Expected: all green.

- [ ] **Step 3**: Tag and publish:

```bash
git tag v2.2.0
git push origin HEAD --tags
npm publish --otp <maintainer-otp>
```

---

## Task 24: Real-world retest

**Files:** none in-repo — this exercises the published package.

- [ ] **Step 1**: In `~/opencode-test/` (the same environment that surfaced the original `ses_2596` transcript), run `npm install @really-knows-ai/foundry@2.2.0`.

- [ ] **Step 2**: Reproduce the haiku cycle scenario. Expected behaviors that must be verified:
  1. Sort dispatches with a token; subagent redeems it successfully.
  2. If the orchestrator attempts to call `foundry_feedback_resolve` outside a stage, it receives an error — no state change.
  3. If a forge subagent writes a file outside `file-patterns`, `stage_finalize` rejects with `unexpected_files` and the cycle is marked `blocked`. No fabricated approval can occur.
  4. `approved` items cannot be flipped by subsequent `rejected` calls — terminal state holds.
  5. `.foundry/.secret` exists with mode 0600; `.foundry/active-stage.json` appears during a stage and vanishes after `stage_end`.

- [ ] **Step 3**: If any failure: file a follow-up issue and decide whether to yank or patch. No hotfix allowed without a failing test.

- [ ] **Step 4** (non-blocking): Open tracking issues for HARDEN.md §Deferred items (B, C, D, E, G) for the v2.2.1 milestone. F was cherry-picked in Phase 1.

---

## Done

v2.2.0 is out. Post-release retrospective recommended before starting v2.2.1.
