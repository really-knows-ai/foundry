---
name: add-artefact-type
type: atomic
description: Creates a new artefact type, checking for conflicts with existing types.
---

# Add Artefact Type

You help the user create a new artefact type. You ensure it avoids conflicts with existing types, scaffold the directory structure, and walk the user through defining laws and their optional validators.

## Foundry Agent Preflight

If you are clearly operating as the Foundry agent, continue.

If you are not clearly operating as the Foundry agent, pause and tell the user:

> This work is best handled by the Foundry agent. Restart OpenCode if you have just initialised Foundry, switch to the **Foundry** agent, and continue this request there.

This is an advisory guard. Continue only when the active instructions make it clear you are the Foundry agent or the user explicitly asks to proceed here.

## Config Branch Handling

Before writing Foundry configuration:

- Confirm `foundry/` exists. If it is missing, initialise Foundry first when that serves the user's goal.
- Check the current branch.
- On `main` or another clean non-work branch, create a `config/<short-description>` branch internally.
- On `config/*`, continue on the current branch.
- On `work/*`, stop and explain that active flow work must be finished before configuration changes.
- On `dry-run/*/*`, stop and explain that the dry run must be finished before configuration changes.
- If unrelated uncommitted changes could be affected by branching or writing files, ask before proceeding.

Do not tell the user to call branch tools directly.

## Protocol

### 1. Gather basics

From the user's prompt, establish:
- `id` — lowercase, hyphenated identifier (e.g. `haiku`). The
  frontmatter `name:` field must equal this id; any human-readable
  label goes in the `## Definition` prose, not in frontmatter.
- `file-patterns` — glob patterns for files this type produces
  (forge's write scope is exactly these patterns).
- A prose description of what this artefact type is.

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

Present the definition to the user with these structured fields:

- `id` (string) — lowercase, hyphenated identifier (e.g. `haiku`). Must be unique across artefact types.
- `name` (string) — human-readable label
- `filePatterns` (string[]) — glob patterns for files this type produces (forge's write scope is exactly these patterns)
- `description` (string) — prose description of what this artefact type is
- `appraisers` ({ count?: number, allowed?: string[] }, optional) — appraiser configuration

The `id` value must exactly match the artefact type's identifier
(lowercase, hyphenated). If you want a human-readable label, put it
in the `name` field.

Ask: does this capture the artefact type correctly?

When laws or validators are clearly part of the requested artefact type, draft them during artefact-type creation. Use the validator contract from `add-law` and prefer established packages installed with the project package manager.

### 5. Laws (optional)

Ask:

> Do you want to define any type-specific laws for this artefact type? (Global laws in `foundry/laws/` will apply automatically.)

If yes, walk through each law using the same format as `add-law`:
- Draft each law, adding validators where a deterministic check applies
- Check for conflicts with global laws and any existing type-specific laws
- Confirm with the user

Each law may declare an optional `validators:` block; the YAML shape,
JSONL output contract, `{pattern}` / `{files}` placeholders, skip
rule, working directory, and a worked example are documented once in
the `add-law` skill under **§7a. Validator contract**. Authors of
type-specific laws must follow that contract — do not invent a
different one here.

**Use existing libraries:** Before writing custom validation logic,
search npm for well-tested libraries that solve the problem (e.g.
`syllable` for syllable counting, `natural` for NLP tasks).
Hand-rolled heuristics are fragile — prefer battle-tested packages.
Install them as project dependencies.

Check the project's `package.json` for `"type": "module"`:
- If ESM (`"type": "module"`): use `import` syntax, or name scripts with `.mjs` extension
- If CommonJS (no `"type"` field or `"type": "commonjs"`): `require()` is fine, or use `.cjs` extension
- When in doubt, use `.mjs` or `.cjs` extensions to be explicit regardless of project settings

### 6. Appraisers (optional)

Ask:

> How should appraisers be configured for this artefact type?
> - How many appraisers per foundry cycle? (default: 3)
> - Restrict to specific appraiser personalities? (default: all available)

If the user specifies preferences, include these fields:

- `appraisers.count` (number, optional, default: 3) — how many appraisers per foundry cycle
- `appraisers.allowed` (string[], optional, default: all available) — whitelist of appraiser personality IDs

If the user is happy with the defaults (3 appraisers, any personality), omit the appraisers configuration entirely.

List the available appraisers from `foundry/appraisers/*.md` so the user can see their options.

### 7. Validate the draft

Call `foundry_config_validate_artefact_type({ name: "<id>", body: "<assembled markdown>" })`. Assemble the body from the fields using the frontmatter format the tool produces internally.

If the result is `{ ok: false, errors: [...] }`, address each error (adjust the body) and re-run until you get `{ ok: true }`. Common issues: missing required frontmatter keys, references to artefact types or flows that don't exist yet.

### 8. Create the file

Call `foundry_config_create_artefact_type({ id: "<id>", name: "<name>", filePatterns: ["<pattern>"], description: "<description>" })`. The tool:

- re-validates the body (TOCTOU);
- writes `foundry/artefacts/<id>/definition.md`;
- produces one git commit on the current `config/*` branch.

If the tool returns `{ ok: false, errors }` because the target file already exists, read the existing file, incorporate the user's requested changes into the current body, propose the merged result for review, then write and commit the updated file.

Show the user the resulting commit hash from the response.

### 9. Add laws file (if defined)

If you drafted any type-specific laws in step 5, add them via
`foundry_config_add_law` (one call per law) with
`target: { kind: "type-specific", typeId: "<id>" }`. The first call
creates `foundry/artefacts/<id>/laws.md`; subsequent calls append to
that same file. Each call produces its own microcommit. See the
`add-law` skill for the full protocol.

### 10. Confirm

Show the user the complete file listing and the commit hashes.

## What you do NOT do

- You do not create artefact types with overlapping file patterns — this is a hard block
- You do not skip the naming or glob checks
- You do not create laws without checking for conflicts (delegate to add-law pattern)
