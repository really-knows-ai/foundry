# Phase 5: Skills, Docs, CHANGELOG, Version Bump

**Scope:** Update all six pipeline skills to describe the new id-based feedback API and the yaml file. Rewrite the relevant sections of `docs/work-spec.md`, `docs/concepts.md`, and `README.md`. Add a v2.6.0 entry to `CHANGELOG.md` with a migration note. Bump `package.json` version.

**Spec sections covered:** §11.5 (history.yaml docs), §12 (skills), §13 (docs + CHANGELOG), §15 (rollout).

**Preconditions:** Phases 1–4 committed and green. No production code uses the legacy feedback API.

**Files in this phase:**
- Modify: `skills/forge/SKILL.md`, `skills/quench/SKILL.md`, `skills/appraise/SKILL.md`, `skills/human-appraise/SKILL.md`, `skills/assay/SKILL.md`, `skills/orchestrate/SKILL.md`
- Modify: `docs/work-spec.md`
- Modify: `docs/concepts.md`
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `package.json`

**Preflight:**

```bash
# Inspect each skill briefly to find the feedback-related sentences.
rg -n "feedback\|WORK\.md\|\\[ \\]\|\\[x\\]\|\\[~\\]\|\\| approved\|foundry_feedback" skills/

# Docs
rg -n "## Feedback\|## WORK\.history\.yaml\|foundry_feedback" docs/ README.md

# Version
rg -n "^\"version\":" package.json

# Baseline
npm test
```

---

## Task 5.1: Update `skills/forge/SKILL.md`

**Files:** `skills/forge/SKILL.md`.

Spec §12: "replace 'read feedback from WORK.md' with 'call `foundry_feedback_list` and action items whose state is `open` or `rejected`'".

- [ ] **Step 1: Read the current skill**

```bash
wc -l skills/forge/SKILL.md
```

Read the entire file.

- [ ] **Step 2: Locate the feedback section**

Typical forge-skill phrasing: "Read the `## Feedback` section of WORK.md" or "check WORK.md for feedback items". Every such mention needs to change.

- [ ] **Step 3: Edit**

Replace references to reading `## Feedback` in WORK.md with the following paragraphs. Insert verbatim:

```markdown
## Feedback handling

Call `foundry_feedback_list` to see feedback items for the current cycle.
Each entry has shape `{ id, file, tag, text, source, state, depth, reason? }`.
Action every item whose `state` is `open` or `rejected`:

- If you address the feedback in the artefact: call `foundry_feedback_action`
  with `{ id }`. This marks the item `actioned`. The tool returns
  `{ ok: true, id, deduped: false }` on success; use `id` for any follow-up.
- If you decide not to address the feedback: call `foundry_feedback_wontfix`
  with `{ id, reason }`. The reason is required. **You may only mark
  `wont-fix` on items whose `source` stage base is `appraise`.** If the
  item's source base is `quench` (objective validation failure) or
  `human-appraise` (direct user instruction), you must action it — the
  tool will return an error if you attempt `wont-fix`. This replaces the
  old tag-based restriction (`#validation`/`#human` tag check); tags are
  now categorical/display-only and not consulted by the state machine.

`foundry_feedback_add` (if you ever call it — forge normally does not)
returns `{ ok, id, deduped }`. `deduped: true` means an existing
non-resolved item with the same `(file, tag, hash(text))` was found and no
new item was written; the returned `id` is the existing item's id.
`deduped: false` means a new item was created.

You cannot resolve or reject items — only the stage that created the item
(the `source` on each list entry) can do that, with the exception that
human-appraise can override any non-resolved item. You also cannot action
items whose state is `actioned`, `wont-fix`, `deadlocked`, or `resolved`.
```

Also replace the existing "Unresolved feedback" subsection (`skills/forge/SKILL.md` lines ~76–83, which still uses the old `approved` vocabulary) with:

```markdown
## Resolution vocabulary

An item is **unresolved** if its `history[0].state` is one of `open`,
`rejected`, `actioned`, `wont-fix`, or `deadlocked`. An item is
**resolved** only when `history[0].state === 'resolved'` (terminal).
Forge only acts on `open` and `rejected` items; it never sees `resolved`
items in the list output.
```

Remove any markdown-checkbox phrasing like `- [ ]`, `- [x]`, `- [~]`, `| approved`, `| rejected`. Remove references to `file`/`index` as a way of identifying items.

- [ ] **Step 4: Run full suite**

Run: `npm test`
Expected: all green (skills are prose; tests don't exercise them).

- [ ] **Step 5: Commit**

```bash
git add skills/forge/SKILL.md
git commit -m "docs(skill-forge): describe id-based feedback API

