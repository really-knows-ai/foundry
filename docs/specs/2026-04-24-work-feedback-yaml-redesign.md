# Spec: WORK.feedback.yaml redesign + history.yaml hardening

**Status:** draft
**Date:** 2026-04-24
**Authors:** Foundry maintainers (via brainstorming session)
**Supersedes:** REVIEW.md P1 `[feedback M1]`
**Related:** REVIEW.md P1 `[feedback M3]`, P2 `[feedback M2]`, P2 `[memory M1-M2]`, P3 testing gaps

## 1. Motivation

Today, feedback lives as markdown checklist lines in the `## Feedback` section of `WORK.md`. The `detectDeadlocks` function (`scripts/lib/feedback.js:190`) flags every `open` item as deadlocked once a global forge-appraise iteration counter hits its threshold. Brand-new feedback added during the threshold-th iteration is routed straight to human-appraise or blocked without ever being seen by forge.

The root cause is not the filter predicate — it is the data model. There is no per-item rework history; sort has to infer "how many times has this item round-tripped forge→appraise" from a global counter that doesn't know which items existed when.

This spec introduces `WORK.feedback.yaml`: a first-class persistent record of every feedback item and its full state-transition history. Deadlocks become per-item — an item is deadlocked when *its own* history is deep enough, independent of global iteration count. New items always go back to forge first. The global `deadlock-iterations` frontmatter key is kept (default 3) but now means "per-item history depth," not "total appraise runs."

The same spec also folds in a prerequisite `WORK.history.yaml` audit — that file's writer has observed incompleteness in the wild, several of its behaviours aren't documented, and it gains a new field (`open_feedback`) as part of this work. The audit fixes are bundled here because the feedback redesign changes how we count open-feedback-at-a-moment, which the history writer needs to know about.

## 2. Goals

- **Per-item deadlock detection.** An item is deadlocked only when its own rework depth exceeds the threshold.
- **Immutable audit log per item.** Every state change appends a snapshot; no snapshot is ever mutated. A resolved feedback item's full journey is visible forever.
- **Single source of truth for feedback state.** YAML file, no markdown mirror.
- **Stage-source authorship enforcement.** Only the creator stage can resolve/reject a non-deadlocked item. Human-appraise has override authority on deadlocked items.
- **Durable writes.** Crashes mid-write never corrupt `WORK.feedback.yaml` or `WORK.history.yaml`. Incomplete history.yaml observed in the wild motivated the atomicity work.
- **Debuggability.** `WORK.history.yaml` gains `open_feedback: <N>` on every entry so a reader scanning history alone can see how feedback load changed stage by stage.

## 3. Non-goals

- Migration from the old `## Feedback` markdown format. Hard cutover.
- Tombstoning or archival of resolved items (they stay in the file forever).
- Cross-cycle debug views (single-cycle filtering is sufficient today).
- Rendering a derived "## Feedback" section back into WORK.md.
- General concurrency / multi-process safety (Foundry remains single-writer per file).

## 4. Data model — WORK.feedback.yaml

New file at the worktree root, alongside `WORK.md` and `WORK.history.yaml`. Tracked in git, committed per-stage, deleted at `foundry_git_finish` (same lifecycle as `WORK.history.yaml`).

### 4.1 Schema

```yaml
# WORK.feedback.yaml
items:
  - id: 01HXY8K9Q5Z3WN0GJM2TYBR4AB        # ULID, stable for item's lifetime
    file: haiku.md                         # artefact file the feedback targets
    tag: law:dark-moody-tone               # feedback source (without leading #)
    text: tone is too cheerful             # original author-supplied body (immutable)
    source: appraise:write-check           # full stage id (base:alias) of creator
    history:                               # reverse chronological; history[0] = current
      - state: resolved
        stage: appraise:write-check
        cycle: write-haiku
        timestamp: 2026-04-23T10:40:00.123Z
      - state: actioned
        stage: forge:write
        cycle: write-haiku
        timestamp: 2026-04-23T10:33:00.456Z
      - state: rejected
        stage: appraise:write-check
        cycle: write-haiku
        timestamp: 2026-04-23T10:30:00.789Z
        reason: still too bright
      - state: actioned
        stage: forge:write
        cycle: write-haiku
        timestamp: 2026-04-23T10:22:00.111Z
      - state: open
        stage: appraise:write-check
        cycle: write-haiku
        timestamp: 2026-04-23T10:15:00.222Z
```

