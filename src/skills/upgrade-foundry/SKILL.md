---
name: upgrade-foundry
type: atomic
description: Analyses and migrates foundry configuration to the current version format.
---

# Upgrade Foundry

You analyse the entire `foundry/` directory and migrate configuration files to the current format, asking the user for clarification where needed.

## Prerequisites

Before running this skill, verify that the `foundry/` directory exists in the project root. If it does not exist, stop and tell the user:

> Foundry is not initialized in this project. Run the `init-foundry` skill first to create the foundry/ directory structure.

## Protocol

### 1. Scan entire foundry directory

Read all configuration files:
- `foundry/flows/*.md` — flow definitions
- `foundry/cycles/*.md` — cycle definitions
- `foundry/artefacts/*/definition.md` — artefact type definitions
- `foundry/artefacts/*/laws.md` — type-specific laws
- `foundry/artefacts/*/validation.md` — validation commands
- `foundry/laws/*.md` — global laws
- `foundry/appraisers/*.md` — appraiser definitions

Also scan `.opencode/agents/foundry-*.md` for agent-filename migration (see §2).

For each file, parse the frontmatter and body content.

### 2. Detect what needs migration

Check each file against the current expected format:

**Agent files (v2.1 migration — see §8):**
- Any `.opencode/agents/foundry-*.md` filename containing a `.` character? → needs renaming to all-dashes format. The v2.1 naming convention replaces both `/` and `.` in the model ID with `-`. For example, `foundry-github-copilot-claude-sonnet-4.6.md` must become `foundry-github-copilot-claude-sonnet-4-6.md`. The inner `model:` frontmatter field is **not** changed — only the filename.

**Flows:**
- Has `starting-cycles` field? If not → needs DAG migration
- Has ordered numbered list under `## Cycles`? → needs conversion to unordered list

**Cycles:**
- Has `targets` field? If not → needs target routing
- Has `inputs.type` (`any-of`/`all-of`)? If `inputs` is a plain list → needs contract type
- Has `hitl` in stages or frontmatter? → needs human-appraise migration
- Has nested `human-appraise: {enabled, deadlock-threshold}`? → v2.2.0 → v2.2.1 flat-keys migration (see §8b)
- Has `output:` in frontmatter (instead of `output-type:`)? → v2.6 → v2.7 cycle-output rename (see §7a)
- Has `models` map? Check format

**Artefact types:**
- Has required frontmatter fields (`id`, `name`, `file-patterns`)?
- Has `output:` in frontmatter? → v2.6 → v2.7 cycle-output rename (see §7a)
- Has `appraisers` config if applicable?

**Appraisers:**
- Has `id` and personality content?
- Has optional `model` field?
- References any deprecated stage types?

**Laws:**
- Uses `## heading` per law?
- Any structural issues?

**Validation:**
- Uses `Command:` / `Failure means:` format?
- Commands have backticks that could cause issues? (Suggest removing — the parser strips them but clean is better)

### 3. Present findings

Present a grouped summary of all issues found:

> **Migration Report**
>
> **Flows (N issues):**
> - `creative-flow.md` — missing `starting-cycles`, has ordered cycle list
>
> **Cycles (N issues):**
> - `create-haiku.md` — missing `targets` field
> - `create-short-story.md` — inputs is plain list, needs `any-of`/`all-of` contract
>
> **Artefact types (N issues):**
> - (none found)
>
> **Appraisers (N issues):**
> - (none found)
>
> **Everything else clean**

If nothing needs migration, say so and stop.

### 4. Choose your starting version

The current target version is **v3.0.0**. Identify the version you're upgrading from (check the `@really-knows-ai/foundry` entry in `package.json`) and read only the sections you need.

