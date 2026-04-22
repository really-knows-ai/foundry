# Foundry Flow Memory — Design Spec

Status: draft, pre-implementation
Scope: design decisions converged through discussion. An implementation plan will be produced separately from this document.

## 1. Purpose

Flow memory is an optional, per-flow, typed, graph-shaped, queryable store for the **condensed active knowledge** a flow has accumulated across runs. It is cycle-facing and tool-facing — not a human-readable artefact. Its job is to give cycles (and deterministic tools) a place to save what they have learned about the subject of the flow, and to let later cycles find and use that knowledge.

Flow memory is distinct from Foundry artefacts:

| | Artefact | Memory |
|---|---|---|
| Audience | Human / downstream deliverable | Cycles, tools |
| Shape | File | Queryable graph store |
| Lifecycle | Forge → appraise → finalise | Accumulates across runs |
| Validation | Laws, appraisers, quench | Schema + type validation on write |
| Content | Deliverable output | Condensed active knowledge |

Both can coexist: a cycle can write to memory **and** produce artefacts.

## 2. Core principles

1. **Descriptive, not normative.** Memory represents what the flow has observed, including inconsistencies and contradictions in the subject. No cardinality constraints. No referential-integrity enforcement. Memory describes what is, not what should be.
2. **State NOW, not history.** Memory contains only the current best understanding. Updates overwrite prior claims. There is no version history of claims in memory. Historical context, when needed, lives in git (of the exported form) or is represented as current-state observations (e.g. "claim A is currently contradicted by observation B").
3. **Types describe what. Cycles and tools describe when and how.** Entity and edge type definitions are ontological: they specify what a type represents and what its fields mean. Creation policy lives in cycle definitions (for LLM writers) or in tool code (for deterministic writers). Type files contain no "when to create" content.
4. **Values are intrinsic. Edges are relational.** An entity's `value` describes the entity itself. Anything that names or refers to another entity is an edge. These two surfaces do not overlap; couplings never appear in prose values.
5. **Grounded in current source.** Where applicable, entities and edges should be anchored to current source locations. Anchors are not modelled as a schema feature in v1; they are conventionally placed in `value` or attached via `comment` / `finding` entities.
6. **Interface is exclusively skills and tools.** There is no CLI. All human, LLM, and cycle interaction with memory happens via OpenCode tools (for direct operations) and Foundry skills (for guided workflows, especially schema changes). Automatic behaviours (sync, load, validation) are internal to the Foundry plugin.

## 3. Data model

### 3.1 Primitives

There are exactly two primitives:

**Entity**

```
{
  type: <string, one of the declared entity types>
  name: <string, unique per type>
  value: <string, free text, max 4KB>
}
```

**Edge**

```
{
  type: <string, one of the declared edge types>
  from: { type: <entity-type>, name: <entity-name> }
  to:   { type: <entity-type>, name: <entity-name> }
}
```

### 3.2 Identity

- Entity primary key: composite `(type, name)`. Two entities of the same type cannot share a name.
- Edge primary key: composite `(type, from.type, from.name, to.type, to.name)`. The same edge type cannot connect the same pair of endpoints twice.
- `name` conventions per type are documented in the type file (e.g. fully-qualified names for Java classes). Foundry does not parse or validate `name` format; it treats names as opaque strings.

### 3.3 Update semantics

- `put(type, name, value)` is an upsert. If the entity exists, its value is replaced. Append semantics are not provided; additive observations are modelled via attached `comment` / `finding` / similar entities linked by edges.
- `relate(from, edge_type, to)` is an upsert. Re-creating an existing edge is a no-op.

### 3.4 No edge values

Edges have no `value` field. If a relationship needs descriptive content, it is reified: create an entity of a suitable type (e.g. `call_site`, `coupling_observation`) with edges to both endpoints. This keeps the "extend via entities" pattern as the single mechanism for adding detail.

### 3.5 Value size

Values are bounded at 4KB. Foundry rejects writes exceeding the bound. Content that does not fit must be split into attached entities (typically `comment`).

## 4. Vocabulary: entity types and edge types

### 4.1 File layout

```
foundry/memory/
  config.md                # memory settings for this project
  entities/
    <type>.md              # one file per entity type
  edges/
    <type>.md              # one file per edge type
  relations/               # committed NDJSON data (see §6)
    <type>.ndjson
  schema.json              # derived schema with version; used by importer
  memory.db                # gitignored; regenerated locally
```

