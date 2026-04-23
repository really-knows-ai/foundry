# Foundry — Codebase Review

_Review date: 2026-04-23_
_Version reviewed: package.json 2.4.2 / CHANGELOG 2.5.0 (pending bump)_
_Commit: 71e0d87 (main, 27 commits ahead of origin)_

---

## 1. What it is

`@really-knows-ai/foundry` — an **OpenCode plugin + skill pack** that enforces a governed "forge → quench → appraise" pipeline for AI-driven artefact generation. Pitch (README:10-14): AI tools skip checks and silently drop feedback; Foundry moves discipline from prompts into **deterministic tool code** so the LLM can't cheat.

Single JS package, MIT, Node ≥18.3, ESM. Author: Really Knows AI.

## 2. Repository layout

```
.opencode/plugins/foundry.js   ← 1,334-line plugin: all tool registrations
scripts/
  orchestrate.js  (464)        ← deterministic cycle driver
  sort.js         (378)        ← routing + stage transitions
  validate-tags.js (54)        ← CLI utility
  lib/                         ← 14 focused modules (workfile, feedback, tokens, etc.)
    assay/       (5 modules)   ← NEW: extractor subprocess runner
    memory/      (19 modules + admin/) ← flow-memory subsystem
skills/          (26 skills)   ← markdown skill files, auto-loaded
tests/           (60 test files, 560 tests, all passing)
docs/            (concepts, getting-started, memory-maintenance, work-spec, plans/, specs/)
```

No TypeScript, no lint config, no build step. Pure ESM JS. Only 4 runtime deps: `@opencode-ai/plugin`, `cozo-node`, `js-yaml`, `minimatch`.

## 3. Domain model (from `docs/concepts.md`)

- **Flow** — top-level work unit; set of cycles with starting-cycles hints.
- **Cycle** — loop producing exactly one artefact type; declares `output`, `inputs`, `targets`, `models`, and (new) `assay.extractors`.
- **Stage** — one step in a cycle, identified as `base:alias`. Bases: `forge`, `quench`, `appraise`, `human-appraise`, `assay`.
- **Artefact type** — `foundry/artefacts/<type>/` with `definition.md`, optional `laws.md`, optional `validation.md`. Non-overlapping file patterns enforced.
- **Law** — subjective pass/fail criterion (global or type-scoped).
- **Appraiser** — a personality sub-agent; count + allowed set declared per artefact type.
- **Flow memory** (v2.4.0) — typed graph store in Cozo 0.7 with optional OpenAI-compatible semantic search; NDJSON is the source of truth, DB is gitignored and rebuildable.
- **Assay / Extractor** (v2.5.0, unreleased but committed) — iteration-0-only stage that runs project-authored CLIs to populate flow memory; strict failure semantics.

## 4. Architecture highlights

**Enforcement via token-gated stages.** Every stage wraps `foundry_stage_begin` → work → `foundry_stage_end`. Tokens are HMAC-signed (`scripts/lib/token.js`, 26 lines; secret in `scripts/lib/secret.js`). Tools are stage-locked so a forge stage literally cannot add feedback rows, etc. This is the core "trust the tool, not the LLM" design.

**Orchestrator loop is in a tool, not a skill.** `foundry_orchestrate` (v2.3.0 breaking change — CHANGELOG:67-79) replaced an LLM-driven `cycle` skill. The orchestrator calls `runSort` (route decision), dispatches, finalizes, appends history, commits. The `orchestrate` skill is now a 3-line driver.

**Deterministic routing.** `scripts/sort.js` picks next stage from history + feedback state + write-invariant checks. 974-line test file (`tests/sort.test.js`) — by far the most-tested module; suggests it's the hot spot for correctness.

**Micro-commit-per-stage.** Every stage ends with a commit on a `work/` branch, so crashes leave clean resume points and there's a full audit log in git.

**Memory subsystem is large and self-contained.** `scripts/lib/memory/` is ~20 modules with a singleton Cozo session, embedding probe, permissions check, vocabulary prompt injection, drift reconciler, and 13-module admin helper set. Tests mirror structure 1:1.

## 5. Testing

- **560 tests, 135 suites, all passing** in ~3.9s via plain `node --test`.
- Roughly 1:1 file correspondence between `scripts/lib/**` and `tests/lib/**`.
- `tests/plugin/` covers end-to-end plugin behavior including precondition checks (312 lines), assay e2e (201), sort (974).
- No coverage tool configured; coverage appears high by inspection.

## 6. Code quality signals

