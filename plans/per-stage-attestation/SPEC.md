# SPEC: Per-stage Attestation

## Goal

Move attestation from a monolithic cycle-level snapshot to per-stage records scoped by run. Every stage executor appends a self-verifying line to a run-scoped jsonl file. The final line is the cycle attestation — it seals the run. The old `foundry_attest` tool, `payload.js`, `attest.js`, and `ATTEST.md` are replaced.

## Background

The feedback-refactor project produced per-stage attestation schemas (`stage-payload.js`, `cycle-payload.js`) and 37 tests but deferred wiring into stage executors and tools. This project completes the wiring, tooling, and cleanup.

## Audit trail

Foundry has three goals: **verifiable** quality, **auditable** process, and **predictable** outcomes. Per-stage attestation serves auditability — it produces an immutable, chronologically ordered record of every quality decision made during a run.

### What an auditor can verify

With `.foundry/attestations/<run-id>.jsonl`, an auditor can answer:

- **Who evaluated what?** Each appraise and human-appraise record lists appraiser identities and their verdicts. Each quench record lists violations found.
- **What changed and when?** Every stage record carries an ISO 8601 timestamp. `changed_files` and `artefact_hashes` show exactly what files the forge produced or modified. The chronological sequence is preserved by append order.
- **What rules were in effect?** The cycle attestation line (final line) includes `governance` — hashes of law files and cycle configuration. An auditor can reproduce the exact rule set in effect for that run.
- **Was any record tampered with?** Every line carries a `_hash` covering its content. If a line is modified after the fact, its hash breaks. The cycle attestation line references all prior stage lines — its `_hash` covers the stage attestations it embeds, so tampering with any line is detectable from the cycle line alone.
- **What was the decision path?** Each stage record shows its derived `status` (pass, fail, actioned, wont-fix, resolved, rejected) and the data that produced it. An auditor can trace an artefact from forge through quench through appraise to the final outcome without reading source code or agent logs.
- **Which runs existed?** The directory listing of `.foundry/attestations/` is a chronological index of every run. `git log -- .foundry/attestations/` shows when each run was committed.

### Immutability properties

- **Scoped by run:** One file per run. Once the cycle attestation line seals the file, the run is complete and the file is committed to git as an immutable record.
- **Content-addressed lines:** Every line's `_hash` is a function of its content. Two lines with the same hash have identical content. Two lines with identical content but different hashes indicate tampering.
- **Cycle line seals the run:** The final line in the file is the cycle attestation. It embeds all stage attestations from the run and carries a `_hash` covering them. An auditor can verify the entire run from the cycle line alone — even if individual stage lines are corrupted, the cycle line's embedded records remain verifiable.

### Git integration

When a run completes and the worktree is merged into main, the git commit message includes the attestation seal. The commit body carries:

```
foundry-run: <run-id>
attestation-seal: <_hash of cycle attestation line>
composite-status: pass
stage-count: 8
```

This links the git history to the audit log. An auditor can:

- **Trace commit → attestation:** `git log` shows the seal hash. Opening `.foundry/attestations/<run-id>.jsonl` and verifying the cycle line's `_hash` against the commit message confirms the commit hasn't been tampered with after the fact.
- **Trace attestation → commit:** The run ID in the attestation file name appears in the commit message. `git log --grep="foundry-run: <run-id>"` finds the exact commit that sealed that run.
- **Detect history rewriting:** If someone rebases or amends a commit, the attestation file's content (committed in that same commit) would need to change — breaking the seal hash in the commit message. Mismatch is detectable by `foundry_attestation_verify`.

The orchestration finalise step (`orchestrate-finalise.js`) reads the seal hash from the cycle attestation output and includes it in the merge commit message.

## Scope

### 1. File structure

Each run produces one file: `.foundry/attestations/<run-id>.jsonl`

The `run-id` is a ULID generated at cycle start by `run.js` and written to `WORK.md` frontmatter. Every executor reads the run ID from `WORK.md`, ensuring all stages in the same run append to the same file. The directory `.foundry/attestations/` is created at foundry init alongside other `.foundry/` subdirectories.

```
.foundry/attestations/
  01JKVT7Z8Q3WN0GJM2TYBR4AA.jsonl  # run 1: cats haiku
  01JKVT8A1R4XP1HKN3UZCS5BB.jsonl  # run 2: cats haiku (feedback loop)
  01JKVT9B2S5YQ2JLP4V0DT6CC.jsonl  # run 3: dogs haiku
  01JKVTA3T6ZR3KMQ5W1EU7DD.jsonl  # run 4: sonnet
```

Each file contains:

```
line 1: stage attestation (assay)
line 2: stage attestation (forge)
line 3: stage attestation (quench)
line 4: stage attestation (forge)        ← feedback sent it back
line 5: stage attestation (quench)
line 6: stage attestation (appraise)
...
line N: cycle attestation                ← seals the run
```

The cycle attestation line embeds all prior stage attestations and carries a `_hash` that covers them.

### 2. Wire stage executors

Every stage executor calls `appendStageAttestation` at stage-end — including on failure. The `status` field captures the outcome, so a failed stage still produces an attestation line. An audit trail with a `fail` record is more informative than a gap.

| Executor | File | Stage |
|----------|------|-------|
| `executeForge` | `src/scripts/run-executors.js` | `forge` |
| `executeQuench` | `src/scripts/run-executors.js` | `quench` |
| `executeAssay` | `src/scripts/run-assay.js` | `assay` |
| `executeAppraise` | `src/scripts/run-appraise.js` | `appraise` |
| `handleAlwaysHumanAppraise` | `src/scripts/run-human-appraise.js` | `human-appraise` |
| `handleDeadlockOverride` | `src/scripts/run-human-appraise.js` | `human-appraise` |

Each executor reads the run ID from `WORK.md` frontmatter (written at cycle start). Each has the data it needs: `cycle`, `iteration`, `evaluations`, `violations`, `changed_files`, `artefact_hashes`, feedback item IDs opened/resolved, and stage-specific flags. `timestamp` is ISO 8601 now. `status` is derived by `deriveStageStatus`.

**human-appraise timing:** Each handler writes one attestation when it completes its work — `handleDeadlockOverride` after all deadlocked items are resolved/rejected, `handleAlwaysHumanAppraise` after approve or reject.

### 3. JSONL line format

Every line in the file is a single JSON object:

```json
{"schema":"foundry-stage-attestation/v1","stage":"forge","cycle":"haiku-cycle","iteration":1,"timestamp":"2026-06-11T14:00:05.000Z","status":"actioned","changed_files":["haikus/cats.md"],"evaluations":[],"violations":0,"feedback_opened":[],"feedback_resolved":["fb-01"],"artefact_hashes":[{"path":"haikus/cats.md","hash":"def456..."}],"_hash":"b2c3d4..."}
```

The `_hash` field is a SHA-256 hash of the canonical JSON of all fields except `_hash` itself.

The final line (cycle attestation) embeds all stage attestations:

```json
{"schema":"foundry-cycle-attestation/v1","cycle":"haiku-cycle","stage_attestations":[{...assay...},{...forge...},...],"composite_status":"pass","cycle_duration_ms":60000,"feedback_summary":{"opened":2,"resolved":2,"rejected":0,"open_remaining":0},"artefact_summary":{"total_changed":1,"unique_paths":1},"governance":{"workfile_hashes":{},"config_commit":"abc123"},"_hash":"i9j0k1..."}
```

### 4. Cycle attestation sealing (orchestration-only)

The cycle attestation is sealed automatically by the orchestration finalise step — it is **not** an agent-callable tool. The seal function in `src/scripts/lib/attestation/hash.js`:

- Reads `.foundry/attestations/<run-id>.jsonl`
- Parses each line; skips lines whose `_hash` does not verify
- Builds `CycleAttestation` via `buildCycleAttestation` from `cycle-payload.js` using all verified stage attestations
- Computes `_hash` on the composite
- Appends the cycle attestation line to the file — **this seals the run**
- If the run has no stages (empty file or no lines parsed), seals with `composite_status: "incomplete"` — the auditor knows the run was abandoned
- Returns `{ ok: true, cycle, composite_status, stage_count, seal_hash }`

The finalise step uses the returned seal hash to amend the work-branch commit with attestation metadata.

### 5. Show and verify tools (agent-callable)

- `foundry_attestation_show`: accepts a `run_id`, reads `.foundry/attestations/<run-id>.jsonl`, and returns its contents
- `foundry_attestation_verify`: accepts a `run_id`, reads the jsonl, re-verifies every line's `_hash` and the cycle line's embedded records; reports any mismatch
- If no `run_id` is provided, both tools list available runs from `.foundry/attestations/`

### 6. Run ID lifecycle

- `generateRunId()` in `src/scripts/lib/attestation/hash.js` produces a ULID (time-sortable, unique)
- Generated at cycle start by `run.js` at `stage_begin`, written to `WORK.md` frontmatter as `foundry-run`
- Every executor reads the run ID from `WORK.md` — no sort-result threading needed
- Multiple stages in the same run see the same run ID because `WORK.md` is the central state file
- Human-appraise handlers also read the run ID from `WORK.md`

### 7. Remove old attestation system

