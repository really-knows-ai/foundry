# Flow memory — maintenance notes

Contributor-facing notes. This file records the derived details from the
Cozo docs / plugin surface that cost us time to establish. Add entries when a
fix required non-trivial spelunking, so the next maintainer can reuse the result.

## Backend status (as of 3.0.0)

The memory subsystem persists to `cozo-node@0.7.6`, which wraps the Rust
`cozodb` engine. Both are effectively unmaintained:

- `cozo-node` has not been published since December 2023.
- `cozodb/cozo` has not received a commit since December 2024.

There are no known correctness or security issues in our usage — `pnpm
audit` reports clean. The only visible symptom is six `deprecated
subdependency` install warnings (all from `cozo-node →
@mapbox/node-pre-gyp@1`).

Foundry will migrate to a maintained graph + vector backend in a future
release. Candidates under evaluation include **Kùzu** (embedded
property-graph with HNSW, Cypher dialect), **SurrealDB embedded**,
**DuckDB + vss + PGQ**, and **SQLite + `sqlite-vec`** with hand-rolled
graph traversal. The migration is structured so the public memory tool
surface (`foundry_memory_*`) and the on-disk durable artefacts
(`foundry-memory/entities/*.md`, `foundry-memory/edges/*.md`,
`foundry-memory/relations/*.ndjson`) remain stable; only the live
in-process store changes.

When contributing to the memory module in the meantime, keep the cozo
coupling routed through `src/scripts/lib/memory/cozo.js` and
`src/scripts/lib/memory/store.js`. New consumers should depend on the
`store` interface, not on `cozo-node` directly.

## Cozo 0.7 adaptations

### `::compact` instead of `::checkpoint`

Older Cozo docs and the original spec reference `::checkpoint` for WAL
consolidation. In 0.7 the operation is spelled `::compact`. The
`foundry_memory_vacuum` admin tool and `openStore` reconciliation both use
`::compact`. See `src/scripts/lib/memory/admin/vacuum.js`.

### Typed `<F32; N>?` vector columns

HNSW indices in Cozo 0.7 require the indexed column to be declared as a
typed, nullable vector: `vec: <F32; 768>?` (the trailing `?` makes the field
nullable so rows without an embedding do not block `:put`). An untyped column
produces a less helpful "expected vector" error when building the index.
`store.js:createEntityRelation` encodes the column shape from
`schema.embeddings.dimensions`.

### `?[...] <- [[...]]` inline-put syntax

Cozo 0.7 dropped implicit positional binding in `:put`. The canonical spelling
is:

```cozo
?[name, value, vec] <- [["a", "v", null]]
:put ent_class { name, value, vec }
```

i.e. bind a named tuple via `?[...] <- [[...]]` and then `:put` with an
explicit column map. See `src/scripts/lib/memory/writes.js` for the generator.

### String literal syntax: single-quoted vs double-quoted

**This is a footgun.** Cozo 0.7 treats the two forms differently:

- `"..."` — **raw**. Does NOT honour backslash escapes. Embedding `"` inside
  (even as `\"`) is a parse error.
- `'...'` — honours standard escapes (`\n`, `\r`, `\t`, `\\`, `\'`).

Any user-supplied value containing `"` would crash a raw-string literal.
Values with `\n` would round-trip as the literal two characters `\` and `n`.

**Always** use the single-quoted form for user data. `src/scripts/lib/memory/cozo.js`
exports `cozoStringLit(s)` as the canonical helper — it emits `'...'` with
escapes for `\`, `'`, `\n`, `\r`, `\t`. Do not introduce ad-hoc escape
helpers.

### `::relations` lists HNSW index pseudo-relations

`::relations` returns not just the base relations Foundry created
(`ent_class`, `edge_calls`) but also their index entries
(`ent_class:vec`, `ent_class:vec:vec`, …). Any code that iterates relations
to reconcile against the expected set must filter:

```js
const baseRelation = /^(ent|edge)_[^:]+$/;
```

Dropping an HNSW-indexed relation also requires `::hnsw drop foo:vec` first
— `::remove foo` alone will leave the index metadata behind. See
`openStore`'s reconciliation loop.

## Plugin / session lifecycle

### Tools that may be first-call-of-session load config from disk

