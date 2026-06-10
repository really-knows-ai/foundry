---
name: add-extractor
type: atomic
description: Create a new extractor definition under foundry/memory/extractors/. An extractor is a project-authored CLI that emits JSONL describing entities and edges to upsert into flow memory.
---

# Add Extractor

Use this skill to register a new extractor — a script that reads the codebase (via `tree-sitter`, `javap`, language servers, or whatever suits the project) and emits line-delimited JSON describing entities and edges to upsert into flow memory during an `assay` stage.

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

`foundry/memory/config.md` must exist with `enabled: true`. Initialise memory internally first if not. Missing memory entity or edge type dependencies are composed internally when they are part of the user's stated goal.

## Protocol

### 1. Understand

Ask the user for each field one question at a time, in this order:

1. **Extractor name.** Lowercase kebab-case (`java-symbols`, `python-classes`, `tree-sitter-rust`). This becomes the filename under `foundry/memory/extractors/<name>.md` and the identifier referenced from cycle frontmatter.
2. **Command.** The path to the executable (relative to the repo root, e.g. `scripts/extract-java-symbols.sh`) or a short shell command. This is passed to `/bin/sh -c` at runtime.
3. **Entity types to populate (`memoryWrite`).** A list of entity type names already declared in this project's memory vocabulary. Validate against what exists; if the user names a type that doesn't exist, compose or create it internally when it is part of the user's stated goal, or ask one focused question when schema design is ambiguous.
4. **Timeout** (optional). Present as a choice:

   > Set a timeout for this extractor?
   > 1. 60 seconds (Recommended)
   > 2. Custom duration (specify as `30s`, `2m`, or milliseconds)
5. **Brief description.** 1–3 paragraphs of prose describing what this extractor extracts, what it requires on `PATH`, and any re-run triggers. This body is injected into the forge prompt of every cycle that uses this extractor, so clarity here translates to better downstream generation.

**Security note:** Remind the user that extractors inherit the agent's full environment, including any API tokens or credentials. Extractors should keep environment variable handling internal to extraction logic.

### 2. Plan

Summarise the proposed extractor back to the user and invite refinement. Include the extractor name, command, memory write path, description, and timeout. Ask: "Does this capture the extractor correctly?" Example:

> I'll create `foundry/memory/extractors/java-symbols.md` with:
> - command: `scripts/extract-java-symbols.sh`
> - memoryWrite: [class, method]
> - timeout: 60s
> - brief: "Walks the Java source tree with tree-sitter-java…"
>
> Does this capture the extractor correctly?

### 3. Confirm

Ask: "Proceed with this plan?" — wait for the user to answer. Do not proceed to Build unless the user says yes. If the user rejects the plan, return to the Understand phase and adjust.

### 4. Build

1. **Create**: Call `foundry_memory_create_extractor({ name: "<name>", command: "<command>", memoryWrite: ["<type>", ...], body: "<description>", timeout: "<optional>" })`. On error, surface the error to the user and stop — do not attempt to recover silently.

2. **Commit**: Run `git add foundry/memory/extractors/<name>.md` plus the command script path if one was created. Run `git commit -m "feat(memory): add '<name>' extractor"`. Report the commit hash.

#### Post-Build — scaffold the command script

When the user has confirmed, create the script file at the `command` path with executable permission. Provide a starter stub that documents the JSONL contract and a minimal example:

```bash
#!/bin/sh
# Emits JSONL describing Java classes and methods.
#
# JSONL Contract (one JSON object per line):
#   - One JSON object per line (JSONL/NDJSON format)
#   - Pretty-printed multi-line JSON is NOT supported
#   - Blank lines and lines starting with '#' are ignored
#   - Each object discriminated by "kind":
#
#   Entities: {"kind":"entity","type":"<entity-type>","name":"<id>","value":"<string ≤ 4KB>"}
#   Edges:    {"kind":"edge","from":{"type":..,"name":..},"edge":"<edge-type>","to":{"type":..,"name":..}}
#
# Exit 0 on success, non-zero on failure (aborts the assay stage).
#
# Environment: This script inherits the agent's full environment, including
# any API tokens. Keep environment variable handling internal.

set -euo pipefail

# TODO: replace this stub with tree-sitter/javap/etc. invocations.
echo '{"kind":"entity","type":"class","name":"example.Foo","value":"Example class, replace me."}'
```

Make the script executable (`chmod +x <path>`). Do **not** run the script — validation is the author's responsibility.

#### Post-Build — compose into a cycle

When the user's stated goal is to add memory extraction to a flow or cycle, compose this extractor into the relevant cycle definition. Update the cycle definition internally to add the `extractors` and `memoryWrite` fields. Ask for confirmation or one focused question when cycle selection or wiring is ambiguous.

Compose into the appropriate memory vocabulary when schema design is ambiguous — ask one focused question rather than stalling.

## What this skill must not do

- **Must not** run the extractor script itself to verify it works. That is the author's job.
