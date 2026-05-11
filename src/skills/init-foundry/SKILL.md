---
name: init-foundry
type: atomic
description: Initialise a Foundry project by creating the foundry/ directory structure
---

# Initialise Foundry

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

3. **Update `.gitignore`**

   Append the following lines to the project's `.gitignore` (creating
   the file if absent), skipping any that are already present:

   ```
   .snapshots/
   node_modules/
   .DS_Store
   ```

   - `.snapshots/` keeps dry-run snapshots out of git.
   - `node_modules/` keeps any npm dependencies (e.g. validator
     packages) out of git. Without it, foundry's `config/*` tools
     reject calls with `unexpected_files` as soon as the user runs
     `npm install`.
   - `.DS_Store` keeps macOS metadata out of git.

   The plugin will idempotently append `.foundry/` itself on first
   boot, so you do not need to add that line.

4. **Generate model-routing agent files**

   Call `foundry_refresh_agents()` to generate model-routing `.opencode/agents/foundry-*.md` files.

5. **Install the Foundry guide agent**

   Create `.opencode/agents/foundry.md` from the packaged Foundry guide
   agent template. Copy `dist/agents/foundry.md` when running from the
   built package, or `src/agents/foundry.md` when running from a source
   checkout. This user-facing agent is installed during `init-foundry`;
   `foundry_refresh_agents()` manages only generated `foundry-*` stage
   agents.

6. **Commit the structure**

   ```bash
   git add foundry/ .gitignore .opencode/agents/foundry.md .opencode/agents/foundry-*.md
   git commit -m "feat: initialise Foundry project structure"
   ```

7. **Guide next steps**

   Tell the user:

   > Foundry is initialised. **Restart OpenCode** so the new Foundry agents register.
   >
   > After the restart, switch to the **Foundry** agent. The Foundry agent is the user-facing guide for setting up artefact types, laws, validators, appraisers, cycles, and flows.
   >
   > Then ask the Foundry agent for the outcome you want, for example:
   >
   > `set up a flow that writes haikus`
   >
   > The first time the plugin boots in this project, it will create the
   > `.foundry/` runtime directory and idempotently append `.foundry/` to
   > `.gitignore` so the per-worktree HMAC key stays out of git. The
   > `.snapshots/` line was added by this skill to keep dry-run snapshots
   > out of git.
   >
   > **Optional: Flow Memory**
   >
   > If your flows need persistent knowledge, ask the Foundry agent to add
   > flow memory. Memory is useful for projects that need to track code
   > structure, dependencies, or domain knowledge across flow runs.
