---
name: add-law
type: atomic
description: Creates a new law, checking for conflicts with existing laws.
---

# Add Law

You help the user create a new law. You ensure it's well-scoped, doesn't conflict with existing laws, and ends up in the right file.

## Prerequisites

Before running this skill, verify all three of the following:

1. The `foundry/` directory exists in the project root. If it does not
   exist, stop and tell the user:

   > Foundry is not initialized in this project. Run the
   > `init-foundry` skill first to create the foundry/ directory
   > structure.

2. The current git branch is a `config/*` branch. Run
   `git rev-parse --abbrev-ref HEAD` and confirm it matches
   `config/<description>`.

3. If the branch does not start with `config/`, instruct the user to
   create one before continuing:

   > Foundry configuration changes must be made on a config/* branch.
   > From a clean main branch, call:
   >
   > `foundry_git_branch({ kind: "config", description: "<short-name>" })`
   >
   > Then re-run this skill.

   If the user is on a `dry-run/*/*` branch, they must finish
   that dry-run first (`foundry_git_finish({ message, confirm: true })`)
   before re-running this skill on the parent `config/*`.

## Protocol

### 1. Determine scope

If the user specifies where the law applies:
- "global law" → goes in `foundry/laws/` (ask which file, or create a new one)
- "law for X artefacts" → goes in `foundry/artefacts/<type>/laws.md`

If the user doesn't specify, ask:

> Should this law apply globally to all artefact types, or to a specific type?

If they name a type, verify it exists in `foundry/artefacts/`. If it doesn't, tell them and ask if they want to create the artefact type first.

### 2. Draft the law

Write the law following the standard format:

```markdown
## <law-id>

<What this law checks — one or two sentences.>

Passing: <What a passing artefact looks like.>
Failing: <What a failing artefact looks like.>
```

The `law-id` (heading) should be:
- Lowercase, hyphenated
- Short but descriptive
- Unique across all laws (global and type-specific)

### 3. Check for conflicts

Read all existing laws that would apply to the same artefact types:
- All files in `foundry/laws/` (global)
- `foundry/artefacts/<type>/laws.md` if the law is type-specific
- If the law is global, also read all `foundry/artefacts/*/laws.md` since a global law applies everywhere

For each existing law, check:
- Does the new law contradict an existing law? (e.g., "must be formal" vs "must be conversational")
- Does the new law duplicate an existing law? (same criterion, different wording)
- Does the new law overlap with an existing law? (partially covers the same ground)

If any conflict is found, present it to the user:

> The new law `<new-id>` may conflict with existing law `<existing-id>`:
> - New: <summary of new law>
> - Existing: <summary of existing law>
> - Conflict: <what the conflict is>
>
> Options:
> 1. Proceed anyway (both laws will apply)
> 2. Replace the existing law with the new one
> 3. Rephrase the new law to avoid the conflict
> 4. Cancel

### 4. Refine with the user

Present the drafted law to the user before writing it. Ask:

> Here's the draft law:
>
> ## <law-id>
>
> <law content>
>
> Does this capture what you want, or should we adjust the wording?

Iterate until the user is happy.

### 5. Validate the draft

Call `foundry_config_validate_law({ name: "<file-name-without-extension>", body: "<full markdown>" })`.

If the result is `{ ok: false, errors: [...] }`, address each error (adjust the body) and re-run until you get `{ ok: true }`. Common issues: missing required frontmatter keys, references to artefact types that don't exist yet.

### 6. Create the file

Pick the target. The user has already chosen scope in step 1 — translate that into the `target` argument:

- Global → `target: { kind: "global", file: "<file-name>.md" }` (lives at `foundry/laws/<file-name>.md`).
- Type-specific → `target: { kind: "type-specific", typeId: "<artefact-type>" }` (lives at `foundry/artefacts/<typeId>/laws.md`).

Then call:

```
foundry_config_create_law({
  name: "<file-name-without-extension>",
  body: "<full markdown>",
  target: { kind: "global", file: "<file-name>.md" }   // OR
           { kind: "type-specific", typeId: "<artefact-type>" }
})
```

The tool:

- re-validates the body (TOCTOU);
- writes the law file at the path determined by `target`;
- produces one git commit on the current `config/*` branch.

If the tool returns `{ ok: false, errors }` because the target file already exists, the user should edit the file by hand on this `config/*` branch — `foundry_config_create_law` does not support updates (including appending to an existing law file).

Show the user the resulting commit hash from the response.

### 7. Verify uniqueness

After the file is created, confirm the law id is unique across all law files. If a collision exists, ask the user to rename and edit by hand on this branch.

## What you do NOT do

- You do not skip the conflict check
- You do not silently overwrite existing laws
- You do not create artefact types — that is a separate skill
