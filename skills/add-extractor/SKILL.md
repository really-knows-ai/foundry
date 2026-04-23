---
name: add-extractor
type: atomic
description: Create a new extractor definition under foundry/memory/extractors/. An extractor is a project-authored CLI that emits JSONL describing entities and edges to upsert into flow memory.
---

# Add Extractor

Use this skill to register a new extractor — a script that reads the codebase (via `tree-sitter`, `javap`, language servers, or whatever suits the project) and emits line-delimited JSON describing entities and edges to upsert into flow memory during an `assay` stage.

## Prerequisites

Before running this skill, verify all of the following. If any fails, stop and tell the user what to do first.

1. `foundry/` exists (run `init-foundry` first if not).
2. `foundry/memory/config.md` exists and has `enabled: true` (run `init-memory` first if not).
3. Every entity type the extractor will populate has already been declared in `foundry/memory/entities/` (use `add-memory-entity-type` to create any that are missing).

## Steps

### 1. Gather inputs

Ask the user for, in this order (one question at a time):

1. **Extractor name.** Lowercase kebab-case (`java-symbols`, `python-classes`, `tree-sitter-rust`). This becomes the filename under `foundry/memory/extractors/<name>.md` and the identifier referenced from cycle frontmatter.
2. **Command.** The path to the executable (relative to the repo root, e.g. `scripts/extract-java-symbols.sh`) or a short shell command. This is passed to `/bin/sh -c` at runtime.
3. **Entity types to populate (`memoryWrite`).** A list of entity type names already declared in this project's memory vocabulary. Validate against what exists; if the user names a type that doesn't exist, either offer to create it via `add-memory-entity-type` first or ask them to adjust.
4. **Timeout** (optional). Duration string like `30s`, `2m`, or a number of milliseconds. Defaults to 60 seconds if omitted.
5. **Brief description.** 1–3 paragraphs of prose describing what this extractor extracts, what it requires on `PATH`, and any re-run triggers. This body is injected into the forge prompt of every cycle that uses this extractor, so clarity here translates to better downstream generation.

### 2. Propose and confirm

Summarise the proposed extractor back to the user and ask for confirmation before writing. Example:

> I'll create `foundry/memory/extractors/java-symbols.md` with:
> - command: `scripts/extract-java-symbols.sh`
> - memoryWrite: [class, method]
> - timeout: 60s (default)
> - brief: "Walks the Java source tree with tree-sitter-java…"
>
> OK to proceed?

### 3. Create the extractor file

Call `foundry_extractor_create({ name, command, memoryWrite, body, timeout? })`. On error, surface the error to the user and stop — do not attempt to recover silently.

### 4. Offer to scaffold the command script

If the user confirms, create the script file at the `command` path with an executable permission. Provide a starter stub that documents the JSONL contract and a minimal example. For example, for `scripts/extract-java-symbols.sh`:

```bash
#!/bin/sh
# Emits JSONL describing Java classes and methods.
# Contract: one JSON object per line, discriminated by "kind".
#   Entities: {"kind":"entity","type":"<entity-type>","name":"<id>","value":"<string ≤ 4KB>"}
#   Edges:    {"kind":"edge","from":{"type":..,"name":..},"edge":"<edge-type>","to":{"type":..,"name":..}}
# Blank lines and lines starting with '#' are ignored.
# Exit 0 on success, non-zero on failure.

set -euo pipefail

# TODO: replace this stub with tree-sitter/javap/etc. invocations.
echo '{"kind":"entity","type":"class","name":"example.Foo","value":"Example class, replace me."}'
```

Make the script executable (`chmod +x <path>`). Do **not** run the script — validation is the author's responsibility.

### 5. Commit

Commit both the definition and (if created) the stub script:

```bash
git add foundry/memory/extractors/<name>.md scripts/<command>
git commit -m "feat(memory): add '<name>' extractor"
```

### 6. Guide the user on wiring it in

After creation, tell the user how to opt a cycle into this extractor:

> To use this extractor, add the following to the cycle's frontmatter:
>
> ```yaml
> memory:
>   write: [<each type in memoryWrite>]   # must include every type the extractor writes
> assay:
>   extractors: [<this extractor's name>]
> ```
>
> Then run the `flow` or `orchestrate` skill. On the first iteration of the cycle, the assay stage will execute this extractor before forge.

## What this skill must not do

- **Must not** run the extractor script itself to verify it works. That is the author's job.
- **Must not** modify cycle definitions. Opting a cycle into the extractor is an explicit editorial step for the user to take.
- **Must not** create entity or edge types that don't already exist. Compose into `add-memory-entity-type` / `add-memory-edge-type` for any missing vocabulary.
