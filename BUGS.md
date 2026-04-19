# Bugs from haiku flow test run (session-ses_2604)

- [x] **BUG-1: `foundry_config_validation` returns empty array.** The validation.md file exists with proper `Command:` entries but the tool returns `[]`. Root cause likely in `scripts/lib/config.js` `getValidation()` parser. This caused the quench stage to skip all validation.

- [x] **BUG-2: `foundry_artefacts_add` fails with "Artefacts table not found".** The workfile doesn't have the expected artefacts section, or the parser can't find it. Artefact tracking is completely broken.

- [x] **BUG-3: `foundry_sort` returns bare `forge` instead of `forge:write-haiku`.** Stage aliases aren't being applied. Commit messages lose the `[cycle] base:alias:` format. Root cause likely in `scripts/sort.js` route generation.

- [x] **BUG-4: Sort returns `done` after first iteration despite open feedback.** Appraisers flagged issues on `vivid-imagery` and `bold-risk-taking-style` but sort skipped the revision loop entirely. The iteration/feedback check logic in sort is broken or feedback state isn't being read correctly.

- [x] **BUG-5: `foundry_workfile_create` stages don't use aliases.** The flow skill passed `["forge", "quench", "appraise"]` instead of aliased names. Both `foundry_workfile_create` (BUG-3) and `foundry_workfile_set` now auto-enrich bare stage names via `enrichStages()`. Cycle skill updated to mention alias format.

- [x] **BUG-6: Validation scripts use `require()` but project has `"type": "module"`.** Not a code bug — skill instruction issue. Updated `add-artefact-type` skill to check project module format and advise on `.mjs`/`.cjs` extensions.

# Bugs from haiku flow test run (session-ses_2602)

- [x] **BUG-7: `foundry_workfile_set` stores stages as plain string.** LLM called `foundry_workfile_set` with `value: "forge:write-haiku, quench:check-haiku, ..."` — a comma-separated string, not JSON. The JSON parse falls through to the catch block, storing the raw string. `runSort` then rejects it: `!Array.isArray(stages)` → `"No stages in WORK.md frontmatter"`. Fix: parse comma-separated strings as arrays in `foundry_workfile_set` when `key === "stages"`.

- [x] **BUG-8: `models` field silently becomes `{}` when LLM passes non-JSON string.** LLM passed `models: "forge: github-copilot/claude-sonnet-4.6, quench: ..."` — human-readable key-value string, not JSON. `JSON.parse` fails, catch sets `fm.models = {}`. Model routing silently broken. Fix: parse `"key: value, key: value"` format into an object, or throw a clear error.

- [ ] **BUG-9: Sort stuck returning `forge:write-haiku` after artefact already created.** After the forge subagent created the haiku and registered the artefact, `foundry_sort` returned `forge:write-haiku` three times in a row. The AI had to manually advance to quench. Root cause: `determineRoute()` returns `stages[0]` (forge) when `lastBase === null`, meaning no non-sort history entries were found for this cycle. The forge subagent likely didn't record a history entry, or the history wasn't committed/visible to sort.

- [ ] **BUG-10: `getValidation()` doesn't strip backticks from `Command:` lines.** The `add-artefact-type` skill allows `Command: \`node ...\`` with markdown backticks. `getValidation()` captures the backtick-wrapped value verbatim. The shell interprets backticks as command substitution, producing `/bin/sh: PASS:: command not found`. Fix: strip surrounding backticks in the parser.