### 4.2 Entity type files

Markdown with YAML frontmatter. Frontmatter is minimal; body carries the semantic load.

**Frontmatter**

```yaml
---
type: <string, matches filename stem>
---
```

**Body — required sections**

- Description: what this entity type represents.
- Name: convention for the `name` field (what it should be, stability rules).
- Value: description of what goes in `value`. Must state that relationships belong in edges.
- Relationships: prose list of relevant edge types involving this entity type. Informational; authoritative edge declarations live in edge files.

**Body — hard rule**

The body must be non-empty. Foundry refuses to load an entity type with an empty body.

**Example: `foundry/memory/entities/class.md`**

```markdown
---
type: class
---

# class

Represents a Java class observed in the current source tree.

## Name

The fully-qualified class name using dot-separated package notation
(e.g. `com.foo.billing.OrderService`). Two classes cannot share a
fully-qualified name; short names are insufficient because the same
short name can appear in multiple packages.

## Value

A condensed, plain-language summary of what this class is and what it
does: its purpose, the responsibilities it holds, and any notable
intrinsic characteristics (e.g. uses reflection, marked deprecated,
has no tests). Grounded in current source.

Relationships to other entities — what this class calls, extends,
writes to, or is referenced by — belong in edges, not in this value.

## Relationships

- `has` method: methods declared in this class
- `extends` class / `implements` class: inheritance structure
- `references` from findings and comments: interpretive observations
  anchored to this class
```

### 4.3 Edge type files

**Frontmatter**

```yaml
---
type: <string, matches filename stem>
sources: [<entity-type>, ...]   # or 'any'
targets: [<entity-type>, ...]   # or 'any'
---
```

- `sources` and `targets` are lists of allowed entity types. The string `any` is permitted as a wildcard value (useful for narrative edges such as `references`). Multiple entity types are allowed.
- Foundry enforces source/target constraints on writes under strict validation (default).

**Body — required**

- Description: what this edge represents semantically.
- Notes on boundaries with related edge types, if any.

Empty body is rejected.

**Example: `foundry/memory/edges/writes.md`**

```markdown
---
type: writes
sources: [class, method, stored_proc]
targets: [table, column]
---

# writes

Represents a direct SQL mutation (INSERT, UPDATE, MERGE, DELETE)
targeting the target from the source, observed in current source.

Excludes reads and indirect effects. For data movement between tables
via procedural logic, see `data_flows_to`.
```

### 4.4 No cardinality, no inheritance

- Edge types do not declare cardinality (1-to-1, 1-to-many, etc.). Memory is descriptive: inconsistent cardinalities in the subject are represented faithfully.
- Entity types have no inheritance or abstract types. The vocabulary is flat.

### 4.5 Strict validation

By default, Foundry enforces:

- Entity `type` is a declared entity type.
- Edge `type` is a declared edge type.
- Edge `from.type` is in the edge's `sources` list (or `sources` is `any`).
- Edge `to.type` is in the edge's `targets` list (or `targets` is `any`).
- Value length ≤ 4KB.
- Type files have non-empty bodies (checked at load time).

Validation mode may be configured to `lax` in `config.md` for exploratory work; `lax` mode downgrades violations to warnings. Default is `strict`.

### 4.6 Schema changes must go through skills (Posture A)

Users may freely edit **prose body content** of entity and edge type files. This is the LLM-facing brief and evolving it is encouraged.

Users may **not** edit the **frontmatter** of existing type files directly (renaming the `type` key, changing `sources`/`targets`, etc.), nor delete or rename type files by hand. All such changes must go through the appropriate skill (see §9).

Foundry detects hand-edits to frontmatter on load by comparing current frontmatter against the last-applied schema recorded in `schema.json`. If a mismatch is detected that the user cannot have produced via a skill, the load fails with a clear message pointing to the appropriate skill (e.g. *"`class` entity type frontmatter has been modified outside of a skill. Use the `rename-memory-entity-type` or `drop-memory-entity-type` skill, or revert the edit."*).

## 5. Cycle integration

### 5.1 Per-cycle access scoping

Each cycle declares which entity types it can read and which it can write:

```yaml
# cycle definition frontmatter
memory:
  read: [class, method, table, stored_proc]
  write: [finding]
```

