# Bugs from haiku flow test run (session-ses_2604)

- [x] **BUG-1: `foundry_config_validation` returns empty array.** The validation.md file exists with proper `Command:` entries but the tool returns `[]`. Root cause likely in `scripts/lib/config.js` `getValidation()` parser. This caused the quench stage to skip all validation.

- [x] **BUG-2: `foundry_artefacts_add` fails with "Artefacts table not found".** The workfile doesn't have the expected artefacts section, or the parser can't find it. Artefact tracking is completely broken.

- [x] **BUG-3: `foundry_sort` returns bare `forge` instead of `forge:write-haiku`.** Stage aliases aren't being applied. Commit messages lose the `[cycle] base:alias:` format. Root cause likely in `scripts/sort.js` route generation.

- [x] **BUG-4: Sort returns `done` after first iteration despite open feedback.** Appraisers flagged issues on `vivid-imagery` and `bold-risk-taking-style` but sort skipped the revision loop entirely. The iteration/feedback check logic in sort is broken or feedback state isn't being read correctly.

- [ ] **BUG-5: `foundry_workfile_create` stages don't use aliases.** The flow skill passed `["forge", "quench", "appraise"]` instead of `["forge:write-haiku", "quench:check-syllables", "appraise:evaluate-quality"]`. This feeds into BUG-3. Partially mitigated by `enrichStages()` fallback in BUG-3 fix, but needs full investigation.

- [ ] **BUG-6: Validation scripts use `require()` but project has `"type": "module"`.** The haiku validators in `foundry/artefacts/haiku/` use CommonJS `require('fs')` which will fail in ESM projects. The scripts happened to work in the test because `opencode-test` doesn't have `"type": "module"`, but this is a latent issue for ESM projects.