Forge stages now consult foundry_feedback_list and action items by id.
Replaces every reference to the ## Feedback markdown section and the
{file, index} pair with the new {id}-based tool signatures.

Clarifies that forge can only transition items whose state is open or
rejected — matches spec §5.1 rule 2."
```

---

## Task 5.2: Update `skills/quench/SKILL.md`

**Files:** `skills/quench/SKILL.md`.

Spec §12: "explain that items it created can be resolved by it, plus it can add new items via `foundry_feedback_add`".

- [ ] **Step 1: Edit the feedback section**

Replace any `## Feedback` / markdown-checkbox references with the following. Insert verbatim:

```markdown
## Feedback handling

As a quench stage, you have two feedback responsibilities:

1. **Adding new validation feedback.** If a validation command surfaces
   an issue, call `foundry_feedback_add` with `{ file, text, tag: 'validation' }`.
   The `source` is automatically recorded as your stage id. The tool rejects
   any tag other than `validation` during a quench stage; do not attempt
   `tag: 'quench-lint'` or similar — the tool will return an error.

   The tool returns `{ ok: true, id, deduped }` on success. `deduped: true`
   means an existing non-resolved item with the same `(file, tag,
   hash(text))` was found; the returned `id` is the existing item's id and
   no new snapshot was written. `deduped: false` means a new item was
   created. Either way, `id` is usable for follow-up calls.

2. **Resolving items you sourced.** Call `foundry_feedback_list` to see items
   whose `source` matches your stage id. For items whose current state is
   `actioned` or `wont-fix`, decide whether forge's response is acceptable:
   - Acceptable: call `foundry_feedback_resolve` with `{ id, resolution: 'approved' }`.
     `reason` is optional here.
   - Not acceptable: call `foundry_feedback_resolve` with `{ id, resolution: 'rejected', reason: '...' }`.
     `reason` is required on `rejected`. Forge will see the item back in
     the `rejected` state on the next pass.

**Reason rules.** `reason` is required when resolving a deadlocked item
(deadlock override — but quench never does this; only human-appraise does),
or when `resolution: 'rejected'`. On `resolution: 'approved'` for a
non-deadlocked item, `reason` is optional.

You cannot resolve items sourced by other stages, and you cannot touch
deadlocked items (only human-appraise can override those).
```

- [ ] **Step 2: Commit**

Run: `npm test` → green.

```bash
git add skills/quench/SKILL.md
git commit -m "docs(skill-quench): describe id-based feedback lifecycle

Quench adds validation items (source = stage id, tag = 'validation') and
can resolve/reject items it sourced. Cannot touch items sourced by other
stages or deadlocked items — matches spec §5.1 rule 3 and §12."
```

---

## Task 5.3: Update `skills/appraise/SKILL.md`

**Files:** `skills/appraise/SKILL.md`.

Spec §12: "same as quench, plus the source-authorship rule ('you can only resolve items where source starts with `appraise:`')".

- [ ] **Step 1: Edit**

Similar structure to quench. Replace the feedback section with the following. Insert verbatim:

```markdown
## Feedback handling

As an appraise stage, you have two feedback responsibilities:

1. **Adding new law-violation feedback.** For each unmet law, call
   `foundry_feedback_add` with `{ file, text, tag: 'law:<slug>' }`.
   The `source` is automatically your stage id (e.g. `appraise:write-check`).
   The tool rejects any tag not matching `law:<slug>` during an appraise
   stage; do not attempt bare `'appraise'` or `'review'` tags.

   The tool returns `{ ok: true, id, deduped }` on success. `deduped: true`
   means an existing non-resolved item with the same `(file, tag,
   hash(text))` was found (no new snapshot written); `deduped: false`
   means a new item was created. Resolved items are NOT considered for
   dedup — a re-added item after a resolution is a legitimate new item
   (regression feedback).

2. **Resolving items you sourced.** Call `foundry_feedback_list` and look
   at items whose `source` exactly matches your stage id. For items whose
   current state is `actioned` or `wont-fix`:
   - Approve: `foundry_feedback_resolve` with `{ id, resolution: 'approved' }`.
     `reason` is optional.
   - Reject: `foundry_feedback_resolve` with `{ id, resolution: 'rejected', reason: '...' }`.
     `reason` is required. A rejection sends the item back to forge for
     another attempt (the `rejected` state is a legal forge input per
     §5.1 rule 2).

**Reason rules.** `reason` is required on `resolution: 'rejected'` and on
any deadlock-override transition. On `resolution: 'approved'` for a
non-deadlocked item, `reason` is optional.

**Source-authorship rule.** You can only resolve/reject items whose `source`
matches your own stage id — not every appraise stage in the cycle, just yours.
This prevents a second appraise stage from rubber-stamping work it didn't
request. For deadlocked items, only human-appraise has the override authority.

**Future work.** Spec §17 notes a planned cycle-level mode that would let
human-appraise see non-deadlocked unresolved feedback before sort routes.
Not available in v2.6.0; appraise stages today are the sole resolver of
their own non-deadlocked items.
```

