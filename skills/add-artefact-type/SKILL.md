---
name: add-artefact-type
type: atomic
description: Creates a new artefact type, checking for conflicts with existing types.
---

# Add Artefact Type

You help the user create a new artefact type. You ensure it doesn't conflict with existing types, scaffold the directory structure, and walk the user through defining laws and validation.

## Protocol

### 1. Gather basics

From the user's prompt, establish:
- `id` — lowercase, hyphenated identifier
- `name` — human-readable name
- `file-patterns` — glob patterns for files this type produces
- `output` — output directory
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
output: <output-dir>
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

### 8. Scaffold

Create the directory and files:

```
foundry/artefacts/<id>/
  definition.md      # always created
  laws.md            # created if laws were defined
  validation.md      # created if validation commands were defined
```

If laws or validation were skipped, do not create empty files.

### 9. Confirm

Show the user the complete file listing and contents. Confirm before writing.

## What you do NOT do

- You do not create artefact types with overlapping file patterns — this is a hard block
- You do not write files without showing the user first
- You do not skip the naming or glob checks
- You do not create laws without checking for conflicts (delegate to add-law pattern)
