---
name: init-memory
type: atomic
description: Initialise flow memory by creating the foundry/memory/ and foundry-memory/ directory structures
---

# Initialise Flow Memory

Scaffold `foundry/memory/` (config) and `foundry-memory/relations/` (row data)
in the current project. `foundry/memory/` holds entity-type and edge-type
definitions, the schema, the config, and the gitignored Cozo database.
`foundry-memory/relations/` is a top-level sibling of `foundry/` that holds
the committed NDJSON relations.

## Foundry Agent Preflight

If you are clearly operating as the Foundry agent, continue.

If you are not clearly operating as the Foundry agent, pause and tell the user:

> This work is best handled by the Foundry agent. Restart OpenCode if you have just initialised Foundry, switch to the **Foundry** agent, and continue this request there.

This is an advisory guard. Continue only when the active instructions make it clear you are the Foundry agent or the user explicitly asks to proceed here.

## Config Branch Handling

Before writing Foundry configuration:

- Confirm `foundry/` exists. If it is missing, initialise Foundry first when that serves the user's goal.
- Check the current branch.
- On `main` or another clean non-work branch, create a `config/<short-description>` branch internally.
- On `config/*`, continue on the current branch.
- On `work/*`, stop and explain that active flow work must be finished before configuration changes.
- On `dry-run/*/*`, stop and explain that the dry run must be finished before configuration changes.
- If unrelated uncommitted changes could be affected by branching or writing files, ask before proceeding.

Do not tell the user to call branch tools directly.

Neither `foundry/memory/` nor `foundry-memory/` may already exist. If they do, stop and tell the user that memory is already initialised.

## Protocol

### 1. Understand

Ask about `embeddings_enabled`. Offer multiple choice:

> Enable embeddings?
> 1. **Yes (Recommended)** — semantic search with local Ollama instance (`http://localhost:11434/v1`, `nomic-embed-text`, 768 dimensions).
> 2. **No** — keyword-only search.

### 2. Plan

Present the init plan and invite refinement: whether embeddings are enabled and what that means (semantic search vs keyword-only). Ask: "Does this look right?"

### 3. Confirm

Ask: "Proceed with this plan?" — wait for the user to answer. Do not proceed to Build unless the user says yes. If the user rejects the plan, return to the Understand phase and adjust.

### 4. Build

1. **Initialise**: Call `foundry_memory_init({ embeddings_enabled: <bool>, probe: true })`. The tool deterministically:
   - creates `foundry/memory/entities/` and `foundry/memory/edges/` with `.gitkeep`,
   - creates `foundry-memory/relations/` (top-level sibling of `foundry/`) with `.gitkeep`,
   - writes `foundry/memory/config.md` (frontmatter set from the embeddings choice),
   - writes `foundry/memory/schema.json` (`embeddings: {...}` when enabled, `null` when not),
   - appends the three `foundry/memory/memory.db*` entries to `.gitignore` idempotently,
   - probes the embedding provider (only when enabled) and returns the result.

   It fails if either `foundry/memory/` or `foundry-memory/` already exists.

2. **Handle the probe result** (field `probe` in the return value):
   - `probe == null`: embeddings disabled, skip.
   - `probe.ok == true`: display `✓ Embedding provider responded (dimensions: N)` where N is `probe.dimensions`, then continue.
   - `probe.ok == false`: present the user with these options:
     1. Install/start Ollama and `ollama pull nomic-embed-text`, then invoke `foundry_memory_validate` to re-check.
     2. Edit `foundry/memory/config.md` frontmatter to point at a different OpenAI-compatible endpoint, then invoke `foundry_memory_validate`.
     3. Set `embeddings.enabled: false` in `foundry/memory/config.md`.

3. **Commit**: Run `git add foundry/memory/ foundry-memory/ .gitignore`. Run `git commit -m "feat: initialise flow memory"`. Report the commit hash.

4. **Continue the user's original request**:

   > Flow memory is scaffolded. The Foundry agent will continue to define memory entity and edge types as needed to support your goal.