- [ ] **Step 2: Commit**

Run: `npm test` → green.

```bash
git add skills/appraise/SKILL.md
git commit -m "docs(skill-appraise): describe id-based feedback + source-authorship

Appraise stages add law:<slug> items and can only resolve/reject items
whose source matches their exact stage id. Matches spec §5.1 rule 3 —
not every appraise stage in a cycle is interchangeable."
```

---

## Task 5.4: Update `skills/human-appraise/SKILL.md`

**Files:** `skills/human-appraise/SKILL.md`.

Spec §12: "document the deadlock override path explicitly".

- [ ] **Step 1: Edit**

Replace/add a feedback section. Insert verbatim:

```markdown
## Feedback handling

As a human-appraise stage, you have three feedback capabilities. **Human-appraise
can override any non-resolved item regardless of source** — this is the
universal override authority recorded in spec §5.1 rule 5. It is not
limited to deadlocked items, though in practice most overrides today are
on deadlocked items because default sort routing only surfaces deadlocked
items to human-appraise (see §17 future-work note below).

1. **Adding new human feedback.** Call `foundry_feedback_add` with
   `{ file, text, tag: 'human' }`. The `source` is your stage id. The tool
   returns `{ ok: true, id, deduped }`; `deduped: true` indicates an
   existing non-resolved item with the same `(file, tag, hash(text))` was
   found and no new snapshot was written, `deduped: false` indicates a new
   item was created.

2. **Resolving any non-resolved item.** Unlike appraise and quench, you
   are NOT restricted to items whose `source` matches your stage id.
   You may transition any non-resolved item to any legal target state:
   - From `{open, rejected}`: call `foundry_feedback_action` or
     `foundry_feedback_wontfix` as appropriate (forwards toward
     `{actioned, wont-fix}`).
   - From `{actioned, wont-fix}`: call `foundry_feedback_resolve` with
     `{ id, resolution: 'approved' | 'rejected', reason? }`.
   - From `deadlocked`: call `foundry_feedback_resolve` with
     `{ id, resolution: 'approved' | 'rejected', reason: '...' }`.
     `reason` is always required on deadlock override — it documents why
     the deadlock is being broken.

3. **Deadlock resolution specifically.** When items reach
   `state: deadlocked` (written by sort when an item's history depth hits
   `deadlock-iterations`), human-appraise is the ONLY stage authorised to
   resolve them. After human-appraise resolves every deadlocked item, the
   cycle resumes normal forge/appraise routing. If deadlocks remain after
   human-appraise, the cycle blocks (per spec §5.2).

**Reason rules.** `reason` is required whenever the target state is
`rejected`, `wont-fix`, `deadlocked` (only sort writes deadlocked — you
do not), or `resolved`. `reason` is forbidden on `open` and optional on
`actioned` (the code change is the reason). A deadlock override always
requires `reason` because the target states (`{resolved, wont-fix,
rejected}`) are all in the required set.

**Future work.** Spec §17 notes that a cycle-level mode flag letting
human-appraise see all unresolved feedback (not just deadlocked items)
before sort routes is planned for a future release. In v2.6.0 the
authority is universal but reachability is limited — you typically only
see deadlocked items on the route from sort. If you do see non-deadlocked
items (e.g. you were invoked directly by the user), the same authority
applies.
```

- [ ] **Step 2: Commit**

Run: `npm test` → green.

