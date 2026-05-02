# Pre-3.0.0 Release Review

Generated: 2026-04-30
Baseline: working tree clean, on `main`, 178 commits ahead of `origin/main`,
`package.json` version `3.0.0`, **1036 tests passing** across 216 suites.

This file is intentionally untracked. It supersedes the prior REVIEW.md
(commits A–F sweeps for the v2.6→v2.7 work and the assay-feedback
redesign) and adds fresh findings from a 4-auditor parallel sweep
covering Phase 1–5 work (commits `6525fc9` → `c5a236b`: guard
composition, branch guards, memory-relations relocation, schema
validators/creators, dry-run mode + tracing + snapshots).

---

## Work Plan: Grouped Items by Priority

**Current progress:** 1136 tests passing (baseline: 1036)

### Priority 1: P0 Blockers (Complete)
- [x] **G5+G6** (Orchestrate atomicity) - Commit e1c3fce, b1409f0
- [x] **G7+G8** (Context bugs) - Commit db2b859, ad61c8f
- [x] **G1+G2** (Feedback resolve bugs) - Commit 231b182
- [x] **G3** (Memory paths) - Commit bcfb425
- [x] **G4** (Git atomicity) - Commit 28f75b2

### Priority 2: P0 Feedback/Memory Bugs (Complete)
**All complete!**

### Priority 3: P0 Assay/Memory Subsystems
- [x] **Assay cluster**: G24+G25+G26+G27+G28+G29 (spawn bugs, UTF-8, OOM risk) - Commit a5c830f
- [x] **Memory cluster**: G13+G14+G15 (permissions, unbounded, live store) - Commits bab78e2, 8d6bfc8

### Priority 4: Voice/Docs Cleanup (Can batch)
- [x] **Spelling**: C13+C29 (defense→defence, behavior→behaviour) - Commit e325b30
- [x] **Voice sweep**: C14+C15+C16+C28+C30-C34+C36+C37+G38+G52 (strawman negations) - Commits adef1d9, 5bedd89, cc9d71a, 3a22a3b
- [x] **Stale tool refs**: C12+D8+D11+D12+G51 (foundry_sort, foundry_stage_finalize) - Commit f19a2bb
- [x] **Doc gaps**: C17+C19+C21-C27 (cross-refs, counts, links, trees) - Commit dd723ed
- [x] **Snapshot tooling**: C10+C11+C38-C40 - Commit 22e97ca

### Priority 5: Remaining P0s
- [x] **G9-G12** (Feedback subsystem contract issues) - Commits 586ad0b, 557443c, a3878f4, 91abb29
- [x] **G16-G23** (Memory subsystem edge cases) - Commits d4d2950, ce001a7, ef7cc95, 714c26e, 8e19ea7, 937b1ef, c2e05c5, 8017c40
- [x] **G30-G37** (Git/validation bugs) - Commits e169433, 27a8ecb, a223938, 5d893f5, 4b60e21, 329ef19, 66dc8da, 7333103

### Priority 6: D-cluster nits (P3)
- [x] **D1** (DRY_RUN_DEEPER_RE defensive guard documented) - Commit 4e39f2e
- [x] **D2** (makeExec moved to helpers.js) - Commit f13fa7f
- [x] **D3** (truncateTrace error handling) - N/A: code already correct (single defensive try/catch at git-tools.js:284-289)
- [x] **D4** (law.js JSDoc clarified) - Commit 3707dae
- [x] **D5** (lawTargetSchema workaround - added target structure example to tool description) - Commit e3028f1
- [x] **D6** (asymmetric gitignore documented in init.js) - Commit 6418a3f
- [x] **D7** (snapshots gitignored) - Folded into A16
- [x] **D8** (orchestrate skill tool references) - Folded into C12 (commit f19a2bb)
- [x] **D9** (upgrade-foundry historical references) - Folded into A16
- [x] **D10** (refresh-agents description capitalisation and British spelling) - Commit 53f4b6d
- [x] **D11** (forge skill method name) - Folded into C12 (commit f19a2bb)
- [x] **D12** (appraise skill filename leak) - Folded into C12 (commit f19a2bb)

---

## How to use

- One fix per commit. No bundling unrelated changes.
- Tackle items roughly in section order — earlier items are higher
  impact / more user-facing.
- For each item: verify the cited code is still ground truth before
  editing, make the change, run `npm test` to confirm the **1035-test**
  baseline holds.
- Doc-only items must keep `npm test` count unchanged. Code-changing
  items may add tests (record new baseline here).
- Real bugs discovered while working an item go in "Follow-ups Found
  During Review Work" at the bottom.

## Severity

- **P0** — factually wrong, breaks a user/agent following the doc, or
  tool fails at runtime
- **P1** — stale or major omission with a workaround
- **P2** — clarity / consistency issue, not breaking
- **P3** — typo / formatting / wording

---

## Background facts confirmed at HEAD

These are settled and inform the items below:

- **Public tool surface: 60 tools** registered in
  `.opencode/plugins/foundry.js`. Test snapshot at
  `tests/plugin/tool-registration.test.js` is exhaustive and
  drift-detecting.
- **Memory data layout (post-Phase 2):**
  `foundry/memory/` holds *config* — `config.md`, `schema.json`,
  `entities/<name>.md`, `edges/<name>.md`, `extractors/<name>.md`,
  and the `memory.db*` runtime files (gitignored).
  `foundry-memory/relations/<name>.ndjson` (top-level sibling of
  `foundry/`) holds *row data*. Only the relations directory moved;
  the rest of the memory tree stayed under `foundry/`. Source of
  truth: `scripts/lib/memory/paths.js:7` and
  `scripts/lib/memory/admin/init.js:24-28`.
- **Branch guards (strict):** `requireOnConfigBranch` rejects
  `dry-run/*/*` ("dry-run/<x>/<y> does not count"). Memory admin
  tools, config-create tools, and `foundry_extractor_create` enforce
  this. Source: `scripts/lib/branch-guard.js:28-39`.
- **Sort terminology:** REVIEW B14–B17 won't-fix held — "sort" survives
  as a conceptual routing-and-deadlock layer, even though the literal
  `foundry_sort` tool is deregistered. Items below distinguish between
  acceptable conceptual prose and unacceptable references to the
  deleted *tool name*.

---

## A. P0 release blockers

These break users or tools at runtime, or contradict shipped behaviour.

### Code drift

- [x] **A1. `scripts/sort.js:176` allowed-pattern still uses old
  memory path.** For `lastBase === 'assay'`, returns
  `[..., '.foundry/**', 'foundry/memory/**']`. Per Phase 2,
  relations live at `foundry-memory/relations/`. `git-policy.js:97`
  and `finalize.js:48` were updated; sort.js was missed. If
  `checkModifiedFiles` runs after a forge cycle whose assay stage
  wrote NDJSON, the gate reports a false `unexpected_files` violation
  on the now-untracked `foundry-memory/**` content. Either the gate
  is genuinely live (then this is a **broken** invariant) or
  effectively dead (then delete it). Add a regression test before
  fixing.

- [x] **A2. `.opencode/plugins/foundry-tools/stage-tools.js:26, 30`
  tool descriptions reference deleted `foundry_sort`.** Tool
  description: "Open a subagent work stage; consumes a dispatch token
  from `foundry_sort`". Token comes from `foundry_orchestrate` in
  v2.3+. LLM-visible drift; the LLM will look for a tool that isn't
  registered.

- [x] **A3. `skills/flow/SKILL.md:21` calls `foundry_git_branch`
  without `kind`.** The kind-typed `foundry_git_branch` (Phase 1)
  rejects calls missing `kind` with
  `"foundry_git_branch: kind is required (one of: config, work,
  dry-run)"`. The flow skill says "Call `foundry_git_branch` with the
  flow ID and a short description". First-time users following the
  flow skill on a new project will hit a tool refusal. Fix:
  `foundry_git_branch({ kind: "work", flowId, description })`.

- [x] **A4. `skills/human-appraise/SKILL.md:4` frontmatter description
  uses `#human` (hashtag).** Per `docs/tools.md:324`, the canonical
  feedback tag is the bare string `human`. The skill body (lines
  74–76) is correct; only the YAML description is wrong. (Was B21 in
  prior review; carried forward unresolved.)

- [x] **A5. `skills/add-memory-entity-type/SKILL.md` `git add`
  references a non-existent file.** Skill stages `foundry/memory/
  relations/<name>.ndjson` (also wrong path post-Phase 2 — should be
  `foundry-memory/relations/<name>.ndjson`). `foundry_memory_create_
  entity_type` writes only the entity-type markdown + schema. The
  relations NDJSON file only exists once rows are written, so
  `git add` fails with "pathspec did not match any files". Fix: drop
  the relations path entirely from the `git add` command. (Was B18.)

- [x] **A6. `skills/add-memory-edge-type/SKILL.md:50` same as A5 for
  edges.** Drop `foundry/memory/relations/<name>.ndjson` from the
  `git add` command. (Was B19.)

### Documentation drift

- [x] **A7. README + tools.md tool-count claim is wrong.** Three
  README locations and `docs/tools.md:5` say "46 tools"; actual
  count is **60**. README:71, README:434, README:478, tools.md:5.

