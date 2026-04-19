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

For each file, parse the frontmatter and body content.

### 2. Detect what needs migration

Check each file against the current expected format:

**Flows:**
- Has `starting-cycles` field? If not → needs DAG migration
- Has ordered numbered list under `## Cycles`? → needs conversion to unordered list

**Cycles:**
- Has `targets` field? If not → needs target routing
- Has `inputs.type` (`any-of`/`all-of`)? If `inputs` is a plain list → needs contract type
- Has `hitl` in stages or frontmatter? → needs human-appraise migration
- Has `human-appraise` config? Check format is correct
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

### 4. Migrate flows

For each flow needing migration:
- Show the current ordered cycle list
- Ask: which cycles are starting cycles?
- Infer targets from adjacency (cycle N → cycle N+1)
- Present the proposed `starting-cycles` and confirm
- Convert numbered `## Cycles` list to unordered

### 5. Migrate cycles

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

### 6. Migrate other config

For artefact types, appraisers, laws, and validation with issues:
- Present each issue with a suggested fix
- Ask the user to confirm or adjust

### 7. Present migration plan

Before writing anything, show the complete list of changes:
- Group by category
- Show each file and the specific changes
- Ask for confirmation

### 8. Apply changes

- Update all affected files
- Commit with message: `[foundry] upgrade: migrate to current format`

## What you do NOT do

- You do not create new cycles, artefact types, or appraisers
- You do not delete existing files without confirmation
- You do not modify artefact content (produced artefacts, not config)
- You do not run automatically — the user invokes it explicitly
- You do not guess when uncertain — ask the user
