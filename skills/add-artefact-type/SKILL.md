---
name: add-artefact-type
type: atomic
description: Creates a new artefact type, checking for conflicts with existing types.
---

# Add Artefact Type

You help the user create a new artefact type. You ensure it doesn't conflict with existing types, scaffold the directory structure, and walk the user through defining laws and validation.

## Prerequisites

Before running this skill, verify all three of the following:

1. The `foundry/` directory exists in the project root. If it does not
   exist, stop and tell the user:

   > Foundry is not initialized in this project. Run the
   > `init-foundry` skill first to create the foundry/ directory
   > structure.

2. The current git branch is a `config/*` branch. Run
   `git rev-parse --abbrev-ref HEAD` and confirm it matches
   `config/<description>` (a single segment, not `config/.../dry-run/...`).

3. If the branch does not start with `config/`, instruct the user to
   create one before continuing:

   > Foundry configuration changes must be made on a config/* branch.
   > From a clean main branch, call:
   >
   > `foundry_git_branch({ kind: "config", description: "<short-name>" })`
   >
   > Then re-run this skill.

   If the user is on a `config/*/dry-run/*` branch, they must finish
   that dry-run first (`foundry_git_finish({ message, confirm: true })`)
   before re-running this skill on the parent `config/*`.

## Protocol

### 1. Gather basics

From the user's prompt, establish:
- `id` — lowercase, hyphenated identifier
- `name` — human-readable name
- `file-patterns` — glob patterns for files this type produces (forge's write scope is exactly these patterns)
- A prose description of what this artefact type is

If any of these are missing, ask.

### 2. Check for naming conflicts

Read all existing artefact type definitions in `foundry/artefacts/*/definition.md`.

- Exact id match → hard conflict, must choose a different id
- Semantically similar name or description → warn the user. Ask:

> An artefact type `<existing-id>` already exists that seems similar:
> - Existing: <name> — <description summary>
> - New: <name> — <description summary>
>
> Is the new type genuinely distinct, or should you extend the existing one?

### 3. Check for glob intersection

For each existing artefact type, check whether the new type's `file-patterns` could match the same files as any existing type's `file-patterns`.

Examples of intersections:
- `features/*.feature` vs `features/*.feature` — exact overlap
- `features/**` vs `features/*.feature` — subset overlap
- `output/*.md` vs `output/reports/*.md` — potential overlap if nested

If any intersection is found, this is a hard block:

> The file pattern `<new-pattern>` intersects with artefact type `<existing-id>` which uses `<existing-pattern>`.
>
> Overlapping file patterns break file modification enforcement — the foundry cycle cannot determine which artefact type owns a file change.
>
> Please choose a different file pattern that does not overlap with any existing type.

Do not proceed until the patterns are non-overlapping.

### 4. Draft the definition

Present the definition to the user:

```markdown
---
id: <id>
name: <name>
file-patterns:
  - "<pattern>"
appraisers:
  count: 3
---

# <Name>

<description>
```

Ask: does this capture the artefact type correctly?

### 5. Laws (optional)

Ask:

> Do you want to define any type-specific laws for this artefact type? (Global laws in `foundry/laws/` will apply automatically.)

If yes, walk through each law using the same format as `add-law`:
- Draft each law
- Check for conflicts with global laws and any existing type-specific laws
- Confirm with the user

### 6. Appraisers (optional)

Ask:

> How should appraisers be configured for this artefact type?
> - How many appraisers per foundry cycle? (default: 3)
> - Restrict to specific appraiser personalities? (default: all available)

If the user specifies preferences, add an `appraisers` section to the definition frontmatter:

```yaml
appraisers:
  count: 3                              # how many appraisers (default: 3)
  allowed: [pedantic, pragmatic]        # which personalities (default: all available)
```

If the user is happy with the defaults (3 appraisers, any personality), add just:

```yaml
appraisers:
  count: 3
```

List the available appraisers from `foundry/appraisers/*.md` so the user can see their options.

### 7. Validation (optional)

Ask:

> Do you want to define any deterministic validation commands for this artefact type?

If yes, walk through each validation entry:
- A `## heading` (identifier)
- A `Command:` line with `{file}` placeholder
- A `Failure means:` line explaining what a non-zero exit indicates

If the user wants validation scripts (not just inline commands), create them as separate files in the artefact type directory.

**Use existing libraries:** Before writing custom validation logic, search npm for well-tested libraries that solve the problem (e.g., `syllable` for syllable counting, `natural` for NLP tasks). Hand-rolled heuristics are fragile — prefer battle-tested packages. Install them as project dependencies.

Check the project's `package.json` for `"type": "module"`:
- If ESM (`"type": "module"`): use `import` syntax, or name scripts with `.mjs` extension
- If CommonJS (no `"type"` field or `"type": "commonjs"`): `require()` is fine, or use `.cjs` extension
- When in doubt, use `.mjs` or `.cjs` extensions to be explicit regardless of project settings

### 8. Validate the draft

Call `foundry_config_validate_artefact_type({ name: "<id>", body: "<full markdown>" })`.

If the result is `{ ok: false, errors: [...] }`, address each error (adjust the body) and re-run until you get `{ ok: true }`. Common issues: missing required frontmatter keys, references to artefact types or flows that don't exist yet.

### 9. Create the file

Call `foundry_config_create_artefact_type({ name: "<id>", body: "<full markdown>" })`. The tool:

- re-validates the body (TOCTOU);
- writes `foundry/artefacts/<id>/definition.md`;
- produces one git commit on the current `config/*` branch.

If the tool returns `{ ok: false, errors }` because the target file already exists, the user should edit the file by hand on this `config/*` branch — `foundry_config_create_artefact_type` does not support updates.

Show the user the resulting commit hash from the response.

### 10. Add laws and validation files (if defined)

The create tool writes only `definition.md`. If you drafted any type-specific laws in step 5, append them to `foundry/artefacts/<id>/laws.md` by hand on this same `config/*` branch (use the `Edit` tool to create the file) and commit that as a separate microcommit.

If you drafted validation commands in step 7, write `foundry/artefacts/<id>/validation.md` (and any companion validation script files) by hand and commit as a separate microcommit.

### 11. Confirm

Show the user the complete file listing and the commit hashes.

## What you do NOT do

- You do not create artefact types with overlapping file patterns — this is a hard block
- You do not skip the naming or glob checks
- You do not create laws without checking for conflicts (delegate to add-law pattern)
