# Spec: Config branches, schema guards, and dry-run mode

**Status:** design
**Target release:** 3.0.0 (BREAKING)
**Date:** 2026-04-29
**Scope:** introduces a `config/*` git-branch namespace as the only
place schema/config mutation is permitted, mirrors it with the
existing `work/*` namespace as the only place flow-data mutation is
permitted, and adds a sibling `dry-run/<x>/<y>` namespace for
dry-running in-progress config against a real flow.
Implementation is gated at the MCP tool layer.

This document is the working spec; it will be deleted once
implemented and the change is reflected in `CHANGELOG.md`,
`README.md`, and `docs/`.

---

## 1. Invariant

Foundry has exactly two kinds of mutation, and they live on disjoint
branch namespaces.

- **Schema/config mutation** — anything that changes how the project
  is configured. Lives under `foundry/` (artefact types, laws,
  appraisers, flows, cycles, memory entity/edge type definitions,
  extractors, embedding model). Permitted on `config/*` branches
  only.
- **Data mutation** — anything that changes flow-execution state.
  WORK files at the repo root (flow lifecycle) and memory data rows
  under `foundry-memory/` (entity and edge rows). Permitted on
  `work/*` or `dry-run/*/*` branches only.

Anything else — `main`, ad-hoc branches, detached HEAD — refuses both
kinds of mutation.

The phrase "everything in `foundry/` is config" is the test. Two
exceptions, both well-defined:

1. `WORK.md`, `WORK.history.yaml`, `WORK.feedback.yaml` at the repo
   root are flow execution state, not config.
2. `foundry-memory/` (a new top-level directory; see §3) holds memory
   data rows. Definitions stay in `foundry/memory/`.

Dry-run mode (§9–§11) adds a third branch namespace, `dry-run/<x>/<y>`,
which behaves as a flow branch (data mutation permitted, schema
mutation refused) but with snapshot-and-discard semantics at finish
time.

## 2. Why tool-layer enforcement only

Two enforcement layers were considered: tool-layer guards in the MCP
plugin, and a git-policy / pre-commit hook layer. This release ships
only the tool layer.

Reasons:

- The MCP plugin already owns every supported mutation path. A user
  hand-editing files outside the plugin is outside foundry's
  contract.
- A pre-commit hook would need to inspect staged paths, classify them
  as config vs data, and refuse based on branch prefix. That doubles
  the classification logic and creates two sources of truth for the
  invariant.
- A hook fires on every commit including those produced by foundry
  tools, so foundry would need to either trust its own commits or
  have the tools bypass the hook. Both are worse than no hook.

The tool layer is sufficient because every officially supported
mutation path goes through one of the tools listed in §6.

## 3. Directory layout (3.0.0)

```
<repo>/
├── foundry/                    # config (schema, definitions). Mutated only on config/*.
│   ├── flows/
│   ├── cycles/
│   ├── laws/
│   ├── appraisers/
│   ├── artefacts/
│   └── memory/
│       ├── entities/           # entity *type* definitions (markdown + frontmatter)
│       ├── edges/              # edge *type* definitions (markdown + frontmatter)
│       ├── extractors/
│       ├── config.md
│       └── schema.json
├── foundry-memory/             # NEW. Memory *data* rows. Created by foundry_memory_init;
│   │                           # absent in projects that never opt in to memory.
│   │                           # Mutated only on work/* or dry-run/*/*.
│   └── relations/              # NDJSON files, one per entity or edge type
│                               # (relocated from foundry/memory/relations/;
│                               # data shape unchanged)
├── WORK.md                     # flow execution state, repo root, work/* or dry-run/*/* only
├── WORK.history.yaml
├── WORK.feedback.yaml
├── .foundry/                   # ephemeral runtime state (active/last-stage JSON, HMAC secret,
│                               # dry-run mode trace files). Gitignored.
└── .snapshots/                 # NEW. Forensic snapshots from dry-run mode runs (§11). Gitignored.
                                # Created lazily; absent in projects that have never used dry-run mode.
```

Memory data ships fresh in 3.0.0; no migration of pre-existing rows
is required. Existing 2.x users who have memory data must reset and
re-extract via flows. This is acceptable because memory is currently
labelled experimental.

## 4. Branch namespace

```
config/<description>            schema/config mutation
work/<flowId>-<description>     flow execution off main
dry-run/<x>/<flowId>-<desc>     flow execution off config/<x> (dry-run mode, §9–§11)
```

Legal branches: `{config/<x>, work/<x>, dry-run/<x>/<y>}` for any
non-empty `<x>` and `<y>`. Anything else is refused for mutation.
`main` is a refusal target like any other non-prefixed branch.

Deeper nesting (`dry-run/<x>/<y>/<z>` and beyond) is explicitly
refused. Dry-run mode is one level only. Equivalently: any branch
name with more than two slashes under the `dry-run/` prefix is
refused, and any further `dry-run/*` creation is refused while
already on a `dry-run/*/*` branch.

The `<y>` segment in the dry-run mode form follows the same
`<flowId>-<slug>` shape as a top-level `work/` branch. The dry-run
namespace is a flat sibling of `config/`, not nested under it,
because git refuses to coexist a parent ref (`config/<x>`) with a
child-prefixed ref (`config/<x>/dry-run/...`); the two cannot exist
as branches at the same time.

## 5. Guard model

Foundry's mutation guards form three axes, all checked at the tool
layer.

### 5.1 Foundational guards

Every mutation tool requires:

- a git repository (`requireGitRepo`);
- a `foundry/` directory at the repo root (`requireFoundryRoot`).

