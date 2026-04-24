# Phase 3 Review — Plugin Tool API Switch

**Reviewer:** code review agent
**Date:** 2026-04-24
**Files reviewed:**
- `new-feedback/2026-04-24-work-feedback-yaml-redesign.md` (spec)
- `new-feedback/PLAN.md`
- `new-feedback/phase-3-plugin-api.md` (primary)
- `new-feedback/phase-1-feedback-store.md`, `phase-2-history-hardening.md` (contract)
- Live codebase: `.opencode/plugins/foundry-tools/`, `tests/plugin/`, `scripts/lib/feedback.js`, `scripts/lib/stage-guard.js`

---

## Summary verdict

**Needs revision before execution.** The plugin-API rewrite is directionally correct and faithfully tracks spec §8. But the phase file is built on two incorrect assumptions about the existing codebase — the active-stage filename and the existence of a reusable `tool` stub — that cascade through five of the twelve tasks. The assay-tools sync/async boundary in Task 3.11 is a hard blocker that the plan waves at rather than resolves. There are also two genuine contract gaps (list error-vs-array response; missing tool description updates) and several minor issues. Fix the blockers and the remaining work is straightforward.

## Strengths (brief)

- **TDD discipline** is genuine: every task opens a RED test, verifies the failure mode, then implements. Commit boundaries are clean.
- **Incremental tool migration** (one tool per commit; explicit transient-broken-state acknowledgement in Task 3.3 Step 5) avoids big-bang risk.
- **Spec §8 coverage** is complete: every tool signature change, the authorship rule, dedup behaviour, and the deadlock-override path are tested end-to-end through the plugin surface.
- **Legacy bridge retained**: sort/orchestrate callers are explicitly deferred to phase 4; phase 3 leaves `scripts/lib/feedback.js` untouched (good — avoids scope creep).
- **Task 3.10 is a strong contract test**: locks in deadlock override behaviour end-to-end, with negative cases for each wrong-stage attempt.

---

## Issues by severity

### BLOCKER

#### B1. Active-stage filename is wrong in Task 3.2 / 3.6 / 3.8 / 3.9 / 3.10 (phase-3-plugin-api.md:98–102, and every subsequent `writeFileSync(path.join(worktree, '.foundry', 'active-stage'), …)`)

The codebase uses `.foundry/active-stage.json` (see `scripts/lib/state.js:1`: `const ACTIVE = '.foundry/active-stage.json'`; confirmed at `tests/plugin/stage-end-failed-flow.test.js:53`, `tests/plugin/failed-flow-e2e.test.js:52`, `tests/orchestrate.test.js:375`). The plan's test scaffolding writes to `.foundry/active-stage` (no extension). **Every test written from these fixtures will fail the precondition check `requireActiveStage(io)` because `readActiveStage` won't find the file** — the executor will see a "no active stage" error and chase ghosts.

The plan does acknowledge the risk ("Write down the exact active-stage file format before proceeding — every task below depends on it" at Task 3.1 Step 1) and again under Task 3.3 Step 3a, but the example scaffolding it hands the executor is *already wrong*. A naive executor will copy-paste and burn cycles.

**Fix:** Replace every `.foundry/active-stage` string literal in Tasks 3.2, 3.6, 3.8, 3.9, 3.10 with `.foundry/active-stage.json`. Consider adding a small fixture helper to the test file to centralise the path:

```js
function writeActiveStage(dir, { stage, cycle, flow = 'creative' }) {
  writeFileSync(
    path.join(dir, '.foundry/active-stage.json'),
    JSON.stringify({ stage, cycle, flow }),
    'utf-8',
  );
}
```

Also confirm the payload shape. Inspection of `tests/plugin/stage-end-failed-flow.test.js:53–54` shows real callers write `{ cycle, stage, baseSha }` — no `flow` field. The plan's extra `flow` key is harmless but incorrect to the spec of the real file.

---

#### B2. Fabricated `tool` stub will not work against production schema calls (phase-3-plugin-api.md:85–90, repeated in Task 3.1)

The plan proposes:

```js
const toolStub = (def) => def;
toolStub.schema = {
  string: () => ({ describe: () => ({ optional: () => ({}) }), optional: () => ({}) }),
  number: () => ({ describe: () => ({}) }),
  enum: () => ({ describe: () => ({}) }),
};
```