- A cycle with no `memory:` block gets no memory tools and no memory content in its prompt.
- Edge permissions are derived, not declared:
  - A cycle can **write** an edge if it can write either the source's or target's entity type.
  - A cycle can **read** an edge if it can read either the source's or target's entity type.
- Foundry enforces cycle access on every tool call. Writes to disallowed types are rejected; reads of disallowed types return empty.

### 5.2 Prompt injection

When a cycle's prompt is constructed, Foundry renders the memory vocabulary scoped to that cycle's read/write sets:

- Each readable/writable entity type: its description, name convention, value guidance, relationship notes.
- Each accessible edge type: its description, allowed sources/targets.
- Tool surface applicable to this cycle (§7).

Descriptions are taken verbatim from the type files. The quality of the rendered prompt is exactly the quality of the type file bodies.

### 5.3 Creation policy lives in cycle definitions

Instructions about **when and how** to create/update entities belong in the cycle definition body, not in entity type files. Cycle authors write guidance like "as you examine each class, ensure a `class` entity exists with the fully-qualified name, and a `finding` entity for any observed unusual characteristic." The cycle body is the right place for procedural knowledge.

### 5.4 Direct tool use outside of cycle context

Memory tools can also be invoked directly by a human (via OpenCode) or by an LLM operating outside of a running cycle. In this mode:

- **Reads** are fully available; no cycle-scoped permission filter applies.
- **Writes** are allowed and are the mechanism by which humans manually curate memory via OpenCode.
- Each such direct write triggers an immediate NDJSON sync (see §6.4) so that no data change happens outside a committable state.

## 6. Storage and persistence

### 6.1 Backend

Cozo using its SQLite backend. Foundry owns the Cozo dependency and exposes no backend choice to users. From the user's perspective, memory is a Foundry capability, not a Cozo database.

### 6.2 Scope

One memory database per flow. File path: `foundry/memory/memory.db` (per-flow memory directories may be introduced later if multiple flows in one project become common; v1 assumes one memory per project-flow).

Cross-flow memory sharing is out of scope for v1.

### 6.3 Git story: NDJSON export is the source of truth

The live `.db` file is gitignored and regenerated locally. The committed source of truth is a deterministic NDJSON export.

**File layout**

```
foundry/memory/
  schema.json              # committed; version + relation schemas
  relations/
    <entity-type>.ndjson   # committed; one line per entity instance
    <edge-type>.ndjson     # committed; one line per edge instance
  memory.db                # gitignored
  memory.db-wal            # gitignored
  memory.db-shm            # gitignored
```

**NDJSON format**

- One tuple per line as a JSON object.
- Entity line: `{"name": "...", "value": "..."}`. Type is implied by filename.
- Edge line: `{"from_type": "...", "from_name": "...", "to_type": "...", "to_name": "..."}`.
- Embeddings, if present, are stored inline as numeric arrays in a separate field on the entity line (e.g. `"embedding": [...]`). Model version is recorded in `schema.json`, not per row.

**Determinism rules (mandatory)**

1. Rows sorted by primary key (entity: `name`; edge: `from_type, from_name, to_type, to_name`).
2. Keys within each JSON object sorted alphabetically.
3. Fixed float/number formatting, locale-independent.
4. Unix newlines, UTF-8, no trailing whitespace.

Without strict determinism, diffs become noisy and merges become harder. This is non-negotiable.

### 6.4 Sync triggers

Sync (export `.db` → NDJSON) is fully automatic. There is no user-facing sync command. Foundry syncs on three triggers:

1. **End of any schema-modifying skill/admin-tool call.** `add-memory-entity-type`, `rename-memory-edge-type`, `drop-memory-entity-type`, `change-embedding-model`, etc. all finish with a sync. `schema.json` and any affected relation files are updated in one step.
2. **End of flow execution.** Accumulated data writes from a run are exported once the flow completes. This batches many small writes into a single sync.
3. **Immediately after any direct memory-tool call invoked from outside a cycle.** If a human in OpenCode asks an LLM to `put` or `relate` without a flow running, each such write triggers a sync on completion. Direct writes are rare and individually cheap to export.

**Load**: on any Foundry startup or first memory-tool invocation, if `memory.db` is missing or its schema version does not match `schema.json`, Foundry imports the NDJSON into a fresh `.db`. This is also fully automatic.

