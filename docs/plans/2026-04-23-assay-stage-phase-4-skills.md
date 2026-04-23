# Phase 4 — Skills

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide the two LLM-facing skill files: `skills/assay/SKILL.md` (the stage protocol) and `skills/add-extractor/SKILL.md` (the authoring workflow).

**Architecture:** Both skills are markdown with YAML frontmatter (`name`, `type: atomic`, `description`). The assay skill is extremely thin — it is a pure protocol wrapper around `foundry_stage_begin` → `foundry_assay_run` → `foundry_stage_end`. The add-extractor skill mirrors `add-memory-entity-type` in structure: prerequisites, prompts, tool invocation, commit.

**Depends on:** Phase 2 (tools must exist) and Phase 3 (stage must be dispatched so the skill has something to handle).

**Files produced:**

- Create: `skills/assay/SKILL.md`
- Create: `skills/add-extractor/SKILL.md`

No tests in this phase — skills are verified by the end-to-end test in Phase 5.

---

## Task 1: Write `skills/assay/SKILL.md`

**Files:**
- Create: `skills/assay/SKILL.md`

**Context:** Model the file on `skills/quench/SKILL.md`. The protocol is simpler than quench because there is only one tool to call and the result is a single structured return value. The skill does no interpretation — if the tool returns `{ok:true}`, end the stage with a success summary; if `{ok:false, aborted:true}`, end the stage with a failure summary. The tool itself has already written `#validation` feedback to WORK.md.

- [ ] **Step 1: Read the quench skill for style reference**

Run: `cat skills/quench/SKILL.md`
Note the frontmatter shape, section order, tone, and the "token" / "stage begin/end" conventions.

- [ ] **Step 2: Create `skills/assay/` directory**

```bash
mkdir -p skills/assay
```

- [ ] **Step 3: Write the skill**

Create `skills/assay/SKILL.md`:

````markdown
---
name: assay
type: atomic
description: Deterministic population of flow memory by running project-authored extractor scripts. Writes JSONL output into entities and edges via foundry tools.
---

# Assay

Runs the `assay` stage of a cycle. An assay stage executes every extractor listed in the cycle's `assay.extractors` frontmatter, in order. Each extractor is a project-authored CLI script at the path given in its definition file — see the `foundry/memory/extractors/<name>.md` files for what each one does.

The assay stage is **deterministic**. This skill does **not** interpret extractor output. It only calls `foundry_assay_run`, which handles spawning, parsing, validation, and memory upserts. On any failure, `foundry_assay_run` writes a `#validation` feedback row against `WORK.md` and returns an aborted result. Your job is to wrap the lifecycle cleanly.

## Protocol

You have been dispatched to run an assay stage. The dispatch prompt contains a stage identifier like `assay:<cycle>` and a token.

Follow these steps exactly and in order.

### 1. Begin the stage

Call `foundry_stage_begin({ stage, cycle, token })` with the values from the dispatch prompt. If the result is not `{ok: true}`, stop and report the error — something is wrong with the token or an already-active stage.

### 2. Read WORK.md to find the extractor list

Call `foundry_workfile_get()`. Read `frontmatter.assay.extractors`. This is an ordered array of extractor names. If it is missing or empty, this is a routing bug — return to step 5 with an error summary.

### 3. Run the extractors

Call `foundry_assay_run({ cycle, extractors })` passing exactly those values. Do not modify the list. Do not split it into multiple calls. The tool returns one of:

- `{ok: true, perExtractor: [{name, rowsUpserted, durationMs}, ...]}` — all extractors succeeded.
- `{ok: false, aborted: true, failedExtractor, reason, stderr, perExtractor: [...]}` — the run aborted. The failure has already been recorded as `#validation` feedback against `WORK.md`.
- `{error: "..."}` — a precondition failed (not an active assay stage, memory not enabled, etc.). This should not happen if step 1 succeeded; treat as an error and proceed to step 5 with the error text.

### 4. Prepare the summary

Build a short summary string for `foundry_stage_end`. Examples:

- On success: `"ran 2 extractors, upserted 47 rows in 1420ms"`.
- On abort: `"aborted on extractor 'java-symbols': extractor exited with exit code 2"`.

Do not add extra feedback items, do not call `foundry_feedback_add`. The tool has already done that on failure.

### 5. End the stage

Call `foundry_stage_end({ summary })` with the summary from step 4. Always end the stage, whether the run succeeded or aborted. The stage lifecycle must close cleanly so the orchestrator can commit.

## What this skill must not do

- **Must not** read or parse extractor output files itself.
- **Must not** call any memory write tools (`foundry_memory_put`, `foundry_memory_relate`, etc.). All writes go through `foundry_assay_run`.
- **Must not** invoke `foundry_feedback_add` — `foundry_assay_run` handles failure feedback on its own.
- **Must not** modify any artefact files. The assay stage writes only to flow memory.

## If something unexpected happens

If `foundry_assay_run` throws an unrelated error (e.g. `error: memory not enabled`), that is a programming error in the cycle configuration — not an expected extractor failure. Do not retry. End the stage with a summary quoting the error, and let the human see the failure through the usual `#validation` channel.
````

- [ ] **Step 4: Commit**

```bash
git add skills/assay/SKILL.md
git commit -m "feat(skills): add assay stage skill"
```

---

## Task 2: Write `skills/add-extractor/SKILL.md`

**Files:**
- Create: `skills/add-extractor/SKILL.md`

**Context:** Mirror `skills/add-memory-entity-type/SKILL.md`. Prerequisites: memory must be enabled; the entity types the extractor will populate must already be declared. Prompts: name, command path, memoryWrite, body, optional timeout. Tool call: `foundry_extractor_create`. Post-step: git add/commit the new file and (optionally) a stub script at the `command` path.

- [ ] **Step 1: Read the entity-type skill for style reference**

Run: `cat skills/add-memory-entity-type/SKILL.md`
Note the prerequisite check, prompt order, and confirmation step.

- [ ] **Step 2: Create the skill directory**

```bash
mkdir -p skills/add-extractor
```

- [ ] **Step 3: Write the skill**

Create `skills/add-extractor/SKILL.md`:

````markdown
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
````

- [ ] **Step 4: Commit**

```bash
git add skills/add-extractor/SKILL.md
git commit -m "feat(skills): add add-extractor authoring skill"
```

---

## Phase 4 exit criteria

- [ ] `skills/assay/SKILL.md` exists and follows the quench-style protocol.
- [ ] `skills/add-extractor/SKILL.md` exists and follows the add-memory-entity-type-style authoring pattern.
- [ ] Both skills have correct YAML frontmatter (`name`, `type: atomic`, `description`).
- [ ] `npm test` still passes (no test changes; this is a sanity check).

Proceed to [Phase 5](./2026-04-23-assay-stage-phase-5-e2e-docs.md).