Top level is always `{ items: [...] }` so future sibling sections (schema version, metadata) have a home without breaking readers.

### 4.2 Item fields

| Field | Type | Required | Mutable? |
|-------|------|----------|----------|
| `id` | string (ULID, 26 chars) | yes | no |
| `file` | string | yes | no |
| `tag` | string (no leading `#`) | yes | no |
| `text` | string | yes | no |
| `source` | string (`base:alias`) | yes | no |
| `history` | array, length ≥ 1 | yes | prepend-only |

Rationale for ULID: monotonically-sortable, 26 chars, no dependencies (implementable in ~40 LOC of pure Node), opaque to humans but not adversarial.

### 4.3 Snapshot fields

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `state` | enum | yes | `open \| actioned \| wont-fix \| rejected \| deadlocked \| resolved` |
| `stage` | string (`base:alias`) or literal `sort` | yes | Who performed the transition |
| `cycle` | string | yes | Cycle id at the time of the transition |
| `timestamp` | ISO-8601 UTC with ms | yes | `new Date().toISOString()` |
| `reason` | string | conditional | Required on `rejected`, `wont-fix`, `deadlocked`; forbidden on `open`, `actioned`, `resolved` |

### 4.4 Snapshot ordering

`history[0]` is always the current state. New snapshots are prepended. This is the inverse of the chronological order used by `WORK.history.yaml`; the divergence is deliberate so "current state" is always a constant-time lookup.

## 5. State machine

```
               forge            quench / appraise / human-appraise              sort        human-appraise
               (open,rejected)   (source == item.source)                        (any)       (state==deadlocked only)

open        → {actioned, wont-fix}    —                                          → deadlocked   —
rejected    → {actioned, wont-fix}    —                                          → deadlocked   —
actioned    —                         → {resolved, rejected}                     → deadlocked   —
wont-fix    —                         → {resolved, rejected}                     → deadlocked   —
deadlocked  —                         —                                          —             → {resolved, wont-fix, rejected}
resolved    —                         —                                          —              —     (terminal)
```

### 5.1 Legal transition rules

1. **Creation.** A new item is created by calling `foundry_feedback_add` from a quench, appraise, or human-appraise stage. The item's initial `history[0]` is `{ state: 'open', stage, cycle, timestamp }`. Forge cannot create items. Creation is not a "transition" in the matrix sense — it brings the item into existence in the `open` state.
2. **Forge transitions.** Forge operates only on items where `history[0].state ∈ {open, rejected}`. Produces `actioned` or `wont-fix`. Forge cannot operate on `actioned`, `wont-fix`, `deadlocked`, or `resolved` items.
3. **Source-stage transitions.** Quench, appraise, and human-appraise operate only on items where:
   - `history[0].state ∈ {actioned, wont-fix}` AND
   - the caller's `stageId === item.source`.
   Produce `resolved` or `rejected`. `rejected` requires a `reason`.
4. **Sort transitions.** Sort (and only sort) transitions items into `deadlocked`. See §6.
5. **Deadlock override.** Human-appraise can transition `deadlocked` items to any of `{resolved, wont-fix, rejected}` **regardless of `item.source`**. This is the deadlock override. `reason` is always required on a deadlocked-item resolution (documents the override).
6. **Terminal state.** `resolved` is terminal. No snapshots are ever appended to an item whose `history[0].state === 'resolved'`.

### 5.2 Depth and deadlocks

For a non-resolved item, `depth = history.length`.

When `deadlock-appraise: true` (default), sort walks all non-resolved non-deadlocked items before emitting a route. For any item where `depth ≥ deadlock-iterations` (frontmatter key, default 3), sort prepends a new snapshot `{ state: deadlocked, stage: 'sort', cycle, timestamp, reason: 'depth=<N> >= threshold=<T>' }`.