**WAL discipline**: Foundry checkpoints the Cozo WAL before every export. Sidecar files (`.db-wal`, `.db-shm`) are auto-gitignored via `.gitignore` entries added by the `init-memory` skill.

### 6.5 Concurrency

Single-writer, single-process. Foundry serialises writes internally. Multi-process concurrent writing is not supported in v1; one cycle at a time per flow is sufficient at current scale.

### 6.6 Team merges

NDJSON per relation enables row-level git diffs and merges. Two engineers modifying different entities in different relations merge cleanly. Two engineers modifying the same row produce a line-level conflict that is hand-resolvable.

## 7. Cycle-facing tool surface

Eight cycle-facing tools. All scoped by the caller cycle's `memory.read`/`memory.write` permissions when invoked from within a cycle; read-only tools are also available to humans and non-cycle LLM contexts without scoping (§5.4).

### 7.1 Write tools

- `foundry_memory_put(type, name, value)` — upsert entity. Rejects if `type` is not in cycle's `write` list (when in a cycle), if value exceeds 4KB, or if validation fails.
- `foundry_memory_relate(from_type, from_name, edge_type, to_type, to_name)` — upsert edge. Rejects if edge write permission is not derivable from cycle's `write` list (when in a cycle).
- `foundry_memory_unrelate(from_type, from_name, edge_type, to_type, to_name)` — delete edge. Same permission rules as `relate`.

### 7.2 Read tools

- `foundry_memory_get(type, name)` — fetch a single entity by composite key. Returns entity or null.
- `foundry_memory_list(type)` — list all entities of a type. No name filter; richer queries are expressed via `foundry_memory_query`.
- `foundry_memory_neighbours(type, name, depth?, edge_types?)` — bounded graph traversal starting from an entity. Default depth 1. Returns a set of entities and edges. Traversal respects cycle's read permissions.
- `foundry_memory_search(query_text, k, type_filter?)` — semantic search over entity values. Returns top-k entities ranked by embedding similarity, optionally restricted to listed types. Requires semantic search enabled (§8).
- `foundry_memory_query(datalog)` — arbitrary read-only Datalog query. Result rows are returned as structured records. The query is executed against a view of memory restricted to the caller cycle's read permissions (entities and edges of types the cycle cannot read are invisible to the query). Write operations in the query are rejected by the engine; the tool is strictly read-only.

### 7.3 Rationale for exposing Datalog

A rich query language is essential for meaningful exploration of a graph-shaped memory, both for cycles that reason across multi-hop patterns and for humans asking an LLM in OpenCode to surface information ("find all findings referencing tables that are also written by `APP.PROC_RECONCILE_ORDERS`"). The set of questions worth asking is not enumerable in advance; exposing Datalog is the pragmatic answer. Writes remain routed through the structured write tools (`put`, `relate`, `unrelate`) so all validation, permission, and sync behaviour is preserved.

## 8. Semantic search

### 8.1 Included in v1

Values are prose. Semantic recall over values is the primary read mode alongside structural traversal. It ships with v1.

### 8.2 Embedding lifecycle

- On `put`, if embeddings are enabled for the project, Foundry computes an embedding of the new/updated `value` using the configured model and stores it alongside the entity.
- Model identifier and version are recorded in `schema.json`.
- When the configured model version changes, Foundry re-embeds all affected entities. This is driven by the `change-embedding-model` skill (§9), not by manual invocation.

### 8.3 Provider model: OpenAI-compatible `/v1/embeddings` endpoint

Foundry does not bundle an embedding model. Instead, it talks to any HTTP endpoint that implements the OpenAI embeddings API shape:

```
POST {baseURL}/embeddings
  headers: { Content-Type: application/json, Authorization?: "Bearer <apiKey>" }
  body:    { model: "<model-id>", input: ["text1", "text2", ...] }
  →        { data: [ { embedding: [..floats..], index: 0 }, ... ] }
```

This single adapter covers every realistic deployment:

- **Ollama** at `http://localhost:11434/v1` (the default, see §8.4) — local, no API key, no network, enterprise-friendly.
- **LM Studio**, **llamafile**, **vLLM**, **text-embeddings-inference** — local self-hosted alternatives to Ollama.
- **OpenAI**, **Azure OpenAI**, **Together**, **Groq**, **Mistral**, etc. — hosted providers, each usable by changing `baseURL`, `model`, and `apiKey`.