- [x] **A8. README "Stage write scopes" assay row stale.**
  README.md:233 still says assay writes `WORK.feedback.yaml for
  #validation feedback on abort`. Per 3.0 (`08934a8`), assay marks
  the workfile failed on abort and writes no feedback. (F2 in prior
  review.)

- [x] **A9. README forge wont-fix exclusion lists `assay` as a
  source base.** README.md:276 and :281. Assay is no longer a valid
  feedback source. (F3.)

- [x] **A10. README "Stages" reference table assay row stale.**
  README.md:450 says `foundry_assay_run … writes #validation
  feedback on abort`. Should say "marks the workfile failed on
  abort". (F4.)

- [x] **A11. README + concepts.md memory layout trees nest
  `relations/` under `foundry/memory/`.** README.md:325–337,
  README.md:362, README.md:567, concepts.md:281,
  getting-started.md:222, getting-started.md:234, tools.md:167.
  Post-Phase 2 the tree must split: `foundry/memory/` holds config
  (entities/, edges/, extractors/, schema.json, config.md, gitignored
  memory.db*) and `foundry-memory/relations/` is a top-level sibling
  holding NDJSON row data. Each tree needs the split rendered.

- [x] **A12. `docs/tools.md:324` `foundry_feedback_add` per-stage
  table still lists `assay → tag must be exactly validation`.** Per
  3.0 the tool rejects assay outright. (F1.)

- [x] **A13. `docs/tools.md:516–518, 533–534, 538`
  `foundry_assay_run` description and failure modes claim it emits
  validation feedback.** Same drift as A8/A12; the tool now marks the
  workfile failed.

- [x] **A14. `docs/tools.md:660–664` snapshot tools have wrong arg
  names + return shapes.**
  - All four tools: arg name `id` documented; code uses `runId`.
  - `foundry_snapshot_show` return: docs say `{readme, work, diff,
    trace}`; code returns `{runId, readme, metadata, diff, trace,
    missing}` — `work` should be `metadata`.
  - `foundry_snapshot_list` return: docs say
    `[{id, branch, parentConfig, createdAt, size}]`; code returns
    `{runId, ...normaliseMeta(fm)}` per entry; no `size`.
  - `foundry_snapshot_prune`: docs list `keepLast?` arg which does
    not exist; `olderThanDays` is mandatory, not optional.
  Skill `dry-run/SKILL.md:84` correctly uses `runId`. Doc is the
  outlier.

- [x] **A15. CHANGELOG `[3.0.0]` missing entry for memory-relations
  relocation.** `db5bfa3` moved `foundry/memory/relations/` →
  `foundry-memory/relations/`. This is a breaking change for any
  project with an existing populated memory store: they must `git mv`
  or re-init. No entry in the breaking-changes list. Migration note
  required.

- [x] **A16. `skills/upgrade-foundry/SKILL.md` is stuck on v2.7.0
  while package is v3.0.0.** Lines 96, 98–106 (version table),
  165–211 (§7a). No §7b for v2.7→v3.0 covering: (a) failed-flow
  guard expansion, (b) kind-typed `foundry_git_branch` (breaking),
  (c) `foundry_git_branch`/`_finish` JSON error envelopes, (d) dry-run
  + snapshot tools as new public surface, (e) `foundry_memory_dump`
  JSON envelope, (f) assay no longer files validation feedback
  (BREAKING), (g) memory-relations relocation to `foundry-memory/`
  (BREAKING — needs migration `git mv` instructions),
  (h) `.snapshots/` gitignore entry. This is the single biggest
  user-facing doc gap for the release. (Was C9 in prior review;
  severity escalated since polarity flipped.)

- [x] **A17. `skills/init-memory/SKILL.md` writes/`git add`s do not
  reflect the foundry-memory/ split.** Lines 9, 42, 55, 77, 84–88
  reference `foundry/memory/` for both config and data. The relations
  side now goes under `foundry-memory/relations/` per
  `scripts/lib/memory/admin/init.js:24-28`. The skill's commands will
  miss the new top-level sibling directory.

---

## B. P1 release blockers (drift with workaround)

### Code drift

- [x] **B1. `git-bridge.js` `extraAllowedPatterns` is dead in
  production.** Phase 2 commit `db5bfa3` added the parameter
  documenting "memory init can stage both `foundry/**` and
  `foundry-memory/**` in one commit", but `scripts/lib/memory/admin/
  init.js` writes files and never commits, and `foundry_memory_init`
  doesn't either. Only the unit test in `tests/lib/git-bridge.
  test.js:224` exercises it. Resolved by removing the parameter
  and its unit test (1037 → 1036 tests, 0 failing).

- [x] **B2. `config-create-tools.js` collapses structured
  `UnexpectedFilesError` to plain `{error: msg}`.** When the
  unexpected-files guard fires inside `makeCreate`, the catch calls
  `errorJson(err)` which keeps only `err.message`. Other tools
  (`orchestrate-tool.js`) preserve `affected_files`. Drift in error
  envelope shape; downstream consumers can't recover the file list.

- [x] **B3. Two-source branch resolution in `git-tools.js`.**
  `git-tools.js:284` uses `currentBranch({ exec: ... })` (handles
  unborn HEAD + detached); `git-tools.js:336` uses raw
  `git branch --show-current` execFileSync, which returns `''` on
  detached HEAD and falls through to a misleading "expected work/<x>"
  refusal. Route both through `currentBranch()`.

### Documentation drift

- [x] **B4. `docs/concepts.md` missing branch-guard / dry-run /
  snapshot / tracing concept entries.** Added `## Branch guards`
  (after Branch namespaces), `## Tracing`, `## Dry-run`, and
  `## Snapshot` sections. Subitem (e) — the `## foundry/memory/
  layout` heading — was already corrected to `## Memory layout` with
  the two-tree split under A11.

- [x] **B5. `docs/getting-started.md` walkthrough does not mention
  config branches.** Added a "Step 0. Open a config branch"
  subsection before the artefact-type/law/appraiser/cycle/flow
  walkthrough, and a one-paragraph note on the memory walkthrough's
  Initialize subsection pointing at `foundry_git_branch({ kind:
  "config", ... })`.

- [x] **B6. `docs/tools.md` does not document branch-guard
  requirements per tool.** Per-tool annotation across 46 blocks would
  duplicate; instead extended the Conventions section with a
  "Branch requirements" entry that lists which tool families gate on
  config / flow / any-branch, parallel to the existing "Failed flow"
  preamble. Self-classifying tools (`foundry_git_branch`,
  `foundry_git_finish`) are called out separately.

- [x] **B7. `docs/tools.md` failed-flow gating preamble is stale.**
  Lines 26–36 list the gated tools but miss the
  `foundry_config_create_*` family (5 tools). Confirm in
  `config-create-tools.js:48,56` and add. (Related to but distinct
  from prior B4 / new A7.)

- [x] **B8. `docs/tools.md` index does not list the 14 new Phase 1–5
  tools.** Lines 46–115. Missing: 5 `foundry_config_create_*`,
  5 `foundry_config_validate_*`, 4 `foundry_snapshot_*`. The index
  needs to enumerate them or be regenerated.

- [x] **B9. `docs/tools.md` new tools have only table-row coverage,
  not per-tool blocks.** Lines 619–649, 651–664. Every other tool
  gets a `### foundry_X` section with Args / Returns / Stage
  requirements / Failure modes / Side effects. The 14 new tools
  break this template.

- [x] **B10. `docs/tools.md:1` header is stale.** "Generated from
  the v2.6.x public plugin API. … Total: 46 tools." Update to
  3.0.x and 60.

- [x] **B11. README "Pipeline tools" / "Memory tools" tables omit
  the 14 new Phase 1–5 tools.** README.md:438–451. Catalogue tables
  must list `foundry_config_create_*`, `foundry_config_validate_*`,
  `foundry_snapshot_*`.

- [x] **B12. README failed-flow blocked-tools list missing
  `foundry_config_create_*`.** README.md:240–249. The 5 config-
  creator tools enforce `gateNotFailed`; the README list is missing
  them.

- [x] **B13. `docs/concepts.md:164`, `docs/work-spec.md:168`, and
  README.md (3 places) reference deleted tool `foundry_stage_finalize`
  as if user-callable.** Per the prior B10–B13 won't-fix on internal
  finalize step, the *concept* is fine — but these surfaces still
  name the deleted tool by literal token rather than calling it "the
  orchestrator's internal finalize step". Reframed README:219+298,
  work-spec:168+172, concepts:192. README:469 retained — that line
  factually catalogues the "intentionally not registered" set by
  literal name, which is its purpose.

- [x] **B14. CHANGELOG 3.0.0 entry contradicts itself on dry-run.**
  CHANGELOG.md:21–23 said "the handler currently returns 'dry-run
  finish not yet implemented' pending Phase 5". Phase 5 landed in
  the same release (`c5a236b`). Replaced the parenthetical with a
  one-line summary of the implemented behaviour and a forward
  pointer to the "Dry-run finish writes a forensic snapshot" entry
  later in the changelog.

- [x] **B15. `docs/memory-maintenance.md` no longer matches reality.**
  (a) Disambiguated the line-96 `relations/<type>.ndjson` reference
  to the canonical `foundry-memory/relations/<type>.ndjson` path,
  and added a "Memory layout: two trees" section pinning the
  config-vs-data split with a pointer to `paths.js`.
  (b) Added a "Failed-flow guard on memory admin tools" section
  enumerating the gated tools, listing the read-only diagnostics
  that remain callable, and pointing at `failed-flow.js` plus the
  README for the recovery path. C31 (the line 3-4 self-deprecating
  framing) deferred to the C-cluster sweep.