- **No TypeScript**, no JSDoc types in most files (only 3 files have `@param`/`@returns`). Relies on tests.
- **No linter or formatter config** (`.eslintrc`, `.prettierrc` absent).
- **No `console.log` noise** in production code (only one in `validate-tags.js`).
- Only **one TODO** in the entire tree: a stub template in `skills/add-extractor/SKILL.md:62`. No `FIXME`/`HACK`/`XXX`.
- Modules are small and focused (most <150 lines). The one notable exception is the plugin entry `.opencode/plugins/foundry.js` at **1,334 lines** — it's a long `tool(...)` registration wall.
- `scripts/lib/feedback.js` at 440 lines is the next-largest and handles the state machine for feedback items (pending → actioned/wontfix → approved/rejected).

## 7. Development state

**Extremely active.** 211 commits in the last 30 days; 27 commits ahead of origin/main on `main`, unpushed. The v2.5.0 assay feature was landed in a clean ~20-commit sequence on 2026-04-23 with design doc → phase plans (1-5) → implementation → tests → docs → CHANGELOG — textbook discipline:

- `docs/specs/2026-04-23-assay-stage-design.md`
- `docs/plans/2026-04-23-assay-stage-phase-{1..5}-*.md`
- Commits follow conventional-commits style (`feat(assay):`, `test(plugin):`, `docs(readme):`).

The CHANGELOG is detailed, honest about breaking changes, and cites file paths. Recent versions show a pattern of architectural consolidation (v2.3.0 replaced LLM orchestration with a tool; v2.4.0 added memory; v2.5.0 adds assay).

## 8. Notable patterns

- **Skills-as-markdown.** 26 skills in `skills/*/SKILL.md`. Authoring tools (`add-law`, `add-appraiser`, etc.) refuse to run on `work/` branches (CHANGELOG v2.3.2) — config changes belong on main.
- **Preview-then-confirm** on destructive memory ops (`drop_*` without `confirm:true` returns a preview).
- **Swallow-errors guards** around optional subsystems: if memory is misconfigured, prompt injection no-ops rather than failing the cycle (CHANGELOG:38).
- **Multi-model routing** via `.opencode/agents/foundry-*.md` files generated by `refresh-agents`. OpenCode-specific; the rest is portable.
- **NDJSON is source of truth** for memory; Cozo DB is a derived, gitignored cache. Smart choice — keeps diffs reviewable.

## 9. Concerns / rough edges

1. **`.opencode/plugins/foundry.js` is 1,334 lines.** Almost all `tool()` registrations with inline handlers. A future split (e.g., `plugins/foundry/memory-tools.js`, `assay-tools.js`) would aid navigation. Not urgent — real logic lives in `scripts/lib/` and is well-factored.
2. **27 unpushed commits** on main, including v2.5.0 assay work, CHANGELOG, README changes. Worth confirming intentional.
3. **No type annotations.** With 3,479 LOC of production JS and an evolving plugin API, typed contracts would catch drift earlier. The test suite is compensating.
4. **`package.json` version is 2.4.2** but CHANGELOG describes 2.5.0 as shipped on 2026-04-23. Version bump appears pending.
5. **`.worktrees/`** exists (empty) and is gitignored — active use of `using-git-worktrees` pattern. Environment signal only.
6. **No lint/format tooling.** Style is consistent by discipline; adding prettier + minimal eslint would lock it in.
7. **Assay extractor skill has a stub TODO** (`skills/add-extractor/SKILL.md:62`) inside a template code block — likely intentional example content, worth verifying.

## 10. Overall assessment

Mature, well-disciplined small codebase. Coherent architecture ("move discipline from prompts into tools"), serious test coverage (560 tests on 3.5 KLOC), exemplary release hygiene (design → plan → phased implementation → docs → CHANGELOG), clean module boundaries. Growth areas are mechanical: split the plugin entry file, bump the version, push pending commits, consider types + a linter if the project keeps expanding.

---

## Action checklist

Ordered roughly by effort / risk. Tick items as we work through them.

### Release hygiene (quick wins)

- [x] **Bump `package.json` version to 2.5.0** to match CHANGELOG. _(amended into HEAD `1937929`)_
- [x] **Review the 27 unpushed commits on main** — cohesive v2.5.0 release batch, pushed to origin/main.
- [x] **Verify `skills/add-extractor/SKILL.md:62` TODO** — confirmed intentional: it's inside a starter-stub bash block the skill instructs authors to drop in and replace. Not a code-debt marker.

### Code organization

- [x] **Split `.opencode/plugins/foundry.js` (1,334 → 89 lines)** into topic-grouped modules under `.opencode/plugins/foundry-tools/`:
  - [x] `history-tools.js`, `stage-tools.js`, `workfile-tools.js`, `orchestrate-tool.js`
  - [x] `artefact-tools.js`, `feedback-tools.js`, `git-tools.js`, `config-tools.js`
  - [x] `validate-tools.js`, `assay-tools.js`, `appraiser-tools.js`
  - [x] `memory-tools.js` (read/write/search), `memory-admin-tools.js` (create/rename/drop/init/etc.)
  - [x] `helpers.js` (shared utils + `buildCyclePromptExtras` re-exported from entry)
  - [x] `memory-helpers.js` (`withStore`)
  - [x] Entry is thin aggregator: imports factories, spreads into `tool:`. Commit `bb16bc9`.