No provider-specific SDKs. No bundled ONNX runtime or model files. No native compilation beyond what Cozo already requires. The plugin sends one `fetch` per batch.

### 8.4 Default configuration

Default targets local Ollama with a small, fast embedding model:

```yaml
# foundry/memory/config.md frontmatter
embeddings:
  enabled: true
  baseURL: http://localhost:11434/v1
  model: nomic-embed-text            # ~270MB, 768-dim, strong recall
  # model: all-minilm                # ~45MB, 384-dim, fine for smaller projects
  dimensions: 768                    # must match the model exactly
  apiKey: null                       # unused for Ollama; set for hosted providers
  batchSize: 64                      # inputs per request
  timeoutMs: 30000
```

Rules:

- `dimensions` is authoritative. It is written to `schema.json` at init and enforced on every embedding write. A model producing vectors of the wrong length is a hard error; the user must fix the config and run `change-embedding-model`.
- `batchSize` applies to sync-time bulk embedding; single-shot query-time embedding ignores it.
- Embedding enablement is per-project (not per-flow) to keep memory databases portable across flows sharing types.

### 8.5 Setup expectations

`init-memory` (§9.1) is responsible for making the embedding provider work before declaring memory ready:

1. Write the default config pointing at local Ollama.
2. Probe the configured `baseURL` with a small test request.
3. On failure, surface a clear message with two paths forward:
   - Install and start Ollama, then `ollama pull nomic-embed-text` (or `all-minilm`).
   - Edit `foundry/memory/config.md` to point at a different OpenAI-compatible endpoint and re-run `init-memory`.
4. Do not complete init until the probe succeeds, or the user explicitly disables embeddings (`embeddings.enabled: false`).

Runtime embedding failures (Ollama stopped, endpoint unreachable, auth expired) produce clear, actionable errors from the affected tool call. They do not corrupt memory: a failed embedding causes the entity write to fail as a whole, rather than persisting an entity with a missing or stale vector.

## 9. Skills and admin tools

Memory is administered via skills, not a CLI. Each skill is a guided workflow that invokes one or more admin tools to carry out a discrete change. Admin tools are not cycle-facing; they are only available to skills and to direct human/LLM invocation in OpenCode.

### 9.1 Skills shipped with v1

- **`init-memory`** — scaffold `foundry/memory/` with empty `entities/`, `edges/`, `relations/` directories, a starter `config.md`, `schema.json` with initial version, and the appropriate `.gitignore` entries for `.db` and SQLite sidecar files.
- **`add-memory-entity-type`** — guided creation of a new entity type file. Checks for name conflicts with existing entity and edge types. Generates frontmatter and a skeletal body that the user completes. Updates `schema.json` and creates an empty relation file.
- **`add-memory-edge-type`** — guided creation of a new edge type file. Checks for name conflicts. Validates that declared `sources`/`targets` reference existing entity types or `any`. Updates `schema.json` and creates an empty relation file.
- **`rename-memory-entity-type`** — renames an entity type. Rewrites the entity's own relation file (new filename), every edge-relation row where `from_type` or `to_type` references the old name, updates edge-type frontmatter (`sources`/`targets`) that listed the old name, updates `schema.json`, renames the `entities/<old>.md` file. Atomic at the skill level: partial failures must roll back.
- **`rename-memory-edge-type`** — renames an edge type. Rewrites the edge's relation file, updates `schema.json`, renames `edges/<old>.md`.
- **`drop-memory-entity-type`** — deletes an entity type and its data. Confirms destructive action. Removes all rows of the type, removes all edge rows where either endpoint references the type, removes the entity type file, updates `schema.json`.
- **`drop-memory-edge-type`** — deletes an edge type and its data. Confirms destructive action. Removes all edges of the type, removes the edge type file, updates `schema.json`.
- **`change-embedding-model`** — updates the configured embedding model, recomputes embeddings for all entities, updates `schema.json` with the new model identifier and version. Long-running; shows progress.
- **`reset-memory`** — destructive purge of all memory data (keeps type definitions). Confirms. Clears `.db` and truncates all relation files to empty.

### 9.2 Admin tools behind the skills