`init-foundry` is the sole exception: it bootstraps the `foundry/`
directory and only requires `requireGitRepo`. After `init-foundry`,
the operator commits the scaffold on whatever branch they were on
(typically `main` or a feature branch) and from then on uses
`config/*` for all further config changes.

### 5.2 Branch guards

Three new guards (location flexible, e.g. `scripts/lib/branch-guard.js`):

```js
requireOnConfigBranch()    // throws unless current branch is config/<x>
                           // (strict: rejects dry-run/<x>/<y>)
requireOnFlowBranch()      // throws unless current branch is work/<x>
                           // OR dry-run/<x>/<y>
requireOnConfigOrFlowBranch()  // either of the above
```

Branch-tier classification:

- **Config-tier mutation** (the 5 new `_create_*` tools, all 9
  memory-schema tools, `foundry_memory_reset`, `foundry_memory_init`):
  `requireOnConfigBranch`. These refuse inside dry-run mode by design —
  dry-run mode is for trying config, not for changing it.
- **Flow-tier mutation** (orchestrate, workfile, artefact, feedback,
  assay, validate, appraisers, history, stage, memory data
  put/relate/unrelate): `requireOnFlowBranch`. These accept both
  top-level `work/*` and dry-run `dry-run/*/*`.

`requireNotFailed` continues to apply to flow-tier tools as today.

### 5.3 Directory-scope guards

Each mutation tool declares which paths it may touch. The existing
`commitWithPolicy` helper in `scripts/lib/git-bridge.js` already
enforces "stage only the allowed paths, refuse if anything unexpected
is dirty"; this work extends it to be **branch- and stage-aware** so
the same helper enforces directory scope across all mutation paths.

Path-scope rules:

- **Config-tier tools** may only stage paths under `foundry/`. The
  one exception is `foundry_memory_init`, which also scaffolds
  `foundry-memory/` (a deliberate operator gesture, classified as
  config — same reasoning applied to `foundry_memory_reset`).
- **Flow-tier tools** stage paths according to the active stage:
  - **Forge stage**: only paths matching the cycle's output
    artefact-type `file-patterns`.
  - **Orchestrator commits**: only `WORK.md`, `WORK.history.yaml`,
    `WORK.feedback.yaml`, and `.foundry/**`.
  - **Memory-data tools** (`_memory_put` / `_relate` / `_unrelate`)
    and the **assay stage** (extractors write memory rows): only
    `foundry-memory/**`.

Schema mutation and memory-data mutation are deliberately disjoint:
schema lives on `config/*` and touches `foundry/`; data lives on
`work/*` (or `dry-run/*/*`) and touches `foundry-memory/`. The
schema cannot be updated and data written in the same branch.

### 5.4 Composition

A shared helper `guarded(execute, [...guards])` (location TBD, likely
`scripts/lib/guards.js`) wraps a tool's `execute` with the declared
guards. As part of this work, the inline `requireNotFailed` checks
currently duplicated across `feedback-tools.js`, `assay-tools.js`,
`validate-tools.js`, `stage-tools.js`, `workfile-tools.js`,
`memory-tools.js`, `artefact-tools.js`, and `orchestrate-tool.js` are
refactored to use `guarded()`. `gateAdmin` in
`memory-admin-tools.js` is replaced by the same helper.

This single composition layer is also the attachment point for
verbose tool-call tracing (§10).

Composition order:

1. `requireGitRepo`
2. `requireFoundryRoot`
3. `requireOnConfigBranch` or `requireOnFlowBranch` (whichever applies)
4. `requireNotFailed` (flow-tier only)

Directory scope is enforced at commit time inside `commitWithPolicy`.

### 5.5 Error messages

Error messages name the offending branch or path and the expected
state, and suggest the corresponding `foundry_git_branch` invocation
when the failure is branch-related.

## 6. Tool guard table

| Tool | main / unprefixed | config/* | work/* | dry-run/*/* |
|---|---|---|---|---|
| **Config-tier mutation** | | | | |
| 5 new `foundry_config_create_*` (artefact-type, law, appraiser, flow, cycle) | ❌ | ✅ | ❌ | ❌ |
| 6 memory-schema admin tools (`create_entity_type`, `create_edge_type`, `rename_entity_type`, `rename_edge_type`, `drop_entity_type`, `drop_edge_type`) | ❌ | ✅ | ❌ | ❌ |
| `foundry_extractor_create` | ❌ | ✅ | ❌ | ❌ |
| `foundry_memory_init` | ❌ | ✅ | ❌ | ❌ |
| `foundry_memory_reset` | ❌ | ✅ | ❌ | ❌ |
| `foundry_memory_change_embedding_model` | ❌ | ✅ | ❌ | ❌ |
| **Flow-tier mutation** | | | | |
| `foundry_memory_put` / `_relate` / `_unrelate` | ❌ | ❌ | ✅ | ✅ |
| `foundry_workfile_*`, `foundry_orchestrate`, `foundry_artefacts_*`, `foundry_feedback_*`, `foundry_assay_run`, `foundry_validate_run`, `foundry_appraisers_select`, `foundry_history_list`, `foundry_stage_*` | ❌ | ❌ | ✅ | ✅ |
| **Read-only** | | | | |
| 5 new `foundry_config_validate_*` (artefact-type, law, appraiser, flow, cycle) | ✅ | ✅ | ✅ | ✅ |
| All `foundry_config_*` read tools (`cycle`, `artefact_type`, `laws`, `validation`, `appraisers`, `flow`) | ✅ | ✅ | ✅ | ✅ |
| `foundry_memory_validate` | ✅ | ✅ | ✅ | ✅ |
| All `foundry_memory_get` / `_list` / `_neighbours` / `_query` / `_search` / `_dump` | ✅ | ✅ | ✅ | ✅ |
| **Meta** | | | | |
| `init-foundry` (skill; no MCP tool today) | ✅ (only requires git repo; see §5.1) | ✅ | ✅ | ✅ |
| `foundry_memory_vacuum` | ✅ | ✅ | ✅ | ✅ |
| `foundry_snapshot_list` / `_show` / `_delete` / `_prune` | ✅ | ✅ | ✅ | ✅ |
| `foundry_git_branch` | ✅ (kind=`config` or `work`) | ✅ (kind=`dry-run`) | ❌ | ❌ |
| `foundry_git_finish` | ❌ (refuses; nothing to finish) | ✅ (squash-merge) | ✅ (squash-merge) | ✅ (snapshot + discard, §11) |