After the pass, sort's routing logic reads `history[0].state === 'deadlocked'` to decide whether to route to human-appraise:
- If any item is deadlocked AND current stage base is not `human-appraise`: route to the cycle's `human-appraise` stage (existing in `stages` frontmatter, else synthesized as `human-appraise:<cycle>`).
- If any item is deadlocked AND current stage base IS `human-appraise`: route `blocked`.
- Otherwise: fall through to normal routing.

When `deadlock-appraise: false`, sort skips the deadlock pass entirely. No depth check, no deadlocked snapshots, no special routing. The cycle loops until `max-iterations` or the user intervenes. This matches today's semantics for the disabled case.

### 5.3 Rejection of wont-fix attempts

A `wont-fix` is not terminal — it must still be approved by the source stage. If appraise rejects a `wont-fix` (e.g. "no, you need to actually address this"), the item goes to `rejected` state, depth increments, and forge picks it up again on the next forge entry. This was implicit in the old model; made explicit here.

## 6. Sort integration

### 6.1 Deadlock snapshot pass

`runSort` in `scripts/sort.js` acquires a feedback-store handle early, walks all items via the new API, and writes deadlocked snapshots for any that qualify. This is the ONLY writer of `state: deadlocked`. The writer is invoked as:

```js
const deadlocked = writeDeadlockSnapshots(feedbackStore, {
  threshold: frontmatter['deadlock-iterations'] ?? 3,
  enabled:   frontmatter['deadlock-appraise'] !== false,
  cycle:     frontmatter.cycle,
});
// deadlocked: [ { id, previousState, depth } ]
```

`writeDeadlockSnapshots` works on a single in-memory snapshot of the items: it walks the list, prepends `{ state: deadlocked, ... }` to every item that qualifies in the same pass, then serialises and writes the full file once via the atomic rename in §9.2. A crash at any point leaves the yaml either fully updated (all N deadlock snapshots present) or untouched (none). There is no intermediate state where half the qualifying items are deadlocked and half aren't.

### 6.2 `detectDeadlocks` removed

The current `detectDeadlocks(feedback, history, threshold)` function is deleted. Its replacement is the sort-side walker described above plus a simple read-side predicate for routing:

```js
const anyDeadlocked = feedbackStore.list().some(
  item => item.history[0].state === 'deadlocked'
);
```

## 7. `WORK.md` changes

The `## Feedback` section is removed. `createWorkfile` in `scripts/lib/workfile.js` no longer emits it. Tools and skills no longer parse it.

The `# Artefacts` table is unchanged.

## 8. Public API — `foundry_feedback_*` tools

### 8.1 Signature changes

| Tool | Before | After |
|------|--------|-------|
| `foundry_feedback_add` | `{ file, text, tag, stageBase? }` | `{ file, text, tag }`; stage is taken from the active stage |
| `foundry_feedback_list` | `{ file? }` → `[{ file, index, text, state, tags, resolved }]` | `{ file? }` → `[{ id, file, tag, text, source, state, depth, reason? }]` |
| `foundry_feedback_action` | `{ file, index }` | `{ id }` |
| `foundry_feedback_wontfix` | `{ file, index, reason }` | `{ id, reason }` |
| `foundry_feedback_resolve` | `{ file, index, resolution, reason? }` | `{ id, resolution, reason? }` |

Every mutating tool continues to gate on `requireNotFailed(io)` (existing failed-flow check) and the stage-lock predicate enforced by the token-gated stage.

### 8.2 Authorship enforcement

Before appending a snapshot, the tool:

1. Reads the active stage from `.foundry/active-stage`.
2. For `resolve` and the rejection path: if `history[0].state !== 'deadlocked'`, verify `activeStage === item.source`. On mismatch: return `{error: 'only stage <source> may resolve/reject this item'}`.
3. For `resolve` when `history[0].state === 'deadlocked'`: verify `baseStage(activeStage) === 'human-appraise'`. On mismatch: return `{error: 'only human-appraise may resolve deadlocked items'}`.
4. For `action` and `wontfix`: verify `baseStage(activeStage) === 'forge'`. On mismatch: return `{error}`.

### 8.3 Dedup