- Delete `src/scripts/lib/attestation/payload.js` — the old `buildAttestationPayload` is unused
- Delete `src/scripts/lib/attestation/attest.js` — the old `buildAttestation` is unused
- Remove `from './lib/attest.js'` import in `attestation-tools.js`
- Delete old `ATTEST.md` files from repos (they are superseded by the jsonl)
- Remove `ATTEST.md` references from all code, skills, and docs
- Replace the `ATTEST.md`-based gate in `foundry_git_finish` with seal verification that reads `foundry-run` and `attestation-seal` from the HEAD commit body
- Remove `foundry_attest` tool registration (the cycle seal is orchestration-driven, not an agent tool)
- No new tool is added to agent permissions — sealing is automatic

## Non-Goals

- Do not modify the schema modules (`stage-payload.js`, `cycle-payload.js`) beyond bug fixes — their contracts are stable
- Do not add markdown rendering for attestation data
- Do not change how evaluators, violations, or feedback items are counted — executors already have this data
- Do not archive or rotate attestation files — they grow with the repo
- Do not expose cycle attestation sealing as an agent-callable tool — it is orchestration-driven

## Future: Federation

A future project, federation, will build on per-stage attestation to provide cross-project auditability:

- **Identity:** A project joins a federation and gains a federated identity
- **Inherited laws:** Federated governance rules apply across member projects
- **Immutable attestation log:** Run seals (`run-id` + cycle `_hash`) are posted to a central blockchain log, providing an external anchor that survives git history rewrites

This project defines the data (run ID, seal hash, attestation file structure) that federation consumes. Federation reads `.foundry/attestations/<run-id>.jsonl`, verifies the seal, and posts it to the chain.

## Requirements

### R1. Run-scoped attestation file

The file `.foundry/attestations/<run-id>.jsonl` is created on first append. Every stage in the run appends to it. No other file is used for per-stage attestation data.

### R2. Append stage attestation

Each of the six stage-execution paths calls `appendStageAttestation(io, runId, params)` which:
1. Calls `buildStageAttestation(params)`
2. Computes `_hash` via `hashAttestation`
3. Appends the JSON line to `.foundry/attestations/<run-id>.jsonl`

This function lives in `src/scripts/lib/attestation/hash.js`. Append happens regardless of stage outcome — a stage that completes (pass or fail) always produces a line. A crashed executor that never reaches the append call produces no line, which is acceptable.

### R3. Compute `_hash`

`hashAttestation(obj)` in `src/scripts/lib/attestation/hash.js`:
1. Deletes `_hash` from a shallow copy
2. Sorts object keys recursively
3. Produces canonical JSON (no whitespace, sorted keys)
4. Returns the SHA-256 hex digest

### R4. Cycle attestation sealing

`sealCycleAttestation(runId, io)` in `src/scripts/lib/attestation/hash.js`:
- Resolves the run ID from `WORK.md` if not explicitly provided
- Reads `.foundry/attestations/<run-id>.jsonl` (non-existent → error)
- Parses each line; skips lines whose `_hash` does not verify
- Builds `CycleAttestation` via `buildCycleAttestation` from `cycle-payload.js` using all verified stage attestations
- Computes `_hash` on the composite
- Appends the cycle attestation line to the file (seals the run)
- If the file has no lines or only unparseable lines, seals with `composite_status: "incomplete"` and an empty `stage_attestations` array
- Returns `{ ok: true, cycle, composite_status, stage_count, seal_hash }`

This is called automatically by the orchestration finalise step. It is not an agent-callable tool.

### R5. Run ID lifecycle

- `generateRunId()` produces a ULID
- Generated at cycle start by `run.js` at `stage_begin`, written to `WORK.md` frontmatter as `foundry-run`
- All executors in the same run read the run ID from `WORK.md`, ensuring they append to the same file

### R6. Show and verify tools (agent-callable)

These are read-only inspection tools, not sealing tools:

- `foundry_attestation_show` reads a run's jsonl and returns contents; lists runs if no `run_id` given
- `foundry_attestation_verify` re-verifies hashes on every line and the cycle line's embedded records; lists runs if no `run_id` given

### R7. Cleanup

- `src/scripts/lib/attestation/payload.js` deleted
- `src/scripts/lib/attestation/attest.js` deleted
- `foundry_attest` removed from `attestation-tools.js`
- `ATTEST.md` references removed from all source, skills, tests, and docs
- No new agent-permission entries needed — cycle sealing is orchestration-driven

### R8. Git commit seal

The orchestration finalise step (`orchestrate-finalise.js`) includes attestation metadata in the merge commit message. When a run completes and the worktree is merged:

- Finalise calls `sealCycleAttestation(runId, io)` to seal the run
- The commit body carries `foundry-run: <run-id>`, `attestation-seal: <_hash>`, `composite-status: <status>`, and `stage-count: <N>`
- The attestation file (`.foundry/attestations/<run-id>.jsonl`) is staged into the merge commit alongside the artefact changes, so the commit contains both the artefact and its audit record