```bash
git add skills/human-appraise/SKILL.md
git commit -m 'docs(skill-human-appraise): document universal override authority

Human-appraise may transition ANY non-resolved item to any legal
target state regardless of source (spec §5.1 rule 5). In practice
default sort routing only surfaces deadlocked items, but the authority
itself is universal, not deadlock-gated. Human-appraise is also the
ONLY stage that can transition items out of deadlocked. Override
transitions always require a reason per spec §4.3.'
```

---

## Task 5.5: Update `skills/assay/SKILL.md`

**Files:** `skills/assay/SKILL.md`.

Spec §12: "`#validation` feedback addition path uses the new API".

- [ ] **Step 1: Edit**

Find the section that describes how assay emits `#validation` feedback on extractor failure. The current file has a single mention at roughly `skills/assay/SKILL.md:11` ("On any failure, `foundry_assay_run` writes a `#validation` feedback row against `WORK.md` and returns an aborted result."). Replace that one sentence with:

```markdown
On any failure, `foundry_assay_run` writes a `validation`-tagged feedback
item to `WORK.feedback.yaml` with `source: assay:<alias>` and returns an
aborted result. Internally this goes through `foundry_feedback_add` with
`{ file: 'WORK.md', tag: 'validation', text: '<failure>' }`, which returns
`{ ok: true, id, deduped }`. `deduped: true` means an existing non-resolved
item with the same `(file, tag, hash(text))` was already present and the
returned `id` points at that existing item; `deduped: false` means a new
item was created. Either way the item follows the normal resolution path
(forge addresses; the assay stage that created it approves or rejects the
fix).
```

If the skill has any longer prose on the `#validation` path elsewhere (e.g. a section describing the resolution lifecycle), leave it alone — this task is a drop-in replacement for the one-sentence mention, not a restructure.

- [ ] **Step 2: Commit**

Run: `npm test` → green.

```bash
git add skills/assay/SKILL.md
git commit -m "docs(skill-assay): validation feedback goes via foundry_feedback_add

Assay's #validation emission now uses the new plugin API against
WORK.feedback.yaml with source=assay:<alias>. Matches the call site
updated in phase 3 (.opencode/plugins/foundry-tools/assay-tools.js)."
```

---

## Task 5.6: Update `skills/orchestrate/SKILL.md`

**Files:** `skills/orchestrate/SKILL.md`.

Spec §12: "no behavioural change, but the loop description references `foundry_feedback_list` instead of parsing WORK.md".

**Preflight note.** The current `skills/orchestrate/SKILL.md` (83 lines) contains NO feedback-related prose — no mention of `## Feedback`, no mention of `WORK.md feedback parsing`, no mention of `addFeedbackItem`. Verify this first:

```bash
rg -n "Feedback|feedback|WORK\.md" skills/orchestrate/SKILL.md
```

Expected hits: only the `foundry_workfile_get` reference under "Check for failed flow state". If any additional hits appear (new contributors may have added prose), fold those into this task.

- [ ] **Step 1: Verify grep output matches expectation**

Expected: zero hits on `feedback`. If non-zero, stop and update this task.

- [ ] **Step 2: Add a short paragraph on `foundry_feedback_list` usage in the loop**

Insert the following paragraph as a new subsection immediately after the `## What you do NOT do` list (end of file). Insert verbatim:

```markdown
## Feedback visibility

Orchestrate's loop does not read, parse, or write feedback directly.
Subagents invoked via `dispatch` use the `foundry_feedback_list` /
`foundry_feedback_add` / `foundry_feedback_action` / `foundry_feedback_wontfix`
/ `foundry_feedback_resolve` tools themselves; orchestrate does not stage
feedback state between iterations. If you want to inspect feedback state
between iterations for diagnostic purposes, call `foundry_feedback_list` —
the response shape is `[{ id, file, tag, text, source, state, depth,
reason? }]`. This is read-only and does not affect the loop's dispatch
decisions.
```

This is a pure documentation addition; there is no old feedback-related prose to delete.

- [ ] **Step 3: Commit**

Run: `npm test` → green.

```bash
git add skills/orchestrate/SKILL.md
git commit -m 'docs(skill-orchestrate): note foundry_feedback_list for diagnostics

Adds a short subsection clarifying that orchestrate itself does not read
or write feedback — subagents do. Mentions foundry_feedback_list as the
read-only diagnostic entry point and documents the new response shape.
No behavioural change to the dispatch algorithm.'
```

---

## Task 5.7: Rewrite `docs/work-spec.md` §Feedback + §history.yaml

