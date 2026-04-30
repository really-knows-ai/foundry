# Documentation Review — Pre-Release Checklist

Generated: 2026-04-28
Baseline: working tree clean, on `main`, 155 commits ahead of `origin/main`,
`package.json` version `2.6.0`, all tests passing.

This file is intentionally untracked. Findings come from a 4-auditor parallel
sweep covering README + CHANGELOG, `docs/tools.md`, `docs/{concepts,getting-started,work-spec,memory-maintenance}.md`,
and all 26 `skills/*/SKILL.md` files, cross-referenced against the codebase.

## How to use

- One fix per commit. No bundling unrelated changes.
- Tackle items roughly in checklist order — earlier items are higher impact / more
  user-facing. Skip-ahead if a later item is in your way.
- For each item: verify the cited code is still ground truth before editing,
  make the change, run `npm test` to confirm baseline holds.
- Test-count contract: doc-only items must keep `npm test` count unchanged.
  Code-changing items (only #1 below) may add tests.
- Real bugs discovered while working an item go in "Follow-ups Found During
  Review Work" at the bottom — don't expand the current item's scope.

## Severity

- **P0** — factually wrong, will break a user/agent following the doc
- **P1** — stale or major omission with a workaround
- **P2** — clarity / consistency issue, not breaking
- **P3** — typo / formatting / wording

---

## A. Assay feedback misimplementation — remove feedback path from assay

**Resolution chosen: assay does not create feedback items. Extractor failure marks
the workfile failed, equivalent to memory-sync failure.**

### Why the current implementation is wrong

Assay was retrofitted with feedback-writing (`assay-tools.js:59-82`) by analogy
with quench, but the analogy doesn't hold:

1. **No artefact exists yet.** Assay runs at iteration 0, before the first forge.
   Feedback items are instructions to forge to revise an artefact. There is
   nothing for forge to revise.
2. **Forge cannot fix the underlying problem.** Extractor scripts live under
   `foundry/memory/extractors/` and are project-authored CLIs — outside any
   artefact's `file-patterns`, outside forge's allowed write scope. The only
   way to fix a broken extractor is for a human to edit the script.
3. **The state machine is unsatisfiable for assay-sourced items.**
   `feedback-transitions.js:29` `SOURCE_STAGES` excludes `assay`, so
   `actioned`/`wont-fix` items can never reach `resolved`/`rejected`. And per
   `work-spec.md:118`, forge `must actioned` (not `wont-fix`) assay-sourced
   items — but forge can't actually fix them, so the loop runs forever or
   blocks at max-iterations.
4. **Doc/code contradiction.** `concepts.md:55` says assay failure
   "marks the cycle blocked"; the code does not call `markWorkfileFailed` and
   does not block. Sort's routing (`sort.js:78`) doesn't even consider
   assay-sourced feedback — after assay it routes straight to forge regardless.
5. **Internal inconsistency in assay-tools itself.** Memory-sync failure
   (`assay-tools.js:50-58`) correctly calls `markWorkfileFailed` + returns
   `flow_failed: true`. Extractor failure (a sibling deterministic
   infrastructure failure) goes through the feedback path instead. Same root
   cause, opposite handling.

### Plan

Tackle in this order. Each numbered step is one commit. TDD for code changes.

1. **Code: remove feedback-writing from assay-tools, mark workfile failed instead.**
   - File: `.opencode/plugins/foundry-tools/assay-tools.js`
   - In the abort branch (currently lines 59-82), replace feedback-store call
     with `markWorkfileFailed(io, msg)` and return
     `{error: msg, flow_failed: true, aborted: true, failedExtractor, reason, stderr, perExtractor}`.
   - Drop the `openFeedbackStore` and `parseFrontmatter` imports if no longer
     used.
   - Tests (RED first):
     - Delete the three obsolete tests in `tests/plugin/assay-tools.test.js`:
       "aborts on extractor non-zero exit and writes validation feedback…",
       "logs and preserves abort result when WORK.md has no cycle for
       validation feedback", "logs and preserves abort result when validation
       feedback write fails".
     - Add: extractor abort calls `markWorkfileFailed` and the workfile
       reflects `status: failed`.
     - Add: extractor abort returns `flow_failed: true` and a non-empty `error`.
     - Add: extractor abort writes no `WORK.feedback.yaml` items.
     - Add: subsequent mutating tools refuse to run after the abort
       (sanity check that the failed-flow guard kicks in).

2. **Code: remove `'assay'` from valid source bases.**
   - File: `scripts/lib/feedback-store.js:8` — drop `'assay'` from
     `VALID_SOURCE_BASES`.
   - Update error message at line 67 to match.
   - Tests: any existing test that asserts assay can be a source must be
     updated/deleted.

3. **Code: remove the assay clause from feedback-tools.**
   - File: `.opencode/plugins/foundry-tools/feedback-tools.js:56` — remove the
     `if (stageBase === 'assay' && args.tag !== 'validation')` clause and
     ensure assay is rejected as a stage that may call `foundry_feedback_add`
     (it should fall through to the existing rejection for unsupported
     stages).
   - Tests: assert `foundry_feedback_add` from an active assay stage is
     rejected with a clear error.

4. **Docs: rewrite `docs/concepts.md` assay section.**
   - Line 55: change "writes a validation-tagged feedback item to
     `WORK.feedback.yaml`" to "marks the workfile failed and aborts the
     cycle. The user must fix the extractor and start a new cycle."
   - Lines 222-229: update the abort-conditions list to reflect that all of
     these mark the workfile failed (no feedback item).

5. **Docs: drop assay from work-spec.md feedback sections.**
   - Line 87: drop `assay` from "`source` bases include …".
   - Line 106 (state-machine table header): drop `assay /` from the
     source-stage column header.
   - Line 118: drop `assay` from the forge `wont-fix` scope rule (now only
     `quench` and `human-appraise`).
   - Line 129: drop `assay` from the `foundry_feedback_add` callers list.
   - Line 150: drop `assay` from the WORK.feedback.yaml writers row.

6. **Docs: rewrite `skills/assay/SKILL.md` failure paragraph.**
   - Line 11: rewrite to describe the new behaviour. On any failure,
     `foundry_assay_run` calls `markWorkfileFailed` and returns
     `{error, flow_failed: true, ...}`. The skill should still call
     `foundry_stage_end` cleanly, but with a summary describing the failure.
   - Line 46: update the abort return shape.
   - Lines 56, 62-66: simplify the "do not call feedback_add" notes — the
     extractor failure path no longer involves feedback at all.

### Test-count contract

This is a code-changing item; the test count will shift. Net: ~3 deleted
assay-feedback tests, ~4 new assertions on the failed-flow path. Record the
new baseline in this file when done.

**Progress:**
- [x] Step 1 — assay-tools.js abort branch + tests + assay-e2e test (commit `0e8b248`).
- [x] Step 2 — drop `'assay'` from `VALID_SOURCE_BASES` (commit `5dd69e8`).
- [x] Step 3 — explicit `assay` reject in `foundry_feedback_add` (commit `08934a8`).
- [x] Step 4 — `docs/concepts.md` failure semantics (commit `b1d659b`).
- [x] Step 5 — `docs/work-spec.md` feedback sections (commit `2c82047`).
- [x] Step 6 — `skills/assay/SKILL.md` failure paragraph + return shapes (commit `00860d6`).

**New baseline: 835 tests passing** (was 834: -3 deleted feedback-write tests, +2 failed-flow tests in `assay-tools.test.js`, +1 reject-assay-source test in `feedback-store.test.js`, +1 assay-feedback-rejected test in `preconditions.test.js`; assay-e2e test rewritten in place).

### Knock-on effects on later REVIEW items

- **B7** (`work-spec.md:108-109` state-machine table cells) — still applies,
  but row labels also need pruning (no more `assay` column).
- **B8** unaffected.

---

## B. Pre-release: P0 / P1 documentation drift

### Cycle frontmatter `output:` → `output-type:` rename (was missed in a few files)

- [x] **B1. README cycle example uses old `output:` key.** README.md:142 shows a
  cycle frontmatter example with `output:`; canonical key is `output-type:` since
  v2.7.0 (commit `b92f866`, also documented in `skills/upgrade-foundry/SKILL.md:165-205`).
- [x] **B2. `add-cycle/SKILL.md:36` prose says establish `output`.** Frontmatter
  draft at line 115 correctly uses `output-type:` — the prose label needs to match.
  Risk: an LLM following the prose may write `output:` into the YAML and trip the
  v2.7 schema-key diagnostic. (Also fixed line 75, same drift pattern.)
- [x] **B3. `add-artefact-type/SKILL.md:32` prose says establish `output`.**
  Frontmatter at line 78 correctly uses `output-dir:`. Same prose-vs-YAML drift
  pattern as B2. **Resolved by dropping the field entirely** — investigation
  found `output-dir` has zero runtime consumers (forge's write scope is
  `file-patterns`, see `scripts/lib/finalize.js:42-66`, `scripts/sort.js:183-197`),
  and `file-patterns` legitimately spans multiple directories so a single
  `output-dir` cannot honestly describe location. Commit removes the field
  from the SKILL template, drops it from `docs/getting-started.md:62`, and
  rewrites the `skills/upgrade-foundry/SKILL.md` v2.7.0 section to delete
  (rather than rename) the inert `output:` line on artefact-type definitions.
  Test comment block in `tests/output-key-rename.test.js` updated. No code
  changes; baseline 835 tests still passing.

### Failed-flow guard expansion not reflected in user docs

- [x] **B4. README failed-flow blocked-tools list incomplete.** README.md:231 lists
  blocked tools but omits `foundry_validate_run` and the 11 mutating memory admin
  tools (`foundry_memory_init`, `_reset`, `_vacuum`, `_change_embedding_model`,
  `_create_entity_type`, `_create_edge_type`, `_rename_*`, `_drop_*`, plus
  `foundry_extractor_create`). Ground truth: `validate-tools.js:29` and
  `memory-admin-tools.js:38` both call `requireNotFailed`.
- [x] **B5. CHANGELOG unreleased section omits ~9 shipped changes.**
  CHANGELOG.md:3-7. Missing entries for: failed-flow guard on `foundry_validate_run`
  (`1e58f8f`), failed-flow guard on 11 memory admin tools (`5a8f150`),
  `foundry_memory_dump` JSON envelope (`b9b4be1`), `foundry_git_branch` JSON error
  envelope (`4a01a9d`), cycle `output:` → `output-type:` rename (`b92f866` —
  **breaking**, requires migration note), `wont-fix` dropped from
  `HUMAN_OVERRIDE_TARGETS` (`3fdbb89` — behavioural change), `getLaws` signature
  refactor (`e65a12c`), `requireNotFailed` moved inside try/catch (`fc3340e`),
  missing artefact-type now typed finalize error (`cd028eb`), and the
  `new-feedback/` planning-tree deletion (`21af160`).
  **Resolution:** rewrote the unreleased section as Breaking / Added /
  Changed / Fixed / Migration. Included the assay-no-longer-files-feedback
  behavioural change as a third BREAKING entry (covers F5/F6 and the
  `0e8b248` + `5dd69e8` + `08934a8` triplet). Folded `88aad11` into the
  artefact-type migration note (the field is dropped, not renamed). Skipped
  internal-only commits: `3fdbb89` (public surface unchanged), `e65a12c`
  (internal helper refactor), `21af160` (repo hygiene, planning tree).

### Release readiness

- [ ] **B6. Bump `package.json` version.** Currently `2.6.0`. The work since
  the v2.6.0 tag includes a breaking config-key rename (`output-type:`) and
  several behavioural changes — bump to `2.7.0` minimum, or `3.0.0` if you
  treat the cycle-frontmatter rename as a major break. Cross-check with
  `skills/upgrade-foundry/SKILL.md:96` which already anticipates v2.7.0.
  **Deferred to end of REVIEW pass: bump to 3.0.0 immediately before
  tagging the release.**

### State-machine documentation drift

- [x] **B7. `work-spec.md:108-109` state-machine table cells are wrong.** Table
  claims `open` → human-appraise → `{actioned, wont-fix}` and `rejected` →
  human-appraise → `{actioned, wont-fix}`. Per `feedback-transitions.js:31-82`
  and `feedback-store.js:120-128`, human-appraise on a non-deadlocked item
  follows the source-stage path: requires `currentState ∈ {actioned, wont-fix}`
  and target ∈ `{resolved, rejected}`. Cells should be `—` (or, depending on
  decision A above, restated to mention deadlock override only).
  **Resolution:** replaced the two cells with `—`. Override authority means
  resolve/reject items regardless of `item.source` and escape from
  `deadlocked` — it does not grant forge-style transitions. Rows 110-112 are
  already consistent with code (post-`3fdbb89` `HUMAN_OVERRIDE_TARGETS =
  {resolved, rejected}`).
- [x] **B8. `concepts.md:241` edge-readability rule contradicts code.** Doc
  said edges are readable iff either endpoint type is **readable**. Code
  (`scripts/lib/memory/permissions.js:23-30`, `checkEdgeRead`) returns true if
  either endpoint is in `read` **or `write`**. `getting-started.md:227` already
  has the correct rule; concepts.md is the outlier.
  **Resolution:** rewrote concepts.md:241 to mirror getting-started.md:226 —
  "an edge is readable if either endpoint type is in `read` or `write`,
  writable if either endpoint type is in `write`." No code changes; baseline
  835 tests still passing.
- [x] **B9. `concepts.md:226-241` missing the "write ⊄ read" entity rule.**
  `getting-started.md:226` documents that types in `write` only are not readable
  and that users must list types in both lists if they need both. `concepts.md`'s
  permissions section silently omits this. Add the rule with a one-line warning.
  **Resolution:** added a sentence to `concepts.md:241` stating entity reads
  check the `read` set only and listing a type in both lists is required to
  get both permissions. Sentence sits before the existing edge derivation
  rule. No code changes; baseline 835 tests still passing.

### `foundry_stage_finalize` is not a public tool — skills should stop naming it

- [x] **B10. `skills/forge/SKILL.md` references `foundry_stage_finalize` 3×.**
  Lines 22, 100, 116. The actual public tool that runs the disk scan / artefact
  registration is `foundry_stage_end` (per `docs/tools.md:154-168`); the
  "finalize" bridge is internal to `foundry_orchestrate` and is not callable.
  Replace each occurrence with `foundry_stage_end` or "the orchestrator's
  finalize step".
- [x] **B11. `skills/quench/SKILL.md:24` references `foundry_stage_finalize`.**
  Same fix as B10.
- [x] **B12. `skills/appraise/SKILL.md:24,169` references `foundry_stage_finalize`.**
  Same fix as B10.
- [x] **B13. `docs/concepts.md:42` lists `foundry_stage_finalize` in the
  user-facing stage lifecycle.** Stage-lifecycle prose should drop the third
  name or qualify it as "internal to `foundry_orchestrate`" per
  `README.md:449` (which correctly identifies it as deregistered in v2.3).
  **Resolution (B10–B13):** verification confirmed that none of these sites
  could be a clean rename to `foundry_stage_end` — every reference
  describes the genuine internal finalize step that runs *after* `stage_end`
  (disk scan, artefact registration, unexpected-files violation), which is
  distinct from `stage_end` itself. All 7 occurrences across the 4 files
  rewritten as "the orchestrator's internal finalize step" (with `concepts.md`
  reframed to bracket the lifecycle by `stage_begin`/`stage_end` and name the
  finalize step as internal to `foundry_orchestrate`). No code changes;
  baseline 835 tests still passing.

### "Sort" is no longer a live component — skills should stop framing it as one

- [~] **B14. `skills/flow/SKILL.md:50` references "sort returns `done`".** Per
  `skills/orchestrate/SKILL.md:58-64`, `done` is returned by `foundry_orchestrate`.
- [~] **B15. `skills/forge/SKILL.md:100` references `sort`'s `checkModifiedFiles`.**
  Sort.js is gone since v2.3.0 (`upgrade-foundry/SKILL.md:256`).
- [~] **B16. `skills/appraise/SKILL.md:101,122` references "sort routes" /
  "before sort routes".** Replace with "orchestrate routes".
- [~] **B17. `skills/human-appraise/SKILL.md` references sort 8×.** Lines 75,
  80, 89, 98, 101, 122, 140, 142. Most are "sort routing", "sort writes
  deadlocked state", "sort marks blocked". Replace with `foundry_orchestrate`
  / "the orchestrator". Behavior described is correct; only the responsible
  component name is wrong.
  **Resolution (B14–B17): WON'T FIX, premise rejected.** Initial commit
  `e4ee4c5` rewrote 12 occurrences as "the orchestrator", reverted in
  `a588d76`. Rationale: 'sort' is a first-class conceptual component in the
  broader platform foundry is an entry point to. The pattern is
  (assay → forge → quench → appraise) → sort, with sort at the centre as
  the routing/deadlock/blocking layer. Even though sort is currently
  bundled inside `foundry_orchestrate`, the nomenclature must be preserved
  for platform alignment. The original prose was correct — sort routes
  between stages, sort writes deadlocked state, sort marks artefacts
  blocked. The original REVIEW item misread an architectural concept as a
  v2.3 implementation-detail leak. Knock-on: review later items (C8,
  D7, D8, E39) for the same misframing before acting.

### Memory git-add commands stage non-existent files

- [ ] **B18. `add-memory-entity-type/SKILL.md:42` `git add` includes
  `foundry/memory/relations/<name>.ndjson`.** Per `memory-admin-tools.js`,
  `foundry_memory_create_entity_type` writes only the entity-type markdown
  + schema; it does **not** create a relations NDJSON file. The `git add`
  command will fail with "pathspec did not match any files" because the
  relations file only exists once rows are written. Drop the relations path.
- [ ] **B19. `add-memory-edge-type/SKILL.md:22` same issue for edges.** Same
  fix: drop `relations/<name>.ndjson` from the `git add` command.

### Other

- [ ] **B20. README `scripts/lib/` tree is stale.** README.md:489-504 lists
  `feedback.js` (deleted in 2.6.0 per CHANGELOG line 45) and `tags.js` (does
  not exist). Missing the actual files: `failed-flow.js`, `git-bridge.js`,
  `git-policy.js`, `ulid.js`, `feedback-store.js`. Verify the current tree
  with `ls scripts/lib/*.js` before editing.
- [ ] **B21. `human-appraise/SKILL.md:4` description uses `#human` (hashtag).**
  Per `docs/tools.md:324`, the tag is the bare string `human`. Body of the
  skill (lines 74-76) is correct; only the YAML description is wrong.

---

## C. Optional pre-release polish (P2 / selected)

These are not release blockers. Pull any in if you want a higher-quality
release; otherwise defer to the next pass.

- [ ] **C1. `docs/tools.md:28-31` "every mutating tool refuses on failed
  flow" overclaims.** `foundry_git_branch` and `foundry_git_finish` are
  mutating but ungated. Either narrow the preamble or list the git-tool
  exceptions explicitly. Verify against `git-tools.js:18-34, 44-138`.
- [ ] **C2. `docs/tools.md:32-36` read-only diagnostics list is curated, not
  exhaustive.** Other un-gated read-only tools include
  `foundry_artefacts_list`, `foundry_feedback_list`, `foundry_history_list`,
  all `foundry_config_*`, `foundry_appraisers_select`. Either complete the
  list or label it explicitly as illustrative.
- [ ] **C3. `docs/tools.md:556` (`foundry_git_branch`) and `:587`
  (`foundry_git_finish`) have no failed-flow annotation.** Given the C1
  preamble overclaim, these entries should explicitly state "Not gated on
  failed flow" so the doc is internally consistent.
- [ ] **C4. `docs/tools.md:898-903` "Follow-ups / inconsistencies spotted"
  section is now stale framing.** The only remaining item is the
  `foundry_orchestrate` `violation` envelope, which is documented and
  intentional (`tools.md:188-189`). Either delete the section or rename to
  "Design exceptions".
- [ ] **C5. `docs/memory-maintenance.md` does not mention failed-flow guards
  on memory admin tools.** Contributor-facing maintenance doc; add a one-line
  note that all mutating admin tools refuse to run on a failed workfile.
- [ ] **C6. CHANGELOG.md:7 references `REVIEW.md P0 #3`.** No `REVIEW.md`
  ships with the package; this internal-planning reference is unhelpful in a
  public CHANGELOG. Drop or rephrase.
- [ ] **C7. `docs/concepts.md:138` links to `README.md#custom-tools`.**
  `docs/tools.md` is now the canonical tool reference; relink.
- [ ] **C8. `docs/concepts.md:95` attributes `WORK.history.yaml` reads to
  the "sort" subsystem.** Same v2.3 sort-removal drift as the skills above.
- [ ] **C9. `skills/upgrade-foundry/SKILL.md` target version is v2.7.0 but
  installed package is v2.6.0.** Either bump the package (B6) so they
  match, or add a note in the skill header that it anticipates v2.7.

---

## D. P3 nits (skip unless trivially adjacent to other work)

- [ ] **D1. `package.json:4` description.** Says "structured framework"
  while README hero says "skill-driven framework for governed artefact
  generation". Cosmetic alignment.
- [ ] **D2. `docs/tools.md:182-189` `foundry_orchestrate` return-shape**
  doesn't mention that the `prompt` field may be augmented with cycle memory
  context (`orchestrate-tool.js:114-121`). One-line note.
- [ ] **D3. `docs/tools.md:233-234` `foundry_workfile_get` return shape**
  uses `{...fm, goal}` spread — could collide with an `error` key in
  frontmatter. Edge case worth a sentence.
- [ ] **D4. `getting-started.md:174` "three places" but lists four
  bullets.** Off-by-one in prose.
- [ ] **D5. `skills/init-foundry/SKILL.md` step 5 doesn't cross-reference
  `init-memory`.** Discovery hint.
- [ ] **D6. `skills/assay/SKILL.md:26` "return to step 5 with an error
  summary" reads ambiguously.** Step 5 is "End the stage" — phrasing makes
  it sound like an error handler.
- [ ] **D7. `.opencode/plugins/foundry-tools/stage-tools.js:13,17` tool
  description still references the deleted `foundry_sort`.** Source-side
  cleanup; minor user-visible drift via tool descriptions.
- [ ] **D8. `.opencode/plugins/foundry-tools/orchestrate-tool.js:38,66` and
  `artefact-tools.js:11` have stale comments mentioning
  `foundry_stage_finalize` / `foundry_sort`.** Source-side cleanup.

---

## Suggested commit grouping

Each line below is one commit. Items can be reordered.

1. **`docs(README): fix cycle frontmatter example to use output-type`** — B1
2. **`docs(skills): fix output-type/output-dir prose drift in add-cycle and add-artefact-type`** — B2 + B3 (single themed commit, two adjacent files)
3. **`docs(skills): drop relations/<name>.ndjson from create-type git-add commands`** — B18 + B19
4. **`docs(skills): replace foundry_stage_finalize references with foundry_stage_end`** — B10 + B11 + B12 + B13
5. **`docs(skills): replace stale 'sort' framing with foundry_orchestrate in stage skills`** — B14 + B15 + B16 + B17
6. **`docs(skill): use bare 'human' tag in human-appraise YAML description`** — B21
7. **`docs(README): refresh failed-flow blocked-tools list`** — B4
8. **`docs(README): fix scripts/lib tree listing`** — B20
9. **`docs(work-spec): fix human-appraise state-machine cells for non-deadlocked items`** — B7
10. **`docs(concepts): fix edge readability rule and document write⊄read entity rule`** — B8 + B9
11. **`fix(feedback)` or `docs(work-spec)`** — A1 (depending on which way it goes)
12. **`docs(changelog): record all unreleased changes through HEAD`** — B5
13. **`chore(release): bump version to 2.7.0` (or 3.0.0)** — B6
14. *(optional)* C1-C9 as one or two thematic doc-polish commits.

---

## Verification at end of each commit

```bash
npm test         # 834 tests passing, 0 failing
git status       # clean working tree
```

Both must hold before moving to the next item. The state-machine code path
(item A1 / B7) is the only one that may shift the test count — record the
new baseline in this file if so.

---

## Follow-ups Found During Review Work

Stale references to assay-feedback behaviour discovered while completing
item A. These are now factually wrong and should be cleaned up alongside
the existing related REVIEW items where they overlap, or as a small
dedicated commit otherwise:

- **F1. `docs/tools.md:324`** still lists `assay → tag must be exactly validation` in the `foundry_feedback_add` per-stage rule table. Assay is now rejected outright; remove the row.
- **F2. `README.md:223`** ("Stage write scopes" table, assay row) says assay writes `WORK.feedback.yaml for #validation feedback on abort`. Drop the feedback clause; assay only writes flow memory.
- **F3. `README.md:266`** says forge cannot wont-fix items whose source base is `assay`, quench, or human-appraise. Drop `assay` — it is no longer a possible source base. (Adjacent to B7 doc-drift cleanup.)
- **F4. `README.md:435`** ("Stages" reference table, Assay row) says `foundry_assay_run` writes `#validation feedback on abort`. Replace with "marks the workfile failed on abort". (Should be folded into B4 or done as part of the same README pass.)
- **F5. `CHANGELOG.md:7`** unreleased entry's tool-list mentions `feedback_*` as blocked but elsewhere refers to the old assay-validation-feedback path. Cross-check during B5 (CHANGELOG rewrite). Item itself is correct on the failed-flow guard, but the historical context note may need a one-liner: "assay no longer files validation feedback; extractor abort marks the workfile failed (replaces 2.6-era validation-feedback path)".
- **F6. `CHANGELOG.md:73`** (the v2.6.0 "Assay stage" entry) describes the original behaviour — extractor failure aborting the cycle with `#validation` feedback. That ships in v2.6 and is historically accurate, but the next release will change it. The 2.7 entry must explicitly call out "BREAKING: assay extractor failure now marks the workfile failed instead of filing a validation feedback item" so anyone migrating mid-cycle understands. Add this to the B5 changelog rewrite scope.
- **F7. `skills/add-extractor/SKILL.md`** — checked: clean. No assay-feedback references.

(Empty otherwise. Add real bugs discovered while working a checklist
item here, with references — do not expand the active item's scope.)

---

## E. Voice review — define affirmatively, use British spelling

Generated: 2026-04-28 from a 4-auditor parallel sweep covering README +
CHANGELOG, `docs/*.md`, all 26 `skills/*/SKILL.md`,
`.opencode/plugins/foundry-tools/*.js` (comments + tool description
strings), and `scripts/lib/**/*.js` (comments + module banners).

Two rules being enforced:

1. **Define things on their own terms.** Affirmative, confident, direct.
   Drop "X is not Y, it is Z" / "rather than Y, X does Z" / "instead of Y" /
   "not just Y but also Z" / strawman comparisons the reader did not bring.
   When negation is the actual semantic content (constraints, guards,
   error messages, API "returns null when not found"), it stays.
2. **British English spelling.** Clear Americanisms (`behavior`,
   `color`, `defense`, `honor`, `center`, `gray`, `traveled`, etc.) get
   rewritten. `-ize` endings are acceptable Oxford spelling and stay
   unless the surrounding file is consistently `-ise`.

Severity uses the same P0/P1/P2/P3 scale as the rest of REVIEW.md.
These are mostly P2 voice/clarity issues; a handful of P1s where the
negation actively muddies an architectural definition.

### Voice — README.md (highest concentration)

The hero section (lines 10–28) and the design-principles section
(569–605) carry most of the negation pattern. One commit per cluster.

- [ ] **E1. README.md:12 opening paragraph defines Foundry by listing
  what other tools fail at.** "AI coding tools are great at producing
  work and terrible at governing it. They skip checks. They silently
  drop feedback. They rationalize past constraints…". P1. Lead with
  what Foundry positively does ("Foundry binds AI work to deterministic
  governance: every stage transition, commit, and feedback resolution
  runs through tested tool code"). The strawman framing can stay as a
  one-line closer if wanted.
- [ ] **E2. README.md:14** "the framework makes the process
  non-optional". P2. "the framework makes the process mandatory" or
  "the framework enforces the process at every step".
- [ ] **E3. README.md:18** "**Stop babysitting the agent.**" P2.
  Replace with a positive header, e.g. "**Deterministic guardrails.**
  Stage transitions, commits, write invariants, and feedback state
  live in tool code that runs the same way every time."
- [ ] **E4. README.md:19** "**Written quality criteria, not vibes.**"
  P2. Drop the strawman: "**Written quality criteria.** Laws are
  markdown…".
- [ ] **E5. README.md:27** "Foundry makes the checks **structural,
  not cultural**." P1 — flagship hero sentence. Rewrite to
  "Foundry makes the checks **structural** — embedded in tool code, so
  every commit shows exactly which quality gate produced this artefact."
- [ ] **E6. README.md:121** "Foundry follows a dependency graph, not a
  linear list." P2. "Foundry walks the dependency graph that cycles
  declare via their own `targets`."
- [ ] **E7. README.md:278** "The following guarantees are enforced in
  plugin code, not prose:". P2. Drop "not prose" — readers do not
  expect prose enforcement. "The following guarantees are enforced in
  plugin code:".
- [ ] **E8. README.md:357** "Drop tools called without `confirm: true`
  return an impact report … instead of deleting anything." P3.
  "…return an impact report; the deletion runs only when `confirm:
  true` is passed."
- [ ] **E9. README.md:359** "If memory is misconfigured or drifted,
  dispatch still succeeds with no vocabulary block rather than failing
  the cycle." P3. "…dispatch succeeds with no vocabulary block; the
  cycle continues."
- [ ] **E10. README.md:419** "Skills call these rather than
  manipulating files directly, which keeps format-parsing and state
  transitions out of LLM hands." P2. "Skills call these tools, which
  keeps format-parsing and state transitions in tested code."
- [ ] **E11. README.md:569** "the logic lives in tested plugin code
  that an LLM can't reason its way past". P2. "the logic lives in
  tested plugin code that runs deterministically on every call."
- [ ] **E12. README.md:573** "No bespoke formats, no databases."
  P3. The preceding sentence already says markdown + YAML; drop the
  negation tail.
- [ ] **E13. README.md:589** "the plugin enforces lifecycle
  transitions instead of encoding state in markdown checkboxes". P2.
  "the plugin enforces lifecycle transitions in code, with the full
  history preserved in YAML."
- [ ] **E14. README.md:597** "Human-in-the-loop gates are first-class
  stages, not afterthoughts." P2. "Human-in-the-loop gates are
  first-class stages with their own write permissions and feedback
  authority."

### Voice — docs/

- [ ] **E18. docs/concepts.md:48** "the stage plays the same role for
  a codebase: it determines what is there so forge can plan against
  reality instead of guessing." P3. "…so forge can plan against
  reality."
- [ ] **E19. docs/concepts.md:138** "Skills call these tools instead
  of manipulating files directly. … This separation ensures state
  transitions and routing logic are tested code, not LLM
  interpretation." P2. "Skills call these tools, which puts state
  transitions and routing logic in tested code."
- [ ] **E20. docs/concepts.md:257** "It is a diff-friendly artefact
  of the vocabulary, not a source of truth — regenerated by the admin
  tools." P2. "It is a diff-friendly artefact of the vocabulary,
  regenerated by the admin tools from the entity/edge files (the
  source of truth)."
- [ ] **E21. docs/memory-maintenance.md:3-4** "Contributor-facing
  notes. Not architecture; not a spec. This is the 'things that
  weren't obvious from the Cozo docs / plugin surface and cost us
  time to derive' file." P2. "Contributor-facing notes: things that
  weren't obvious from the Cozo docs / plugin surface and cost us
  time to derive."
- [ ] **E22. docs/memory-maintenance.md:57** "`::relations` returns
  not just the base relations Foundry created (`ent_class`,
  `edge_calls`) but also their index entries…". P3. "`::relations`
  returns the base relations Foundry created (`ent_class`,
  `edge_calls`) **plus** their index entries…".
- [ ] **E23. docs/work-spec.md:87** "(`assay` is not a feedback
  source — extractor failure marks the workfile failed.)" P2.
  "`source` bases are `quench`, `appraise`, and `human-appraise`.
  Extractor failures during `assay` mark the workfile failed without
  producing feedback items." (Adjacent to A.)

### Voice — skills/

- [ ] **E24. skills/forge/SKILL.md:100** "This is **not an
  honor-system rule**: …". P2 (also Americanism `honor`). "This
  rule is tool-enforced: …". Resolves the spelling issue by removal.
- [ ] **E25. skills/human-appraise/SKILL.md:116-117** "Unlike appraise
  and quench, you are NOT restricted to items whose `source` matches
  your stage id — you may resolve any such item regardless of source."
  P2. "You may resolve any such item regardless of `source` —
  human-appraise has authority over items from every source stage."

### Voice — plugin code (tool descriptions and inline comments)

These are user/agent-visible to varying degrees. Tool descriptions are
the most visible (LLMs read them every call); module banners and inline
comments are contributor-facing.

- [ ] **E26. .opencode/plugins/foundry-tools/assay-tools.js:40-43**
  "flush extractor writes to NDJSON immediately rather than deferring
  to stage_end. A stage killed before stage_end would otherwise lose
  every extractor-written row…". P3. "Defence-in-depth: flush
  extractor writes to NDJSON immediately so a stage killed before
  stage_end still preserves every extractor-written row on the next
  process start."
- [ ] **E27. .opencode/plugins/foundry-tools/orchestrate-tool.js:31-34**
  "surfaces as a violation rather than an uncaught exception". P3.
  Drop the "rather than" tail; preserve the catch-to-violation
  contract description.
- [ ] **E28. .opencode/plugins/foundry-tools/orchestrate-tool.js:82-86**
  "Surface as a typed finalize error instead of falling back to empty
  filePatterns. The fallback would let the forge-written artefact file
  resurface as a misleading 'unexpected_files' violation, hiding the
  actual cause…". P3. "Surface as a typed finalize error so the caller
  sees the actual cause (a missing or malformed artefact-type
  definition) directly, keyed off the artefact-type identifier."
- [ ] **E29. .opencode/plugins/foundry-tools/validate-tools.js:34-36**
  "passed as a single literal argument rather than evaluated by the
  shell". P3. "passed as a single literal argument to the command".
- [ ] **E30. .opencode/plugins/foundry-tools/memory-admin-tools.js:32-34**
  "we use makeIO here rather than the async makeMemoryIO that the
  admin tool bodies themselves consume". P3. "we use makeIO here;
  admin tool bodies consume the async makeMemoryIO separately."
- [ ] **E31. .opencode/plugins/foundry-tools/memory-helpers.js:25-28**
  "we fall through to unscoped behaviour rather than blocking
  unrelated direct calls". P3. "we fall through to unscoped behaviour
  so unrelated direct calls remain available."
- [ ] **E32. .opencode/plugins/foundry-tools/memory-helpers.js:57-62**
  "better to block the call than silently grant full access. When the
  caller passed `context.cycle` explicitly we preserve the historical
  behaviour…". P2. Rewrite affirmatively as a fail-closed contract
  with the explicit-cycle path documented as a trust-the-caller
  contract.
- [ ] **E33. .opencode/plugins/foundry-tools/helpers.js:106-110**
  "Call sites pass full shell strings …, so we must use execSync
  rather than execFileSync". P3. "Call sites pass full shell strings
  …, which requires execSync."
- [ ] **E34. .opencode/plugins/foundry-tools/helpers.js:76-77**
  (FOUNDRY_CONTEXT user-visible string) "Brainstorming applies to NEW
  features … It does NOT apply to running an existing, defined flow."
  P2 — this is rendered to the agent on every session start.
  Rewrite: "Brainstorming applies to NEW features being added to
  foundry itself (new cycles, new artefact types, new skills). For
  running an existing, defined flow, invoke the flow directly per the
  routing rule above."

### Voice — scripts/lib/

- [ ] **E35. scripts/lib/git-policy.js:4-15** module banner defines
  the module by extensive description of the prior `git add .` bug.
  P2. Lead with what the module does ("commits ONLY the files allowed
  by the current phase, reports a structured violation when the
  worktree contains anything else"); drop the historical "both commits
  historically used `git add .`" paragraph.
- [ ] **E36. scripts/lib/git-bridge.js:1-22** module banner opens with
  "Replaces a previous `git add . && git commit -m msg` flow that
  would silently capture …". P2. Drop the "Replaces …" paragraph;
  lead with the helper's positive contract.
- [ ] **E37. scripts/lib/git-bridge.js:52-54** "Then add ONLY the
  allowed paths explicitly via argv — never `git add .`." P3. Drop
  the "never `git add .`" tail.
- [ ] **E38. scripts/lib/feedback-transitions.js:14-19** "wont-fix is
  a forge declaration … not a reviewer verdict, so it is intentionally
  absent here". P2. "wont-fix is a forge-only declaration
  ('considered, choosing not to act') and so is intentionally absent
  from the override set."
- [ ] **E39. scripts/lib/feedback-store.js:153-155** "Sort-only…
  Not validated through validateTransition (sort bypasses the state
  machine per spec §6.1)." P3. "Sort owns deadlock per spec §6.1, so
  this path writes the snapshot directly."
- [ ] **E40. scripts/lib/memory/config.js:49-53** "would previously
  have silently disabled memory via the `=== true` check… so the user
  fixes config.md rather than debugging a phantom 'memory off'
  state." P2. "`enabled` must be a real YAML boolean: only `true` /
  `false` parse as booleans. Throw with a filename-prefixed message
  so the user can fix config.md directly."
- [ ] **E41. scripts/lib/memory/config.js:65-70** "This prevents
  validate() from enforcing baseURL/model/dimensions against a
  provider the user never configured, and prevents the init-memory
  probe from firing for a memory install that was explicitly turned
  off." P2. "That keeps validate() scoped to providers the user has
  configured, and keeps the init-memory probe scoped to memory
  installs that are turned on."
- [ ] **E42. scripts/lib/memory/cozo.js:16-20** defines the choice
  of single-quote literal via the failure mode of the double-quote
  form. P3. Lead with what single-quote literals give you; mention
  the raw form parenthetically.
- [ ] **E43. scripts/lib/assay/spawn-with-timeout.js:11-15** "We
  signal the whole group … rather than just the direct child,
  otherwise orphaned descendants …". P3. "We signal the whole group
  … so descendants are torn down too."
- [ ] **E44. scripts/lib/assay/spawn-with-timeout.js:17-19**
  "Extractors are project-authored and committed to the repo; they
  are trusted code paths, not untrusted input." P3. "Extractors are
  project-authored and committed to the repo, so they are trusted
  code paths under the project's own review."

### British spelling fixes

Clear Americanisms only. `-ize` endings stay (Oxford spelling).

- [ ] **E45. README.md:297** "Dispatch behavior:" → `behaviour`. P1
  in a doc otherwise consistent on `behaviour` / `categorisation` /
  `nearest-neighbour`.
- [ ] **E46. skills/upgrade-foundry/SKILL.md:256** "stricter \"no
  human ever\" behavior" → `behaviour`. P2.
- [ ] **E47. skills/forge/SKILL.md:100** "honor-system rule" →
  rewritten away by E24, but if any "honor" survives, use `honour`.
  P2.
- [ ] **E48. scripts/lib/finalize.js:16** "// here for
  defense-in-depth before passing the value to git." → `defence`. P3.

### Suggested commit grouping

One commit per cluster keeps each diff scoped and reviewable.

1. **`docs(README): rewrite hero + design-principles sections to lead
   affirmatively`** — E1, E2, E3, E4, E5, E11, E12, E13, E14
2. **`docs(README): tighten cycle/dispatch prose, drop strawman
   negations`** — E6, E7, E8, E9, E10
3. **`docs(README): use British 'behaviour'`** — E45
4. **`docs(concepts,memory-maintenance,work-spec): drop strawman
   framing`** — E18, E19, E20, E21, E22, E23
5. **`docs(skills): use affirmative voice in forge and human-appraise`**
   — E24, E25
6. **`docs(skills): use British 'behaviour'`** — E46 (and E47 if not
   resolved by E24)
7. **`docs(plugins): rewrite tool-description and contributor
   comments affirmatively`** — E26 through E34
8. **`docs(scripts/lib): rewrite module banners and design comments
   affirmatively`** — E35 through E44
9. **`docs(scripts/lib): use British 'defence'`** — E48

### Verification

These are doc/comment-only changes:

```bash
npm test         # 835 tests passing, 0 failing (matches A-section baseline)
git status       # clean working tree
```

No test count shift expected. If a test snapshots a tool description
string, update the snapshot in the same commit.

---

## F. Doc structure — surface the stage-role unifying principle

Currently the docs describe each stage's role in turn but never state the
*unifying principle* that ties them together. After completing the rest
of REVIEW.md, cycle back and verify the documentation lands this in one
clear place.

### The principle

The five stages have crisply separated roles:

- **assay** — populates flow memory (entities + edges). Pure knowledge
  ingestion. No artefact, no feedback. Failure marks the workfile failed.
- **forge** — creates and modifies the artefact under the cycle's
  output-type `file-patterns`. The only stage that writes artefact
  files. Resolves prior feedback (`actioned` / `wont-fix`).
- **quench** — runs deterministic CLI validators against the artefact.
  Files `validation`-tagged feedback when checks fail.
- **appraise** — subjective LLM evaluation against laws. Files
  `law:<id>`-tagged feedback.
- **human-appraise** — human review gate. Files `human`-tagged
  feedback; also has deadlock-override authority.

Feedback is always *about an artefact* and always flows backward to
forge. It is the message-passing protocol between the four stages that
observe the artefact and report problems with it. Assay populates flow
memory before any artefact exists, so it sits outside the protocol
entirely. The only thing assay can break (an extractor script under
`foundry/memory/extractors/`) lives outside the artefact's
`file-patterns`, where forge has no write permission. Extractor failure
therefore marks the workfile failed.

### Where this should land

Pick one or two homes; avoid duplication.

- [ ] **F1. `docs/concepts.md`** — top of the "Stages" section, as a
  short framing paragraph before the per-stage subsections. The most
  natural home for a unifying principle. P2.
- [ ] **F2. `README.md`** — the "Stages" reference table around
  line 435 lists tools per stage. Add a one-paragraph preamble stating
  the role-separation principle so readers building a mental model
  have a hook for the table. P2.
- [ ] **F3. `docs/work-spec.md:87`** — the feedback-state-machine
  section's source-bases sentence can lead with a one-sentence
  reminder of *why* `assay` is excluded as a source base, framing the
  rule before the table. P3. (Adjacent to E23 and to A's work-spec
  edits.)

### Verification at the end of the REVIEW pass

Read `docs/concepts.md`, `README.md`, and `docs/work-spec.md`
end-to-end with this principle in mind. Confirm:

- Assay reads as input ingestion, not artefact work.
- Feedback reads as artefact-revision instructions flowing back to forge.
- The four feedback-producing stages share one role: they observe the
  artefact and report problems with it.

One paragraph in one place is enough — the goal is to give readers a
hook for organising the per-stage detail; restating every stage's role
in another voice would bloat the docs.