- [x] **B16. CHANGELOG.md:138** still references `REVIEW.md P0 #3`
  internally. (Actual line at HEAD: 152.) Dropped the trailing
  `See REVIEW.md P0 #3.` sentence — the surrounding paragraph
  describes the prior behaviour (silent swallow + drift) on its
  own and the cross-reference adds nothing for a public reader.

- [x] **B17. `docs/tools.md` "Follow-ups / inconsistencies spotted"
  section is stale framing.** (Actual line at HEAD: 1261.) Renamed
  the section to "Design exceptions" and rewrote the orchestrate-
  violation bullet affirmatively — it documents an intentional
  design choice, no longer framed as a TODO/inconsistency.

- [x] **B18. `docs/tools.md` read-only diagnostics list is curated,
  not exhaustive.** Verified the actual gated set against the plugin
  source: `feedback-tools.js`, `artefact-tools.js`, `appraiser-tools.js`,
  and `config-create-tools.js` are gated; `config-tools.js`,
  `history-tools.js`, and `workfile-tools.js`'s `_get` are wholly
  ungated. Rewrote both surfaces:
  (a) the failed-flow preamble (lines 26–39 at HEAD) now lists every
      callable diagnostic by category — `_workfile_get`, every
      `_list` tool, all six read-only `_config_*`, all five
      `_config_validate_*`, all read-only memory tools, and all
      `_snapshot_*` — with a cross-reference to the Branch
      requirements section. `appraisers_select` is called out as
      gated despite the "select" verb.
  (b) the "Any branch (read-only diagnostics)" enumeration
      (former lines 65–70) now covers the same set affirmatively.
  Note: `foundry_appraisers_select` was incorrectly listed in B18's
  citation as a read-only diagnostic — it is gated. (And the
  citation was lines 33–36; actual span at HEAD is lines 26–39.)

- [x] **B19. `docs/tools.md` "every mutating tool refuses on failed
  flow" preamble overclaims.** Narrowed the preamble (former line 27)
  from "every mutating tool refuses to run" to "the mutating tool
  families refuse to run" and appended a sentence calling out
  `foundry_git_branch` / `foundry_git_finish` as the self-classifying
  exceptions whose ungating is the failed-flow recovery path. Added
  "Not gated on failed flow" annotations to both per-tool blocks
  (under Stage requirements) and extended the "Self-classifying"
  bullet in the Branch requirements section to match. (Folds prior
  C3.)

### Skill drift

- [x] **B20. Eight memory admin skills `git add` `foundry/memory/
  relations/` (or `relations/<name>.ndjson`).** Updated all six
  remaining skills (A5 / A6 already done): `change-embedding-model`
  (line 56) renamed `foundry/memory/relations/` →
  `foundry-memory/relations/`; `reset-memory` (line 52) likewise;
  `drop-memory-entity-type` (line 55) and `drop-memory-edge-type`
  (line 52) extended `git add -A foundry/memory/` to also stage
  `foundry-memory/relations/` (since both ops `unlink p.relationFile()`
  under the new tree); `rename-memory-entity-type` (line 49) and
  `rename-memory-edge-type` (line 48) extended their `git add`
  commands the same way. Verified each operation's actual file
  touches via the admin source under `scripts/lib/memory/admin/`
  before editing.

- [x] **B21. `skills/flow/SKILL.md:50, 75` finish-time prose stale
  for the new kind-typed model.** Drift was at line 75 only (line 50
  is a section header, not stale). Added two sentences to the
  Squash-merge bullet: a leading clause noting that the flow skill
  always lands on `work/<flow>-<desc>` and so dispatches to the
  `work` mode, and a closing parenthetical naming the other two
  modes (`config` integrates without WORK cleanup, `dry-run`
  writes a snapshot) so a reader who misroutes the call has the
  context to recover. The destructive description still applies
  verbatim to the `work` mode the skill exits on.

---

## C. P2 polish

Defer if release window is tight; pull in if doing a thorough doc
pass.

### Code (voice / consistency)

- [x] **C1. `scripts/lib/guards.js:42-54` `guarded()` fast path is
  effectively dead.** Verified by enumerating callers: all 32
  production `guarded()` invocations pass
  `{ branchIo: branchIoFactory, io: asyncIoFactory }` (snapshot tools
  via the shared `TRACE_OPTS` const, every other plugin inline). The
  five tests at `tests/lib/guards.test.js:11,19,24,183,190` are the
  only callers reaching the early return. Reframed the comment from
  "Backwards-compatible fast path" to "Test-only path", naming the
  test file and explaining why it skips the tracing IO factories.
  Voice: original "no tracing work at all" recast affirmatively.

- [x] **C2. `scripts/lib/guards.js:84` empty `catch {}` swallows all
  tracing errors.** Captured the swallowed exception as `traceErr`,
  kept the silent-by-default contract (tracing still must never break
  a tool call), and added a `console.warn` gated on
  `process.env.FOUNDRY_DEBUG` that surfaces tool name and the
  underlying error message. `FOUNDRY_DEBUG` is a new convention —
  no prior env-var usage in `scripts/lib/` or
  `.opencode/plugins/foundry-tools/`. Two regression tests
  (silent-default and warn-when-set) added with explicit
  `console.warn` stubbing and `process.env.FOUNDRY_DEBUG`
  save/restore. Test count: 1038 → 1040.

- [x] **C3. `scripts/lib/foundational-guards.js:7` trailing-slash
  inconsistency.** Dropped the trailing slash from the probe path:
  `requireFoundryRoot` now calls `io.exists('foundry')`, matching
  `requireGitRepo`'s `'.git'` style. The user-facing error message
  keeps the trailing slash (`'foundry/ directory not found …'`)
  because that reads naturally as a directory name to a human.
  Updated the existing test to assert the new probe key, and added
  a third test pinning the no-trailing-slash invariant — feeding
  `'foundry/'` into the io stub now correctly fails the guard, so
  any future regression that re-introduces the slash will fail
  loudly. Test count: 1040 → 1041.

- [x] **C4. `scripts/lib/branch-guard.js:11` strawman-negation
  comment.** Rewrote "instead of bubbling a thrown ExecError" to
  "envelope rather than throwing" — leading with what the code does
  (returns a structured refusal envelope) rather than what it avoids.

- [x] **C5. `scripts/lib/memory/paths.js:7` `relationsDir` is
  hard-coded ignoring `foundryDir` parameter.** Added a comment
  explaining why it's fixed: Phase 2 moved relations out of the
  foundry/ tree to a sibling path (foundry-memory/relations/),
  which sits at the worktree root level, not under foundryDir.
  There's no way to derive it from foundryDir without knowing the
  worktree root, so the fixed string literal is intentional.

- [x] **C6. `config-creators` are nearly identical (5 files,
  ~33 lines each).** Compress to a 20-line factory. Not a bug;
  consolidation opportunity.

- [x] **C7. `cycle.js` and `flow.js` config-creators have dead
  `KIND_HUMAN` / `KIND_UNDERSCORED` parity constants** (both equal
  the same value). Vestigial parity with `artefact-type`. Replace
  with single `KIND` constant.

- [x] **C8. `config-validators/cycle.js` and `creators/law.js`
  shadow the Node `path` module.** No actual collision (they don't
  import `node:path`), but reuse of the name is confusing. Rename
  to `filePath`. (Note: Only `cycle.js` had the issue; `law.js` uses
  a `pathFor` function, not a `path` variable.)

- [x] **C9. `git-tools.js` `finishWorkBranch` and `finishConfigBranch`
  duplicate ~80% of scaffolding.** Extracted common logic into
  `finishBranchCommon` helper; both functions are now thin wrappers.
  Added test coverage for config branch path. (Commits: 1ce3452,
  a92af70)

- [x] **C10. `snapshot-tools.js:88-90` arg-validation envelope
  inconsistency.** `pruneSnapshots` returns
  `JSON.stringify({ok:false, error})` rather than via `errorJson`.

- [x] **C11. `snapshot/finish.js:73` recovery semantics undocumented.**
  After `git checkout parent`, the dry-run branch and partial
  `.snapshots/<runId>` directory may remain. Document recovery in
  module comment.

- [x] **C12. Stale tool-description / inline comments in plugins.**
  `artefact-tools.js:24` ("registered automatically by
  `foundry_stage_finalize`"), `orchestrate-tool.js:54` ("same pattern
  as removed `foundry_sort`"), `orchestrate-tool.js:82` ("mimics the
  deleted `foundry_stage_finalize` body"). Reframe as "the
  orchestrator's internal finalize step" / drop the historical
  comparison. (Was D7/D8.)

- [x] **C13. `scripts/lib/finalize.js:16` Americanism `defense`** →
  `defence`. (Was E48.) Fixed in e325b30.

### Voice — strawman negation in NEW prose

These are NEW occurrences in Phase 1–5 prose (REVIEW E1–E48 already
catalogued the older ones; section D below restates which still
apply).

- [x] **C14. CHANGELOG 3.0.0 entry has 4 strawman negations.**
  Lines 184 ("instead of based on…"), 217 ("instead of crashing…"),
  333 ("instead of every row…"), 348 ("instead of mutating…").
  All rewritten affirmatively. Commit TBD.

- [x] **C15. `docs/tools.md:197, 413` use "rather than" framing.**
  Line 485 (actual location): "propagates as a tool error rather than
  being wrapped". Rewritten affirmatively. Commit 8b89227.

- [x] **C16. `memory-admin-tools.js:43-44` "land on a branch that
  finishes via foundry_git_finish (config kind) rather than
  polluting main directly".** Already fixed in commit 9cf62d8 (voice
  sweep batch). Current wording: "and stay isolated from main".