Notes:

- `foundry_memory_vacuum` only runs `::compact` on the Cozo SQLite at
  `foundry/memory/memory.db` (gitignored). It touches no tracked
  files and is permitted everywhere.
- `foundry_memory_reset` truncates NDJSON files under
  `foundry-memory/`. That is data mutation by content but a
  deliberate operator gesture applied to the project's data baseline;
  it is classified as config. The squash-merge from `config/*` keeps
  it as one operator-attributable commit.
- `foundry_memory_init` is the one config-tier tool that legitimately
  writes outside `foundry/`: it scaffolds the initial
  `foundry-memory/` directory and empty NDJSON files. Treated as
  config for the same reason as `_memory_reset`. The directory-scope
  guard (§5.3) allows it to stage paths under `foundry-memory/` in
  addition to `foundry/`.

## 7. New config-create tools

Five new MCP tools. Each accepts the full markdown body the LLM has
authored and writes it after a successful validate step.

- `foundry_config_create_artefact_type({ name, body })`
- `foundry_config_create_law({ name, body })`
- `foundry_config_create_appraiser({ name, body })`
- `foundry_config_create_flow({ name, body })`
- `foundry_config_create_cycle({ flow, name, body })`

Five matching validators, each accepting the same arguments and
returning a structured report (`{ ok: true }` or
`{ ok: false, errors: [...] }`):

- `foundry_config_validate_artefact_type`
- `foundry_config_validate_law`
- `foundry_config_validate_appraiser`
- `foundry_config_validate_flow`
- `foundry_config_validate_cycle`

LLM workflow per skill:

1. Author markdown content for the file.
2. Call `_validate_*` until it returns `{ ok: true }`.
3. Call `_create_*` to write and commit.

The validator's job is the strict checks the runtime actually relies
on: required frontmatter keys (including hyphenated ones like
`output-type`, `file-patterns`, `input-types`), correct types, valid
references to existing artefact types / flows / cycles, and the
parsed body sections runtime needs (`laws.md` body shape,
`validation.md` body shape). Prose-only sections are not parsed and
not validated for content.

`_create_*` performs the same validation a final time before writing,
to guard against TOCTOU between validate and create. It also refuses
if the target path already exists (updates are deferred; see end of
this section). On success it writes the file and produces a single
git commit on the current `config/*` branch with a structured
message:

```
config: add <kind> <name>

via foundry_config_create_<kind>
```

The commit reuses the policy-enforcing helper `commitWithPolicy` in
`scripts/lib/git-bridge.js` that `foundry_orchestrate` already uses
to produce per-stage commits. That helper stages only the explicitly
allowed paths and refuses if anything unexpected is dirty in the
worktree, which is exactly the behaviour the config-create tools
need: each invocation produces one commit touching exactly one
config file.

Updates (editing existing config files) are deferred. No
`foundry_config_update_*` tools in 3.0.0. Operators edit by hand on a
`config/*` branch when an update is needed; this is an acceptable
escape hatch because such edits are rare and the operator has
already declared intent by checking out the correct branch.

## 8. `foundry_git_branch` and `foundry_git_finish`

### 8.1 `foundry_git_branch`

`foundry_git_branch({ kind, flowId?, description })`:

- `kind` is **required**: one of `'config' | 'work' | 'dry-run'`. The
  tool fails fast on missing or unknown `kind`. No inference from
  current branch or argument shape — operator declares intent
  explicitly.
- Per-kind requirements:

  | `kind`   | required args             | required current branch                            | result                                |
  |----------|---------------------------|----------------------------------------------------|---------------------------------------|
  | `config` | `description`             | not on `config/*` or `work/*` (typically `main`)   | `config/<slug>`                       |
  | `work`   | `flowId`, `description`   | not on `config/*` or `work/*` (typically `main`)   | `work/<flowId>-<slug>`                |
  | `dry-run` | `flowId`, `description`  | on `config/<x>`                                    | `dry-run/<x>/<flowId>-<slug>`         |

- Slug rules (existing): lowercased, non-alphanumeric collapsed to
  `-`, trimmed; refused if empty after slugification.
- Refusal cases (each with a message naming the offending state and
  the expected one):
  - missing or unknown `kind`;
  - missing required args for the chosen `kind`;
  - args supplied that are not valid for the chosen `kind` (e.g.
    `flowId` with `kind: "config"`). Forbidden args are refused, not
    silently ignored;
  - wrong starting branch for the chosen `kind`;
  - dirty worktree (existing behaviour preserved);
  - already on `dry-run/<x>/<y>` (cannot nest deeper, regardless
    of `kind`).

### 8.2 `foundry_git_finish`

