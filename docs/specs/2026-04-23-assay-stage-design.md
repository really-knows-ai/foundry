# Assay Stage — Design

**Status:** Draft
**Date:** 2026-04-23
**Author:** Design collaboration (brainstorming session)

## Summary

Introduce a new, optional, deterministic stage base — **`assay`** — that runs before the first `forge` of a cycle to populate flow memory from project-authored static-analysis scripts. Downstream `forge` stages operate against the resulting graph instead of guessing at the codebase.

The name comes from metallurgy: to *assay* an ore or alloy is to determine its composition before working it. Applied to Foundry, the assay stage determines the composition of the codebase — classes, methods, imports, call graphs, whatever the project cares about — before forge begins shaping artefacts.

## Motivation

Today, a `forge` stage that needs structural knowledge about a codebase (e.g. to generate documentation for every public class) has two bad options:

1. **Re-derive it each run via LLM tool calls.** Non-deterministic, expensive in tokens, and slow.
2. **Hand-curate memory beforehand.** Manual, drifts from source, no audit trail.

Flow memory already exists as the right storage layer. What's missing is a stage-shaped, deterministic, auditable way to *populate* it from tools that already know how to read code — `tree-sitter`, `javap`, `cargo metadata`, language servers, whatever the project chooses.

Assay is that stage.

## Non-goals

- **Re-running assay on later iterations.** v1 is iteration-0-only. Re-extraction on every iteration is deferred until there's a concrete use case that proves iteration-0 isn't enough.
- **Parallel extractor execution.** Sequential only. Parallelism is a future optimisation once the semantics are proven.
- **Caching extractor output by git SHA.** Every assay run re-executes every extractor. Upserts are idempotent, so this is correct; performance tuning comes later.
- **Shipping built-in extractors.** Foundry ships the stage machinery; projects author their own extractor scripts. This matches how `validation.md` works — Foundry provides the socket, projects plug in CLIs.
- **Editing extractors via a tool.** Updates are plain file edits to `foundry/memory/extractors/<name>.md`, matching Foundry's existing authoring conventions.
- **A `remove-extractor` skill.** Deletion is `rm`.

## Concepts

### Stage base: `assay`

A fourth deterministic stage base, joining `forge`, `quench`, `appraise`, and `human-appraise`. Like `quench`, it runs CLI commands and parses their output. Unlike `quench`, its side effect is **memory writes**, not pass/fail feedback on an artefact.

Properties:

- **Deterministic runtime.** No LLM in the execution path. The stage skill becomes a thin wrapper over the `foundry_assay_run` tool.
- **Memory-only side effect.** Assay only mutates flow memory (via the existing memory write tools); it does not modify artefact files, so the write-invariant enforcer trivially passes.
- **Token-gated.** Same HMAC lifecycle as every other stage (`foundry_stage_begin` / `foundry_stage_end` / `foundry_stage_finalize`).
- **Opt-in per cycle**, via a frontmatter `assay:` block — same pattern as `human-appraise`.
- **Runs at iteration 0 only.** The effective stage list becomes `[assay, forge, quench, appraise, (human-appraise)]` on the first iteration and reverts to `[forge, quench, appraise, (human-appraise)]` on subsequent iterations.

### Extractor

A project-authored CLI that emits JSONL describing entities and edges to upsert into flow memory. Analogous to a validator (which is a CLI emitting pass/fail output).

Each extractor is defined by a markdown file at `foundry/memory/extractors/<name>.md`:

```markdown
---
command: scripts/extract-java-symbols.sh
memory:
  write: [class, method, file]
timeout: 60s
---

# java-symbols

Walks the Java source tree with tree-sitter-java and emits one entity per
public class and method, plus a `defined-in` edge linking each symbol to
its source file.

Requires `tree-sitter` with the `java` grammar installed. Re-run after
large refactors or package restructures.
```

Frontmatter:

| Field | Required | Default | Meaning |
|---|---|---|---|
| `command` | yes | — | Path (relative to repo root) to an executable. Must emit JSONL on stdout. |
| `memory.write` | yes | — | List of **entity types** this extractor is permitted to populate. Edge permissions are derived: an edge row is permitted if either endpoint's entity type is in this list (mirroring the cycle-level rule in `docs/concepts.md`). Enforced on every row. |
| `timeout` | no | `60s` | Hard kill. Extractors should be fast; slow ones are bugs. |

The markdown body is a prose brief describing what the extractor captures, what it requires on PATH, and any caveats. Like entity-type briefs, it is injected into the `forge` prompt of any cycle that uses this extractor, so the LLM knows what's in memory and where it came from.

## Cycle opt-in

Cycles declare assay via a frontmatter block listing extractors by name:

```yaml
---
output: documentation
inputs:
  all-of: [source]
memory:
  read:  [class, method, file]
  write: [class, method, file, documentation-section]
assay:
  extractors: [java-symbols, java-imports]
targets: [publish-docs]
---
```