### Doc gaps (not breaking but worth filling)

- [x] **C17. `skills/dry-run/SKILL.md` not cross-referenced from
  `flow` / `orchestrate`.** Already present in flow/SKILL.md:12
  ("If you are on a `config/<x>` branch with in-progress edits...
  use the `dry-run` skill instead"). Comprehensive note covers the
  use case.

- [x] **C18. `docs/getting-started.md` no mention of
  `foundry_config_validate_*` (the validate-then-create authoring
  loop).** Added a "Step 6. Validate before writing (optional)"
  subsection covering all five validators. (Folded into B5/B6 commit
  per grouping #17.)

- [x] **C19. `docs/getting-started.md:174` "three places" but lists
  four bullets.** Already fixed: getting-started.md:232 now correctly
  says "four places" and lists exactly four bullets (lines 234-237).

- [x] **C20. `docs/getting-started.md` no mention of failed-flow
  recovery / `foundry_workfile_delete` escape hatch.** Added a
  "Recovering a failed flow" subsection under "Inspecting progress"
  describing the `status: failed` flag, which read-only diagnostics
  remain available, and the `foundry_workfile_delete({ confirm: true
  })` escape hatch. (Folded into B5/B6 commit per grouping #17.)

- [x] **C21. `docs/concepts.md:138` links to `README.md#custom-tools`.**
  Already fixed: concepts.md:247 now correctly links to `tools.md`.

- [x] **C22. `package.json:4` description vs README hero wording
  mismatch.** Already aligned: both use identical wording.

- [x] **C23. `docs/tools.md:182-189` `foundry_orchestrate` return
  shape doesn't mention prompt-augmentation with cycle memory
  context.** Already documented: tools.md:253-254 mentions "The `prompt`
  field is augmented with cycle memory context".

- [x] **C24. `docs/tools.md:233-234` `foundry_workfile_get` return
  shape uses `{...fm, goal}` spread that could collide with `error`
  key in frontmatter.** Already documented: tools.md:303-305 includes
  note about potential collision.

- [x] **C25. `skills/init-foundry/SKILL.md` step 5 doesn't
  cross-reference `init-memory` skill.** Already fixed:
  init-foundry/SKILL.md:74 references the `init-memory` skill.

- [x] **C26. `skills/assay/SKILL.md:25` "return to step 5 with an
  error summary" reads ambiguously.** Already clear: assay/SKILL.md:59
  "End the stage" is unambiguous.

- [x] **C27. README `scripts/lib/` tree (lines 505–541) is stale.**
  Already fixed: README:510-570 comprehensive tree includes all current
  files (failed-flow.js, git-bridge.js, git-policy.js, ulid.js,
  feedback-store.js, branch-guard.js, foundational-guards.js, tracing.js,
  plus all subtrees). No longer lists deleted feedback.js or non-existent
  tags.js.

### Voice — older prose still standing

REVIEW.md prior section E catalogued 48 voice/spelling items;
all 48 still applicable at HEAD with three drifts:

- [x] **C28. README hero + design-principles voice cluster.**
  Fixed in 771b8f7: Converted 9 instances of strawman negation to affirmative
  definitions per AGENTS.md (lines 12, 14, 18, 27, 364, 370, 653, 665, 681).
  Hero section now leads with what problems ARE; design principles define
  features on their own terms. Constraints/prohibitions preserved per guidelines.

- [x] **C29. README:312 Americanism `behavior`.** (Was E45.)
  → `behaviour`. Fixed in e325b30.

- [x] **C30. `docs/concepts.md` voice cluster.** Already fixed: no
  "instead of" patterns found in concepts.md.

- [x] **C31. `docs/memory-maintenance.md:3-4` self-deprecating
  framing.** Already fixed: no "Not architecture; not a spec" found.
  Current text is "Contributor-facing notes" (affirmative).

- [x] **C32. `docs/work-spec.md:106` parenthetical rationale for
  why assay is excluded as feedback source.** Already affirmative:
  work-spec.md:106 leads with the list of included sources, then
  explains the exclusion.

- [x] **C33. `skills/forge/SKILL.md:100` Americanism + strawman
  ("not an honor-system rule").** Already fixed: forge/SKILL.md:101
  says "This rule is tool-enforced" (affirmative, British spelling).

- [x] **C34. `skills/human-appraise/SKILL.md:117-119` "Unlike
  appraise and quench, you are NOT restricted…".** Already affirmative:
  human-appraise/SKILL.md:117-119 says "may resolve any such item" and
  "is the ONLY stage authorised".

- [x] **C35. `skills/upgrade-foundry/SKILL.md:256` Americanism
  `behavior`.** (Was E46.) → `behaviour`. (Folded into A16's
  rewrite.)

- [x] **C36. Plugin-comment voice cluster (9 items, E26–E34).**
  All items fixed in commit 9cf62d8 (voice sweep). Item #1
  (assay-tools.js "deferring to stage_end") was removed earlier in
  a5c830f. Items #3 and #4 were confirmed as part of the voice sweep,
  not duplicates of C12. All 1136 tests passing.

- [x] **C37. `scripts/lib/` module-banner voice cluster (10 items,
  E35–E44).** Fixed in commit 8f3956c. Converted 17 strawman negations
  and "rather than" framings across 11 files (feedback-store.js,
  feedback-transitions.js, memory/cozo.js, memory/admin/reembed.js,
  memory/store.js, assay/spawn-with-timeout.js, git-bridge.js,
  git-policy.js, failed-flow.js, orchestrate.js, sort.js). Initial
  implementation had 4 residual negation patterns in feedback subsystem;
  fixed in amended commit. All 1136 tests passing.

### Snapshot tooling minor

- [x] **C38. `snapshot/inspect.js:172-211` `pruneSnapshots`
  envelope inconsistency.** Missing `.snapshots/` + `confirm: false`
  returns refusal envelope; missing `.snapshots/` + `confirm: true`
  returns success. UX would prefer `{ok:true, candidates:[]}` for
  the first case.

- [x] **C39. `snapshot/inspect.js:93-95` `parseDiffStats`
  heuristic.** `+`/`-` line counter has known undercount/overcount
  cases. Fine for forensic stat, but pin tricky-patch expectations
  in a test.

- [x] **C40. `snapshot/render.js:36-39` `goalRendered` uses
  `JSON.stringify` for strings while everything else uses
  `formatValue`.** Add a one-line comment explaining YAML-quoting
  rationale.

---

## D. P3 nits

Only pull in if trivially adjacent to other work.

- [x] **D1. `git-tools.js:50-52` `validateStartingBranch` tests
  `DRY_RUN_DEEPER_RE` which is unreachable in practice.** Already
  documented: git-tools.js:45 has comment explaining the defensive guard.

- [x] **D2. `git-tools.js:25-28` `makeExec` duplicated across many
  tool plugins.** Already fixed: makeExec is in helpers.js:102 and
  imported by all tool plugins. The only remaining local helper is
  `makeExecFile` in config-create-tools.js:48 which is intentionally
  different (hard-codes 'git' command for commitWithPolicy contract).

- [x] **D3. `git-tools.js:301-310` double-swallowed
  `truncateTrace` error.** Code is correct: only one try/catch at
  git-tools.js:284-289 with defensive swallow (lines 282-283 comment
  explains "Must never break branch creation"). No vestigial outer catch.

- [x] **D4. `config-validators/law.js:5-7` JSDoc says params
  "unused; accepted for parity".** Already documented: law.js:4-5
  explains "Laws derive their ID from the filename rather than
  frontmatter, so name and io are unused here but accepted for API
  parity with other validators."

- [x] **D5. `config-create-tools.js:67-73` `lawTargetSchema`
  workaround comment.** Already fixed: config-create-tools.js:77-80
  adds target structure example to the tool description when kind === 'law'.

- [x] **D6. `init.js:18-21` asymmetric gitignore — only
  `foundry/memory/memory.db*` is added; `foundry-memory/` (which
  IS tracked) is not, by design.** Already documented: init.js:14-16
  comment explains "Gitignore only the runtime DB files under
  foundry/memory/. foundry-memory/relations/ (NDJSON row data) is
  intentionally tracked."

- [x] **D7. `skills/dry-run/SKILL.md:76` says snapshots are
  gitignored.** Correct *after* re-running init-foundry on an
  upgraded project. Pre-3.0.0 projects upgrading need an explicit
  `.snapshots/` line added to `.gitignore`. Cover in upgrade-foundry
  §7b (folded into A16).

- [x] **D8. `skills/orchestrate/SKILL.md:82` literally names
  `foundry_sort` and `foundry_stage_finalize` inside a "do NOT
  call" guard.** Already fixed: orchestrate/SKILL.md:82 uses the
  preferred phrasing "are not registered tools; orchestrate handles
  them internally via the loop."

- [x] **D9. `skills/upgrade-foundry/SKILL.md:230, 239` historical
  references to `foundry_stage_finalize`.** Acceptable as
  v2.2→v2.3 migration narrative. Add a parenthetical "(since v2.3
  internal to `foundry_orchestrate`)".

- [x] **D10. `skills/refresh-agents/SKILL.md:3` description lacks
  leading capital.** Already fixed: description starts with "Use"
  (capital U), matching sibling skills' capitalization style.

- [x] **D11. `skills/forge/SKILL.md:100` mentions `sort`'s
  `checkModifiedFiles`.** Already fixed: forge/SKILL.md:101 uses
  user-facing phrasing "the orchestrator's modified-file check".

- [x] **D12. `skills/appraise/SKILL.md:122** mentions `sort.js`
  filename.** Internal implementation leak in user-facing skill.

---

## E. Doc structure follow-up

After finishing A–D, surface the unifying stage-role principle in one
place. The five stages have crisply separated roles:

- **assay** populates flow memory. No artefact, no feedback. Failure
  marks the workfile failed.
- **forge** creates and modifies the artefact. Resolves prior
  feedback.
- **quench** validates deterministically. Files
  `validation`-tagged feedback.
- **appraise** evaluates against laws. Files `law:<id>`-tagged
  feedback.
- **human-appraise** human review. Files `human`-tagged feedback;
  has deadlock-override authority.

Feedback is always *about an artefact* and flows backward to forge.
Assay sits outside the protocol because it precedes the artefact and
its only failure mode (a broken extractor under
`foundry/memory/extractors/`) lives outside forge's `file-patterns`.

- [x] **E1. Add a unifying-principle paragraph to `docs/concepts.md`
  Stages section.**

- [x] **E2. Add a one-paragraph preamble to README's "Stages"
  reference table** (around line 432).

- [x] **E3. `docs/work-spec.md:106` lead with the rule before the
  rationale.** (Folded into C32 - already affirmative.)

---

## F. Test-coverage gaps

Largely clean — Phase 1–5 has strong test coverage. Low-severity
gaps only:

- [x] **F1. Missing `tests/lib/memory/admin/vacuum.test.js`** —
  every other admin module has a peer unit test. Vacuum is exercised
  through plugin tests, so behavioural coverage exists; only the
  lib-level direct unit test is missing. Low. Fixed in 569968c.

- [x] **F2. No regression test for `scripts/sort.js:176` allowed-
  pattern drift** (A1). Added `tests/sort.test.js` case "allows
  foundry-memory/** and .foundry/** for assay stage".

- [x] **F3. No test confirming `extraAllowedPatterns` is wired into
  `foundry_memory_init`** (B1). Resolved by removing the parameter
  and its test together (see B1).

- [x] **F4. No test asserting that legacy `foundry/memory/relations/`
  layout is rejected / migrated.** N/A: Memory feature is new in 3.0.0;
  no legacy layout exists. The `foundry-memory/relations/` path was the
  initial implementation, not a migration from an older location.

---

## Suggested commit grouping

Each line is one commit.

1. **`fix(sort): use foundry-memory/** allowed pattern after Phase 2`** — A1 + F2
2. **`fix(stage-tools): drop deleted foundry_sort from tool descriptions`** — A2
3. **`fix(skill/flow): pass kind:"work" to foundry_git_branch`** — A3
4. **`docs(skill/human-appraise): use bare 'human' tag in description`** — A4
5. **`docs(skills): drop relations NDJSON from create-type git-add commands`** — A5 + A6
6. **`docs(README,tools): correct tool count to 60`** — A7 + B10
7. **`docs(README): purge stale assay-feedback prose from stage-tables`** — A8 + A9 + A10
8. **`docs(README,concepts,getting-started,tools): split memory layout tree`** — A11
9. **`docs(tools): align foundry_feedback_add / assay_run with 3.0 semantics`** — A12 + A13
10. **`docs(tools): correct snapshot-tool arg names and return shapes`** — A14
11. **`docs(changelog): record memory-relations relocation under 3.0.0`** — A15
12. **`docs(skill/upgrade-foundry): add v2.7→v3.0 migration section`** — A16 (+ folds C35, D7, D9)
13. **`docs(skill/init-memory): split foundry-memory/ relations from foundry/memory/ config`** — A17
14. **`docs(skills/memory): update git-add paths to foundry-memory/relations/`** — B20 (8 skills)
15. **`docs(README,tools): list new Phase 1–5 tools in catalogue + per-tool blocks`** — B7 + B8 + B9 + B11 + B12
16. **`docs(concepts): add branch-guard / dry-run / snapshot / tracing entries`** — B4
17. **`docs(getting-started): walk through config-branch authoring loop`** — B5 + B6 + C18 + C20
18. **`docs(changelog): drop stale dry-run-not-yet-implemented note`** — B14
19. *(fix or refactor)* **`fix(git-bridge): wire extraAllowedPatterns through to memory_init` OR `chore: remove unused extraAllowedPatterns`** — B1 + F3
20. **`fix(config-create): preserve UnexpectedFilesError.files in error envelope`** — B2
21. **`fix(git-tools): unify branch-resolution via currentBranch()`** — B3
22. *(remaining doc cleanup)* — B13, B15–B19, B21
23. *(P2 polish, voice, spelling)* — C cluster
24. *(P3 nits)* — D cluster
25. **`docs(concepts,README,work-spec): surface stage-role unifying principle`** — E1 + E2 + E3

---

## Verification

```bash
npm test         # 1041 tests passing, 0 failing (post-C3 baseline)
git status       # clean working tree
```

Both must hold before moving on.

---

## Follow-ups Found During Review Work

- [x] **Rename-memory skills miss deletion staging.** Fixed in f64e517:
  Changed `git add` to `git add -A` in both rename-memory-entity-type and
  rename-memory-edge-type skills (lines 49 and 48 respectively). The `-A`
  flag ensures deletions (old type markdown + NDJSON files) are staged
  alongside additions (new files), preventing inconsistent repository state.

---

# G. Second-pass audit (neglected modules)

Generated 2026-04-30 by 6 parallel explore agents covering the modules
not freshly swept in the first pass: feedback subsystem, memory
read/cozo/embeddings/admin, assay runner, orchestrate/sort/finalize,
remaining tool plugins, and git-bridge/git-policy/failed-flow. Every
citation verified at HEAD. Items marked [DUP] overlap with earlier
sections and are listed for cross-reference only.

## G.0 P0 release blockers

- [x] **G1. `foundry_feedback_resolve` rejects `approved` without a
  reason — tool description is actively wrong.** Already fixed:
  feedback-store.js:132-135 documents the fix per REVISION-CONTRACT §A1,
  REASON_REQUIRED_TARGETS now only includes ['rejected', 'wont-fix'],
  and regression test exists at tests/plugin/feedback-tools.test.js:355.

- [x] **G2. `foundry_feedback_resolve` description hides the
  deadlock-override authority.** Already fixed: feedback-tools.js:144
  description now reads "Resolve a feedback item (approved or rejected).
  In human-appraise stages, this tool can override deadlocked items by
  providing a reason."

- [x] **G3. `paths.relationsDir` ignores its `foundryDir` argument —
  silent test/worktree leak.** Already fixed: scripts/lib/memory/paths.js:7-9
  now uses `join(foundryDir, '..', 'foundry-memory', 'relations')` with
  a comment explaining the Phase 2 relocation rationale.

- [x] **G4. Atomicity hole: `commitWithPolicy` violates its own
  contract on post-add commit failure.** Already fixed: git-bridge.js:66-76
  wraps `add` + `commit` in try/catch with `reset --quiet` in the catch
  block to restore the "Nothing is staged or committed" invariant.

- [x] **G5. Subagent-failure path leaks stale `lastStage`, corrupting
  the next finalize.** `scripts/orchestrate.js:450-462`. When
  `lastResult.ok === false`, the handler clears `activeStage` but never
  clears `lastStage`. Next happy-path orchestrate call reads the stale
  `lastStage` at line 467-484 and runs `finalize` against a dead
  `baseSha`, producing spurious `unexpected_files` violations against
  every change since. Add `clearLastStage(io)` peer to
  `clearActiveStage(io)` in the failure branch, plus a regression test
  using the stub-finalize harness.

- [x] **G6. Non-atomic stage finalisation: history + artefact rows
  persist before the commit, with no rollback on commit refusal.**
  `scripts/orchestrate.js:499-549`. Order: registerArtefact writes
  artefact rows → `addArtefactRow` (deduped) → two `appendEntry` calls
  to `WORK.history.yaml` → `tryCommit` may return a violation
  (line 546). On commit-policy violation the function returns the
  violation but `WORK.md` and `WORK.history.yaml` are mutated and
  uncommitted. Next sort sees dirty tool-managed files
  (`sort.js:315-321`) and returns its own violation — cycle wedged.
  Either stage the writes-only-on-success, or compensate (revert
  in-memory writes) on commit failure.

- [x] **G7. `<FOUNDRY_CONTEXT>` skills list omits new skill families.**
  `.opencode/plugins/foundry-tools/helpers.js:81-83`. The Pipeline /
  Authoring / Maintenance lists do not include `init-memory`,
  `dry-run`, `add-memory-entity-type`, `add-memory-edge-type`,
  `change-embedding-model`, `add-extractor`, etc. Every agent reads
  this string on session start; missing skills are silently invisible.

- [x] **G8. `<FOUNDRY_CONTEXT>` pipeline summary omits `assay` and
  `human-appraise`.** `.opencode/plugins/foundry-tools/helpers.js:64`
  reads `"forge → quench → appraise → iterate"`. The canonical 3.0
  pipeline is `assay → forge → quench → appraise → human-appraise`
  (REVIEW E1/E2). The first prose every agent reads understates the
  pipeline by two stages.

## G.1 P1 — bugs / contract issues

### Feedback subsystem

- [x] **G9. `human-appraise` override comment overstates authority.**
  Already fixed: feedback-store.js:117-120 comment now correctly states
  "authority over items in {actioned, wont-fix, deadlocked} states".

- [x] **G10. `feedback_list.depth` definition disagrees with sort's
  depth.** Already fixed: both feedback-tools.js and sort.js:339 now
  consistently use `it.history.length` for depth calculation.

- [x] **G11. `markWorkfileFailed` overwrites the original failure
  reason on a second call.** Already fixed: failed-flow.js:62-67 now
  checks if already failed and skips the overwrite to preserve the
  first (diagnostic) failure reason.

- [x] **G12. `requireNotFailed` swallows IO/parse errors as "ok".**
  Already fixed: failed-flow.js:83-93 try/catch now detects corrupted
  WORK.md and returns refusal with recovery instructions.

### Memory subsystem

- [x] **G13. `foundry_memory_query` permission filter is bypassable
  via Datalog rule aliasing.**
  `.opencode/plugins/foundry-tools/memory-tools.js:169` matches
  literal `\bent_<name>\b` / `\bedge_<name>\b` tokens. Datalog rule
  bindings (`?[x] := alias[x]` where `alias <- *ent_secret{...}`) or
  comment-embedded references can refer to forbidden relations
  without matching the regex. The pre-filter is the *only* permission
  gate. Either ban any unknown `*ent_` / `*edge_` reference, parse
  with a stricter token grammar, or push permission enforcement down
  into `runQuery`. Fixed in bab78e2 and 8d6bfc8.

- [x] **G14. `foundry_memory_neighbours` and `foundry_memory_search`
  do not bound `depth` / `k`.**
  `.opencode/plugins/foundry-tools/memory-tools.js:124-154,202`.
  `depth: 1000` runs O(depth × edge_types × frontier) Cozo queries
  and exhausts memory. Same for unbounded `k`. Clamp both
  (depth ≤ 5, k ≤ 100) or reject with a clear error. Fixed in
  bab78e2.

- [x] **G15. `dropEntityType` / `dropEdgeType` leave orphan Cozo
  relations alive in long-lived processes.**
  `scripts/lib/memory/admin/drop-edge-type.js:23-30`,
  `drop-entity-type.js:96-105`. Both delete markdown + NDJSON +
  schema entry but never drop the Cozo `ent_<t>`/`edge_<t>` relation
  or HNSW index. `reconcileRelations` (`store.js:111-134`) cleans up
  on next `openStore`, but anything holding a live `db` handle
  through `invalidateStore` propagation continues seeing the dropped
  relation. Symmetric problem in `createEntityType` /
  `createEdgeType` (`create-entity-type.js:7-29`,
  `create-edge-type.js:33-63`) — they don't create the relation
  either, so `foundry_memory_put` against a freshly-created type can
  fail with "stored relation not found" until reopen. Make admin
  ops consistently touch the live store, or consistently rely on
  reconciliation; the current mix is the bug. Fixed in bab78e2.

- [x] **G16. Embedding probe seeds dimensions from the user's claim,
  not the provider's reality.** Fixed in 3444319: init.js now writes schema
  AFTER probe and uses probe.dimensions when available. Falls back to defaults
  when probe fails/disabled. init-memory skill updated to display actual
  dimensions when probe succeeds.

- [x] **G17. `embed()` discards index ordering when `index` is
  missing.** Already fixed: embeddings.js:28-33 now validates that all
  embeddings have an index field and throws if missing, preventing
  silent misalignment.

- [x] **G18. `foundry_memory_search` fetches `k` from each type then
  re-slices to `k`.** Fixed in e078af3: enhanced tool description to document
  the N×k amplification cost and recommend using type_filter. Implementation
  is correct by design (ensures global top-k accuracy) and already well-
  documented in code (search.js:21-54) and tests (search.test.js:67-95).

- [x] **G19. `embed()` does no retry on transient failures.**
  Already fixed: embeddings.js:1-71 implements full retry mechanism with
  `callWithRetry`, `isRetryableError` for 429/5xx/timeout, exponential
  backoff (1s, 2s), and max 3 attempts.

- [x] **G20. Reembed Phase 4 leaves schema/DB out of sync if
  `writeSchema` fails after rename.** Fixed in 8e19ea7: reembed.js now writes
  schema BEFORE renaming DB files (Phase 3, lines 115-122). If writeSchema
  fails, DB remains untouched. If rename fails after writeSchema, mismatch
  will be detected on next openStore (better than silent corruption). Test
  added at reembed.test.js:130-237.

- [x] **G21. `cozoStringLit` claims NUL/control-char rejection lives
  in `validate.js`, but `validate.js` only does drift detection.**
  Fixed in ef11880: Added explicit NUL rejection in cozoStringLit (lines
  29-40) as defence in depth. Write path validates via validateEntityWrite/
  validateEdgeWrite, import path was vulnerable. Added 7 tests (4 unit +
  3 integration). Test count: 1129 → 1136.

- [x] **G22. `reset.js` unconditionally `unlink`s `-wal` / `-shm`.**
  Fixed in c2e05c5: Added existence checks before unlinking WAL/SHM sidecar
  files in reset.js (lines 14-16). Prevents ENOENT when SQLite doesn't create
  sidecars (clean checkpoint or inactive WAL mode). Test added at
  reset.test.js (handles missing WAL/SHM gracefully).

- [x] **G23. `dump.js` summary path enumerates entity counts only.**
  Fixed in 8017c40: Added edge counts to summary (dump.js:33-36) mirroring
  the entity count loop. Summary now shows both entity and edge counts
  (e.g., "- edge implements: 2 rows"). Test added at dump.test.js:18-40.

### Assay subsystem

- [x] **G24. SIGKILL fallback timer is never cleared on natural
  exit.** `scripts/lib/assay/spawn-with-timeout.js:43-49`. The inner
  `setTimeout(..., 500)` reference is never captured, so a child
  exiting cleanly between SIGTERM and the 500ms mark leaves the
  timer keeping the Node event loop alive. Capture the inner timer
  id and `clearTimeout` it from `child.on('close')` and
  `child.on('error')`. Fixed in a5c830f.

- [x] **G25. `process.kill(-child.pid, ...)` runs with possibly
  undefined pid.** `scripts/lib/assay/spawn-with-timeout.js:34-38`.
  If `spawn` fails synchronously (`/bin/sh` missing, EMFILE),
  `child.pid` is undefined. The try/catch wraps `process.kill` but
  the `-undefined` argument coerces to `NaN`. Add
  `if (child.pid == null) return;` at the top of `killGroup`.
  Fixed in a5c830f.

- [x] **G26. `child.on('error')` returns whatever `timedOut` is set
  to.** `scripts/lib/assay/spawn-with-timeout.js:51-63`. A spawn
  error that races with the soft timer reports
  `{ok: false, timedOut: true, ...}` while the real failure was
  spawn (e.g. ENOENT). `runAssay` then reports "extractor timed out
  after Xms". Capture spawn-error explicitly: `timedOut: true`
  requires the timer actually elapsed AND a child existed.
  Fixed in a5c830f.

- [x] **G27. Stdout decoding is per-chunk `Buffer.toString`, splitting
  multi-byte UTF-8.** `scripts/lib/assay/spawn-with-timeout.js:40-41`.
  A multi-byte codepoint straddling a chunk boundary decodes as two
  replacement characters. Extractors emitting non-ASCII content
  (emoji, accented chars, CJK identifiers) silently corrupt. Use
  `StringDecoder` from `node:string_decoder`. Fixed in a5c830f.

- [x] **G28. No bound on captured stdout/stderr — extractor can OOM
  the agent.** `scripts/lib/assay/spawn-with-timeout.js:29-41`. Both
  streams accumulate unbounded into JS strings. A buggy extractor
  printing in a loop exhausts Node heap before the timeout fires.
  Add a byte cap (e.g. 50 MB stdout, 1 MB stderr) and on overflow
  kill the group with a distinguished `tooMuchOutput: true` flag.
  Fixed in a5c830f.

- [x] **G29. Partial-write contract violation across extractors.**
  `.opencode/plugins/foundry-tools/assay-tools.js:62-68`,
  `scripts/lib/assay/run.js:52-92`. The runner validates each row
  before any write *within one extractor*, but the wrapper only
  calls `syncStore` once after the entire extractor list completes.
  If extractor A succeeds (1000 rows in-memory) and extractor B
  aborts on row 5, `runAssay` returns `{ok:false}`,
  `markWorkfileFailed` runs, and `syncStore` never fires — every row
  from A is lost. The in-code comment at lines 52-56 says writes are
  flushed immediately; the code says otherwise. Decide which is
  truth and align. Fixed in a5c830f.

- [x] **G30. `parse-jsonl` rejects valid pretty-printed JSON.**
  `scripts/lib/assay/parse-jsonl.js:59-78`. `text.split(/\r?\n/)` then
  per-line `JSON.parse` rejects an object that spans multiple lines
  (perfectly legal JSON). Error reads "extractor output line N:
  invalid JSON". Either document one-object-per-line in the
  extractor contract (loader.js, the tool description, and
  `add-extractor` skill), or use a streaming JSON parser.
  Fixed in e169433 (documented requirement).

- [x] **G31. Edge rows have no size cap.**
  `scripts/lib/assay/parse-jsonl.js:34-55`. `parseEntityRow` enforces
  `MAX_VALUE_BYTES`; `parseEdgeRow` accepts arbitrary `from.name` /
  `to.name` strings. Apply consistent caps or delegate uniformly to
  the memory validator.
  Fixed in 27a8ecb (applied MAX_VALUE_BYTES cap to from.name/to.name).

- [x] **G32. `parseTimeout` is unbounded.**
  `scripts/lib/assay/loader.js:6-21`. `timeout: 999999999` is
  accepted; Node clamps to 24.8 days and warns at runtime. Cap at
  e.g. 600000ms with a clear error.
  Fixed in a223938 (capped at 600000ms with clear error message).

### Validate / git plumbing

- [x] **G33. `foundry_validate_run` `{file}` substitution is
  positionally naïve.**
  `.opencode/plugins/foundry-tools/validate-tools.js:49`. The
  substituted value is single-quoted; if a config validation entry
  uses `cmd "{file}"` (a natural pattern documented nowhere as
  forbidden), the result is `cmd "'path'"` — a literal containing
  single quotes. Either document that `{file}` must appear unquoted
  in `command:` strings, or detect surrounding quotes and strip them
  before substituting. Add a fixture covering filenames with spaces
  and shell metacharacters.
  Fixed in 5d893f5 (detects and strips quotes around standalone {file}).

- [x] **G34. `commitWithPolicy` returns `null` SHA on a clean
  worktree; config-creators silently propagate.**
  `scripts/lib/git-bridge.js:47` JSDoc says "Returns the short commit
  SHA on success" with no mention of `null`.
  `scripts/lib/config-creators/{artefact-type,law,cycle,flow,appraiser}.js`
  return `{ok: true, path, sha: null}` to the caller. Either treat
  `sha === null` as an internal error ("expected to write but
  worktree was clean") or document `null` as part of the contract.
  Fixed in 4b60e21 (documented null as valid return value).

- [x] **G35. `parsePorcelainZ` rename-ordering doc contradicts git's
  actual `-z` output.** `scripts/lib/git-policy.js:39-43`. The
  comment claims renames emit destination-then-source. Real
  `git status -z --porcelain` for `git mv old new` emits
  `R  old\0new\0` (source first). The function still works because
  both paths are pushed, but the doc is wrong. Verify with a real
  `git mv` and update the comment. The bridge test at
  `tests/lib/git-bridge.test.js:166-187` only asserts `includes()`,
  so it cannot catch the swap.
  Fixed: Verified with real `git mv` - comment was already correct (git
  emits destination-then-source per git-status(1) man page). Enhanced
  comment to reference git documentation. Existing test at
  tests/lib/git-policy.test.js:39-43 verifies correct order.

- [x] **G36. `UnexpectedFilesError.message` floods logs.**
  `scripts/lib/git-bridge.js:28`. `super(\`unexpected_files: ${files.join(', ')}\`)`
  produces a multi-kilobyte message for a worktree with hundreds of
  stray files. The structured `err.files` array is the right channel.
  Bound the message: `unexpected_files: ${files.length} file(s)`.
  Fixed in 66dc8da (changed error message to show count, added test).

- [x] **G37. `markWorkfileFailed` truncation does not escape YAML.**
  `scripts/lib/failed-flow.js:33-37,62`. A reason containing `\n`,
  `:`, or leading quote may produce frontmatter that fails to
  round-trip through `parseFrontmatter`. Next `readFailedStatus`
  returns null (status no longer parseable as `failed`), bypassing
  the guard. Verify `setFrontmatterField` quotes correctly; if not,
  sanitise/quote the reason before writing.
  Fixed in 7333103 (added tests verifying yaml.dump() handles escaping correctly).

## G.2 P2 — voice / consistency / dead code

These are bundled into a single voice-sweep commit with the existing
C36 cluster. Listing the citations here so the commit author can find
them.

- [x] **G38. Strawman / "rather than" framing across modules.**
  Fixed in 8f3956c as part of C37. All items addressed:
  - `scripts/lib/feedback-store.js:153-155` "Not validated through
    validateTransition (sort bypasses the state machine per spec
    §6.1)."
  - `scripts/lib/feedback-transitions.js:13-14` "NOT validated here
    — sort bypasses this function. Included for completeness…"
  - `scripts/lib/feedback-transitions.js:94-95` "The predicate is
    forge-specific. Non-forge callers always receive `false` — they
    should use validateTransition directly, not this helper."
  - `scripts/lib/feedback-store.js:131-134, 139-140` "'open' is
    forbidden as a transition target … so no 'reason forbidden on
    open' branch is needed here."
  - `scripts/lib/memory/cozo.js:18-19` defines `cozoStringLit` by
    what double-quoted form *cannot* do.
  - `scripts/lib/memory/admin/reembed.js:8-26` opens with prior
    in-place implementation rather than current behaviour.
  - `scripts/lib/memory/store.js:69-74` "they don't touch the live
    .db".
  - `scripts/lib/assay/spawn-with-timeout.js:13-15` "rather than just
    the direct child".
  - `.opencode/plugins/foundry-tools/assay-tools.js:53-56` "rather
    than deferring to stage_end".
  - `.opencode/plugins/foundry-tools/orchestrate-tool.js:33-36`
    "Inline rather than composed via guarded()".
  - `.opencode/plugins/foundry-tools/orchestrate-tool.js:54`
    "Mint: same pattern as removed foundry_sort." [DUP C12]
  - `.opencode/plugins/foundry-tools/orchestrate-tool.js:82`
    "Finalize bridge: mimics the deleted foundry_stage_finalize body."
    [DUP C12]
  - `.opencode/plugins/foundry-tools/orchestrate-tool.js:97-107`
    "Surface as a typed finalize error instead of falling back to…".
  - `.opencode/plugins/foundry-tools/helpers.js:107-110` "rather than
    execFileSync".
  - `.opencode/plugins/foundry-tools/memory-helpers.js:24-29` "rather
    than blocking unrelated direct calls".
  - `.opencode/plugins/foundry-tools/memory-helpers.js:57-62` "better
    to block the call than silently grant".
  - `.opencode/plugins/foundry-tools/stage-tools.js:81-83` "(no
    notFailed gate)" defines tool by what it lacks.
  - `.opencode/plugins/foundry-tools/workfile-tools.js:78-80`
    parenthetical "(no notFailed gate)".
  - `scripts/lib/git-bridge.js:5-7` "Replaces a previous git add . &&
    git commit -m msg flow that would silently capture…"
  - `scripts/lib/git-bridge.js:18` "no `git add .`, no shell strings".
  - `scripts/lib/git-policy.js:7-15` "Both commits historically used
    `git add .`…" + "Intentionally framework-agnostic".
  - `scripts/lib/failed-flow.js:20-23` "Read-only diagnostics are
    intentionally exempt".
  - `scripts/lib/failed-flow.js:25-27` "The only ways out are…".
  - `scripts/orchestrate.js:94-110` "Pre-redesign… Post-redesign…"
    historical narrative.
  - `scripts/orchestrate.js:60-62` "Task-6 stub helpers (wired in
    later)" — both stale and strawman.
  - `scripts/sort.js:30-31` "an item is 'open' iff its head state is
    neither 'resolved' nor 'deadlocked'" — affirmative restatement
    available.
  - `scripts/sort.js:147-149` "rather than diffing against an
    arbitrary depth".

- [ ] **G39. Dead / test-only code.**
  - `scripts/lib/feedback-store.js:156-173` `writeDeadlockedSnapshot`
    (singular) is only called from tests. Remove or rename
    `writeDeadlockedSnapshotForTest`.
  - `scripts/lib/assay/permissions.js:8-15` `checkExtractorAgainstCycle`
    is exported and unit-tested but has no production caller;
    `scripts/orchestrate.js:376` reimplements the same check inline.
    Either route orchestrate through the helper, or delete the helper
    and its tests.
  - `scripts/lib/git-policy.js:30` `TOOL_MANAGED_PREFIX` exported but
    only used internally; drop the export.
  - `scripts/orchestrate.js:499-511` `addArtefactRow` loop is a no-op
    in production because `registerArtefact` already wrote the row.
    Either remove the loop or remove `registerArtefact` and let
    orchestrate own the write.
  - `scripts/lib/finalize.js:16` `defense` → `defence`. [DUP C13]

- [ ] **G40. Internal naming inconsistency.**
  - `feedback_list.depth` vs sort's depth — see G10.
  - `await io.exists(...)` at `scripts/orchestrate.js:359` while
    every other call site uses sync; `io.exists` is documented sync.
  - `embeddings`/`memory` admin modules hard-code `'foundry'` as
    `foundryDir` while accepting `worktreeRoot` and using it only
    for `invalidateStore`. Either thread `foundryDir` end-to-end or
    drop the parameter — the current API is misleading. Sites:
    `create-extractor.js:14,20`, `create-edge-type.js:39-40,60`,
    `create-entity-type.js:11-12,25`, `drop-edge-type.js:6-7,27`,
    `drop-entity-type.js:74-75,133`, `rename-edge-type.js:21-22,48`,
    `rename-entity-type.js:22-23,88`, `reset.js:7-8,19`,
    `reembed.js:42,48,79,123,136`, `validate.js:9-12`. Note: also
    interacts with G3 — fix together.
  - Frontmatter helpers duplicated in `drop-entity-type.js:113-116`,
    `rename-edge-type.js:33`, `rename-entity-type.js:65`. Extract a
    `composeMarkdown(fm, body)` helper.
  - Per-file `-ize` vs `-ise` inconsistency between
    `scripts/lib/git-bridge.js` (`initialisation`) and
    `scripts/lib/git-policy.js` (`finalize`). Pick one for the pair.

- [ ] **G41. `flowBranchGuard` scaffold duplicated five times.**
  `appraiser-tools.js`, `artefact-tools.js`, `workfile-tools.js`,
  `validate-tools.js`, `stage-tools.js` each redefine the same 8-line
  helper. `helpers.js` already exports `branchIoFactory`; consolidate
  there. Adjacent to D2.

- [ ] **G42. `stderr` truncation at byte 500 has no marker.**
  `.opencode/plugins/foundry-tools/assay-tools.js:78`.
  `res.stderr.trim().slice(0, 500)` cuts without ellipsis or
  "(N bytes truncated)" suffix; consumers can't tell whether stderr
  ended naturally at 500 chars or was cut. Add a marker.

- [ ] **G43. `helpers.js:33` swallows malformed flow files
  silently.** `.opencode/plugins/foundry-tools/helpers.js:33` — bare
  `catch { /* skip bad files */ }`. A malformed `flows/*.md` silently
  disappears from `<FOUNDRY_CONTEXT>`, the user-facing flow catalogue.
  Surface a one-line warning on stderr at least once per session.

- [ ] **G44. `loadItems` malformed-YAML branch chain is brittle.**
  `scripts/lib/feedback-store.js:14-19`. Top-level array document
  passes through to `Array.isArray(undefined)` → false → throws the
  malformed error, which is correct but reached by a different code
  path than expected. Tighten the type check.

- [ ] **G45. `splitFrontmatter` rejects UTF-8 BOM with a misleading
  error.** `scripts/lib/assay/loader.js:23-36`. A file saved with BOM
  fails the `lines[0] !== '---'` check and reports "missing
  frontmatter". Strip BOM before the check.

- [ ] **G46. `runAssay` exit-code message swallows signal info.**
  `scripts/lib/assay/run.js:38-43,42`. A signal-killed process
  surfaces as `extractor exited with exit code null`. Fold `signal`
  into the message: `extractor exited with signal SIGKILL (exit
  code null)`.

## G.3 P3 — nits

- [ ] **G47. `loader.js:32` strips leading whitespace from extractor
  body — undocumented.** Body field is presentational only, but the
  silent strip is surprising.

- [ ] **G48. Trim historical/transitional comments in `orchestrate.js`.**
  `Task-6 stub helpers (wired in later)` (line 60), the
  Pre/Post-redesign block (lines 94-110). Either delete or tag
  `// historical:` for grep.

- [ ] **G49. `runAssay` does not pass `env` to `spawnWithTimeout`,
  so extractors inherit the agent's full env including any tokens.**
  `scripts/lib/assay/run.js:32-36`. Document at the
  `add-extractor` skill, or pass a sanitised env (PATH, HOME,
  TMPDIR, locale) by default with an opt-in `extra-env:` frontmatter
  key.

- [ ] **G50. `helpers.js:104` `unlink` no-ops on missing files
  (differs from `fs.unlinkSync`).** Add a one-line comment to
  prevent surprise.

- [ ] **G51. `setArtefactStatus` error references deregistered
  `stage_finalize`.** `scripts/lib/artefacts.js:90` — error string
  `'status draft not permitted; use stage_finalize for registration'`.
  The operator looks for a tool that no longer exists. [DUP C12]

- [ ] **G52. `stage-tools.js`, `workfile-tools.js`, `git-bridge.js`,
  `failed-flow.js` banner-comment voice cleanups.** Bundled with G38.

## G.4 Test coverage gaps (deferred — file under F)

- **TF1.** `foundry_feedback_resolve` approved-without-reason case
  (G1) has no test; the contradicted behaviour is not locked in.
- **TF2.** No test for the SIGKILL fallback against a child that
  traps SIGTERM (G24, G25).
- **TF3.** No test for stdout containing non-ASCII split across
  chunks (G27).
- **TF4.** No test for stdout/stderr volume bound (G28).
- **TF5.** No test for multi-line JSON input (G30).
- **TF6.** No test asserting NDJSON persistence after extractor A
  succeeds and B fails (G29).
- **TF7.** No test for the subagent-failure `lastStage` non-clear
  (G5).
- **TF8.** No test for the dispatch-token nonce leak when `!model`.
- **TF9.** No test for non-atomic finalize rollback (G6).
- **TF10.** No regression test for `foundry_memory_query` permission
  bypass via creative Datalog (G13).
- **TF11.** No test for `foundry_memory_neighbours depth: 1000`
  rejection / clamping (G14).
- **TF12.** No test for `embed()` provider returning data without
  `index` field in arbitrary order (G17).
- **TF13.** No test for `foundry_validate_run` `{file}` substitution
  with shell-special filenames (G33).
- **TF14.** `tests/lib/git-bridge.test.js:224-248` exercises the
  dead `extraAllowedPatterns` parameter (B1); update or delete when
  B1 resolves.
- **TF15.** No test for `commitWithPolicy` post-add commit failure
  atomicity (G4).
- **TF16.** No test for `helpers.js:33` malformed flow file
  swallow-and-warn behaviour (G43).

## G.5 Suggested commit grouping for second-pass items

Continuing from the existing 25-item plan:

26. **`fix(feedback): align approved-resolution reason rule with tool description`** — G1 (+ adds TF1)
27. **`fix(feedback-tools): surface deadlock-override authority in description`** — G2
28. **`fix(memory/paths): root relationsDir under foundryDir`** — G3 (+ check parallel-test leak)
29. **`fix(orchestrate): clear lastStage on subagent-failure path`** — G5 (+ TF7)
30. **`fix(orchestrate): atomic stage finalisation rollback on commit refusal`** — G6 (+ TF9)
31. **`fix(plugin/helpers): refresh FOUNDRY_CONTEXT pipeline + skills catalogue`** — G7 + G8
32. **`fix(memory): clamp neighbours.depth and search.k`** — G14 (+ TF11)
33. **`fix(memory/query): tighten relation-permission filter`** — G13 (+ TF10)
34. **`fix(memory/admin): make create/drop entity+edge consistent on live store`** — G15
35. **`fix(memory/embeddings): handle missing `index` field; add retry`** — G17 + G19 (+ TF12)
36. **`fix(memory/admin/reembed): write schema before rename`** — G20
37. **`fix(assay/spawn): clear hard-kill timer on natural exit; guard undefined pid`** — G24 + G25 + G26
38. **`fix(assay/spawn): use StringDecoder for chunked utf-8`** — G27 (+ TF3)
39. **`fix(assay/spawn): bound captured stdout/stderr`** — G28 (+ TF4)
40. **`fix(assay): flush per-extractor on success; align with code comment`** — G29 (+ TF6)
41. **`fix(assay/parse-jsonl): document one-object-per-line; cap edge name size`** — G30 + G31
42. **`fix(validate): document {file} substitution rules`** — G33 (+ TF13)
43. **`fix(git-bridge): wrap stage+commit in try/finally`** — G4 (+ TF15)
44. **`fix(git-bridge): bound UnexpectedFilesError.message`** — G36
45. **`fix(git-bridge): correct rename-ordering comment`** — G35
46. **`fix(failed-flow): refuse on unparseable WORK.md; document reason-overwrite`** — G11 + G12 + G37
47. **`fix(human-appraise/feedback): align override comment with validator`** — G9
48. **`refactor(plugins): consolidate flowBranchGuard into helpers.js`** — G41
49. **`refactor(memory/admin): thread foundryDir or drop worktreeRoot param`** — G40 (+ G3 if not already done)
50. **`refactor: remove dead helpers (writeDeadlockedSnapshot singular, checkExtractorAgainstCycle, TOOL_MANAGED_PREFIX export, addArtefactRow loop)`** — G39
51. **`docs/voice: sweep strawman framings across feedback, memory, assay, plugins, git-bridge`** — G38 (+ G52, folds C36)
52. **`fix(memory/embeddings): probe should report provider's actual dimension`** — G16
53. **`fix(memory/cozo): reject NUL/control chars in cozoStringLit or in validator`** — G21
54. **`fix(memory/admin): reset.js sidecar existence check; dump.js include edge counts`** — G22 + G23
55. **`fix(feedback-list): align depth definition with sort, or rename`** — G10
56. *(P3 nits)* — G47, G48, G49, G50, G51
