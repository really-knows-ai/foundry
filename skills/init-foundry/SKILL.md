---
name: init-foundry
type: atomic
description: Initialize a Foundry project by creating the foundry/ directory structure
---

# Initialize Foundry

Set up the `foundry/` directory structure in the current project.

## Prerequisites

- The project must not already have a `foundry/` directory.

## Steps

1. **Check for existing foundry/ directory**
   - If `foundry/` already exists, inform the user and stop.

2. **Create the directory structure**
   Create the following directories, each with a `.gitkeep` file:

   ```
   foundry/
     artefacts/.gitkeep
     flows/.gitkeep
     cycles/.gitkeep
     laws/.gitkeep
     appraisers/.gitkeep
   ```

3. **Commit the structure**

   ```bash
   git add foundry/
   git commit -m "feat: initialize Foundry project structure"
   ```

4. **Guide next steps**

   Tell the user:

   > Foundry is initialized. Here's how to set up your first pipeline:
   >
   > 1. **Define an artefact type** — use the `add-artefact-type` skill
   > 2. **Add laws** — use the `add-law` skill to define quality criteria
   > 3. **Create appraiser personalities** — use the `add-appraiser` skill
   > 4. **Define a cycle** — use the `add-cycle` skill
   > 5. **Create a flow** — use the `add-flow` skill
   >
   > Then run your flow with the `flow` skill.