`foundry_git_finish({ message, baseBranch?, confirm })` dispatches
on the current branch prefix:

- **`work/<x>`**: existing semantics. Squash-merges into `baseBranch`
  (default `main`), deletes the `WORK*` files in the cleanup commit,
  deletes the work branch.
- **`config/<x>`**: squash-merges into `baseBranch` (default `main`)
  and deletes the config branch. No `WORK*` files exist on a config
  branch, so no cleanup commit is needed.
- **`dry-run/<x>/<y>`** (dry-run mode): writes a snapshot to
  `.snapshots/<run-id>/` on the parent `config/<x>` working tree
  and discards the dry-run branch. No merge, no commit. Full sequence
  in §11. `baseBranch` is **not valid** for this case — the parent
  is determined by the dry-run branch name; supplying `baseBranch` is
  a refusal case.
- **Any other branch** (including `main`): refused; nothing to
  finish.

Common behaviour across all three modes:

- The `confirm: true` gate; without it, finish returns a preview
  describing what would happen.
- Dirty-tree refusal.
- For `work/*` and `config/*`: existing squash-merge conflict
  recovery (operator resolves on the merge branch; tool re-runnable).
- For `dry-run/*/*`: see §11 for failure modes specific to
  dry-run mode.

## 9. Behaviour during dry-run mode

The `config/<x>` workflow lets an operator change foundry's
configuration safely. It does not let them *try* the change — see how
the modified flow behaves end-to-end on a real input — without either
leaving the config-in-progress unmerged or having the dry run
pollute the config branch's history.

Dry-run mode answers: "from a `config/<x>` branch with my in-progress
changes, run flow F against goal G, observe everything the flow did,
then throw away the run while keeping a forensic snapshot for
analysis."

Concretely:

- The operator is iterating on a flow definition or a law.
- They want to confirm the change works against a representative
  goal before merging the config.
- A normal `work/<flow>-<goal>` branch off `main` would not see the
  in-progress config (it's still on `config/<x>`).
- A flow run on `config/<x>` directly would leak WORK files and
  memory data into the config branch.
- The operator wants the dry run's output preserved (for diff
  analysis), but not the run's mutations.

While on `dry-run/<x>/<y>`:

- Flow execution proceeds normally. `foundry_orchestrate`,
  `foundry_workfile_*`, `foundry_artefacts_*`, `foundry_feedback_*`,
  memory data tools, etc. all work — they pass `requireOnFlowBranch`.
- Schema-mutation tools refuse — `requireOnConfigBranch` is strict
  and does not match the nested namespace. The operator cannot
  modify config from inside a dry run. This is intentional: if
  config needs adjusting, finish the dry run, edit on the parent
  `config/<x>`, then re-enter dry-run mode.
- Verbose tool-call tracing is **on** (see §10). Outside dry-run mode
  it is off.
- The flow inherits the parent `config/<x>` branch's config because
  git resolved the branch off that parent. There is no special
  config loading.

Memory data mutations made during the dry run live in
`foundry-memory/` on the dry-run branch, just like a normal flow.
They are part of the snapshot diff (§11) and are discarded when the
branch is discarded.

The dry-run branch inherits `foundry-memory/` from `config/<x>` at
branch-creation time (git's normal branching behaviour — no special
loading). For a fresh-slate dry run (e.g. to re-run extractors against
a known-empty memory), the operator finishes the dry-run branch, runs
`foundry_memory_reset` on `config/<x>`, and re-enters dry-run mode.
`foundry_memory_reset` is config-tier and refuses inside dry-run mode
by design.

## 10. Verbose tool-call tracing

While on a `dry-run/<x>/<y>` branch, the foundry MCP plugin
appends one JSONL record per tool invocation to a trace file:

```
.foundry/trace/<branch-slug>.jsonl
```

`<branch-slug>` is the dry-run branch name with `/` replaced by
`-`, so `dry-run/foo/bar-baz` becomes
`dry-run-foo-bar-baz.jsonl`.

Record shape:

```json
{
  "ts": "2026-04-29T12:34:56.789Z",
  "tool": "foundry_orchestrate",
  "args": { ... },
  "result": { ... } | { "error": "..." },
  "duration_ms": 123
}
```

Tracing covers every `foundry_*` tool call. Read-only tools are
traced along with mutation tools — the operator wants to see what
the flow inspected, not just what it changed. Non-foundry tool calls
(Read, Write, Bash, etc. invoked by the LLM running the flow) are
not traced; their effects show up in the FS diff (§11).

Implementation seam: tracing is hung off the same `guarded()`
wrapper introduced in §5.4. One layer wraps every `foundry_*` tool's
`execute`, applies the configured guards, and — when the current
branch matches `dry-run/<x>/<y>` — appends a JSONL record before
and after the tool body. There is no per-tool tracing code; if a
tool is registered through the wrapper, it is traced.

`.foundry/` is gitignored, so the trace file is not committed during
the run. It is read by `foundry_git_finish` at snapshot time (§11)
and copied into the snapshot directory.

The trace file is truncated at branch-creation time, so a re-entered
dry-run branch starts clean.

## 11. Finishing dry-run mode: snapshot and discard

`foundry_git_finish({ message, confirm })` on `dry-run/<x>/<y>`
behaves differently from the `work/*` and `config/*` cases in §8.2.

The branch is **never merged**. Its commits and tree are discarded.
Before discarding, foundry captures a snapshot to disk on the parent
`config/<x>` branch's working tree.

The snapshot is **not committed**. It is written as untracked,
gitignored files. The operator decides what to do with it: inspect
it, copy interesting bits elsewhere, or `rm -rf` it. Foundry never
adds, commits, or otherwise tracks the snapshot.

