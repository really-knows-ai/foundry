---
name: forge
type: atomic
description: Produces or revises an artefact, guided by WORK.md and the foundry cycle definition.
---

# Forge

You produce or revise artefacts. You read WORK.md to understand the goal and feedback, and the foundry cycle definition to understand what you're producing and what inputs you can read.

## Protocol

### First generation (no artefact registered in WORK.md yet)

1. Read `WORK.md` — understand the goal
2. Read the foundry cycle definition from `foundry/cycles/<cycle-id>.md` — understand what to produce and what inputs are available
3. Read the output artefact type definition from `foundry/artefacts/<type>/definition.md`
4. Read all files in `foundry/laws/` for global laws
5. Read `foundry/artefacts/<type>/laws.md` for type-specific laws (if it exists)
6. If the foundry cycle has inputs, read the input artefacts (read-only context)
7. Produce the artefact, respecting all applicable laws from the start
8. Write the artefact to the location specified in the artefact type definition
9. Register the artefact in the WORK.md artefacts table (file, type, cycle, status: draft)

### Revision (feedback exists in WORK.md)

1. Read `WORK.md` — find unresolved feedback items for the artefact
2. Read the artefact
3. If the foundry cycle has inputs, read the input artefacts (read-only context)
4. For each unresolved feedback item, either:
   - Address it and mark as `[x]` (actioned)
   - Mark as `[~]` with justification if you believe the feedback should not be actioned: `- [~] <issue> #law:<id> | wont-fix: <reason>`
5. Update the artefact file
6. Wont-fix is only available for `#law:` feedback (subjective appraisal). Validation feedback (`#validation`) must be actioned — deterministic rules are not negotiable.

## Unresolved feedback

An item is unresolved if it is:
- `[ ]` — open, not yet addressed
- `[x] ... | rejected: ...` — actioned but rejected by appraiser, effectively re-opened
- `[~] ... | rejected` — wont-fix rejected by appraiser, effectively re-opened

An item is resolved if it is:
- `[x] ... | approved`
- `[~] ... | approved`

## History

After completing your work (first generation or revision), append an entry to `WORK.history.yaml`:

```yaml
- timestamp: "<ISO 8601 UTC>"
  cycle: <current-cycle-id>
  stage: <alias>
  iteration: <n>
  comment: <brief description of what you did>
```

The `<alias>` is the full alias received from sort (e.g., `forge:write-haiku`). Use it exactly as given.

The iteration number is one more than the count of existing `forge` entries for this cycle in the history.

## Feedback tagged `#hitl`

Feedback tagged `#hitl` (human-in-the-loop) is treated the same as any other open feedback. Address it or wont-fix it using the same rules as other feedback items.

## What you do NOT do

- You do not evaluate or score the artefact
- You do not add feedback — that is the quench skill's and appraise skill's job
- You do not mark feedback as actioned unless you actually changed the artefact to address it
- You do not wont-fix validation feedback
- You do not modify input artefacts — they are read-only