- [x] **Audit `scripts/lib/feedback.js` (440 lines)** for extraction opportunities (state-machine transitions vs. I/O vs. rendering). **— done in `5f22e87`. Extracted `walkFeedbackItems` generator; five near-duplicate section-scanners (`parseFeedback`, `listFeedback`, `collectItemsForFile`, `readItemState`, `transformFeedbackItem`) now share it. 440 → 337 lines. All 563 tests pass, public API unchanged. Follow-ups flagged below.**

  **Flagged for future work (not fixed in this pass):**
  - `addFeedbackItem` still has its own ~60-line scanner with mutation-oriented goals (locate positions instead of yielding items). A future pass could extract `locateFeedbackSection(lines) → { feedbackIdx, feedbackLevel, sectionEnd, fileHeadings }` and let `addFeedbackItem` consume it.
  - `readItemState` returns `'approved'` when `parsed.resolved` is true, while `listFeedback` surfaces `{ resolved: true, state: 'open'|'actioned'|'wont-fix' }`. Asymmetric modelling — worth documenting or unifying.
  - `detectDeadlocks` takes a `threshold` parameter but only gates on the total count of forge-appraise iterations, then returns every still-unresolved item. Name and semantics don't quite match the implementation. Needs a spec review.

### Tooling

- [ ] **Add prettier** with a minimal config, run once across repo.
- [ ] **Add eslint** (flat config) — start strict-but-minimal: no-unused-vars, no-undef, prefer-const, eqeqeq.
- [ ] **Add a CI workflow** (`.github/workflows/test.yml`) running `npm test` on push/PR if one doesn't exist.
- [ ] **Add test coverage reporting** (c8 via `node --test --experimental-test-coverage`) — no gate, just visibility.

### Type safety

- [ ] **Decide on typing strategy**: JSDoc + `checkJs` in `tsconfig.json`, or full TS migration, or neither.
- [ ] If JSDoc route: type the plugin tool contracts first (`@opencode-ai/plugin` surface), then `scripts/lib/config.js` and `scripts/lib/workfile.js` (highest fan-in).

### Correctness / hot spots worth re-reading

- [x] **`scripts/sort.js`** — routing brain. Walk through `determineRoute` and the write-invariant checks with fresh eyes.
- [x] **`scripts/lib/memory/singleton.js` + `store.js`** — Cozo session lifecycle; `docs/memory-maintenance.md` flags subtleties.
- [x] **`scripts/lib/feedback.js`** — state machine (pending → actioned/wontfix → approved/rejected). Confirm all transitions have tests and no illegal paths are reachable.
- [x] **`scripts/lib/assay/run.js`** — newest subsystem. Verify strict-failure claims (non-zero exit, parse error, permission violation, timeout → abort with `#validation` feedback) against the code.
- [x] **Token signing (`scripts/lib/token.js` + `secret.js`)** — sanity-check HMAC usage, secret rotation story, and what happens on secret loss.

---

#### Findings from correctness re-reads (five parallel subagent reviews)

All five reviews were read-only; no code was changed. The must-fix / should-investigate items below are the new follow-up backlog. Ordered roughly by severity.

##### sort.js

- **M1 (must-fix): Micro-commit guard fails open on any git error.** `sort.js:245-257` `getDirtyToolManagedFiles` swallows every exception and returns `[]`, which `runSort:294-302` treats as "tree is clean, proceed." Tests *actively assert* this graceful-degrade behaviour. A sandbox with no git on PATH, a missing repo, a transient `index.lock`, or denied permissions silently disables the guard. Same pattern in `getModifiedFiles:177-179` disables file-pattern enforcement too. Fix direction: distinguish "git ran and reported clean" from "git failed"; surface failure as `route: 'violation'` unless explicitly opted out via frontmatter.
- **M2 (must-fix): `getModifiedFiles` diff-base detection is fragile.** Substring-matches `[${cycle}] sort:` in `git log --oneline -20`. Issues: (a) hardcoded 20-commit window; a long-running cycle with enough micro-commits falls off and silently uses `HEAD~1` as the base (under-reports modified files). (b) Substring match is ambiguous — a commit message containing the literal pattern matches. Fix direction: use `git notes`, a sentinel ref, or read the SHA from `WORK.history.yaml` / `.foundry/last-sort-sha`.
- **M3 (must-fix): Dispatch token is not bound to `baseSha`, contrary to README claims.** Token payload is `{route, cycle, nonce, exp}` only. Replay protection rests entirely on the in-memory `pending` Map. Process restart doesn't cause replay (pending is empty, rejects all) but confuses legitimate in-flight dispatches with an unhelpful error. Fix direction: include `baseSha` (from `git rev-parse HEAD` at mint time) in the token payload; verify match in `stage_begin`.
- **Should-investigate:** `nextAfterQuench` has no deadlock detection (only `nextAfterAppraise` does); `findFirst(stages, 'forge')` always picks the first forge stage, ignoring multi-forge routes; `human-appraise`-only cycles may return `'blocked'` when they should loop; `now` parameter vs `Date.now()` divergence in pending store.
- **Test coverage gaps:** mixed staged/unstaged/untracked porcelain output; `git log` pattern ambiguity; >20-commit window; token minting for non-forge stages; order assertion that guard fires before token mint.