`baseBranch` is **not valid** for a dry-run finish (see §8.2);
the parent config branch is determined by the dry-run branch name.

### 11.1 Snapshot location

```
.snapshots/<run-id>/
```

Top-level dot-prefixed directory in the repo, **gitignored**
(`.snapshots/` is added to `.gitignore` by `init-foundry`, alongside
the existing `.foundry/` line). The convention mirrors `.foundry/`:
hidden, ephemeral, foundry-owned runtime data.

`<run-id>` is `<branch-slug>-<ulid>` where `<branch-slug>` is the
dry-run branch name with `/` replaced by `-` and `<ulid>` is a
26-character ULID from `scripts/lib/ulid.js` (Crockford base32, time-
prefixed, monotonic). The ULID embeds creation time in its first ten
characters, so `_list` can sort run-ids lexicographically to get
chronological order without parsing metadata. Example:

```
.snapshots/dry-run-foo-bar-baz-01HX8K3M5N7PQR9STVWXYZ0123/
```

### 11.2 Snapshot contents

```
.snapshots/<run-id>/
├── README.md           # branch name, flow id, goal, start/end ts, exit reason
├── work/
│   ├── WORK.md
│   ├── WORK.history.yaml
│   └── WORK.feedback.yaml
├── diff.patch          # unified diff of dry-run branch tip vs parent config/<x>
└── trace.jsonl         # copy of .foundry/trace/<branch-slug>.jsonl
```

- **`work/`** captures the WORK files at the moment finish was
  called, verbatim. This is the flow's lifecycle state.
- **`diff.patch`** is `git diff config/<x>...HEAD` produced by
  foundry before checkout. Three-dot (merge-base) diff is used so
  the patch captures only what the dry-run branch added on top of
  where it forked from; if the operator advances `config/<x>` during
  a long-running dry run, those parent-side commits are not reported
  as "removed" by the snapshot. It captures every tracked-file change
  the flow made: artefacts produced, memory data written, etc.
- **`trace.jsonl`** is the verbose tool-call log from §10, copied
  in verbatim.
- **`README.md`** is generated by foundry from the `message`
  argument plus metadata (branch name, parent branch, flow id if
  known, goal text from WORK.md, start time inferred from first
  trace record, finish time, whether the flow ended `done`,
  `failed`, or operator-aborted).

### 11.3 Sequence

1. Verify clean tree on the dry-run branch (dirty-tree refusal, §11.4).
2. Capture `diff.patch` (`git diff config/<x>...HEAD`) to a temp
   buffer.
3. Capture WORK file contents to a temp buffer.
4. Read `.foundry/trace/<branch-slug>.jsonl` to a temp buffer.
5. Generate the README from metadata and the `message` argument.
6. Checkout `config/<x>`.
7. Materialise `.snapshots/<run-id>/` from the captured buffers.
   Files are written as untracked. Foundry does not run `git add`.
8. Force-delete the dry-run branch (`git branch -D
   dry-run/<x>/<y>`). The parent config branch was determined by
   parsing the dry-run branch name (extract `<x>` from
   `dry-run/<x>/<y>` → parent is `config/<x>`).
9. Truncate `.foundry/trace/<branch-slug>.jsonl`.
10. Return control to the operator on `config/<x>` with the snapshot
    on disk. `git status` reports a clean tracked tree; the snapshot
    directory under `.snapshots/<run-id>/` is untracked and ignored
    via the `.snapshots/` `.gitignore` entry, so it does not appear
    in `git status` output at all.

The dry-run branch's commits become unreachable and are
garbage-collected by git in the normal way.

### 11.4 Confirm gate and dirty-tree refusal

The `confirm: true` gate applies. Without it, finish returns a
preview: snapshot path, branch to be deleted, file count in the diff.

Dirty-tree refusal also applies: the operator must commit or stash
flow output before finish. (In practice, most flows leave a clean
tree at end-of-cycle because orchestrate commits per-stage; this is
the same pre-existing behaviour.)

### 11.5 Failure modes

- **Snapshot path collision**: cannot happen — `.snapshots/<run-id>/`
  is a fresh path per run by construction (ULID suffix). The only
  failure path is filesystem-level (disk full, permission), in which
  case finish aborts and the dry-run branch is preserved for retry.
- **Operator aborts mid-finish**: the dry-run branch and
  `.foundry/trace/` are untouched until the snapshot is fully
  written and the dry-run branch is deleted. Re-running finish is safe.
- **Trace file missing or truncated**: snapshot still produced;
  trace file in snapshot is empty or partial; README notes this.
- **Flow ended in failure state**: snapshot is still produced.
  Forensic snapshots of failed runs are the most useful kind.
- **Operator supplies `baseBranch` to dry-run finish**: refused;
  baseBranch is meaningless for dry-run mode (no merge happens, parent
  is determined by the branch name).
- **Process killed mid-write**: snapshot creation in §11.3 step 7 is
  not atomic. A killed finish can leave a partial `.snapshots/<run-id>/`
  with some files missing. `foundry_snapshot_list` returns it with an
  `error: "incomplete"` marker; `foundry_snapshot_show` reports which
  expected files are missing. Operator deletes via
  `foundry_snapshot_delete`. The dry-run branch is preserved (step 8
  ran only after step 7 completed), so retry by re-running finish on
  the still-existing dry-run branch.

### 11.6 Snapshot tools

Four MCP tools provide programmatic access to `.snapshots/`. All four
are meta tools (like `foundry_memory_vacuum`): they touch only
gitignored files, carry no branch guards, and are allowed everywhere.

