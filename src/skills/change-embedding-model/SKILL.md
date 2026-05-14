---
name: change-embedding-model
type: atomic
description: Swap the embedding model for memory and re-embed all existing entities
---

# Change Embedding Model

Update `foundry/memory/config.md` to target a new OpenAI-compatible endpoint / model
and re-embed every existing entity.

## Prerequisites

Before running this skill, verify all of the following:

1. The `foundry/` directory exists in the project root. If it does not
   exist, stop and tell the user:

   > Restart OpenCode to initialise Foundry, then retry this command.

2. The current git branch is a `config/*` branch. Run
   `git rev-parse --abbrev-ref HEAD` and confirm it matches
   `config/<description>`.

3. If the branch does not start with `config/`, instruct the user to
   create one before continuing:

   > Foundry configuration changes must be made on a config/* branch.
   > If configuration changes are needed, move to a suitable `config/*`
   > branch internally when the current branch is safe. If the current
   > branch is `work/*` or `dry-run/*/*`, stop and explain the active
   > work must be finished first.
   >
   > After the prerequisite is handled, continue the user's original
   > request from the current context.

4. Memory is initialised and enabled. The new provider is reachable
   from this machine. Allow enough time and bandwidth to re-embed
   (O(#entities) requests in batches).

## Protocol

### 1. Understand

Ask for each field one question at a time:

1. **Model**: Offer multiple choice from available models (e.g. `text-embedding-3-small`, `text-embedding-3-large`, `nomic-embed-text`).
2. **Dimensions**: Recommend the default for the chosen model.
3. **Custom endpoint and API key**: Ask: "Do you need a custom endpoint or API key? (No is the default — uses the current provider.)" Only ask for `baseURL` and `apiKey` if the user says yes.

### 2. Plan

Present a summary: "Change embedding model to `<model>` with `<dimensions>` dimensions. Base URL: `<baseURL or 'default'>`. API key: `<'custom' or 'default'>`."

### 3. Confirm

Ask: "Proceed?" — wait for the user's answer. Do not proceed to Build unless the user says yes. If the user rejects the plan, return to the Understand phase and adjust.

### 4. Build

1. **Check connectivity**: Verify the new provider is reachable from this machine and the model name is valid.
2. **Execute**: Call `foundry_memory_change_embedding_model({ model: "<model>", dimensions: <dimensions>, baseURL: "<baseURL>", apiKey: "<apiKey>" })`. The tool probes the new provider, re-embeds every entity, rewrites `schema.json`, and then updates `foundry/memory/config.md` frontmatter to match. On probe or re-embed failure, nothing is written.
3. **Verify**: Invoke `foundry_memory_search` with a sample query.
4. **Commit**: Run `git add foundry/memory/config.md foundry/memory/schema.json foundry-memory/relations/`. Run `git commit -m "chore(memory): change embedding model to <model>"`. Report the commit hash.