**Files:** `docs/work-spec.md`.

Spec §13 + §11.5.

- [ ] **Step 1: Inspect**

Read the entire `docs/work-spec.md`. Identify:
- Section(s) describing the `## Feedback` markdown format — delete/rewrite.
- Section describing `WORK.history.yaml` — extend with `route`, `seq`, `open_feedback` descriptions and the lifecycle note.
- "Who writes what" table (if present) — update.

- [ ] **Step 2: Replace the §Feedback section**

Insert a new `§WORK.feedback.yaml` section. Reference content:

```markdown
## WORK.feedback.yaml

Every cycle owns a `WORK.feedback.yaml` file alongside `WORK.md` and
`WORK.history.yaml`. It records every feedback item created during the cycle
and the full state-transition history of each. Tracked in git, committed
per-stage on the work branch, deleted by `foundry_git_finish` before the
squash-merge (same lifecycle as `WORK.history.yaml`).

### Schema

Top-level: `{ items: [Item...] }`.

Each `Item`:

| Field | Type | Required | Mutable? |
|-------|------|----------|----------|
| `id` | string (ULID, 26 chars) | yes | no |
| `file` | string | yes | no |
| `tag` | string (no leading `#`) | yes | no |
| `text` | string | yes | no |
| `source` | string (`base:alias`) | yes | no |
| `history` | array, length ≥ 1 | yes | prepend-only |

Each history snapshot:

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `state` | enum | yes | `open \| actioned \| wont-fix \| rejected \| deadlocked \| resolved` |
| `stage` | string (`base:alias`) or literal `sort` | yes | Who performed the transition |
| `cycle` | string | yes | Cycle id at the time of the transition |
| `timestamp` | ISO-8601 UTC with ms | yes | |
| `reason` | string | conditional | Required on `rejected`, `wont-fix`, `deadlocked`; forbidden on `open`, `actioned`, `resolved` |

`history[0]` is always the current state; new snapshots are prepended.
`resolved` is terminal.

### State machine

The six states and the legal transitions are:

| From \ Caller | forge (any source) | source-stage (quench / appraise / human-appraise where stageId === item.source) | sort | human-appraise (override authority, any source) |
|---|---|---|---|---|
| `open` | → `actioned` always; → `wont-fix` only if `item.source` base is `appraise` | — | → `deadlocked` (if depth ≥ threshold) | → `{actioned, wont-fix}` |
| `rejected` | → `actioned` always; → `wont-fix` only if `item.source` base is `appraise` | — | → `deadlocked` (if depth ≥ threshold) | → `{actioned, wont-fix}` |
| `actioned` | — | → `{resolved, rejected}` | → `deadlocked` (if depth ≥ threshold) | → `{resolved, rejected}` |
| `wont-fix` | — | → `{resolved, rejected}` | → `deadlocked` (if depth ≥ threshold) | → `{resolved, rejected}` |
| `deadlocked` | — | — | — | → `{resolved, wont-fix, rejected}` |
| `resolved` | — | — | — | — (terminal) |

Notes:

- `source-stage` column applies when the caller's stage id exactly matches `item.source` (e.g. `appraise:write-check` resolving an item it created). `human-appraise` override authority (last column) applies regardless of `item.source` and is the only path that can transition out of `deadlocked`.
- **Forge `wont-fix` scope.** When `item.source` base is `quench` (objective validation failure) or `human-appraise` (direct user instruction), forge may not `wont-fix` — it must `actioned`. Only `appraise`-sourced items are wont-fix-able by forge. This replaces the earlier tag-based restriction on `#validation` / `#human` tags.
- **Reason required on** `rejected`, `wont-fix`, `deadlocked`, `resolved`. **Forbidden on** `open`. **Optional on** `actioned` (the code change is the reason).
- Sort is the only writer of `state: deadlocked`; it writes these via its internal pass, not through the plugin API.

See `docs/specs/2026-04-24-work-feedback-yaml-redesign.md` §5 for the authoritative rules.

### Transitions are made via the plugin API

No direct yaml editing. Every state change goes through one of:

- `foundry_feedback_add` (creates items)
- `foundry_feedback_action` (forge: open/rejected → actioned)
- `foundry_feedback_wontfix` (forge: open/rejected → wont-fix)
- `foundry_feedback_resolve` (source stage: actioned/wont-fix → resolved/rejected; or human-appraise deadlock override)

