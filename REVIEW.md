# Dry-run Post-Release Review

## Findings

1. **`enforceForgeStage` missing `cwd` parameter.** `enforceForgeStage` at `src/scripts/orchestrate.js:213` calls `computeArtefactVersion('foundry', fgResult.outputType, io)` without the `cwd` worktree parameter. `captureForgeContext` (the `preVersion` equivalent) passes `args.cwd` correctly. This asymmetry means `preVersion` is hashed from the worktree root (correct) while `postVersion` is hashed from the `foundry/` config directory (wrong). Config directory has no artefact files, so `expandPatterns` returns `[]` and `postVersion` is the empty-input SHA. The contract check then sees "version unchanged but items actioned" and fails repeatedly, creating an infinite forge loop.

2. **`changedFiles` always empty in forge history entries.** `finaliseStage` at `src/scripts/orchestrate-phases.js:289` calls `finalize()` which runs a git diff in `finalizeStage` (src/scripts/lib/finalize.js) and returns `{ ok, artefacts, changedFiles, artefact_version }`. But `writeHistoryEntries` at line 309 uses `ctx.lastStage.changedFiles` (from the forge subagent's `writeLastStage`, which never sets it) instead of `finalizeResult.changedFiles`. Every forge history entry ends up with `changed_files: []`.

## Summary

2 items across 1 review (post-release dry-run analysis).