`foundry_feedback_add` dedups on `(file, tag, hash(text))` against non-resolved items. A collision returns `{deduped: true, id: <existing-id>}` without writing. Resolved items are NOT considered for dedup — a re-added item after a resolution is a legitimate new item (regression feedback).

## 9. Persistence and atomicity

### 9.1 File format

`js-yaml` `dump`/`load`. Default options except `lineWidth: -1` (matches workfile.js convention).

### 9.2 Write-temp-then-rename

All writes to `WORK.feedback.yaml` and `WORK.history.yaml` use write-to-temp-then-rename:

```js
io.writeFile(path + '.tmp', body);
io.rename(path + '.tmp', path);
```

`io.rename` is a new capability on the IO shim. Real IO delegates to `fs.renameSync` (atomic on POSIX; atomic-on-same-volume on Windows). In-memory test IO shims rename by updating the store key.

On crash between `writeFile` and `rename`, the live file is untouched; a stray `.tmp` remains and is harmless (and can be cleaned up by a future sweep).

### 9.3 Failure handling

If `writeFile` or `rename` throws during a tool call, the tool returns the error to the caller. No automatic failed-flow transition for feedback writes — each tool invocation is a single atomic rename, so a failure leaves the file exactly as it was before the call. A subsequent retry by the LLM driver succeeds or repeatedly fails, and the user diagnoses.

A secondary consistency concern: sort writes deadlock snapshots to `WORK.feedback.yaml`, then writes two entries to `WORK.history.yaml`. If the history write fails after the feedback write succeeds, the yaml records "item X went deadlocked at T" but history has no matching sort entry at T. On the next run, sort re-reads `WORK.feedback.yaml`, sees item X is already deadlocked (first history snapshot), and routes to human-appraise — correct behaviour, and the history write will be retried naturally. This is acceptable; the cross-file consistency test (§14.6) explicitly allows `state: deadlocked` snapshots to reference a `stage: sort` that has no corresponding history row, as long as the opposite ordering never holds (a history row referencing a deadlock transition not present in feedback.yaml).

The history.yaml writer, invoked only from `foundry_orchestrate`, marks the flow failed on yaml-parse failure. See §11.3.

## 10. `WORK.history.yaml` — `open_feedback` field

Every history entry gains one new field:

```yaml
- timestamp: "2026-04-23T10:33:00.456Z"
  seq: 42
  cycle: write-haiku
  stage: forge:write
  iteration: 2
  comment: "ticked 3 items"
  open_feedback: 5
```

`open_feedback` = count of items in `WORK.feedback.yaml` where `history[0].state !== 'resolved'`. Computed at callsite in `orchestrate.js` using a one-liner:

```js
const openFeedback = feedbackStore.list().filter(
  item => item.history[0].state !== 'resolved'
).length;
appendEntry(historyPath, { ..., openFeedback }, io);
```

