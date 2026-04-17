---
name: add-law
type: atomic
description: Creates a new law, checking for conflicts with existing laws.
---

# Add Law

You help the user create a new law. You ensure it's well-scoped, doesn't conflict with existing laws, and ends up in the right file.

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

### 5. Write the law

Append the law to the appropriate file:
- Global: the specified file in `foundry/laws/`, or a new file
- Type-specific: `foundry/artefacts/<type>/laws.md`

If the target file doesn't exist yet, create it with a top-level heading.

### 6. Verify uniqueness

After writing, confirm the law id is unique. If there's a collision, ask the user to rename.

## What you do NOT do

- You do not write the law without showing the user first
- You do not skip the conflict check
- You do not silently overwrite existing laws
- You do not create artefact types — that is a separate skill