Note that the cycle's `memory.write` includes `class`, `method`, and `file` — the entity types populated by its extractors. Extractors cannot write outside the cycle's declared permissions; the cycle author must opt the types in explicitly.

Rules:

- **Opt-in.** A cycle with no `assay:` block runs exactly as today — no new stage, no overhead.
- **One `assay` stage per cycle.** All listed extractors execute inside a single token-gated stage (alias chosen by the cycle author, e.g. `assay:survey-java`). Symmetric with how `quench` runs multiple CLI commands inside one stage.
- **Sequential execution.** Extractors run in the order listed.
- **Permission check at load time.** For every extractor, every entity type in its `memory.write` must also appear in the cycle's `memory.write`. Edge permissions follow the existing derivation rule (writable if either endpoint's entity type is writable), so edges are not listed explicitly. If `java-symbols` writes `class` but the cycle does not declare `class` as writable, the cycle fails to load. Extraction cannot smuggle types past the cycle's declared permissions.
- **Memory must be enabled.** A cycle declaring `assay:` in a project without `foundry/memory/` (or with `config.md` `enabled: false`) fails to load with a clear error pointing at `init-memory`.

## Wire format

Each stdout line is a JSON object with a `kind` discriminator:

```json
{"kind":"entity","type":"class","name":"UserService","value":"Singleton service managing user CRUD. See src/main/java/com/acme/UserService.java."}
{"kind":"entity","type":"method","name":"UserService.findById","value":"Returns Optional<User> by primary key."}
{"kind":"edge","from":{"type":"method","name":"UserService.findById"},"edge":"defined-in","to":{"type":"class","name":"UserService"}}
```

Rules:

- **Blank lines and lines starting with `#` are ignored.** Scripts may emit comments for debugging without breaking parsing.
- **Unknown top-level fields are rejected.** Forward-compatibility is handled via new `kind` values, not by silently tolerating garbage.
- **Entity `value` is capped at 4 KB** (memory's existing limit). Overflow is a hard failure, not silent truncation.
- **Upsert semantics.** Entities are keyed by `(type, name)`; re-running an extractor replaces any prior row with the same key. Edges are idempotent on `(from, edge, to)`.

## Runtime

### Lifecycle

1. `foundry_orchestrate` mints an assay stage token.
2. Assay stage skill calls `foundry_stage_begin({ stage: "assay", token, cycle })`.
3. Skill calls `foundry_assay_run({ cycle, extractors })`.
4. Skill calls `foundry_stage_end({ summary })`.
5. Orchestrator finalises with a micro-commit. The write-invariant check trivially passes (no artefact files changed).

The skill is thin — no bespoke subprocess handling, no parsing. All that logic lives in `foundry_assay_run`, which is unit-testable in isolation. This matches Foundry's existing "skills are thin, tools are tested" discipline.

### `foundry_assay_run` tool

Signature:

```
foundry_assay_run({ cycle, extractors: [name, ...] })
  → {
      ok: boolean,
      aborted?: boolean,
      perExtractor: [
        { name, rowsUpserted, durationMs, error? }
      ]
    }
```

Behaviour:

1. Verifies the active stage is `assay` and the token is valid.
2. Resolves each extractor name against `foundry/memory/extractors/<name>.md`; missing or malformed definitions abort before any execution.
3. For each extractor in order:
   - Spawns `command` with `cwd` = repo root, `stdin` closed, stdout/stderr captured.
   - Streams stdout line-by-line. Parses each non-blank, non-`#` line as JSON.
   - Validates the row against the schema for its `kind` and checks the referenced types are all within the extractor's declared `memory.write`.
   - Upserts the row into Cozo inside a per-extractor transaction.
   - Enforces the configured `timeout`.
4. On the first failure of any kind, returns `{ ok: false, aborted: true, ... }`. The failed extractor's transaction is rolled back. Prior extractors' transactions remain committed.
5. On success, returns per-extractor row counts and durations for WORK.history.yaml.

### Failure semantics (strict)

The following all abort the cycle:

- Script exit code ≠ 0.
- Malformed JSON on any row.
- Unknown `kind` value.
- Any referenced entity type not in the extractor's declared `memory.write` (edges check both endpoints against the derived permission).
- Any referenced entity or edge type not declared in the project's memory vocabulary.
- Entity `value` exceeding 4 KB.
- Script exceeding `timeout`.

When assay aborts, the orchestrator writes a `#validation`-tagged feedback row against WORK.md itself (since no artefact was produced) describing which extractor failed and why, with captured stderr. Humans and the flow skill see it through the same channel as any other blocking feedback.

**Partial commits on abort are intentional.** Prior extractors' writes are not rolled back when a later extractor fails. This keeps the transaction scope tight (one per extractor) and avoids a complex "assay-wide transaction" abstraction. On the next flow run, iteration 0 re-runs every extractor; idempotent upserts make this safe.

### Performance budget

Extractors are expected to complete in seconds. The 60s default timeout is generous. The `add-extractor` skill documents "if it takes longer than 10s, it's doing too much — split it."

## Authoring

### `add-extractor` skill

New skill at `foundry/skills/add-extractor/`. Symmetric with `add-appraiser`, `add-law`, `add-memory-entity-type`.

Flow:

1. Prompt for extractor name, target entity/edge types, and command path.
2. Validate each target type against the project's declared memory vocabulary. For missing types, offer to compose into `add-memory-entity-type` / `add-memory-edge-type`.
3. Delegate file creation to `foundry_extractor_create`.
4. Scaffold an executable stub at the configured command path with a minimal example (e.g. `tree-sitter` + `jq`) and the JSONL contract documented inline as comments.
5. Make the stub executable (`chmod +x`).
6. **Do not run the stub.** Authors validate their own scripts before wiring them into a cycle.

### `foundry_extractor_create` tool

Signature:

```
foundry_extractor_create({ name, command, memoryWrite: [...], timeout?, description })
  → { path }
```

Behaviour:

- Writes `foundry/memory/extractors/<name>.md` with populated frontmatter and prose body.
- Validates `memoryWrite` against the project's current memory schema.
- Errors if the file already exists (edits are manual, per Foundry convention).
- Updates any derived indexes (none currently, but the tool is the hook if one is added later).

## Interaction with existing systems

- **Write-invariant enforcer.** Assay produces no artefact-file changes, so the enforcer's pattern check runs against an empty diff and passes. Memory files (`foundry/memory/relations/*.ndjson`) are on the always-allowed list already.
- **Stage tokens.** Assay uses the same HMAC lifecycle as every other stage. `foundry_assay_run` is a stage-locked mutation tool: it checks `active-stage.json` and refuses if the stage isn't `assay`.
- **Memory permissions.** Assay writes go through the existing `foundry_memory_upsert_*` code paths, which already enforce cycle-declared `memory.write`. The extractor's own `memory.write` is an additional narrower gate layered on top.
- **`upgrade-foundry`.** Assay is additive and opt-in. No migration required for existing projects. The skill adds no migration entry for this version.
- **`refresh-agents` / `list-agents`.** Unaffected. Assay does not use sub-agents for routing.

## Documentation updates

As part of implementation:

- `docs/concepts.md` — new entries for **Assay** (stage) and **Extractor**, plus a cross-reference from the memory section.
- `docs/memory-maintenance.md` — one-paragraph note on extractors as a memory-population path.
- `README.md` — stage list updated; custom-tools catalogue gets `foundry_assay_run` and `foundry_extractor_create`.
- `CHANGELOG.md` — feature entry under the next version.

## Testing strategy

- **Unit tests for `foundry_assay_run`** with injectable subprocess and memory I/O:
  - Happy path (multiple extractors, mixed entities and edges).
  - JSONL parse errors at various line positions.
  - Permission violations (type outside `memory.write`).
  - Timeout enforcement.
  - Non-zero exit.
  - Oversized `value`.
  - Comment and blank-line handling.
  - Unknown `kind` rejection.
- **Unit tests for `foundry_extractor_create`**:
  - File written with correct frontmatter.
  - Duplicate detection.
  - Memory-vocabulary validation.
- **Integration test** (one end-to-end): a minimal fixture project with memory enabled and a trivial bash extractor emitting two entities and one edge, run through a full cycle; assert the graph contains the rows and the cycle's forge stage received them in its prompt.
- **Cycle load-time validation tests**: assay declared without memory, extractor referencing undeclared types, type-permission mismatch between extractor and cycle.

## Open questions

None blocking. Deferred items are captured in *Non-goals* above.

## Appendix: example wiring end-to-end

Project structure after `init-memory`, `add-memory-entity-type class`, `add-memory-entity-type method`, `add-memory-edge-type defined-in`, `add-extractor java-symbols`:

```
foundry/
├── memory/
│   ├── config.md
│   ├── entities/
│   │   ├── class.md
│   │   └── method.md
│   ├── edges/
│   │   └── defined-in.md
│   └── extractors/
│       └── java-symbols.md
├── cycles/
│   └── document-java.md      # declares assay: { extractors: [java-symbols] }
└── ...
scripts/
└── extract-java-symbols.sh   # emits JSONL on stdout
```

A flow that enters `document-java` runs:

```
assay:survey-java   (foundry_assay_run → scripts/extract-java-symbols.sh → memory upserts)
forge:write-docs    (reads class / method / defined-in from memory)
quench:check-md     (validation.md CLIs run)
appraise:tone       (LLM appraisers with laws)
```

— then iterates forge/quench/appraise until feedback is resolved, never re-running assay.