`open_feedback` is optional on read (backward-compatible for test fixtures that don't set it). `appendEntry` coerces `undefined` to `0` rather than omitting the field — the field is always present in new entries. **Deadlocked items are included** in the count (they are non-resolved); matches your intent that only `resolved` is special.

## 11. History subsystem audit fixes

Findings from the 2026-04-24 audit; all folded into this spec.

### 11.1 Delete `readLastSortRoute`

Unused in production. Delete the function (`scripts/lib/history.js:55-58`) and its 3 tests in `tests/lib/history.test.js` (`describe('readLastSortRoute')` block). Remove the `readLastSortRoute` import from the test file.

### 11.2 Add explicit `seq` field; sort by (timestamp, seq)

`appendEntry` computes `seq` as the length of the existing entries array before pushing. Snapshots written in the same millisecond get monotonically increasing `seq` values.

`loadHistory` sorts primarily by `timestamp`, then by `seq` ascending. Entries loaded from files written before this change lack `seq`; they are treated as `seq = 0` on read (stable with V8, preserves file-order).

### 11.3 Malformed-yaml → markWorkfileFailed

`loadHistory` wraps `yaml.load` in try/catch. On parse failure:

```js
try {
  data = yaml.load(text) || [];
  if (!Array.isArray(data)) throw new Error('history.yaml root is not an array');
} catch (err) {
  const msg = `WORK.history.yaml malformed: ${err.message}`;
  try { markWorkfileFailed(io, msg); } catch { /* WORK.md gone; nothing to mark */ }
  throw new Error(msg);
}
```

The three production callers (`sort.js`, `orchestrate.js`, `history-tools.js`) propagate the thrown error unchanged. The caller handles it exactly as today — the new behaviour is that the flow is also marked failed, mirroring the memory-sync-failure pattern in P0 #3.

### 11.4 Enforce `stage === 'sort'` when `route` is supplied

`appendEntry` throws if `route !== undefined && stage !== 'sort'`. Documented in work-spec.md.

### 11.5 Document `route` field + lifecycle in work-spec.md

work-spec.md §`WORK.history.yaml` gains:
- `route` field description (optional, only on `stage: sort` entries, records the routing decision).
- `seq` field description.
- `open_feedback` field description.
- Lifecycle note: file is tracked in git, committed per stage on the work branch, deleted by `foundry_git_finish` before squash-merge.

### 11.6 Atomic write for history.yaml

`appendEntry` uses write-temp-then-rename (§9.2). This is the primary motivation for promoting atomicity into scope — observed incompleteness in the wild.

### 11.7 `getIteration` doc comment

Doc comment on `getIteration` in `scripts/lib/history.js`:

```
/**
 * Count COMPLETED forge stages for a cycle. This includes forges that ran
 * to completion but whose downstream appraise deadlocked or blocked the
 * cycle — completion here means "stage_end was called", not "cycle progressed."
 * Used by sort for max-iterations enforcement.
 */
```

### 11.8 Sort-entry comment text

`orchestrate.js:434` changes from `comment: \`route ${lastStage.stage}\`` to `comment: \`sort → ${route}\``. Cosmetic but clearer on debug reads.

## 12. Skill updates

Affected skills (each opens with "read WORK.md" or "look at the ## Feedback section"):

- `skills/forge/SKILL.md` — replace "read feedback from WORK.md" with "call `foundry_feedback_list` and action items whose state is `open` or `rejected`"
- `skills/quench/SKILL.md` — explain that items it created can be resolved by it, plus it can add new items via `foundry_feedback_add`
- `skills/appraise/SKILL.md` — same as quench, plus the source-authorship rule ("you can only resolve items where source starts with `appraise:`")
- `skills/human-appraise/SKILL.md` — document the deadlock override path explicitly
- `skills/assay/SKILL.md` — `#validation` feedback addition path uses the new API
- `skills/orchestrate/SKILL.md` — no behavioural change, but the loop description references `foundry_feedback_list` instead of parsing WORK.md

Each skill is short; changes are a few lines each.

## 13. Documentation

- `docs/work-spec.md`: delete §Feedback (the markdown-checklist spec), add new §`WORK.feedback.yaml` describing the yaml schema, states, transitions, deadlock rule. Update §`WORK.history.yaml` per §11.5. Update §"Who writes what" table.
- `docs/concepts.md`: update the "Feedback" subsection to reference the yaml file.
- `README.md`: update §"Feedback lifecycle" and §"WORK.md" to reflect split.
- `CHANGELOG.md`: new version entry (v2.6.0 — minor bump, breaking for anyone scripting the old tool API). Migration note: "finish in-flight cycles before upgrading, or delete WORK.md/WORK.history.yaml/WORK.feedback.yaml and re-flow."

## 14. Tests

### 14.1 New: `scripts/lib/feedback-store.js`

Unit tests cover:
- create/read/write roundtrip
- ULID generation + uniqueness + monotonicity
- prepend-only history invariant (reject any attempt to mutate existing snapshots)
- schema validation (missing required fields, unknown state, `reason` required on `rejected`/`wont-fix`/`deadlocked`, `reason` forbidden on `open`/`actioned`/`resolved`)
- atomic rename: simulate writeFile-success-then-rename-throws, assert file unchanged
- atomic rename: simulate writeFile-throws, assert file unchanged + no stray `.tmp` accessible via the real IO
- dedup on `(file, tag, text-hash)` against non-resolved items; no dedup against resolved items
- state-machine validator: every legal transition; every illegal transition rejected with a clear reason
- source-authorship check: non-matching source rejected; matching source accepted; deadlocked-override for human-appraise
- depth computation: history length for non-resolved; irrelevant for resolved

### 14.2 Rewritten: `tests/lib/feedback.test.js`

Old walker/parser tests delete. New tests cover the public store API. Existing coverage gaps from REVIEW.md (matrix row-by-row enumeration, `unknown` state, silent no-op on unknown id) addressed here.

### 14.3 Sort integration tests

`tests/sort.test.js` updated:
- `detectDeadlocks` tests rewritten around `writeDeadlockSnapshots`: given feedback with various depths, assert snapshots are (or are not) written; assert route decision matches.
- New test: per-item deadlock, brand-new open item never deadlocks even past threshold.
- New test: `deadlock-appraise: false` skips the pass entirely; no snapshots written; no route change.
- Existing sort-routing tests updated to construct a feedback store instead of a feedback array.

### 14.4 Plugin-tool tests

`tests/plugin/feedback-tools.test.js` (new or renamed): exercise the id-based API end-to-end. Assert stage-lock still works, failed-flow gating still works, source-authorship refusals surface as tool errors.

### 14.5 History tests

`tests/lib/history.test.js`:
- Delete `describe('readLastSortRoute')`.
- Add: malformed-yaml → markWorkfileFailed + throw.
- Add: non-array root → same.
- Add: `seq` field populated; same-ms entries preserve insertion order.
- Add: `open_feedback` round-trips.
- Add: `route` throws on non-sort stage.
- Add: atomic rename — mid-rename crash simulation leaves file unchanged.

### 14.6 Cross-file consistency test

New test at `tests/plugin/workfiles-consistency.test.js`: end-to-end scenario exercises a full cycle, then asserts every `snapshot.stage` in `WORK.feedback.yaml` (except `sort`) has a corresponding entry in `WORK.history.yaml` with matching `stage` + `cycle`.

## 15. Rollout

- Single release. Hard cutover. Minor version bump to 2.6.0.
- CHANGELOG entry calls out breaking tool-API change (`foundry_feedback_*` signatures).
- No auto-migration code. Users with in-flight work-branches before upgrading are instructed to complete those cycles on the old version or `foundry_workfile_delete` and re-flow.

## 16. Risks

- **Skill regression.** The six affected skills plus their prompts must all be updated. A missed update will read/write against the old format and fail at runtime. Mitigation: grep for `## Feedback`, `parseFeedback`, `addFeedbackItem`, `{file, index}` across the entire tree before landing.
- **Test volume.** `tests/lib/feedback.test.js` and `tests/sort.test.js` together account for ~1500 lines. Rewriting both at once risks churn-related bugs. Mitigation: implement in phases (store first, tools next, sort integration last); each phase lands green tests before the next begins.
- **Deadlocked snapshot on sort write-failure.** If sort writes deadlock snapshots but then the subsequent stage entry fails, the yaml has deadlocked items for the next run to react to without the corresponding history entry. Mitigation: the atomic rename and the invariant test (§14.6) catch this class of issue; the spec accepts it as an acceptable edge (yaml is source of truth; history is debug log).

## 17. Open questions

None remaining after the brainstorming session. All design decisions are captured above.

## 18. Summary of files touched

- **New:** `scripts/lib/feedback-store.js`, `scripts/lib/ulid.js`, `docs/specs/2026-04-24-work-feedback-yaml-redesign.md` (this file)
- **Rewritten:** `scripts/lib/feedback.js` (becomes a thin compatibility shim or deleted), `scripts/lib/feedback-transitions.js` (new state machine), `.opencode/plugins/foundry-tools/feedback-tools.js`, `tests/lib/feedback.test.js`, `tests/lib/feedback-walker.test.js` (delete)
- **Modified:** `scripts/sort.js`, `scripts/orchestrate.js`, `scripts/lib/history.js`, `scripts/lib/workfile.js`, `tests/sort.test.js`, `tests/lib/history.test.js`, IO shim (`scripts/lib/io.js` + memory helpers), six skills, three docs, CHANGELOG.