##### memory singleton + store

- **M1 (must-fix): `disposeStores` is not exception-safe.** `scripts/lib/memory/singleton.js:38-41` iterates synchronously with no try/catch. A throw mid-loop leaks live handles across test runs on the same process, causing "database is locked" / sqlite corruption on the next reopen.
- **M2 (must-fix): `withStore` has no try/finally; nothing ever closes the store.** Design assumes "open once per process, close via `disposeStores` at shutdown," but no `process.on('exit'|'SIGINT'|'SIGTERM')` hook is registered in the plugin entrypoint. SIGKILL leaves `memory.db-wal` / `memory.db-shm` on disk (Cozo should recover but untested).
- **M3 (must-fix): `openStore` is not crash-safe between `openMemoryDb` and `createEntityRelation` (`scripts/lib/memory/store.js:59-99`).** If schema setup throws after the DB handle is opened but before the Map is populated, the handle is dropped on the floor with an active WAL lock. Fix direction: wrap the post-open work in try/catch that calls `closeMemoryDb(db)` on failure.
- **M4 (must-fix): `reembed.js:56-80` leaves half-embedded state on provider failure.** Phase 1 drops old relation/index, phase 2 re-embeds in a loop; schema is written *after* the DB work. Provider throws mid-flight → DB at new dim, schema file says old dim, NDJSON reimport corrupts. Fix direction: write new schema to disk before opening the new store, or reembed in a temp DB and atomically rename.
- **M5 (must-fix): `putEntity` is not transactional against NDJSON.** Cozo write succeeds but NDJSON write fails (disk full/perms) → in-memory DB ahead of on-disk source of truth → next process start re-imports stale NDJSON and silently loses the put. The invariant "NDJSON is durable, DB is derived" deserves explicit doc + test.
- **Should-investigate:** Two processes opening the same Cozo sqlite path (no advisory lock); `withStore` re-entrancy race on concurrent `getOrOpenStore`; worktree switching mid-session leaks handles; `foundry_memory_query` allowlist description is stale (tool description at `memory-tools.js:143` claims it only rejects `:put/:rm/:create/::remove` but the code blocks far more); no query timeout; `drop-entity-type` cascade during an active cycle can silently drop uncommitted writes; `reset.js` unlinks WAL/SHM before the handle is closed.
- **Test coverage gaps:** concurrent `getOrOpenStore`; `openStore` failure mid-init; `reembed` failure mid-flight; NDJSON write failure; `disposeStores` idempotency; multi-process opens; query non-termination; `foundry_memory_validate` doesn't check orphan/dangling edges.

##### feedback state machine

- **M1 (must-fix): `detectDeadlocks` flags every `open` item once the threshold is reached.** `feedback.js:199` filter includes `state === 'open'`, but an open item is *new* feedback — by definition not deadlocked. After the threshold-th iteration, any new open feedback routes straight to human-appraise / blocked without ever round-tripping through forge. Fix direction: drop `'open'` from the filter, or change threshold semantics to "iterations since item was last touched by forge."
- **M2 (must-fix): `readItemState` and `listFeedback` model the same value differently.** `readItemState:244` collapses `{ state: 'actioned', resolved: true }` to the string `'approved'`; `listFeedback:174-181` returns `{ state, resolved }` raw. Validator sees one shape, router sees the other. The asymmetry is silent today but will bite when new states are added (e.g. `wont-fix + resolved`). Fix direction: pick one shape — recommendation is to keep `{ state, resolved }` everywhere and introduce a `derivedState(parsed)` helper for the collapsed view.
- **M3 (must-fix): `parseFeedbackItem` resolution detection is substring-based (`feedback.js:23-28`).** `line.includes('| approved')` misclassifies any item whose author-supplied body contains that substring (e.g. an appraiser quoting earlier feedback). Fix direction: tail-anchored regex like `/\s*\|\s*approved\s*$/` matching `collectItemsForFile`'s strip pattern.
- **Should-investigate:** `stageBase` is optional (silent validation bypass in public API — all plugin tools pass it, tests skip it; footgun); `wont-fix` is non-terminal in the matrix (documented ambiguity); `addFeedbackItem` dedup substring-replaces tags one at a time (fragile if tags share prefixes); `parseFeedback`/`listFeedback` behaviour when artefact row has empty file; `detectDeadlocks` threshold counts only `appraise`, not `human-appraise`.
- **Test coverage gaps:** Matrix row-by-row enumeration included — ~10 (current, target) pairs with no direct test. `unknown` state untested. `wont-fix → actioned` via forge disallowed but undocumented/untested. `transformFeedbackItem` silent no-op on unknown (file, index) in the no-validation path.