A tool that can be invoked before any memory read/write must not rely on
`context.store` or `context.config` being populated. The store singleton is
only constructed on first store-touching call, and plugin-level `context` is
only partially populated for tools that never needed a store before.

Canonical example: `foundry_memory_change_embedding_model`. If the user
invokes it as the first memory op of the session (common in the
`change-embedding-model` skill), `context.config` is `null` and any
`context.config.embeddings.*` access throws. The fix (commit `3147409`) loads
config fresh:

```js
const io = makeMemoryIO(context.worktree);
const currentConfig = await loadMemoryConfig('foundry', io);
```

Any new admin tool that (a) may be the first call of a session and (b) needs
config should follow the same pattern. Opening a store inside the tool
handler is fine; *reading through a possibly-uninitialised singleton* is not.

## Runtime population via extractors

Beyond hand-authored `foundry-memory/relations/<type>.ndjson` seed data, flow memory can be populated at runtime by **extractors** — project-authored CLI scripts that emit JSONL describing entities and edges. An extractor runs inside the `assay` stage of a cycle that opts in via its frontmatter.

Extractors are defined at `foundry/memory/extractors/<name>.md` with a `command`, a `memory.write` scope, and a prose brief. Create them with the `add-extractor` skill; reference them from a cycle via `assay: { extractors: [name, ...] }`. This path is runtime population: extractor definitions live in config, while successful rows are flushed to the top-level `foundry-memory/relations/` data tree. See [docs/concepts.md](concepts.md#extractor) for the full spec.

## Memory layout: two trees

Since Phase 2 (3.0.0), memory is split across two top-level trees:

- `foundry/memory/` — *config*. Holds `config.md`, `schema.json`,
  `entities/<name>.md`, `edges/<name>.md`, `extractors/<name>.md`,
  and the `memory.db*` runtime files (gitignored). Authored on
  `config/*` branches via the schema-mutation tools.
- `foundry-memory/relations/` — *row data*. Top-level sibling of
  `foundry/`, holding `<name>.ndjson` files. Tracked in git (the
  source of truth for memory rows). Written by `foundry_stage_end`
  flushing in-cycle puts, by `foundry_assay_run` flushing extractor
  output, by direct out-of-cycle `foundry_memory_put` /
  `foundry_memory_relate` / `foundry_memory_unrelate` calls, or by
  hand-authored seed data.

Source of truth: `src/scripts/lib/memory/paths.js`, which threads
`foundryDir` through the `foundry/memory/` config tree but pins
`relationsDir` at the literal `'foundry-memory/relations'`.

When sweeping memory paths in maintenance scripts, treat the two
trees as separate: `foundry/memory/` for config, `foundry-memory/`
for data. Operations that touch both (init, drop, rename, reset,
embedding-model swap) stage paths under both prefixes in the same
commit.

## Failed-flow guard on memory admin tools

Every mutating memory tool — both data writes (`foundry_memory_put`,
`foundry_memory_relate`, `foundry_memory_unrelate`) and admin ops
(`foundry_memory_init`, `foundry_memory_reset`, `foundry_memory_vacuum`,
`foundry_memory_change_embedding_model`,
`foundry_memory_create_entity_type` / `_create_edge_type`,
`foundry_memory_rename_entity_type` / `_rename_edge_type`,
`foundry_memory_drop_entity_type` / `_drop_edge_type`,
`foundry_extractor_create`) — refuses to run when `WORK.md`
frontmatter has `status: failed`. Each tool returns a tool-name-prefixed
error referencing the failure reason.

This is by design: the failed-flow state locks mutating tools until the
failure is handled, and admin operations on memory while a flow is in an
unrecoverable state risk compounding the damage. Read-only diagnostics
(`foundry_memory_get`, `_list`, `_neighbours`, `_query`, `_search`,
`_dump`, `_validate`) remain callable so the operator can investigate.

The supported recovery paths: read the failure reason via
`foundry_workfile_get`, fix the root cause, then either call
`foundry_stage_retry()` to clear the failed state and re-run the blocked
stage, or abandon the cycle with `foundry_workfile_delete({ confirm: true })`.
See `src/scripts/lib/failed-flow.js` and [architecture.md](architecture.md#failed-flow-state) for the full contract.
