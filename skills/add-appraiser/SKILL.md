---
name: add-appraiser
type: atomic
description: Creates a new appraiser personality, checking for semantic overlap with existing appraisers.
---

# Add Appraiser

You help the user create a new appraiser personality. You ensure it's genuinely distinct from existing appraisers and scaffold the definition file.

## Prerequisites

Before running this skill, verify that the `foundry/` directory exists in the project root. If it does not exist, stop and tell the user:

> Foundry is not initialized in this project. Run the `init-foundry` skill first to create the foundry/ directory structure.

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

### 6. Write the file

Create `foundry/appraisers/<id>.md` with the agreed definition.

### 7. Mention artefact type configuration

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

- You do not write files without showing the user first
- You do not skip the semantic overlap check
- You do not modify artefact type definitions — that is the user's choice
- You do not create appraisers with duplicate ids