But **no existing plugin test uses a hand-rolled `tool` stub**. Every plugin test in `tests/plugin/*.test.js` (e.g. `assay-tools.test.js:7`, `stage-tools.test.js`, `orchestrate.test.js`) uses the real plugin: `const plugin = await FoundryPlugin({ directory: root }); plugin.tool.foundry_feedback_add.execute(...)`. Task 3.1's Step 2 asks the executor to "locate that stub in whichever existing plugin-test file uses it" — **it doesn't exist**. The executor will either invent one (and carry the cost of keeping it in sync with opencode's real `tool` factory) or stop and escalate.

Beyond that, the stub is under-specified: `tool.schema.array(tool.schema.string())` is used by `assay-tools.js:16` but not by feedback-tools — if feedback-tools later grows an array arg, the stub silently returns `undefined`.

**Fix:** Rewrite Tasks 3.1 and 3.2 to use `FoundryPlugin({ directory: root })` (the actual pattern from `tests/plugin/assay-tools.test.js:70`). Access tools via `plugin.tool.foundry_feedback_add.execute(args, { worktree: root })`. Drop the `toolStub` apparatus entirely. This also removes the import of `createFeedbackTools` from the test — tests should exercise the public plugin surface, not the internal factory.

---

#### B3. Task 3.11 assay-tools sync/async boundary unresolved (phase-3-plugin-api.md:1055–1068)

`scripts/lib/feedback-store.js` (phase 1) uses **sync** IO: `io.exists`, `io.readFile`, `io.writeFile`, `io.rename` are sync. `.opencode/plugins/foundry-tools/assay-tools.js` runs inside `withStore(context)`, which hands the caller `memIo` — an **async** shim from `makeMemoryIO` (see `.opencode/plugins/foundry-tools/helpers.js:114–125`: every method is `async`). The plan's Task 3.11 Step 4 shows:

```js
const fm = parseFrontmatter(io.readFile('WORK.md'));
const store = openFeedbackStore('WORK.feedback.yaml', io);
```

but does not say which `io` — the existing code uses `memIo` (async) and has `io` (sync) in scope from line 19. Either:

- (a) open the store against sync `io` (the one from `makeIO`) — doable but means two IO handles active in the same tool; the memIo-owned `WORK.md` read in the existing fallback path at line 54 now conflicts; or
- (b) teach `feedback-store` to accept either sync or async IO — non-trivial refactor and outside phase 3 scope; or
- (c) introduce a second sync IO inside assay-tools.

The plan hand-waves: "If the assay-tools function doesn't have `activeStage` in scope, thread it through — follow the same pattern as feedback-tools.js" — but the sync/async mismatch is the real blocker, and it's not `activeStage`.

**Fix:** Pick (a): use the already-present sync `io` (line 19) for `openFeedbackStore`. The `await memIo.exists(workPath)` guard on line 53 is independent (it's the assay-aborted branch). Explicitly state in the task:

```js
const sio = io;  // sync IO from makeIO, line 19
const fm = parseFrontmatter(sio.readFile('WORK.md'));
const store = openFeedbackStore('WORK.feedback.yaml', sio);
const activeStage = guard.active.stage;  // from requireActiveStage call at top of tool
store.add({ file: 'WORK.md', tag: 'validation', text: msg, source: activeStage, cycle: fm.cycle });
```

Also note: the current assay-tools code only emits feedback in the **failure** branch (line 50–60), not on every run. The rewrite must preserve that semantic — the plan's diff doesn't make this clear and reads as if feedback is always emitted.

---

### MAJOR

#### M1. `foundry_feedback_list` error-vs-array contract violation (phase-3-plugin-api.md:418–421)

Rewritten `foundry_feedback_list` returns `JSON.stringify({ error: 'WORK.md not found' })` when WORK.md is absent, but otherwise returns `JSON.stringify([...])`. Callers receive either an array or an object — the type of the JSON parse result is non-deterministic without sniffing. The old code had the same bug; the rewrite perpetuates it instead of fixing it.

Spec §8.1's public contract is `{file?} → [{id, file, tag, text, source, state, depth, reason?}]` — an array, always.

**Fix:** When WORK.md is missing or `WORK.feedback.yaml` is absent, return `JSON.stringify([])`. Reserve error responses for genuine failures (e.g. yaml parse error from a corrupted file — which `openFeedbackStore` already throws for, and the existing try/catch handles). Update the corresponding test at phase-3-plugin-api.md:389 ("returns an empty array when WORK.feedback.yaml is absent") to also cover the WORK.md-absent case.

---

#### M2. Tool `description` strings not updated (phase-3-plugin-api.md:413 and all tool definitions)

Tool descriptions are consumed by LLM tool-callers as the primary UX — when a skill says "call foundry_feedback_add", the LLM reads the description to understand inputs. The rewrites preserve strings like "Add a feedback item to WORK.md under a file heading" (line 13 of the current file) even though `WORK.md` is no longer touched. `foundry_feedback_action`'s "Mark a feedback item as actioned [x]" still references the markdown checkbox syntax.

**Fix:** Update every tool's `description` string in the rewritten definitions:

- `foundry_feedback_add`: "Add a feedback item against an artefact file (writes to WORK.feedback.yaml)"
- `foundry_feedback_action`: "Mark a feedback item as actioned (forge stages only)" — already correct in 3.7, good
- `foundry_feedback_wontfix`: already correct in 3.8
- `foundry_feedback_resolve`: already correct in 3.9
- `foundry_feedback_list`: "List feedback items from WORK.feedback.yaml, optionally filtered by artefact file"

Add a test assertion that the description does not contain "WORK.md" — cheap, prevents regression.

---

#### M3. Test harness path uses hardcoded active-stage without helper (phase-3-plugin-api.md:98–102, repeated ~8 times)

Even after fixing B1, the plan re-inlines the full JSON.stringify + writeFileSync every time it wants to change the active stage (at lines 492–496, 611–615, 622–626, 645–649, 734–738, 749–753, 766–770, 781–785, 891–895, 923–927). This is copy-paste bloat and a correctness risk — each re-inlining is another place for a typo.

**Fix:** Extract the helper once in Task 3.2:

```js
function setActiveStage(dir, stage, cycle = 'write-haiku', flow = 'creative') {
  writeFileSync(
    path.join(dir, '.foundry/active-stage.json'),
    JSON.stringify({ cycle, stage, baseSha: 'test-sha' }),
    'utf-8',
  );
}
```

And rewrite all subsequent call sites to `setActiveStage(worktree, 'forge:write')`. This also matches the real file's shape `{cycle, stage, baseSha}` per the codebase inspection at B1.

---

#### M4. Task 3.10 relies on phase-1 `writeDeadlockedSnapshot` behaviour that isn't part of the plugin surface (phase-3-plugin-api.md:881–888, repeated 3×)

The test helper manually constructs a deadlocked snapshot by unshifting into yaml directly:

```js
doc.items[0].history.unshift({ state: 'deadlocked', stage: 'sort', … });
writeFileSync(feedbackPath, yaml.dump(doc), 'utf-8');
```

This works, but it duplicates knowledge of the on-disk schema in the test file — if spec §4.1 evolves (e.g. nested metadata), these three tests break invisibly (they'll still pass with stale snapshot shape but fail to exercise the real sort-written format).

**Fix:** Import `openFeedbackStore` in the test and use `store.writeDeadlockedSnapshot({id, cycle, reason})` directly. Phase 1 already exposes it (phase-1-feedback-store.md:882). This couples the test to the public store API rather than the file format — cleaner coupling, same test fidelity.

---

### MINOR

#### m1. Grep preflight is broken for zsh (phase-3-plugin-api.md:26)

```bash
rg -l "foundry_feedback_add\|foundry_feedback_action\|foundry_feedback_list" tests/
```

In zsh, `\|` is a literal pipe string, not a regex alternator. `rg` uses Rust regex; you need either `"foundry_feedback_(add|action|list)"` or unescaped `"foundry_feedback_add|foundry_feedback_action|..."`. The first form is correct and works.

**Fix:** Replace with `rg -l "foundry_feedback_(add|action|list)" tests/`.

---

#### m2. "Verify before committing" heuristic is fragile (phase-3-plugin-api.md:325–328)

```bash
npm test 2>&1 | rg -c 'fail'
```

This counts lines containing "fail" — it hits the string in test names (e.g. `describe('fail gracefully')`, comments, etc.), not actual failures. A better signal is `npm test` exit code (`$?`) or grepping for the explicit `node:test` summary line `# fail <N>`.

**Fix:** Replace with `npm test; test $? -eq 0` or `npm test 2>&1 | rg -c '^# fail'` (node:test emits `# fail 0` at end of run; counts the literal summary line once).

---

#### m3. `depth = 0` for resolved items is undocumented in spec (phase-3-plugin-api.md:435)

Spec §5.2 defines `depth = history.length` only for non-resolved items. Phase 3 Task 3.5 decides resolved items get `depth: 0`. That's a reasonable choice but not spec'd — a downstream consumer (e.g. a future debug tool) might expect `depth` to mean `history.length` always. Not wrong, but undocumented.

**Fix:** Either add a comment in the rewritten `foundry_feedback_list` ("depth is 0 for resolved items per plan phase 3 — terminal") or bump to spec §8.1 as an addendum. Alternatively, keep `depth: it.history.length` for resolved too; the cost is minimal.

---

#### m4. Resolved items still returned by list with no terminal filter (phase-3-plugin-api.md:424–439)

`foundry_feedback_list` returns all items including `resolved`. For sort/forge consumers this is the right answer (they filter). But LLM consumers reading the response will see a growing list of historical resolved items and may waste tokens/reasoning on them.

Not wrong — spec §8.1 says the tool returns "items optionally filtered by file" with no implicit terminal filter. But a `includeResolved?: boolean` flag (default true for back-compat; callers opt out) would be a cheap UX win and worth considering in phase 3 rather than a later breaking change.

**Fix (optional, worth discussing):** Add an `includeResolved` flag now; skills that don't care about resolved items (forge, quench) pass `false`.

---

#### m5. Task 3.11 test-file discovery is imprecise (phase-3-plugin-api.md:1002–1005)

```bash
rg -l "foundry_assay_run" tests/
```

This returns `tests/plugin/assay-tools.test.js`, `tests/plugin/assay-e2e.test.js`, `tests/plugin/assay-orchestration.test.js`. Three files, not one. The plan says "stage that specific file" (singular) but the executor may need to update fixtures in all three.

**Fix:** List all three files explicitly in Task 3.11 Step 2, and audit each for `## Feedback` or `addFeedbackItem` fixture assertions.

---

#### m6. No forward-compat schema version field (spec §4.1 implicitly)

Spec §4.1 rationale: "Top level is always `{ items: [...] }` so future sibling sections (schema version, metadata) have a home". But neither phase 1 nor phase 3 actually writes a `version: 1` sibling. Any future schema bump will have to infer version from field presence — more fragile than an explicit version key.

**Fix (optional, non-blocking):** When `openFeedbackStore.persist` writes, include `version: 1`. Reader ignores unknown top-level keys; writer always stamps current version. Cheap insurance; fits the spec's intent.

---

### NIT

#### n1. Commit message body refers to "spec §8.1: stageBase? arg removed" — the old tool did not have a `stageBase?` arg (phase-3-plugin-api.md:337–339)

Inspection of the current `foundry_feedback_add` at `.opencode/plugins/foundry-tools/feedback-tools.js:12–18` shows args are `{file, text, tag}` — no `stageBase?`. Spec §8.1 table lists "Before: `{ file, text, tag, stageBase? }`" but that's actually inaccurate vs current code. The commit message repeats the inaccuracy.

**Fix:** Drop the "stageBase? arg removed" clause; it was never present. This is a spec correction, not a phase-3 code issue, but the plan's commit message propagates it.

---

#### n2. `Task 3.2 step 2` failure-mode description is vague (phase-3-plugin-api.md:204–208)

"`foundry_feedback_add` still writes `WORK.md` instead of `WORK.feedback.yaml`" — true but the assertion failure will actually come from `readFileSync(WORK.feedback.yaml, 'utf-8')` throwing ENOENT. Slightly more precise failure-mode docs help the executor distinguish "legitimate RED" from "harness bug".

**Fix:** Append: "specifically `readFileSync('WORK.feedback.yaml')` throws ENOENT; the test file didn't exist because the old code writes `WORK.md`."

---

## Open questions

1. **Is `baseSha` in active-stage.json required by `requireActiveStage`?** Quick inspection (`stage-guard.js:15–24`) suggests no — the guard only looks at `stage` and `cycle`. Tests should be allowed to omit it. But the real callers always write it. Recommend: test harness writes a dummy `baseSha: 'test'` to match production fidelity.

2. **How does phase 3 handle the `ulid` module's per-process monotonic state across tests?** `scripts/lib/ulid.js` maintains `lastTime` / `lastRandom` at module scope (phase-1-feedback-store.md:103). Tests run in isolated processes per `node --test`, so cross-test contamination isn't an issue. But if a future test imports the feedback-store twice in the same process (parallel describe blocks), the monotonic counter will yield the same ID space — benign but worth a note.

3. **`foundry_feedback_list` when `WORK.feedback.yaml` exists but WORK.md doesn't?** Edge case not covered by any phase-3 test. The plan rewrites list to check `io.exists('WORK.md')` first (line 419) and error out. But the feedback file is the source of truth — if WORK.md is gone (e.g. deleted mid-cycle), is the correct response an error or the items? Spec is silent. Recommend: align with current behaviour (error) but note the coupling explicitly.

4. **Should Task 3.11 move to phase 4?** The spec-§12 assay skill update sits in phase 5; the assay-tools plugin code change sits in phase 3. That's inconsistent. Phase 4 is where sort/orchestrate move to feedback-store — assay is in the same "producer of feedback" family. Consider moving Task 3.11 to phase 4 so all plugin-code migrations to feedback-store happen in one phase, and phase 3 is strictly the five `foundry_feedback_*` tools. Minor restructuring; worth a decision before execution.

---

## Contract with phases 1 & 2

**Phase 1 outputs consumed:**
- `openFeedbackStore(path, io)` — correctly invoked throughout phase 3.
- `store.add({file, tag, text, source, cycle})` — signature matches phase-1 task 1.6.
- `store.transition({id, target, stage, cycle, reason?})` — signature matches phase-1 task 1.8.
- `store.list()` — shape matches phase-1 task 1.6.
- `hashText` — not directly used by phase 3 (good; encapsulated in store).
- `ulid` — not directly used by phase 3 (good).
- **Missing consumption:** `store.writeDeadlockedSnapshot` is used only in test fixtures (see M4 for the suggestion to use it there). That's fine — sort owns it in phase 4.

**Phase 2 outputs consumed:**
- `io.rename` on `makeIO` — used by `openFeedbackStore` transitively. Good.
- `## Feedback` removal from `createWorkfile` — phase 3's tests write their own WORK.md fixture, so they don't inherit the empty workfile. But any phase-3 test that calls `createWorkfile` would need to have that section absent. None in the plan do. Fine.
- History `seq`, `open_feedback`, `route` invariant: untouched by phase 3. Good — these belong to sort/orchestrate in phase 4.

No contract drift between phase 1/2 and phase 3. Types line up.

---

## Recommendation

**Revise phase 3 before dispatch.** The three blockers (B1 filename, B2 tool stub, B3 assay sync/async) will each cost the executor a full cycle to untangle, and B3 in particular is a design decision that the plan-author should make, not the executor. The majors are all fixable with ~5 targeted edits. Once blockers and M1–M4 are addressed, phase 3 is a clean plugin-API swap.

Specifically, I recommend:

1. Rewrite Task 3.1 and Task 3.2's test-harness scaffolding to use the real `FoundryPlugin({directory: root})` pattern (addresses B2). Remove the `toolStub` apparatus.
2. Fix the active-stage filename globally to `.foundry/active-stage.json` with payload `{cycle, stage, baseSha}` (addresses B1).
3. Add an explicit `setActiveStage(dir, stage, cycle?)` helper in Task 3.2 and reuse it in all subsequent tasks (addresses M3).
4. Rewrite Task 3.11 Step 4 with explicit sync-`io` handle for `openFeedbackStore`, and preserve the "feedback emitted only on failure" semantic from the current assay-tools code (addresses B3).
5. Fix the `foundry_feedback_list` empty-case to return `[]` rather than `{error}` (addresses M1).
6. Update every tool's `description` string to drop `WORK.md` language (addresses M2).
7. Consider moving Task 3.11 to phase 4 for coherence (open question 4).
8. Apply minor fixes: grep preflight syntax (m1), verification heuristic (m2), depth-for-resolved documentation (m3), test-file discovery plurality (m5).

After revision, phase 3 should be ~30 minutes of senior-engineer execution per task, ~4 hours total.
