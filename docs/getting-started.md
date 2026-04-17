# Getting Started

How to set up and run your first foundry flow.

## Prerequisites

- Git repository initialised
- Node.js available (for validation scripts)
- An AI coding tool that supports skills (OpenCode, Claude Code, Copilot CLI, etc.)

## Step by step

### 1. Define an artefact type

Create a directory under `foundry/artefacts/` with three files:

```
foundry/artefacts/my-type/
  definition.md    # what it is, file patterns, output location
  laws.md          # subjective laws (optional)
  validation.md    # CLI validation commands (optional)
```

Use the `init-foundry` skill to scaffold the `foundry/` directory, then use `add-artefact-type` to create your first artefact type interactively — or create the directory structure above manually.

### 2. Write laws

Add global laws to any `.md` file in `foundry/laws/`. Add type-specific laws to `foundry/artefacts/<type>/laws.md`.

Each law is a `##` heading with: a description, what passing looks like, and what failing looks like.

### 3. Define a foundry cycle

Create a file in `foundry/cycles/` that specifies what artefact type the foundry cycle produces and what inputs it reads:

```yaml
---
id: my-cycle
name: My Cycle
output: my-type
inputs: []
---
```

Cycles list their stages using `base:alias` format — e.g. `forge:write-haiku`, `quench:check-syllables`. The alias makes each stage's purpose clear when reading WORK.md. You can also include `hitl:alias` stages for human-in-the-loop checkpoints.

### 4. Define a foundry flow

Create a file in `foundry/flows/` that lists foundry cycles in order:

```markdown
---
id: my-flow
name: My Flow
---

# My Flow

Description of what this flow produces.

## Cycles

1. my-cycle
```

### 5. Run the foundry flow

Tell your AI tool to start the foundry flow. It will create a work branch, initialise WORK.md, and begin executing foundry cycles.

## What happens during a foundry flow

1. The foundry flow skill creates a branch and WORK.md
2. For each foundry cycle:
   - Forge produces the artefact
   - Quench runs CLI commands (if defined)
   - Appraise dispatches sub-agent appraisers against the laws
   - If feedback exists, forge revises and the foundry cycle repeats
3. When all foundry cycles complete, the human decides to merge, PR, or discard