- `foundry_snapshot_list({})` →
  `[{ runId, branch, parent, flow, goal, startedAt, finishedAt,
     exitReason, error? }]` for every snapshot under `.snapshots/`.
  Metadata is parsed from each snapshot's `README.md`. Snapshots
  with missing or malformed `README.md` (e.g. interrupted writes,
  see §11.5) are returned with `error: "incomplete"` plus whatever
  metadata could be recovered, rather than omitted.
- `foundry_snapshot_show({ runId })` →
  `{ runId, readme, metadata, diff: { files, insertions, deletions },
     trace: { lineCount, firstTs, lastTs }, missing: [...] }`. Returns
  a structured summary; the full `diff.patch` and `trace.jsonl` stay
  on disk for the operator to inspect with shell tools. `missing`
  lists any of the four expected files (`README.md`, `work/...`,
  `diff.patch`, `trace.jsonl`) that aren't present.
- `foundry_snapshot_delete({ runId, confirm })`. Without `confirm`,
  returns a preview (paths to be removed, file count). With
  `confirm: true`, removes `.snapshots/<runId>/`. Refuses on unknown
  `runId`.
- `foundry_snapshot_prune({ olderThanDays, confirm })`. Without
  `confirm`, returns a preview list of run-ids that match. With
  `confirm: true`, removes them. `olderThanDays` is required and
  must be a positive integer.

These tools never modify tracked files; the directory-scope guard is
"may stage nothing" (read-only with respect to git).

## 12. Skill changes

### 12.1 Five `add-*` config skills

`add-flow`, `add-cycle`, `add-law`, `add-appraiser`,
`add-artefact-type`:

- Replace direct `Write` / `Edit` steps with
  `foundry_config_validate_*` and `foundry_config_create_*`
  invocations.
- Keep the existing prose preamble that says "ensure you are on a
  `config/*` branch; if not, use
  `foundry_git_branch({ kind: 'config', ... })` first." The tool
  guard now backs this up.
- The create tool produces a single commit per invocation. Skills
  should not include `git add` / `git commit` instructions; the
  microcommit-per-config-change pattern is enforced at the tool
  layer.

### 12.2 Nine memory-schema skills

`add-memory-entity-type`, `add-memory-edge-type`,
`rename-memory-entity-type`, `rename-memory-edge-type`,
`drop-memory-entity-type`, `drop-memory-edge-type`,
`change-embedding-model`, `init-memory`, `add-extractor`:

- Add a prose preamble identical in shape to the one used by the
  config skills: "ensure you are on a `config/*` branch; if not, use
  `foundry_git_branch({ kind: 'config', ... })` first."
- The existing `git add` paths for NDJSON files (created at
  type-creation time) remain. The B18/B19 REVIEW.md entries (which
  questioned those paths) are superseded by this work and should be
  marked accordingly.
- The tool guard backs the preamble up; the skill prose is the
  human-facing reminder.

### 12.3 One memory-data skill

`reset-memory`:

- Add the same `config/*` preamble. `foundry_memory_reset` is a
  deliberate operator gesture, not a flow operation.

### 12.4 New `dry-run` skill

A new skill covering the dry-run mode workflow.

- **When to use:** you are on a `config/<x>` branch with in-progress
  config changes, and you want to run a flow against the modified
  config to see what happens, without merging the config or
  contaminating the config branch with the dry run.
- **Steps:**
  1. Confirm current branch is `config/<x>` and tree is clean.
  2. Call
     `foundry_git_branch({ kind: "dry-run", flowId, description: <dry-run-purpose> })`.
  3. Run the flow normally (typically via the `flow` skill).
  4. When done (success or failure), call
     `foundry_git_finish({ message: <findings>, confirm: true })`.
  5. Inspect the snapshot at `.snapshots/<run-id>/`. The diff and
     trace tell you exactly what the flow did.
  6. If the dry run reveals the config needs adjustment: edit on
     `config/<x>`, then optionally re-enter dry-run mode for another
     run. Snapshots are gitignored and do not affect the config
     branch's history.
  7. When ready, finish `config/<x>` to `main` per §8.2. Snapshots
     do not merge with the config — they are local to the
     operator's working tree.

### 12.5 Flow skills (no change)

`assay`, `appraise`, `forge`, `quench`, `human-appraise`,
`orchestrate`, `flow`, and other flow skills do not change. They
already operate inside flows, which run on `work/*` or
`dry-run/*/*`. Their tools are guarded by `requireOnFlowBranch`
per §5.2 and run identically inside dry-run mode.

The five `add-*` config skills do not change in their dry-run mode
behaviour: they explicitly refuse to run inside dry-run mode because
`requireOnConfigBranch` does not match `dry-run/<x>/<y>`. The
skill prose preamble (§12.1) catches this in the human-facing layer
too.

## 13. Reading a snapshot

This is operator-facing, but worth specifying so foundry's tooling
matches expectations.

To analyse a snapshot, the operator inspects `.snapshots/<run-id>/`
directly:

- `README.md` for the high-level summary.
- `diff.patch` to see every file change the flow made — apply with
  `git apply --check` (won't apply; just inspects) or read directly.
- `trace.jsonl` filtered with `jq` for specific tool calls of
  interest.
- `work/WORK.md` to see how the flow's plan evolved.

No special foundry tool reads snapshots. They are flat files
designed for direct inspection. A future version may add a
snapshot-diff viewer; this release does not.

Snapshots accumulate under `.snapshots/` (gitignored) across dry
runs. They are not tracked in git and are never followed into commits
by foundry. Retention is purely an operator decision: keep them
around for as long as they are useful and `rm -rf` them when not. If
an operator wants to preserve a particular snapshot beyond the local
checkout, they may copy it elsewhere or explicitly add and commit it
by hand on a `config/*` branch — but foundry does not encourage this
and `.gitignore` makes it slightly awkward by design.

## 14. Failure-mode review

### 14.1 Branch / tool combinations

- **User on `main` calls `foundry_config_create_law`** → tool
  refuses with message naming branch and suggesting
  `foundry_git_branch({ kind: "config", description: "..." })`.
- **User on `config/foo` calls `foundry_orchestrate`** → tool
  refuses with message naming branch and suggesting
  `foundry_git_branch({ kind: "dry-run", flowId: "...", description: "..." })`.
- **User on `work/bar` calls
  `foundry_memory_create_entity_type`** → tool refuses; same shape.
- **User on detached HEAD** → `requireOnConfigBranch` /
  `requireOnFlowBranch` refuse; message points at `git checkout`
  plus `foundry_git_branch`.
- **User on `dry-run/<x>/<y>` calls
  `foundry_config_create_law`** → refuses;
  `requireOnConfigBranch` is strict and does not match. Message
  points at the parent branch.

### 14.2 `foundry_git_branch` arg validation

- **Operator on `config/<x>` calls `foundry_git_branch` with
  `kind: "config"`** → refuses (already on a `config/*` branch);
  suggests editing on `config/<x>` directly.
- **Operator on `config/<x>` calls `foundry_git_branch` with
  `kind: "work"`** → refuses (cannot start a top-level work branch
  off a config branch); suggests `kind: "dry-run"` instead, or first
  `foundry_git_finish` to leave the config branch.
- **Operator on `dry-run/<x>/<y>` calls `foundry_git_branch`
  (any `kind`)** → refuses; cannot nest deeper.
- **Missing or unknown `kind`** → refuses with the per-kind
  requirements table from §8.1.
- **Forbidden arg for `kind`** (e.g. `kind: "config"` with a `flowId`
  argument) → refuses; names the offending arg and the kind that
  would accept it.

### 14.3 Validate / create races

- **Validator passes, then user edits the file before create runs**
  → create re-validates and fails cleanly without writing.
- **Create called with a name that collides with an existing file**
  → refuses; updates are deferred (§7).
- **Rapid create/validate sequence races against external git
  operation** → out of scope; foundry assumes the operator does
  not run conflicting git commands during a tool call.

### 14.4 `foundry_git_finish`

- **Called on `main`** → refuses (no work to finish).
- **Called with dirty tree** → existing refusal preserved (all three
  modes).
- **Squash-merge conflict** (work/* or config/* mode) → existing
  recovery path preserved (operator resolves on the merge branch;
  tool re-runnable).
- **Dry-run finish failure modes** — see §11.5.

### 14.5 Dry-run lifecycle

- **Dry run abandoned without finish** → branch persists,
  trace file persists. Operator can either re-run finish to get the
  snapshot or `git checkout config/<x> && git branch -D
  dry-run/<x>/<y>` to discard without snapshot.
- **Operator manually deletes the dry-run branch before finish**
  → snapshot is lost. The trace file in `.foundry/trace/` may or
  may not still exist; if so, it can be recovered by hand. Foundry
  does not protect against operator-issued git commands.
- **Two dry runs against the same `config/<x>` and same
  flow** → produce two distinct `<run-id>` directories under
  `.snapshots/` (ULID suffix differs).
- **`config/<x>` has accumulated several snapshots and the
  operator finishes to `main`** → snapshots are gitignored and do
  not merge. They remain in the operator's local working tree
  until removed.

## 15. Testing strategy

### 15.1 Guard unit tests

- **`requireGitRepo`, `requireFoundryRoot`**: stub filesystem,
  assert correct refusal/permission with and without each
  prerequisite present.
- **`requireOnConfigBranch`** (strict): matches `config/foo`;
  rejects `dry-run/foo/bar`, `work/foo`, `main`, detached HEAD,
  `feature/foo`.
- **`requireOnFlowBranch`** (extended): matches `work/foo` and
  `dry-run/x/foo`; rejects `config/foo`, `main`, detached HEAD,
  and any deeper nesting (`dry-run/x/foo/bar`).
- **`guarded()` composition**: assert that guards run in the order
  documented in §5.4 and that the first failing guard short-circuits.

### 15.2 Per-tool integration tests

- For each of the 10 new `foundry_config_*` tools (5 create,
  5 validate): happy path, validator-fail path, write produces
  correct commit, refusal on wrong branch, refusal when target file
  already exists (create only).
- For the existing memory-admin tools and `foundry_extractor_create`:
  refusal on wrong branch (now config-tier), happy path on
  `config/*`.
- For `foundry_memory_init`: confirms it can stage paths under both
  `foundry/` and `foundry-memory/` per §5.3 / §6.

### 15.3 Validator fixture tests

Each of the 5 validators gets a fixtures directory with one valid
example and one invalid example per parsed rule. Runtime-relevant
checks only (frontmatter shape, references, parsed body sections);
prose-only sections are not exercised.

### 15.4 `foundry_git_branch` integration test

Cross every starting branch shape (`main`, `config/x`, `work/x`,
`dry-run/x/y`, unprefixed feature branch) with every `kind`
value (`'config'`, `'work'`, `'dry-run'`) and with required-arg
variations (missing args, missing `kind`). Assert the per-kind
table from §8.1.

### 15.5 `foundry_git_finish` integration test

Cross every starting branch shape with `confirm` true / false /
omitted, with `baseBranch` supplied / omitted, with dirty / clean
trees. Assert the three-mode dispatch from §8.2 and the dry-run
`baseBranch` refusal.

### 15.6 Tracing integration test

Confirms `.foundry/trace/<slug>.jsonl` is appended during a flow
run on a dry-run branch and **not** appended during a flow run
on a top-level `work/*` branch. Confirms the trace is truncated at
dry-run branch creation and copied into the snapshot at finish.

### 15.7 End-to-end smoke tests

- **Config workflow:** from `main`, create a `config/*` branch with
  `kind: "config"`, add a law via the new tool, finish to `main`.
  Assert: one squash commit lands on `main` with the law file; the
  config branch is deleted; tree is clean.
- **Work workflow:** from `main`, create a `work/*` branch with
  `kind: "work"`, run a flow, finish to `main`. Assert: one squash
  commit lands on `main` containing the flow's artefacts and any
  memory-data changes; the work branch is deleted.
- **Dry-run workflow:** create `config/foo`, edit a law, branch
  `dry-run/foo/some-flow-goal` with `kind: "dry-run"`, run a
  small flow to completion, finish with snapshot. Assert:
  `.snapshots/<run-id>/` exists in the working tree with all four
  expected entries; the snapshot is untracked (gitignored, not in
  `git status`); dry-run branch is deleted;
  `.foundry/trace/<slug>.jsonl` is truncated; HEAD is `config/foo`
  with a clean tree.
- **Failure-path dry run:** same as above but the flow fails
  mid-cycle. Assert snapshot is still produced and README notes the
  failed exit.

## 16. Migration and breaking changes

This work adds the third BREAKING entry for 3.0.0 (alongside
output-type rename and assay-feedback removal already pencilled
into `CHANGELOG.md`).

CHANGELOG entries:

```
### Breaking
- Schema/config mutation now requires a `config/*` branch.
  Flow-data mutation now requires a `work/*` or
  `dry-run/*/*` branch. Tools refuse on other branches.
- Memory data rows moved from `foundry/memory/relations/` to
  top-level `foundry-memory/relations/`. Existing memory data does
  not migrate; reset and re-extract.
- Five new `foundry_config_create_*` tools and five new
  `foundry_config_validate_*` tools. The five `add-*` config skills
  now use these instead of writing files directly.
- `foundry_git_branch` requires an explicit
  `kind: 'config' | 'work' | 'dry-run'` argument. Previous
  `flowId`-only signature is removed. Per-kind requirements are
  documented in `docs/tools.md`.
- `foundry_git_finish` on a `dry-run/*/*` branch (dry-run finish)
  writes an untracked snapshot directory at `.snapshots/<run-id>/`
  on the parent config branch's working tree and discards the
  dry-run branch (no merge, no commit).
- New nested branch namespace `dry-run/<x>/<y>` for dry-run
  flow runs against in-progress config.
- New `dry-run` skill.
- New gitignored top-level `.snapshots/` directory; appears in
  projects only after the first dry run. Snapshots are local
  operator artefacts and never committed by foundry.
- Four new `foundry_snapshot_*` tools (`_list`, `_show`, `_delete`,
  `_prune`) for programmatic snapshot inspection and cleanup.
- Verbose tool-call tracing is on inside dry-run mode; trace files
  live in `.foundry/trace/` (gitignored) during the run and are
  copied into snapshots at finish.
```

Doc updates required:

- `README.md` — quickstart mentions `config/*` for first-time
  config edits and dry-run mode for trying changes.
- `CHANGELOG.md` — entries above.
- `docs/concepts.md` — the §1 invariant in plain English; the third
  namespace and snapshot model.
- `docs/work-spec.md` — branch namespace section; dry-run mode flow
  lifecycle.
- `docs/getting-started.md` — first-run example uses
  `foundry_git_branch({ kind: "config", description: "init" })`;
  short dry-run example: edit a law on `config/foo`, dry-run it via
  `dry-run/foo/...`, inspect snapshot, finish.
- `docs/tools.md` — new tools listed; `foundry_git_branch` per-kind
  table; `foundry_git_finish` three-mode dispatch.
- `docs/skills.md` (or equivalent) — `dry-run` skill listed.

## 17. Out of scope

- **`foundry_config_update_*` tools** for editing existing config
  files. Operators edit by hand on `config/*` for now.
- **Pre-commit / git-policy hook layer.** Tool-layer enforcement is
  sufficient (see §2).
- **Migration tooling for pre-3.0.0 memory data.** Memory ships
  fresh in 3.0.0.
- **Multi-operator concurrency / lock files on `config/*`.**
  Foundry assumes single-operator-at-a-time for config work;
  ordinary git conflict resolution covers the rare exception.
- **Multi-level dry-run mode nesting** (`dry-run/x/y/dry-run/z`).
  One level only.
- **Auto-replay of snapshots** as regression tests. Snapshots are
  forensic; replay is a separate feature.
- **Snapshot diffing tools** (compare two snapshots side-by-side).
  Operators use `diff -r` between snapshot directories.
- **Trace replay** (re-run a flow from a `trace.jsonl`). The trace
  is for human inspection.
- **Branching dry-run mode off `work/*`.** A flow run cannot itself
  spawn a dry-run mode sub-run. Only `config/*` is a valid dry-run mode
  parent.
- **Cross-branch snapshot sharing.** Snapshots are local working-tree
  artefacts; if `config/<x>` is abandoned and the operator hasn't
  committed snapshots somewhere else, they go with it.