Sort is the only writer of `state: deadlocked`, and it writes snapshots via
its own internal pass — not through the plugin API.

### Persistence

Writes are atomic: `io.writeFile(path + '.tmp', body); io.rename(tmp, path)`.
A crash between the two steps leaves the live file untouched.
```

- [ ] **Step 3: Extend `§WORK.history.yaml`**

Find the existing `§WORK.history.yaml`. Add (or extend) field descriptions:

```markdown
| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `cycle` | string | yes | |
| `stage` | string or literal `sort` | yes | |
| `iteration` | integer | yes | Count of completed forge stages for the cycle at the time of write |
| `comment` | string | yes | |
| `timestamp` | ISO-8601 UTC with ms | yes | |
| `seq` | integer | yes on write | Monotonic per file; sort tiebreaker for same-ms entries |
| `route` | string | conditional | Only on `stage: sort` entries; records the route decision. Throws if set on a non-sort entry |
| `open_feedback` | integer | yes on write | Count of non-resolved items in `WORK.feedback.yaml` at the time of write; deadlocked items are counted |
```

Add the lifecycle note:

```markdown
### Lifecycle

`WORK.history.yaml` is tracked in git and committed per-stage on the work
branch. `foundry_git_finish` deletes it before the squash-merge so the
history does not leak into the base branch.

If the yaml is malformed on read (parse failure or non-array root), the
flow is marked failed via `markWorkfileFailed` and the error is re-thrown
to the caller. Mirrors the P0 #3 failed-flow pattern used by the memory
sync writer.
```

- [ ] **Step 4: Update the "Who writes what" table**

If this table lists `## Feedback` under a stage's write responsibility, update it to reference `WORK.feedback.yaml` and attribute writes to the plugin tools. Sort writes only deadlocked snapshots. Orchestrate writes `WORK.history.yaml`.

- [ ] **Step 5: Commit**

Run: `npm test` → green.

```bash
git add docs/work-spec.md
git commit -m "docs(work-spec): describe WORK.feedback.yaml + history.yaml fields

Deletes the ## Feedback markdown format section. Adds WORK.feedback.yaml
section covering schema, state machine, persistence, and plugin-only
write path. Extends WORK.history.yaml with route/seq/open_feedback
documentation and lifecycle + parse-failure behaviour."
```

---

## Task 5.8: Update `docs/concepts.md`

**Files:** `docs/concepts.md`.

Spec §13: "update the 'Feedback' subsection to reference the yaml file".

- [ ] **Step 1: Inspect**

```bash
rg -n "feedback\|## Feedback\|WORK\.md" docs/concepts.md | head -20
```

- [ ] **Step 2: Rewrite the "Feedback" subsection**

Replace with something concise that cross-references `docs/work-spec.md`:

```markdown
## Feedback

Feedback items live in `WORK.feedback.yaml` — a yaml file at the worktree
root, alongside `WORK.md`. Every item has a ULID, a source stage, and a
full history of state transitions (open → actioned → resolved, or variants
including wont-fix / rejected / deadlocked).

Plugins read and write feedback through the `foundry_feedback_*` tools;
skills never edit the yaml directly. Sort-side detection of deadlocked
items (per-item history depth) replaces the earlier global-iteration
counter.

See `docs/work-spec.md` for the full schema and state machine.
```

- [ ] **Step 3: Commit**

Run: `npm test` → green.

```bash
git add docs/concepts.md
git commit -m "docs(concepts): point Feedback subsection at WORK.feedback.yaml

Brief cross-reference to docs/work-spec.md where the full schema and
state machine live."
```

---

## Task 5.9: Update `README.md`

**Files:** `README.md`.

Spec §13: "update §'Feedback lifecycle' and §'WORK.md' to reflect split".

- [ ] **Step 1: Inspect**

```bash
rg -n "Feedback\|WORK\.md\|## Feedback" README.md
```

- [ ] **Step 2: Edit**

- The `§WORK.md` section (if it mentions a `## Feedback` subheading) should remove that description and point to `WORK.feedback.yaml`.
- The `§Feedback lifecycle` section should describe: created via the plugin, six states, sort writes deadlocked on depth, human-appraise override.

Keep changes concise; the README is an overview, not a spec.

- [ ] **Step 3: Commit**

Run: `npm test` → green.

```bash
git add README.md
git commit -m "docs(readme): reflect WORK.feedback.yaml split from WORK.md

Feedback lifecycle now points at the yaml file and the six-state
machine. WORK.md section no longer mentions a ## Feedback heading."
```