| From    | To 3.0.0 | Sections to read (in order)                                     |
|---------|----------|-----------------------------------------------------------------|
| 2.7.x   | 3.0.0    | §7b (v2.7 → v3.0 branch namespaces, dry-run, snapshots, assay)  |
| 2.6.x   | 3.0.0    | §7a (v2.6 → v2.7), §7b                                          |
| 2.5.x   | 3.0.0    | §7 (v2.5 → v2.6), §7a, §7b                                      |
| 2.4.x   | 3.0.0    | §6 (v2.4 → v2.5), §7, §7a, §7b                                  |
| 2.3.x   | 3.0.0    | §5 (v2.3 → v2.4), §6, §7, §7a, §7b                              |
| 2.2.x   | 3.0.0    | §8c (v2.2.x → v2.3), §5, §6, §7, §7a, §7b                       |
| 2.1.x   | 3.0.0    | §8 (v2.1 agents), §8a, §8b, §8c, §5, §6, §7, §7a, §7b           |
| pre-2.1 | 3.0.0    | All historical migrations (§8 → §8c), then §5 → §7b             |

Each section labels the source-version range it applies to and the target version. A migration becomes a no-op once you have already passed through it.

### 5. v2.3.x → v2.4.x

v2.4.0 adds **flow memory** — an opt-in, typed graph store under `foundry/memory/`. v2.4.1 fixes the `getting-started` install snippet; v2.4.2 is README-only. None of these are forced migrations.

#### Pre-flight checks

Same as §8c: clean tree, on base branch, no `WORK.md` in repo root.

#### Upgrade steps

1. `npm install @really-knows-ai/foundry@2.4.2 --save-dev` (or skip straight to 2.6.0 — see later sections).
2. Replace `.opencode/plugins/foundry.js` with the new version from `node_modules/@really-knows-ai/foundry/.opencode/plugins/foundry.js`.
3. **No config migration required.** Existing flows, cycles, artefact types, appraisers, and laws continue to work unchanged. A project without `foundry/memory/` behaves exactly as before.
4. (Optional) To opt into flow memory, run the `init-memory` skill afterwards. Cycles that want memory must declare a `memory: { read: [...], write: [...] }` block in their frontmatter — but no existing cycle is forced to.
5. Commit: `chore: upgrade foundry to 2.4.2`.

### 6. v2.4.x → v2.5.x

v2.5.0 adds the **assay stage** — a deterministic, opt-in pre-forge stage that runs project-authored extractor scripts to populate flow memory. Not a forced migration.

#### Pre-flight checks

Clean tree, on base branch, no `WORK.md` in repo root.

#### Upgrade steps

1. `npm install @really-knows-ai/foundry@2.5.0 --save-dev`.
2. Replace `.opencode/plugins/foundry.js` from the new package.
3. **No config migration required.** Existing cycles continue to work unchanged.
4. (Optional) To opt a cycle into assay: ensure `foundry/memory/` is initialized first (run `init-memory` if needed), then add `assay: { extractors: [<names>] }` to the cycle frontmatter and create `foundry/memory/extractors/<name>.md` files via the `add-extractor` skill.
5. Commit: `chore: upgrade foundry to 2.5.0`.

### 7. v2.5.x → v2.6.0

v2.6.0 is a **breaking** feedback-system overhaul:

- Feedback tool args switch from `{ file, index }` to `{ id }`.
- `foundry_feedback_add` drops the `stageBase` argument (source is read from the active stage).
- `foundry_feedback_list` response shape changes to `{ id, file, tag, text, source, state, depth, reason? }`.
- The state machine expands from 4 to 6 states (`open | actioned | wont-fix | rejected | deadlocked | resolved`).
- Deadlock detection becomes per-item (uses each item's own history depth) instead of a global iteration count.
- Feedback now lives in `WORK.feedback.yaml`. The old `## Feedback` markdown section in `WORK.md` is no longer read or written.

#### Pre-flight checks

Clean tree, on base branch, no `WORK.md` in repo root. **The third check is load-bearing here:** there is no automatic migration of in-flight feedback. If `WORK.md` is present, run `foundry_workfile_delete` (or finish the cycle) before upgrading. Re-flow from a clean base afterwards.

#### Upgrade steps

1. `npm install @really-knows-ai/foundry@2.6.0 --save-dev`.
2. Replace `.opencode/plugins/foundry.js` from the new package.
3. **No `foundry/` config migration required.** Cycle, flow, artefact, law, and appraiser definitions are unchanged.
4. Any `## Feedback` markdown left over in a stale `WORK.md` on disk after the upgrade is **inert** — neither parsed nor deleted by 2.6.0 tools, and new writes go to `WORK.feedback.yaml`. If a stale `WORK.md` slipped past pre-flight, `foundry_workfile_delete` it before running `foundry_git_finish`, otherwise the squash-merge will carry inert markdown into the base branch.
5. Commit: `chore: upgrade foundry to 2.6.0`.

### 7a. v2.6.x → v2.7.0

v2.7.0 cleans up the overloaded `output:` frontmatter key. Pre-2.7, both
cycle definitions and artefact-type definitions used `output:` to mean two
different things — an artefact-type ID on cycles, a directory path on
artefact-types. v2.7 resolves this by:

- **Renaming** the cycle key: `output:` → `output-type:` (the artefact-type ID
  this cycle produces).
- **Removing** the artefact-type key entirely. It had no runtime consumer —
  forge's write scope is `file-patterns`, not a directory hint. Stale
  `output:` entries in artefact-type frontmatter are harmless (parsers
  ignore unknown keys) but should be deleted for hygiene.

| File                                       | Old key   | v2.7 action                                |
|--------------------------------------------|-----------|--------------------------------------------|
| `foundry/cycles/<id>.md`                   | `output:` | Rename to `output-type:` (load-bearing)    |
| `foundry/artefacts/<id>/definition.md`     | `output:` | Delete the line (field has no consumer)    |

The cycle rename is a **breaking** schema change. The orchestrator no longer
reads `output:` on cycles; an unmigrated cycle yields a hard violation
pointing at this skill. The artefact-type cleanup is cosmetic — projects
that skip it still run.

#### Pre-flight checks

Same as §7: clean tree, on base branch, no `WORK.md` in repo root.

#### Upgrade steps

1. `npm install @really-knows-ai/foundry@2.7.0 --save-dev`.
2. Replace `.opencode/plugins/foundry.js` from the new package.
3. **Cycle migration:** for every `foundry/cycles/<id>.md` whose frontmatter
   has `output: <type-id>`, rename the key to `output-type:`. The value is
   unchanged. Confirm with the user before rewriting:
   > Cycle `<id>` declares `output: <value>`. Rename to `output-type: <value>`?
4. **Artefact-type cleanup (optional but recommended):** for every
   `foundry/artefacts/<id>/definition.md` whose frontmatter has
   `output: <dir-path>`, delete the line. The field has no runtime
   consumer; this is hygiene only. Confirm with the user before rewriting:
   > Artefact type `<id>` has an inert `output: <value>` line. Delete it?
5. Verify by running any cycle: the orchestrator now resolves the cycle's
   `output-type:` against the artefact-type registry. Any cycle still
   carrying `output:` will halt with a `cycle <id> uses old schema key
   'output:' for the produced artefact-type. Rename it to 'output-type:'`
   diagnostic — apply the rename and re-run.
6. Commit: `chore: upgrade foundry to 2.7.0`.

### 7b. v2.7.x → v3.0.0

v3.0.0 is a **breaking** release that introduces typed git branches,
dry-run flows with forensic snapshots, verbose tracing, expanded
failed-flow guards, JSON error envelopes, and a relocation of memory
row data. The plugin tool surface grows from 46 to 64 tools.

Each change is summarised below; the full rationale lives in the
3.0.0 CHANGELOG entry.

**(a) Failed-flow guard expansion.** `foundry_validate_run` and 11
mutating memory admin tools (`_init`, `_reset`, `_vacuum`,
`_change_embedding_model`, `_create_entity_type`, `_create_edge_type`,
`_rename_entity_type`, `_rename_edge_type`, `_drop_entity_type`,
`_drop_edge_type`, `foundry_extractor_create`) now refuse on a failed
workfile. No config migration; agents driving these tools must check
for `flow_failed: true` in error envelopes and either run
`foundry_workfile_delete` or finish the cycle before retrying.

**(b) `foundry_git_branch` requires explicit `kind` (BREAKING).**
The previous `{ flowId, description }` signature is removed. Callers
must pass `kind: 'config' | 'work' | 'dry-run'`:

- `kind: 'config'` — needs `description`; starting branch must not be
  `config/*` or `work/*`. `flowId` is invalid.
- `kind: 'work'` — needs `flowId` and `description`; starting branch
  must not be `config/*` or `work/*`.
- `kind: 'dry-run'` — needs `flowId` and `description`; the operator
  must already be on a `config/<x>` branch.

Any skill or wrapper script that calls `foundry_git_branch` without
`kind` will hit a tool refusal. The shipped skills are already
updated; project-local automation needs the same treatment.

**(c) `foundry_git_finish` dispatches on the current branch.**
`work/<x>` retains existing semantics (squash-merge plus WORK
cleanup). `config/<x>` is new (squash-merge to base, no WORK
cleanup). `dry-run/<x>/<y>` writes a forensic snapshot under
`.snapshots/<runId>/` on the parent `config/<x>` working tree and
force-deletes the dry-run branch — no merge, no commit. Any other
branch is refused with "nothing to finish". `baseBranch` is rejected
for dry-run finishes (the parent is encoded in the branch name).

**(d) `foundry_git_branch`/`_finish` JSON error envelopes.**
Failures from both tools now return `{ error: "<message>" }` instead
of throwing raw `execFileSync` errors. Wrappers parsing tool output
must read the envelope; pre-3.0 try/catch around raw throws will see
clean returns instead of exceptions.

**(e) Dry-run + snapshot tools as new public surface.** Four new
tools — `foundry_snapshot_list`, `_show`, `_delete`, `_prune` — let
operators inspect and prune the `.snapshots/<runId>/` artefacts left
behind by dry-run finishes. The tracing layer also writes
`.foundry/trace/<branch-slug>.jsonl` while on a dry-run branch and
copies it into the snapshot at finish. The new `dry-run` skill
documents the config-edit → dry-run → finish → inspect-snapshot
loop.

**(f) `foundry_memory_dump` JSON envelope.** The tool now returns
`{ dump: "<text>" }` instead of a raw string, matching the contract
of every other plugin tool. Callers that previously consumed the raw
string must read `.dump`.

**(g) Assay no longer files validation feedback (BREAKING).**
When an extractor exits non-zero, parses incorrectly, violates
permissions, or times out, `foundry_assay_run` calls
`markWorkfileFailed` and returns `{flow_failed: true, error, …}`.
It no longer files a `#validation` feedback item. Assay is also
rejected as a `source` base in `foundry_feedback_add`. Tooling that
pattern-matched assay-sourced feedback must instead detect
`flow_failed: true` on the assay-run response.

**(h) Memory NDJSON relations relocated to `foundry-memory/` (BREAKING).**
Per-type row data (`<entity-type>.ndjson`, `<edge-type>.ndjson`) now
lives at top-level `foundry-memory/relations/`, sibling to
`foundry/`. The rest of the memory tree (`config.md`, `schema.json`,
`entities/`, `edges/`, `extractors/`, the gitignored `memory.db*`
runtime files) stays under `foundry/memory/`.

#### Pre-flight checks

Same as §7: clean tree, on base branch, no `WORK.md` in repo root.

For projects with an existing populated memory store, also verify
that `foundry/memory/relations/` is up-to-date with the on-disk Cozo
DB (`foundry_memory_validate` returns clean). The migration moves
files; a desynced store would carry stale rows into the new path.

#### Upgrade steps

1. `npm install @really-knows-ai/foundry@3.0.0 --save-dev`.
2. Replace `.opencode/plugins/foundry.js` from the new package.
3. **Memory relations relocation** (skip if memory was never
   initialized in this project):
   ```bash
   git mv foundry/memory/relations foundry-memory/relations
   git commit -m "chore: relocate memory relations to foundry-memory/"
   ```
   Projects that have not yet populated memory can simply re-run
   `foundry_memory_init` on a fresh `config/*` branch — the new
   layout is created automatically.
4. **Add `.snapshots/` to `.gitignore`.** Append a line `.snapshots/`
   to the project `.gitignore` (do not duplicate). The directory
   appears only after the first dry-run finish; projects that
   re-run `init-foundry` get this entry automatically, but upgraded
   projects need it added by hand.
5. **Audit project-local wrappers** that call `foundry_git_branch`,
   `foundry_git_finish`, or `foundry_memory_dump`. Update them to
   pass `kind:` and to read JSON envelopes. Skills shipped with the
   package are already updated.
6. **Audit assay-feedback consumers.** Anything pattern-matching
   `#validation` feedback items sourced from assay must instead read
   `flow_failed: true` from the assay-run response.
7. **No `foundry/` config migration required.** Cycle, flow,
   artefact, law, and appraiser definitions are unchanged from v2.7.
8. Commit: `chore: upgrade foundry to 3.0.0`.

In-flight cycles from v2.6.x or earlier carrying assay-sourced
feedback items in `WORK.feedback.yaml` are no longer reachable by the
state machine. `foundry_workfile_delete` followed by re-flow is the
supported recovery path.

## Historical migrations (pre-2.3.0)

The following sections cover migrations that only matter if you are upgrading from a version older than 2.3.0. Skip them if you are already on 2.3.x or later.

### 8. Migrate agent files (v2.1)

Applies to: any project upgrading **from pre-2.1 to v2.1.x or later**.

For each `.opencode/agents/foundry-*.md` file with a `.` in its filename:
- Compute the new filename by replacing all `.` with `-` (keep the `.md` extension)
- `git mv <old> <new>` to preserve history
- Do **not** modify the file contents — the `model:` field inside retains its original dots

After renaming, remind the user: **Restart OpenCode** for the new agent filenames to register.

### 8a. v2.1.x → v2.2.0 lifecycle upgrade

Foundry v2.2.0 introduces a tool-enforced stage lifecycle (`stage_begin` / `stage_end` / `stage_finalize`, since v2.3 internal to `foundry_orchestrate`) backed by a per-project state directory and HMAC-signed dispatch tokens. The upgrade is non-destructive — no WORK.md or artefact migration is required — but the project needs three small changes:

1. **Create `.foundry/`** (if absent):
   - `mkdir -p .foundry`
   - The plugin auto-creates `.foundry/.secret` on first boot via `readOrCreateSecret`. You do not need to generate it by hand; just ensure the directory exists and is writable.
2. **Gitignore `.foundry/`**:
   - Ensure `.gitignore` contains a line `.foundry/` (append if missing; do not duplicate). The directory holds a per-worktree HMAC secret and transient active-stage state — neither should be committed.
3. **Pre-existing state:** v2.2.0 is a fresh state system. There is no `active-stage.json` to migrate. If one happens to exist from a manually-aborted prior run, leave it alone — the new plugin treats its absence as "no active stage" and its presence as a legitimate in-flight stage.

The `foundry_artefacts_add` tool has been removed in v2.2.0 — artefact registration now happens automatically via `foundry_stage_finalize` (since v2.3 internal to `foundry_orchestrate`). No existing config references this tool, so there is nothing to migrate in `foundry/`.

### 8b. v2.2.0 → v2.2.1 cycle-definition flat human-appraise keys

v2.2.1 replaces the nested `human-appraise: {enabled, deadlock-threshold}` block in cycle definitions with three flat keys:

```yaml
human-appraise: <true|false>         # default: false — run human-appraise every iteration
deadlock-appraise: <true|false>      # default: true — pull in human-appraise when LLM appraisers deadlock
deadlock-iterations: <number>        # default: 5 — deadlock detection threshold
```

For each `foundry/cycles/*.md` whose frontmatter has the old nested form, migrate:

- `human-appraise.enabled: true` → `human-appraise: true`
- `human-appraise.enabled: false` (or missing) → `human-appraise: false`
- `human-appraise.deadlock-threshold: N` → `deadlock-iterations: N`
- Always add `deadlock-appraise: true` unless the user explicitly wants the stricter "no human ever" behaviour (`deadlock-appraise: false` → deadlock marks the cycle `blocked`).

The old nested form is no longer read. After migration, verify by asking: "cycle `<id>`: human-appraise every iteration? deadlock-appraise on? deadlock-iterations = N?".

### 8c. v2.2.x → v2.3.0

v2.3.0 replaces the LLM-driven sort orchestrator with the `foundry_orchestrate` plugin tool. The `cycle` and `sort` skills are removed. Six tools are deregistered: `foundry_sort`, `foundry_history_append`, `foundry_stage_finalize`, `foundry_git_commit`, `foundry_workfile_configure_from_cycle`, `foundry_workfile_set`.

v2.3.1 and v2.3.2 ship within this section as no-op upgrades: v2.3.1 is a skill-prose change (any cycle in a flow may be a starting cycle; forge write invariant restated) with no tool, schema, or config changes; v2.3.2 tightens config-modifying skills to refuse on `work/*` branches and removes historical planning docs. Neither requires `foundry/` migration. Install the latest 2.3.x and follow the v2.3.0 steps below.

#### Pre-flight checks

Before upgrading, verify a clean base state. Abort the upgrade if any of these fail:

1. **Branch**: must be on `main` (or the user's configured default base branch).
   - Check: `git rev-parse --abbrev-ref HEAD` — must match expected default.
   - If on `work/*`: abort with "You're on a work branch. Switch to main and complete or discard any in-flight flow before upgrading."

2. **Working tree**: must be clean.
   - Check: `git status --porcelain` — must be empty.
   - If dirty: abort with "Uncommitted changes. Commit or stash before upgrading."

3. **In-flight workfile**: `WORK.md` must not exist.
   - Check: is `WORK.md` present in the repo root?
   - If yes: abort with "In-flight workfile detected. Delete it (`foundry_workfile_delete`) or complete the cycle before upgrading."

Only when all three pass, proceed with the plugin swap.

#### Upgrade steps

1. Install the new plugin package version: `npm install @really-knows-ai/foundry@2.3.2 --save-dev` (latest 2.3.x).
2. Swap `.opencode/plugins/foundry.js` with the new version from `node_modules/@really-knows-ai/foundry/.opencode/plugins/foundry.js`.
3. Remove `skills/cycle/` and `skills/sort/` directories from the project if they exist locally (they shouldn't — skills live in the package).
4. Commit the upgrade: `chore: upgrade foundry to 2.3.2`.

No state migration is performed. In-flight cycles from v2.2.x must be completed or discarded before upgrading.

### 9. Migrate flows (historical, pre-2.3.0)

For each flow needing migration:
- Show the current ordered cycle list
- Ask: which cycles are starting cycles?
- Infer targets from adjacency (cycle N → cycle N+1)
- Present the proposed `starting-cycles` and confirm
- Convert numbered `## Cycles` list to unordered

### 10. Migrate cycles (historical, pre-2.3.0)

For each cycle needing migration:

**Targets:** Infer from the flow's old ordering. Present and confirm:
> Cycle `create-haiku` was followed by `create-short-story` in the flow. Set `targets: [create-short-story]`?

**Input contracts:** If inputs exist as a plain list, ask:
> Cycle `create-short-story` has inputs `[haiku, limerick]`. Should it require:
> 1. `any-of` — at least one must exist
> 2. `all-of` — all must exist

**HITL migration:** If `hitl` is found in stages:
> Cycle `create-haiku` has an `hitl` stage. This has been replaced by `human-appraise`.
> - Enable human-appraise? (yes/no)
> - Deadlock threshold? (default: 3)

Remove `hitl` from stages and add `human-appraise` config if enabled.

### 11. Migrate other config (historical, pre-2.3.0)

For artefact types, appraisers, laws, and validation with issues:
- Present each issue with a suggested fix
- Ask the user to confirm or adjust

## Finalisation

### 12. Present migration plan

Before writing anything, show the complete list of changes:
- Group by category
- Show each file and the specific changes
- Ask for confirmation

### 13. Apply changes

- Update all affected files
- Commit with message: `[foundry] upgrade: migrate to current format`

## What you do NOT do

- You do not create new cycles, artefact types, or appraisers
- You do not delete existing files without confirmation
- You do not modify artefact content (produced artefacts, not config)
- You do not run automatically — the user invokes it explicitly
- You do not guess when uncertain — ask the user