### R9. Git-finish seal gate

`foundry_git_finish` verifies the attestation seal exists before merging a work branch. It reads the HEAD commit body and checks for `foundry-run` and `attestation-seal` fields — both must be present. If the seal is absent, the finish is blocked. The seal metadata from the HEAD commit body becomes the merge commit message.

## Error Handling

- **Run ID file does not exist at cycle-end:** `sealCycleAttestation` returns `{ ok: false, error: "no attestation file found for run <run-id>" }`
- **Corrupt or non-JSON line:** skipped; logged to stderr
- **Hash mismatch on a stage line:** that line is skipped; the composite may still include it but the mismatch is reported
- **Cycle line hash mismatch:** returned as an error — the composite cannot be trusted
- **Partial run (empty or no parseable lines):** sealed with `composite_status: "incomplete"` — the auditor knows the run did not finish
- **IO write failure appending:** executor catches and logs; does not fail the stage (attestation is diagnostic, not critical path)
- **IO read failure for show/verify:** returned as an error to the caller

## Verification

```sh
# All attestation unit tests (hash, stage-payload, cycle-payload, append)
pnpm run test:all tests/lib/attestation/

# Cycle attestation seal tests specifically
pnpm run test:all tests/lib/attestation/seal-cycle-attestation.test.js

# Git-finish seal gate tests
pnpm run test:all tests/lib/git-finish/work-finish.test.js

# E2E tests for git tools
pnpm run test:e2e tests/plugin/git-tools.e2e.test.js

# Full quality gate
pnpm run build:all
```

Tests must verify:
- `hashAttestation` is deterministic regardless of key order
- `generateRunId` produces ULIDs that are time-sortable and unique
- `appendStageAttestation` writes valid JSONL lines with correct `_hash` to the correct run-scoped file (including on failure)
- `sealCycleAttestation` reads a run's jsonl, verifies hashes, builds a composite with embedded stage attestations, and appends the cycle line with its own verifiable `_hash`
- `sealCycleAttestation` seals a partial run (empty file) with `composite_status: "incomplete"`
- `sealCycleAttestation` handles missing/corrupt jsonl gracefully
- A modified jsonl line whose `_hash` was not updated is detected as tampered
- A full cycle produces one `.foundry/attestations/<run-id>.jsonl` with stage lines plus a cycle line that seals it
- The orchestration finalise step includes the run ID and seal hash in the commit message
- The attestation file is staged in the same commit as the artefact changes
- Old tools (`foundry_attest`) are not registered
- Old modules (`payload.js`, `attest.js`) do not exist
- `foundry_git_finish` passes with seal present and blocks with seal absent

## Acceptance Criteria

1. `generateRunId` produces a unique ULID at cycle start
2. All six stage-execution paths append a valid JSONL line with verified `_hash` to `.foundry/attestations/<run-id>.jsonl`
3. All executors in the same run append to the same file (the run ID survives across executor invocations)
4. `hashAttestation` is deterministic: same input → same hash every time
5. `sealCycleAttestation` reads the run's jsonl, verifies each line's hash, builds a `CycleAttestation`, and appends the cycle line — sealing the run
6. `foundry_attestation_show` returns contents of a run's jsonl; lists runs when no `run_id` given
7. `foundry_attestation_verify` re-verifies all hashes and the cycle line's embedded records
8. `foundry_attest` is removed from tool registration and agent permissions
9. `src/scripts/lib/attestation/payload.js` and `src/scripts/lib/attestation/attest.js` are deleted
10. No file in the repository references `ATTEST.md` as a file path
11. `pnpm run build:all` passes — lint, all tests, and build succeed
12. Existing attestation tests (stage-payload, cycle-payload) continue to pass unchanged
13. A test exercises a full cycle (assay → forge → quench → appraise) and verifies the run file contains one line per stage plus a cycle line, all with valid `_hash`
14. Tampering detection: a modified jsonl line whose `_hash` was not updated is flagged by `sealCycleAttestation` and `foundry_attestation_verify`
15. The merge commit message after a cycle contains `foundry-run: <run-id>` and `attestation-seal: <_hash>` in its body
16. The attestation file (`.foundry/attestations/<run-id>.jsonl`) is committed in the same merge commit as the artefact changes
17. A partial run (abandoned, no stages completed) seals with `composite_status: "incomplete"`
18. `foundry_git_finish` blocks the merge if the HEAD commit body lacks `foundry-run` and `attestation-seal` fields
19. `foundry_git_finish` uses the HEAD commit body (carrying the seal metadata) as the merge commit message

## Open Questions

None.