---

## Task 5.10: Update `CHANGELOG.md` + bump version

**Files:** `CHANGELOG.md`, `package.json`.

Spec §15: "Single release. Hard cutover. Minor version bump to 2.6.0."

- [ ] **Step 1: Inspect CHANGELOG**

```bash
head -60 CHANGELOG.md
```

Follow the existing format (it's likely Keep-a-Changelog or a variant).

- [ ] **Step 2: Add v2.6.0 entry**

At the top of `CHANGELOG.md`, under the most recent unreleased entry or as a new released entry dated today:

```markdown
## [2.6.0] - 2026-04-24

### Breaking changes

- `foundry_feedback_*` plugin tools switch from `{ file, index }` to `{ id }`
  addressing. `foundry_feedback_add` drops the `stageBase?` argument (source
  is read from the active stage). `foundry_feedback_list` response shape
  changes to `{ id, file, tag, text, source, state, depth, reason? }`.
- Feedback state machine expands from 4 states to 6 (`open | actioned |
  wont-fix | rejected | deadlocked | resolved`). `approved` is renamed to
  `resolved` internally; the public resolve tool still accepts
  `resolution: 'approved' | 'rejected'` as input.
- Deadlock detection becomes per-item (based on the item's own history depth)
  instead of based on a global forge-appraise iteration count. Items freshly
  added in the threshold-th iteration are never auto-deadlocked.

### Added

- `WORK.feedback.yaml` — first-class persistent record of every feedback
  item and its full transition history. Replaces the markdown `## Feedback`
  section in `WORK.md`.
- `open_feedback` field on every `WORK.history.yaml` entry.
- `seq` field on every `WORK.history.yaml` entry (tiebreaker for same-ms
  timestamps).
- Atomic writes via write-temp-then-rename for both `WORK.feedback.yaml`
  and `WORK.history.yaml`.
- Source-authorship rule: only the stage that created a feedback item can
  resolve/reject it. Human-appraise has universal override authority —
  it may transition any non-resolved item to any legal target state
  regardless of source (per spec §5.1 rule 5). In practice default sort
  routing only surfaces deadlocked items to human-appraise; a cycle-level
  mode flag to surface non-deadlocked items pre-sort is future work
  (spec §17).

### Removed

- `scripts/lib/feedback.js` (markdown parser + walker).
- `readLastSortRoute` from `scripts/lib/history.js` (dead code).
- `## Feedback` section from `createWorkfile` output.

### Fixed

- Deadlock detection no longer flags freshly-added open items (P1 [feedback M1]).
- `WORK.history.yaml` writes are now atomic (closes observed incompleteness
  in the wild).
- Malformed `WORK.history.yaml` on read now marks the flow failed via
  `markWorkfileFailed` instead of crashing the caller.
- `appendEntry` enforces `route ⇒ stage === 'sort'`; violating calls throw.

### Migration

2.6.0 no longer reads or writes the `## Feedback` section. Pre-2.6.0
workfiles with in-flight feedback are not auto-migrated — finish or
discard in-flight cycles before upgrading. `foundry_workfile_delete`
+ re-flow is the supported path. Any `## Feedback` content left over
in a `WORK.md` on disk after the upgrade is inert text: neither parsed
nor deleted by 2.6.0 tools, and new writes go to `WORK.feedback.yaml`.
Users running `foundry_git_finish` post-upgrade on a stale cycle will
squash-merge the inert markdown unless they delete the workfile first.
```

- [ ] **Step 3: Bump `package.json`**

Change the `"version": "2.5.0"` line to `"version": "2.6.0"`. Do not use `npm version` (it creates a commit and a tag on its own; we want a single hand-crafted commit).

- [ ] **Step 3.5: Bump `package-lock.json`**

`package-lock.json` exists in this repo and contains the `version` field in two places: the root `version` and `packages[""].version`. Both must match `package.json`. Run:

```bash
rg -n '"version": "2\.5\.0"' package-lock.json
```

Expected: two hits (root + `packages[""]`). Edit each to `"2.6.0"`. Verify:

```bash
rg -n '"version": "2\.6\.0"' package-lock.json
```

Expected: two hits. Then run `npm install --package-lock-only` only if the lockfile has any additional drift; otherwise leave as-is (a dependency-free version bump should not churn the lockfile).

If `package-lock.json` does not exist at that path (future fork), skip this step and note in `## Revision Notes`.

- [ ] **Step 4: Run full suite**

Run: `npm test`
Expected: all green.

- [ ] **Step 5: Commit**

Commit both files atomically so the lockfile never lags behind the manifest.

```bash
git add CHANGELOG.md package.json package-lock.json
git commit -m 'chore(release): 2.6.0 — WORK.feedback.yaml redesign

Bumps version in package.json and package-lock.json (both root and
packages[""] entries) and adds a CHANGELOG entry summarising the phase
1–5 changes: new yaml file, id-based plugin API, per-item deadlock
detection, atomic writes, history-file hardening, and legacy markdown
path removed. Breaking for anyone scripting the old plugin API
signatures; migration note included in the CHANGELOG entry.'
```

---

## Task 5.11: Phase 5 verification gate

- [ ] **Step 1: Full suite**

```bash
npm test
```
Expected: all green.

- [ ] **Step 2: Grep for leftover legacy prose**

```bash
rg -n "## Feedback\|\\- \\[ \\]\|\\- \\[x\\]\|\\- \\[~\\]\|{ file, index }\|\\| approved\|\\| rejected" skills/ docs/ README.md
```
Expected: zero matches. (Test fixtures may still reference markdown checkboxes — those are fine; phase 6 final sweep will differentiate.)

- [ ] **Step 3: Version confirmation**

```bash
rg '^"version":' package.json
```
Expected: `"version": "2.6.0",`.

- [ ] **Step 4: Handoff**

Phase 5 complete. Tell the operator:

> "Phase 5 complete. Six skills, three docs, CHANGELOG, and package.json updated. v2.6.0 with explicit breaking-change migration note. Full suite green. Ready for phase 6 (cross-file consistency test + final sweep)."

---

## Revision Notes

Flags from the 2026-04-24 revision pass (REVISION-CONTRACT §C5):

- **Task 5.6 (orchestrate) rewritten.** The existing `skills/orchestrate/SKILL.md` contains NO feedback-related prose to edit (verified: 83 lines, zero hits on `feedback` other than the `foundry_workfile_get` check). Per contract §C5 Major, the task is now "add a short paragraph about `foundry_feedback_list` usage" inserted after `## What you do NOT do`. It produces one commit of pure documentation addition; no prose is deleted.
- **Task 5.7 transition-matrix table.** The spec §5 block-diagram is prose, not a discrete copyable table. The table authored inline in Task 5.7 is a derived 6×4 matrix (6 from-states × 4 caller categories) that folds in rule 7 (forge wont-fix scope) and the universal human-appraise column. Treat this matrix as authoritative for the `docs/work-spec.md` doc; if it drifts from spec rules during execution, fix the table here — do not silently diverge.
- **Task 5.10 `package-lock.json` handling.** The repo root has a `package-lock.json` with two `"version"` entries (root + `packages[""]`). Step 3.5 edits both by hand and commits alongside `package.json` and `CHANGELOG.md` in a single commit to keep the lockfile/manifest atomic. If future versions of npm restructure the lockfile, the `rg` count in step 3.5 will diverge from "two hits" and the executor must adapt.
- **CHANGELOG migration note.** The rewritten note explicitly states 2.6.0 neither reads nor migrates old `## Feedback` content — pre-2.6.0 in-flight cycles must be finished or discarded before upgrade. `foundry_workfile_delete` + re-flow is the supported path. This replaces the factually incorrect "old `## Feedback` section is ignored" phrasing.
- **No narrowing language for human-appraise.** The CHANGELOG Added section's source-authorship bullet and Task 5.4's prose now both state universal override authority (spec §5.1 rule 5) and reference §17 future-work explicitly. No "deadlocked-only" narrowing remains in phase 5.
- **Forge wont-fix scope.** Task 5.1 and the Task 5.7 transition-matrix table both state forge may `wont-fix` only when `item.source` base is `appraise` (spec §5.1 rule 7). Old tag-based (`#validation` / `#human`) restriction language is removed.
- **Response-shape documentation.** All five skills that call `foundry_feedback_add` (forge, quench, appraise, human-appraise, assay) now document the `{ok, id, deduped}` response shape and explain what `deduped: true` vs `deduped: false` means.
- **No surprises outside scope.** All changes are within `phase-5-skills-docs.md`. Spec + PLAN.md untouched (coordinator scope).
