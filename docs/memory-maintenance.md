# Flow memory — maintenance notes

Contributor-facing notes. Not architecture; not a spec. This is the
"things that weren't obvious from the Cozo docs / plugin surface and cost us
time to derive" file. Add entries when a fix required non-trivial spelunking,
so the next maintainer doesn't re-derive it.

## Cozo 0.7 adaptations

### `::compact` instead of `::checkpoint`

Older Cozo docs and the original spec reference `::checkpoint` for WAL
consolidation. In 0.7 the operation is spelled `::compact`. The
`foundry_memory_vacuum` admin tool and `openStore` reconciliation both use
`::compact`. See `scripts/lib/memory/admin/vacuum.js`.

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
explicit column map. See `scripts/lib/memory/writes.js` for the generator.

### String literal syntax: single-quoted vs double-quoted

**This is a footgun.** Cozo 0.7 treats the two forms differently:

- `"..."` — **raw**. Does NOT honour backslash escapes. Embedding `"` inside
  (even as `\"`) is a parse error.
- `'...'` — honours standard escapes (`\n`, `\r`, `\t`, `\\`, `\'`).

Any user-supplied value containing `"` would crash a raw-string literal.
Values with `\n` would round-trip as the literal two characters `\` and `n`.

**Always** use the single-quoted form for user data. `scripts/lib/memory/cozo.js`
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

Beyond hand-authored `relations/<type>.ndjson` seed data, flow memory can be populated at runtime by **extractors** — project-authored CLI scripts that emit JSONL describing entities and edges. An extractor runs inside the `assay` stage of a cycle that opts in via its frontmatter.

Extractors are defined at `foundry/memory/extractors/<name>.md` with a `command`, a `memory.write` scope, and a prose brief. Create them with the `add-extractor` skill; reference them from a cycle via `assay: { extractors: [name, ...] }`. See [docs/concepts.md](concepts.md#extractor) for the full spec.