##### assay/run.js

- **M1 (must-fix): Assay writes bypass the embedder and the NDJSON snapshot (`.opencode/plugins/foundry-tools/assay-tools.js:24,31`).** `putEntity` called with no `embedder`, never invokes `syncIfOutOfCycle`. Consequences: (a) entities populated by extractors have no embedding row — `foundry_memory_search` can't find them when embeddings are enabled; (b) on-disk NDJSON not refreshed — next `disposeStores` + reopen silently loses all assay writes. This is a data-loss bug disguised as "works in tests." Fix direction: thread `writeEmbedder` and `syncIfOutOfCycle` from a `withStore`-equivalent through `runAssay`.
- **M2 (must-fix): `checkExtractorAgainstCycle` exists and is unit-tested but has no production call site.** The phase-1 plan said it should be called at cycle load. Today an extractor whose `memory.write` exceeds the cycle's permissions will run unchecked. Fix direction: call it from the cycle loader or `foundry_assay_run` entry before spawning anything.
- **Should-investigate:** No `AbortSignal` plumbed through spawn — parent SIGKILL leaves extractors orphaned; stdout/stderr buffers are unbounded JS strings (extractor emitting MB balloons heap); per-row upserts have no transaction — abort leaves memory half-populated; `spawnResult.exitCode` may be 0 after SIGTERM during graceful shutdown; feedback write on failure is best-effort-silent (no `feedbackWritten` field).
- **Doc mismatch:** `docs/concepts.md:55` says assay "aborts the cycle" — in reality it only aborts further extractors; prior writes stand. Either fix the behaviour or fix the doc.
- **Footgun:** `parseTimeout` accepts unitless `"30"` as 30 **ms**, not 30 seconds. Author writing `timeout: 30` intending seconds gets a 30 ms timeout.
- **Test coverage gaps:** same-name writes with different values (last-write-wins?); unknown `kind`; unknown `from_type` on edge; stderr-only on success; CR-LF/BOM/no-trailing-newline; partial writes on abort; timeout end-to-end through the plugin tool; parent-death cleanup; empty or duplicated extractor list; feedback dedup when assay aborts twice with same reason; embeddings populated after assay (they aren't); NDJSON synced after assay (it isn't); `checkExtractorAgainstCycle` end-to-end (it's never called).

##### token + secret

- **M1 (must-fix): Replay protection does not survive process restart** (`pending.js:1-17`). In-memory only. Restart correctly fails closed against replay (pending is empty, rejects all), but also fails closed against legitimate in-flight tokens — a mint just before restart is unusable with the confusing error "nonce not pending or already consumed." Fix direction: persist `pending` to `.foundry/pending.json`, or surface a clearer error and document the restart window.
- **M2 (must-fix): `pending` has no bounded growth / no background eviction.** `add()` never checks size; `consume()` only evicts the consumed entry; `size()` is the only path that sweeps, and it's called only in tests. A long-running session with abandoned dispatches grows the Map unbounded. Fix direction: sweep on `add()` (cheap amortised), or max-size cap with LRU.
- **M3 (must-fix): Secret is bound to plugin-boot `directory`, not per-invocation `context.worktree`** (`.opencode/plugins/foundry.js:36-43`). The code comment acknowledges this is deferred. In-process there is exactly one secret (boot-time). README claim "one per worktree" is misleading. Fix direction: re-read the secret on every mint/verify using `context.worktree`, or document single-worktree-per-process.
- **Positive findings:** HMAC-SHA256 correct; `timingSafeEqual` used; 32-byte `crypto.randomBytes` secret; file mode 0o600 on create; `stage-tools.js:29` strictly compares `payload.route` and `payload.cycle` against args (so cross-stage / cross-cycle replay is blocked by construction). **README claim "replays, forgery, and cross-stage reuse all fail closed" holds for the in-process single-worktree case.**
- **Should-investigate:** `verifyToken` returns full payload without shape validation (safe today because only one caller exists; add a guard or doc); `secret.js:14` reads existing secret without checking file mode (possible permission downgrade by a prior attacker); `randomBytes(32)` called before `openSync('wx')` — wasted entropy on every idempotent re-read.
- **Test coverage gaps:** per-field tampering (only `route` is tested); payload with missing/wrong-typed `exp`; truncated or oversize MAC; pending unbounded growth; pending sweep actually runs; two different `directory`s produce different secrets; EEXIST race on concurrent create; restart resilience of pending; cross-stage replay at integration level (claim is enforced by construction but not directly tested).

---

##### Cross-cutting themes

Three patterns showed up across multiple reports:

1. **Fail-open on errors is everywhere.** sort.js git-failure path, assay's silent feedback-write try/catch, memory's `disposeStores` unhandled throws, pending.consume's ambiguous `null`. The project's general instinct is "keep going on error" — defensible for tool robustness, dangerous for invariant enforcement.
2. **In-memory state with no persistence story.** `pending`, `stores` Map, the secret closure. Works for single-process, breaks on restart. No documented recovery procedure.
3. **Documented claims that the code doesn't fully implement.** Token `baseSha` binding, "aborts the cycle", "one secret per worktree", `checkExtractorAgainstCycle` wired at load time. Gap between design intent and implementation.

### Documentation

- [ ] **Add a CONTRIBUTING.md** if none exists (conventions, commit style, phase-plan workflow).
- [ ] **Add an ARCHITECTURE.md** or expand `docs/concepts.md` with a diagram of tool → lib dependencies.
- [ ] **Document the plugin-file split** once done (where new tools should go).

### Bugs found during review

#### Prioritised backlog from correctness re-reads

Ranked by severity × blast radius × confidence. Each item cites the subsystem finding above. Check boxes as work completes.

**P0 — Data-loss / corruption risks. Fix before next release.**

- [x] **[assay M1] Assay writes bypass embedder + NDJSON snapshot.** `putEntity` called with no `embedder`, `syncIfOutOfCycle` never invoked. Entities populated by extractors have no embedding row (search can't find them when embeddings are on) and are silently lost on the next `disposeStores` + reopen. Fix: thread `writeEmbedder` + post-batch `flush` through `runAssay` (mirror `memory-tools.js:20-25`). Test: integration test confirming embeddings populated and NDJSON synced after assay. **Blast radius: every extractor-written entity. Confidence: high (directly verifiable).** **— fixed in `ea954ad`.** `runAssay` now accepts `writeEmbedder` and forwards it to `putEntity` as `{ embedder }`. `assay-tools.js` uses `withStore` (same resolution as memory-* tools) and runs an unconditional `syncStore` after successful runs, making extractor writes durable before `stage_end`. Two new unit tests in `tests/lib/assay/run.test.js` (embedder present/absent) and one new integration test in `tests/plugin/assay-tools.test.js` (NDJSON contains extractor rows before `stage_end`). Suite: 563 → 566 tests passing.
- [x] **[memory M4] `reembed.js` leaves half-embedded state on provider failure.** New-dim DB rows + old-dim schema + old-dim NDJSON → next reopen corrupts. Fix: write new schema to disk before opening new store, OR reembed in temp DB + atomic rename. **Blast radius: only change-embedding-model path, but a silent corruption when it hits.** **— fixed in `e6a63b5`.** Rewrote `reembed` around a sibling staging DB (`<dbAbsolutePath>.reembed-tmp`): Phase 1 reads the live DB without mutating it, Phase 2 creates the staging DB at the new dimensionality and embeds into it, Phase 3 closes the staging DB and atomically renames it over the live DB (plus its WAL/SHM sidecars) before writing the new schema, Phase 4 refreshes NDJSON. On any failure (provider error, bad vector length, Cozo error) the staging DB is closed and unlinked and the live DB + on-disk schema + NDJSON are untouched. Added a red-then-green test (`leaves schema + DB + NDJSON untouched when embedder fails mid-flight`) asserting schema bytes, NDJSON bytes, DB byte length, and the absence of leftover staging files. Suite: 566 → 567 tests passing.
- [x] **[memory M5] `putEntity` is not transactional against NDJSON.** Cozo write succeeds, NDJSON write fails → in-memory DB ahead of on-disk source of truth → stale state on reopen. **— addressed in `d4fc2f2` + `d57852c` + `3ccceab` + `6c45385` + `4a5f10b` via a new WORK.md `status: failed` lifecycle.** Rather than try to make per-put writes transactional (expensive, changes the "NDJSON is source of truth, DB is derived" contract), `foundry_stage_end`'s syncStore failure path — previously swallowed by a `console.error` + `{ok:true}` return — now marks WORK.md `status: failed` with the sync error as `reason`. Every mutating plugin tool gates on `requireNotFailed(io)` and returns a clear error telling the caller to abandon the cycle via `foundry_workfile_delete`. Read-only tools and the escape hatches (`workfile_delete`, `git_finish`) remain callable. Skills driving each stage were updated to check `status: failed` at the top of their procedure and hand control back to the user. New lib module `scripts/lib/failed-flow.js` exposes the lifecycle helpers. Four new test files: `tests/lib/failed-flow.test.js` (unit, 12 cases), `tests/plugin/stage-end-failed-flow.test.js` (stage-end integration, 1 case), `tests/plugin/failed-flow-tool-gate.test.js` (12 refusals + 3 escape-hatch happy paths), `tests/plugin/failed-flow-e2e.test.js` (full lifecycle, 1 case). Suite: 567 → 596 tests passing.
- [x] **[memory M3] `openStore` is not crash-safe between `openMemoryDb` and `createEntityRelation`.** Schema-setup throw leaves an orphaned DB handle with an active WAL lock. Fix: try/catch around post-open work, call `closeMemoryDb(db)` on failure. **— fixed in `11047d7`.** Wrapped the post-open block (reconcile + entity loop + edge loop) in try/catch; on failure, `closeMemoryDb(db)` runs (best-effort; any close error is swallowed) and the original error rethrows. Added an optional `cozo` deps parameter to `openStore` (defaults to the real module) so tests can spy on `closeMemoryDb`; production callers unchanged. Three new tests in `tests/lib/memory/store.test.js`: close-on-entity-NDJSON-fault, close-on-edge-NDJSON-fault, no-double-close-on-happy-path. Investigation note: an earlier RED attempt testing "reopen same db path after mid-init failure" passed without the fix because cozo-node tolerates concurrent in-process handles on the same sqlite file (verified with a probe). The hazard is a native-fd leak in-process + cross-process WAL-lock blockade; tests observe the close call via DI rather than via reopen. Suite: 596 → 599 tests passing.

**P1 — Correctness bugs with observable user impact.**

- [ ] **[feedback M1] `detectDeadlocks` flags every `open` item once threshold is reached.** Any new open feedback after the threshold-th iteration routes straight to human-appraise / blocked, never round-trips through forge. Fix: drop `'open'` from the filter OR change threshold semantics to "iterations since item last touched by forge." Low-risk fix, clear behavioural change.
- [ ] **[feedback M3] `parseFeedbackItem` resolution detection is substring-based.** `line.includes('| approved')` misclassifies items whose body contains that substring. Fix: tail-anchored regex.
- [ ] **[sort M1] Micro-commit guard fails open on any git error.** Sandbox with no git, denied permissions, or `index.lock` silently disables the guard. Same pattern disables file-pattern enforcement. Fix: distinguish "git clean" from "git failed"; surface failure as `route: 'violation'` unless explicitly opted out.
- [ ] **[sort M2] `getModifiedFiles` uses fragile substring match + 20-commit window.** Long cycles fall off the window; ambiguous commit messages match. Fix: record sort SHA in `WORK.history.yaml` or a sentinel ref.

**P2 — Design/invariant hardening. Not exploitable today, but the footgun is loaded.**

- [ ] **[feedback M2] `readItemState` vs `listFeedback` model the same value differently.** Validator sees `'approved'` string; router sees `{ state, resolved }`. Works today; breaks silently when new states are added. Fix: unify on `{ state, resolved }` + introduce a `derivedState(parsed)` helper.
- [ ] **[memory M1] `disposeStores` is not exception-safe.** Throw mid-loop leaks handles across test runs → "database is locked" on reopen. Fix: per-entry try/catch.
- [ ] **[memory M2] No `process.on('exit'|'SIGINT'|'SIGTERM')` hook for `disposeStores`.** SIGKILL leaves WAL/SHM on disk. Register a shutdown hook in plugin entrypoint.
- [ ] **[sort M3] Token not bound to `baseSha`.** README implies it is. In-memory `pending` Map does all the work today; process restart is a confusing liveness failure. Fix: include `baseSha` in token payload; verify in `stage_begin`.
- [ ] **[token M1] `pending` replay store does not survive process restart.** Legitimate tokens fail after restart with unhelpful error. Fix: persist `pending` to `.foundry/pending.json`, OR surface a clearer error + document the restart window.
- [ ] **[token M2] `pending` grows unbounded / no background eviction.** Fix: sweep on `add()` or max-size cap with LRU.
- [ ] **[token M3] Secret is bound to plugin-boot `directory`, not per-invocation `context.worktree`.** In-process there is exactly one secret. README "one per worktree" is misleading. Fix: re-read per call, OR document single-worktree-per-process.

**P3 — Doc & coverage work. Do these alongside the related P0/P1 fixes.**

- [ ] **[assay M2] `checkExtractorAgainstCycle` exists, is unit-tested, but has no production call site.** Phase-1 plan said call it at cycle load. Fix: wire it into the cycle loader.
- [ ] **[assay doc] `docs/concepts.md:55` says assay "aborts the cycle"** — reality is "aborts further extractors; prior writes stand." Align doc and code.
- [ ] **[assay footgun] `parseTimeout` treats unitless `"30"` as 30 ms.** Author writing `timeout: 30` intending seconds gets 30 ms. Reject unitless or default to seconds.
- [ ] **[memory doc] `memory-tools.js:143` tool description is stale** re: which `foundry_memory_query` ops are rejected. Update to match the allowlist in `query.js`.
- [ ] **[memory] `foundry_memory_validate` doesn't check orphan / dangling edges, NDJSON ↔ DB row counts, embedding-dim consistency.** Extend checks.
- [ ] **[memory] Document the crash-recovery procedure** (NDJSON is source of truth; delete `memory.db*` to recover from corruption).
- [ ] **Test coverage** — each subsystem has enumerated gaps (see findings above). Worth a single "coverage pass" after the P0/P1 fixes land.

#### Follow-ups from P0 #3 (failed-flow)

Surfaced by the final integration review of the failed-flow series (`d4fc2f2` → `0adcc20`). Kept as pending checkboxes so they surface in the next pass.

- [ ] **`stage_end` when WORK.md is already failed — add test.** Spec says `stage_end` is intentionally ungated on `requireNotFailed` (it's the tool that writes the failed status; gating would deadlock). No direct test asserts that calling `stage_end` on an already-failed flow still succeeds / behaves sanely. Add one.
- [ ] **`foundry_git_finish` under a failed flow — add test.** The skill copy + REVIEW.md entry claim `git_finish` is an escape hatch that works while `status: failed`. Not directly tested. Add an integration test that marks the flow failed and then runs `git_finish` end-to-end.
- [ ] **`foundry_memory_admin_*` tools NOT gated by failed-flow — add assertion.** Admin tools (reset, drop type, rename, etc.) were deliberately left ungated. Add an explicit test that calls each admin tool against a failed WORK.md and asserts it proceeds (or, if any should be gated, fix and test).
- [ ] **Reconcile `failed-flow.js` module docstring with skill copy.** The lib module's docstring mentions manual WORK.md edit as a recovery path; the user-facing skills only mention `foundry_workfile_delete`. Pick one narrative and make both sources agree.
- [ ] **WORK.md absent when `markWorkfileFailed` runs — add integration test.** In `stage_end`'s failure path, if WORK.md has already been deleted (or never existed) when we try to mark it failed, the inner catch swallows the error and `flow_failed` is NOT set in the response. Behaviour is intentional but untested; lock it in with a test so future refactors don't silently change it.

**Already-known, previously-flagged:**

- [ ] **`makeIO.readDir` sync-but-awaited inconsistency** in `helpers.js` (previously flagged with appraisers fix).
- [ ] **`addFeedbackItem` has its own ~60-line scanner** not covered by the walker refactor. Could extract `locateFeedbackSection(lines) → { feedbackIdx, feedbackLevel, sectionEnd, fileHeadings }`.
- [ ] **`detectDeadlocks` threshold name/semantics mismatch** (separate from M1 above — the name implies per-item, the implementation is global).

---

##### Earlier findings

- [x] **`foundry_appraisers_select` is broken** (`.opencode/plugins/foundry.js:928-938`). The `execute` body references an undefined `result` and would throw `ReferenceError` on any invocation. No test coverage — that's how it slipped through. Likely intended: `const result = await selectAppraisers('foundry', args.typeId, args.count, io); return JSON.stringify(result);` using the already-imported `selectAppraisers`. Fix in a separate commit and add a test. **— fixed in `8aaf8c2` (root cause: lines accidentally dropped in `7cc7550`, propagated through `bb16bc9` refactor). Regression test added at `tests/plugin/appraiser-tools.test.js` (3 cases). Full suite now 563 passing.**

  **Latent issue flagged by implementer (not fixed, not in scope):** `makeIO.readDir` in `.opencode/plugins/foundry-tools/helpers.js` is synchronous but `scripts/lib/config.js` `await`s it. Works by accident (`await` on non-thenable resolves immediately). `makeMemoryIO` is properly async. Worth reconciling in a future cleanup.

### Future / nice-to-have

- [ ] **Benchmark suite** — some cycles (especially with memory + embeddings) could regress silently; a few `node --test` perf sanity checks would help.
- [ ] **Plugin API compatibility test** — lock down the `@opencode-ai/plugin` surface with a contract test so upstream breaks are caught immediately.
- [ ] **`refresh-agents` portability** — the multi-model routing currently requires OpenCode agent files. Consider a portability shim or explicit "OpenCode-only" guard.