Non-exhaustive — each skill invokes one or more of these, and the implementation plan will specify the precise set. Admin tools are the only way (other than skills) to mutate schema, and they are responsible for bumping the `schema.json` version, carrying out data migrations, and triggering a sync on completion.

Illustrative set:

- `foundry_memory_create_entity_type(name, body)`
- `foundry_memory_create_edge_type(name, sources, targets, body)`
- `foundry_memory_rename_entity_type(from, to)`
- `foundry_memory_rename_edge_type(from, to)`
- `foundry_memory_drop_entity_type(name, confirm)`
- `foundry_memory_drop_edge_type(name, confirm)`
- `foundry_memory_reembed(new_model?, new_dimensions?)`
- `foundry_memory_reset(confirm)`
- `foundry_memory_dump(type?, name?)` — read-only tool for human-readable output; used by skills and also directly by humans/LLMs for trust and debugging.
- `foundry_memory_validate()` — runs all load-time and schema-consistency checks, returns a report.
- `foundry_memory_vacuum()` — compacts the `.db` file.

### 9.3 Sync as a side effect, never as a command

There is no `sync` skill or tool. Sync happens automatically after every schema-modifying admin tool, at the end of every flow execution, and after every direct out-of-cycle write. Users do not, and cannot, invoke sync manually.

## 10. Validation

### 10.1 Enforced at load time

- Every entity type file has non-empty body. Load fails with a clear error if not.
- Every edge type file has non-empty body. Load fails if not.
- Every edge type declares `sources` and `targets` (each either a list of declared entity types or `any`).
- `schema.json` version is compatible with current Foundry version (or migration is available).
- Frontmatter of every type file matches the last-applied schema recorded in `schema.json` (Posture A, §4.6). Mismatches fail the load with a pointer to the appropriate skill.

### 10.2 Enforced at write time

- Entity `type` is declared.
- Entity `name` is a non-empty string.
- Entity `value` is ≤ 4KB.
- Edge `type` is declared.
- Edge endpoints reference declared entity types consistent with edge's `sources`/`targets`.
- Cycle's read/write permissions (when invoked inside a cycle).

### 10.3 Optional project-level checks

Users may define quench-style commands that read memory and verify properties of their choosing (e.g. "every `class` entity's name resolves to a file at current SHA"). These are not built into Foundry. They are ordinary quench commands that the project registers and runs.

## 11. Config shape

### 11.1 Project-level config: `foundry/memory/config.md`

```markdown
---
enabled: true
validation: strict           # or 'lax'
embeddings:
  enabled: true
  baseURL: http://localhost:11434/v1
  model: nomic-embed-text
  dimensions: 768
  apiKey: null
  batchSize: 64
  timeoutMs: 30000
---

# Memory configuration for this project.

(Optional prose about the project's memory usage and conventions.)
```

### 11.2 Flow-level opt-in

A flow opts in to memory by declaring memory usage in its cycle definitions (§5.1). Flows whose cycles do not declare `memory:` blocks effectively do not use memory, even if the project has memory enabled.

There is no top-level flow `memory:` block in v1. Cycle-level declarations are sufficient.

## 12. Non-goals and deferred features

Explicitly out of scope for v1. Listed so implementation does not drift toward them.

- **Cross-flow memory sharing.** One DB per flow in v1. Sharing is deferred until there is evidence of a concrete need and a clear governance model.
- **Per-cycle namespacing within a flow.** All cycles in a flow share the flow's memory.
- **Cardinality constraints.** Never.
- **Entity/edge type inheritance or abstract types.** Never in v1; revisit only on evidence.
- **Property schemas on entities.** Entities have `value` only; no custom properties. Extension is via related entities.
- **Edge value fields.** Edges carry no content; reify relationships as entities if needed.
- **Append-to-value semantics.** All writes are overwrites.
- **History of claims.** Memory is state-now; git provides any needed history of the NDJSON form.
- **Staleness sweeps / anchor-hash validation.** Users may implement via quench; not built-in.
- **Vocabulary packs (shareable sets of type definitions).** Not in v1; file layout leaves room for this later.
- **Multi-process concurrent writes.** Single writer.
- **Automatic embedding model selection based on GPU/CPU availability.** Ship one default endpoint; users override.
- **Bundled embedding models.** Foundry does not ship a model binary or ONNX runtime. The embedding provider is an external HTTP endpoint (default: local Ollama).
- **Graph algorithms beyond bounded traversal and Datalog** (built-in shortest path, PageRank, etc. as named tools). Cozo supports them; Foundry does not expose them as named tools in v1. Datalog users can express many of these directly.
- **CLI.** No shell commands. All interaction is through OpenCode tools and Foundry skills.
- **Manual sync / load / vacuum invocation.** Sync is fully automatic; load is automatic on cold start; vacuum is available as an admin tool but not as a scheduled or CLI operation.

