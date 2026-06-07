# Review

Review of the cli-forge-dispatch implementation after code reading and dry-run testing.

## Checklist

- [ ] **Silent JSONL swallow.** `parseConsolidatedLine` in `src/scripts/appraise-module.js:128` catches JSON parse errors and returns `null` without logging. If a sub-agent is killed mid-write (e.g. by timeout) or produces malformed output, the finding is silently dropped. `parseConsolidated` at line 144 skips nulls without warning. Add a `console.warn` in the catch block to surface parse failures so lost findings aren't invisible.

- [ ] **Fragile appraise system prompt hack.** CLI dispatch lost the ability to set the `system` parameter, so the appraiser persona is wrapped in `<appraiser_instructions>` XML tags at the end of the user message to exploit recency bias. This works now but relies on the model obeying trailing XML instructions — a behavioural quirk that could break with model updates. Either accept as documented risk or explore alternatives (e.g. passing persona via agent config or environment).

- [ ] **R4 role-based tool deny lists are dead code.** `foundry.js:71-81` defines `FORGE_DENIED` and `APPRAISE_DENIED` lists with an enforcement hook, but `childSessions.set()` is never called — no production code path populates it because sub-agents are spawned as independent OS processes via `execFile`. Both forge and appraise sub-agents have access to the full plugin toolset. **Fix:** Replace the dead R4 mechanism with three opencode agents, each with permissions enforced by the opencode runtime:
  - `foundry-guide` — the current guide agent (primary, full permissions)
  - `foundry-forge` — forge subagent (edit/bash allowed, restricted tool deny list)
  - `foundry-appraise` — appraise subagent (edit: deny, bash: deny, read-only)
  
  Agent markdown files deployed by the plugin (like `foundry.md` is today). Change `spawnDispatch` to use `--agent foundry-forge` or `--agent foundry-appraise` based on stage type. Dynamic personality stays in the dispatch prompt (current approach). Remove the dead `childSessions` / R4 deny list code from `foundry.js`.
