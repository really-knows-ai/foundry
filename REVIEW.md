# Token Mechanism Review

File-based dispatch token replaced raw token-in-prompt. The token now travels via
`.foundry/dispatch-token` instead of being embedded in the dispatch prompt text.
`foundry_stage_begin` reads from the file; `foundry_stage_end` deletes it.

---

## Token lifecycle by stage

| Stage | Writes token file | Reads token file | Deletes token file |
|-------|-------------------|------------------|--------------------|
| Forge | `orchestrate-phases.js:55` (`buildDispatchAction`) | `stage-tools.js:37-42` (`beginTokenStage` via `readDispatchToken`) | `stage-tools.js:191-192` (`executeStageEnd`) |
| Human-appraise | `orchestrate-terminals.js:45` (`humanAppraiseAction`) | Same | Same |
| Appraise (dispatch_multi) | N/A — uses `writeStageRecord` directly, no `stage_begin` | N/A | N/A |
| Quench | N/A — inline | N/A | N/A |
| Assay | Delegates to forge, same path as forge | Same | Same |

---

## Findings

### 1. Redundant token in human_appraise response (minor)

`orchestrate-terminals.js:48` — The response object includes `token: "..."`. With file-based tokens, this field is dead weight. The caller no longer needs it; `stage_begin` reads from disk.

**Recommendation:** Remove `token` from the response object. The single test checking `typeof r3.token === 'string'` (`orchestrate-appraise.integration.test.js:658`) will need updating.

### 2. No cleanup on `stage_begin` failure (minor)

If `beginTokenStage` fails after reading the token file — bad token, active stage already present, git rev-parse fails — the file persists on disk. It is overwritten on the next dispatch, so there is no accumulation, but a stale file sits in `.foundry/` until then.

**Recommendation:** Acceptable as-is. `stage_end` always cleans up on the happy path. A failure during begin means the stage never opened, and the orchestrator will mint a fresh token when asked. The file size is negligible.

### 3. Stale token after nonce expiry (minor)

If a token expires before `stage_begin` is called (10-minute window), the file stays. The next dispatch overwrites it.

**Recommendation:** Acceptable. The expiry handling is correct — `stage_begin` returns an actionable error telling the caller to get a fresh dispatch. The file is harmless.

### 4. Race conditions (none found)

The orchestrator mints one dispatch at a time and waits for `lastResult` before producing the next. Two dispatches cannot overlap. Dispatch_multi (appraise) bypasses the token file entirely, so concurrent appraisers do not interact with it.

### 5. Token/nonce consistency (sound)

The nonce is consumed from the in-memory pending store **after** token verification succeeds (`beginTokenStage` in `stage-tools.js`). If token verification fails, the nonce is preserved. Git HEAD failure also precedes nonce consumption, so the retry-on-commit test (`stage-tools.e2e.test.js:95-130`) verifies this works correctly.

### 6. Agent binding enforcement (still working)

`checkTokenAgentBinding` in `stage-forge-helpers.js:35-43` prevents the Foundry agent from calling `stage_begin` with a model-scoped token. The enforcement reads the token payload from the file (same as before, just via disk instead of args), so the guard is unchanged. The error message correctly directs the agent to dispatch via `task()`.

### 7. Dispatch prompt instructions (accurate)

`orchestrate-cycle.js:285-307` — The prompt now says:
```
Your FIRST tool call MUST be foundry_stage_begin({stage: "forge:...", cycle: "..."}).
```
No token mentioned. The subagent just calls `stage_begin` with stage and cycle. The token is already on disk. This eliminates the LLM copy-paste error that caused `bad_signature` in the original dry-run trace.

---

## Verdict

The file-based mechanism is sound. No bugs. Two minor cleanup items (redundant response field, stale file on failure) are cosmetic and can be addressed later.