## 13. Gotchas and implementation constraints

- **WAL consistency.** Foundry must checkpoint the WAL before every export. Since `.db` is gitignored, the practical risk is isolated to the sync path — which must checkpoint first.
- **Determinism of export.** Any non-determinism in NDJSON output produces phantom diffs. Row order, key order, number formatting must be fixed and documented. Tested explicitly.
- **Schema version migration.** Any admin tool that touches schema (create, rename, drop, change-embedding-model) auto-bumps the schema version recorded in `schema.json` and records the last-applied frontmatter for every type file, so that hand-edit detection (§4.6) remains reliable. The skills-only surface is the only supported path for such changes in v1.
- **Size drift.** Cozo-on-SQLite does not reclaim deleted page space automatically. The `foundry_memory_vacuum` admin tool compacts the `.db`; users (or skills) may invoke it when needed. A future enhancement may auto-vacuum on size thresholds.
- **Embedding size in NDJSON.** Inline float arrays grow NDJSON files. Acceptable at v1 scale (hundreds to low thousands of entities per flow). If this becomes painful, a follow-up will add an option to split embeddings into a separate optional file.
- **Team merge conflicts on the same entity.** Inevitable. NDJSON makes them resolvable but not automatic. Document the workflow.
- **LLM type-file quality.** Type file bodies are the contract between memory and the LLM. Under-authored types produce bad memory. The `add-memory-entity-type` and `add-memory-edge-type` skills should enforce structure and prompt for the required sections. Ship v1 with a validation that warns on very short bodies and hard-fails on empty.
- **Datalog tool and LLM error rates.** LLMs will write Datalog imperfectly. Ensure `foundry_memory_query` returns clear, actionable error messages on parse failure, unknown relation, or permission-filtered empty results (distinguishing "no match" from "you cannot see this").
- **Embedding provider availability.** The default embedding path depends on Ollama running locally. This moves the "does embeddings work?" failure from install time to runtime. Mitigations: `init-memory` probes the endpoint before completing; every tool surfaces provider errors clearly; `embeddings.enabled: false` is a supported mode for environments without a provider.
- **Embedding dimension drift.** A hosted provider silently changing a model's output dimension, or a user editing `model` without running `change-embedding-model`, would corrupt the vector index. Enforce `dimensions` from `schema.json` on every write; reject mismatches loudly.

## 14. Summary of the feature surface

For reference during implementation planning:

- **User files authored by hand**: prose bodies of `foundry/memory/entities/*.md`, `foundry/memory/edges/*.md`, plus `foundry/memory/config.md`.
- **User files authored via skills only**: frontmatter of entity and edge type files; file creation, renaming, deletion.
- **User files generated and committed**: `foundry/memory/schema.json`, `foundry/memory/relations/*.ndjson`.
- **User files generated and ignored**: `foundry/memory/memory.db` and SQLite sidecars.
- **Flow-author files touched**: cycle definitions gain an optional `memory:` block with `read` / `write` type lists.
- **Cycle-facing tools**: 8 tools (§7), including read-only `foundry_memory_query` for Datalog.
- **Admin tools**: skill-driven, not cycle-facing; carry out schema and lifecycle operations (§9.2).
- **Skills shipped with v1**: `init-memory`, `add-memory-entity-type`, `add-memory-edge-type`, `rename-memory-entity-type`, `rename-memory-edge-type`, `drop-memory-entity-type`, `drop-memory-edge-type`, `change-embedding-model`, `reset-memory`.
- **Automatic behaviours**: lazy load on startup, sync after schema changes, sync at end of flow execution, sync after out-of-cycle direct writes, WAL checkpoint before every export.
- **No CLI.** All interaction via tools and skills.
- **Backend**: Cozo-on-SQLite, hidden from users.

---

End of spec.
