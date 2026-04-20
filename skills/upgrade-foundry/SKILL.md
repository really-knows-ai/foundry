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

**Agent files (v2.1 migration):**
- Any `.opencode/agents/foundry-*.md` filename containing a `.` character? → needs renaming to all-dashes format. The v2.1 naming convention replaces both `/` and `.` in the model ID with `-`. For example, `foundry-github-copilot-claude-sonnet-4.6.md` must become `foundry-github-copilot-claude-sonnet-4-6.md`. The inner `model:` frontmatter field is **not** changed — only the filename.

**Flows:**
- Has `starting-cycles` field? If not → needs DAG migration
- Has ordered numbered list under `## Cycles`? → needs conversion to unordered list

**Cycles:**
- Has `targets` field? If not → needs target routing
- Has `inputs.type` (`any-of`/`all-of`)? If `inputs` is a plain list → needs contract type
- Has `hitl` in stages or frontmatter? → needs human-appraise migration
- Has nested `human-appraise: {enabled, deadlock-threshold}`? → v2.2.1 flat-keys migration (see §4b)
- Has `models` map? Check format

**Artefact types:**
- Has required frontmatter fields (`id`, `name`, `file-patterns`)?
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

### 4. Migrate agent files (v2.1)

For each `.opencode/agents/foundry-*.md` file with a `.` in its filename:
- Compute the new filename by replacing all `.` with `-` (keep the `.md` extension)
- `git mv <old> <new>` to preserve history
- Do **not** modify the file contents — the `model:` field inside retains its original dots

After renaming, remind the user: **Restart OpenCode** for the new agent filenames to register.

### 4a. v2.2.0 lifecycle upgrade

Foundry v2.2.0 introduces a tool-enforced stage lifecycle (`stage_begin` / `stage_end` / `stage_finalize`) backed by a per-project state directory and HMAC-signed dispatch tokens. The upgrade is non-destructive — no WORK.md or artefact migration is required — but the project needs three small changes:

1. **Create `.foundry/`** (if absent):
   - `mkdir -p .foundry`
   - The plugin auto-creates `.foundry/.secret` on first boot via `readOrCreateSecret`. You do not need to generate it by hand; just ensure the directory exists and is writable.
2. **Gitignore `.foundry/`**:
   - Ensure `.gitignore` contains a line `.foundry/` (append if missing; do not duplicate). The directory holds a per-worktree HMAC secret and transient active-stage state — neither should be committed.
3. **Pre-existing state:** v2.2.0 is a fresh state system. There is no `active-stage.json` to migrate. If one happens to exist from a manually-aborted prior run, leave it alone — the new plugin treats its absence as "no active stage" and its presence as a legitimate in-flight stage.

The `foundry_artefacts_add` tool has been removed in v2.2.0 — artefact registration now happens automatically via `foundry_stage_finalize`. No existing config references this tool, so there is nothing to migrate in `foundry/`.

### 4b. v2.2.1 cycle-definition flat human-appraise keys

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
- Always add `deadlock-appraise: true` unless the user explicitly wants the stricter "no human ever" behavior (`deadlock-appraise: false` → deadlock marks the cycle `blocked`).

The old nested form is no longer read. After migration, verify by asking: "cycle `<id>`: human-appraise every iteration? deadlock-appraise on? deadlock-iterations = N?".

### 4c. v2.2.x → v2.3.0

v2.3.0 replaces the LLM-driven sort orchestrator with the `foundry_orchestrate` plugin tool. The `cycle` and `sort` skills are removed. Six tools are deregistered: `foundry_sort`, `foundry_history_append`, `foundry_stage_finalize`, `foundry_git_commit`, `foundry_workfile_configure_from_cycle`, `foundry_workfile_set`.

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

1. Install the new plugin package version: `npm install @really-knows-ai/foundry@2.3.0 --save-dev`.
2. Swap `.opencode/plugins/foundry.js` with the new version from `node_modules/@really-knows-ai/foundry/.opencode/plugins/foundry.js`.
3. Remove `skills/cycle/` and `skills/sort/` directories from the project if they exist locally (they shouldn't — skills live in the package).
4. Commit the upgrade: `chore: upgrade foundry to 2.3.0`.

No state migration is performed. In-flight cycles from v2.2.x must be completed or discarded before upgrading.

### 5. Migrate flows

For each flow needing migration:
- Show the current ordered cycle list
- Ask: which cycles are starting cycles?
- Infer targets from adjacency (cycle N → cycle N+1)
- Present the proposed `starting-cycles` and confirm
- Convert numbered `## Cycles` list to unordered

### 6. Migrate cycles

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

### 7. Migrate other config

For artefact types, appraisers, laws, and validation with issues:
- Present each issue with a suggested fix
- Ask the user to confirm or adjust

### 8. Present migration plan

Before writing anything, show the complete list of changes:
- Group by category
- Show each file and the specific changes
- Ask for confirmation

### 9. Apply changes

- Update all affected files
- Commit with message: `[foundry] upgrade: migrate to current format`

## What you do NOT do

- You do not create new cycles, artefact types, or appraisers
- You do not delete existing files without confirmation
- You do not modify artefact content (produced artefacts, not config)
- You do not run automatically — the user invokes it explicitly
- You do not guess when uncertain — ask the user
