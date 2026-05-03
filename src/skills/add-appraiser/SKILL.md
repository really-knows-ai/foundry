---
name: add-appraiser
type: atomic
description: Creates a new appraiser personality, checking for semantic overlap with existing appraisers.
---

# Add Appraiser

You help the user create a new appraiser personality. You ensure it's genuinely distinct from existing appraisers and scaffold the definition file.

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

### 1. Gather basics

From the user's prompt, establish:
- `id` — lowercase, hyphenated identifier
- `name` — a short character name (e.g., "The Pedant", "The Pragmatist")
- `model` — (optional) a specific model ID to use for this appraiser (e.g., `openai/gpt-4o`). Overrides the cycle-level model for the appraise stage. If omitted, the appraiser uses whatever model the cycle's appraise stage is configured with.
- A prose description of the personality: how they think, what they prioritize, how they evaluate

If `id`, `name`, or the personality description are missing, ask. The `model` field is optional — only ask about it if the user mentions wanting a specific model for this appraiser.

### 2. Check for id conflicts

Read all existing appraiser definitions in `foundry/appraisers/*.md`.

- Exact id match → hard conflict, must choose a different id

### 3. Check for semantic overlap

For each existing appraiser, compare the new personality against it:
- What does this appraiser prioritize?
- What lens do they evaluate through?
- Would two artefacts get meaningfully different feedback from these appraisers?

If significant overlap is found, present it to the user:

> The new appraiser `<new-id>` seems to overlap with existing appraiser `<existing-id>`:
> - New: <name> — <personality summary>
> - Existing: <name> — <personality summary>
> - Overlap: <what makes them similar>
>
> Appraiser diversity matters — similar personalities produce redundant feedback.
>
> Options:
> 1. Proceed anyway (the distinction is meaningful enough)
> 2. Adjust the new personality to be more distinct
> 3. Replace the existing appraiser with a revised version
> 4. Cancel

Do not proceed until the user has decided.

### 4. Draft the definition

Present the definition to the user:

```markdown
---
id: <id>
name: <name>
model: <model-id>            # only include if specified
---

# <Name>

<personality description — 2-4 sentences describing how this appraiser thinks, what they care about, and how they approach evaluation>
```

Ask: does this capture the personality correctly?

### 5. Refine with the user

Iterate until the user is happy with the personality description. Key things to check:
- Is the personality distinct enough from existing appraisers?
- Does the description give the LLM enough direction to adopt a consistent voice?
- Is it clear what this appraiser would flag vs let pass?

### 6. Validate the draft

Call `foundry_config_validate_appraiser({ name: "<id>", body: "<full markdown>" })`.

If the result is `{ ok: false, errors: [...] }`, address each error (adjust the body) and re-run until you get `{ ok: true }`. Common issues: missing required frontmatter keys, references to artefact types or flows that don't exist yet.

### 7. Create the file

Call `foundry_config_create_appraiser({ name: "<id>", body: "<full markdown>" })`. The tool:

- re-validates the body (TOCTOU);
- writes `foundry/appraisers/<id>.md`;
- produces one git commit on the current `config/*` branch.

If the tool returns `{ ok: false, errors }` because the target file already exists, the user should edit the file by hand on this `config/*` branch — `foundry_config_create_appraiser` does not support updates.

Show the user the resulting commit hash from the response.

### 8. Mention artefact type configuration

After creating the appraiser, remind the user:

> Appraiser `<id>` is now available. To use it for a specific artefact type, add it to the `appraisers.allowed` list in that type's `definition.md` frontmatter:
>
> ```yaml
> appraisers:
>   count: 3
>   allowed: [<id>, ...]
> ```
>
> If no `allowed` list is specified, all available appraisers (including this new one) are eligible.

## What you do NOT do

- You do not skip the semantic overlap check
- You do not modify artefact type definitions — that is the user's choice
- You do not create appraisers with duplicate ids
