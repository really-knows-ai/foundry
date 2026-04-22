# Flow Memory — Post-Implementation Review

Full review of the flow-memory stack (Plans 01–05) with the guiding principle:

> **If something can be deterministic, it should be a tool, not a skill step.**

Skills should orchestrate user intent (confirm, ask for free-form text, present options).
Deterministic file-writes / state mutations / validations should live in tools.

Items that are already tracked in `docs/plans/review-followups.md` are cross-referenced as
`(ref: followups §…)` so we can retire that file once this checklist is closed.

---

## 1. Deterministic work that leaked into skill prompts

### 1.1 `change-embedding-model` skill writes config.md by hand — **BUG**
- [ ] **Skill step 2** says "Edit `foundry/memory/config.md` frontmatter". The tool
      `foundry_memory_change_embedding_model` accepts `{model, dimensions, baseURL?, apiKey?}`
      but **never writes config.md**. It only:
      1. reads config via `loadMemoryConfig`,
      2. constructs `newConfig` in-memory from args,
      3. probes + re-embeds + rewrites `schema.json`.
      If the user (or a headless caller) invokes the tool without first running the skill,
      **schema.json says 1024-dim while config.md still says 768** — the next session's
      `getOrOpenStore` will load the stale config, the `embedder` will produce 768-dim
      vectors, and writes into the 1024-dim typed column will fail at runtime.
      **Fix:** move config-file rewrite into the tool. The skill step 2 becomes "invoke
      tool". `.opencode/plugins/foundry.js:1173–1213`, `skills/change-embedding-model/SKILL.md:21–29`.

### 1.2 `init-memory` skill templates every file in the prompt
- [ ] Skill steps 2, 3, 4, 6 tell the LLM to create directories, write a specific
      `config.md` template, write a specific `schema.json`, and append exact lines to
      `.gitignore`. All of this is deterministic. Replace with a single
      `foundry_memory_init` tool that:
      - creates `entities/`, `edges/`, `relations/` with `.gitkeep`,
      - writes `config.md` and `schema.json` from templates,
      - appends `.gitignore` entries idempotently,
      - optionally probes (step 5) and reports result,
      - returns `{ created: [...], probe: {...} }` so the skill's remaining job is
        only: ask user whether embeddings should be enabled, show probe failure
        options, and `git commit`.
      `skills/init-memory/SKILL.md:23–96`.

### 1.3 `add-memory-entity-type` redundant pre-validation
- [ ] Step 2 says "invoke `foundry_memory_validate`. If an entity or edge type with this
      name already exists, stop". The `foundry_memory_create_entity_type` tool already
      rejects duplicates (`create-entity-type.js:14–16`). The skill step is defensive
      LLM cognition that a deterministic tool already performs. Drop step 2 — let the
      create tool error out and surface the message. Same pattern in
      `add-memory-edge-type`. `skills/add-memory-entity-type/SKILL.md:19`.

### 1.4 Commit messages templated in every skill
- [ ] All 8 memory skills close with a literal `git add … && git commit -m "..."` block
      where the LLM substitutes `<name>` / `<from>` / `<to>`. This is a string-format
      job. Consider returning `commitHint: { paths, message }` from each mutating tool
      and having a single `foundry_memory_commit` helper — or at minimum assert the
      commit message format in the tool's return value so the skill is copy-paste.
      Low priority; matches `init-foundry`'s convention and skills already invoke git
      directly. Keep but acknowledge.

### 1.5 `drop-memory-entity-type` preview step
- [ ] Step 2 says "Run `foundry_memory_dump` on the type to show them the data that
      will be deleted". Consider folding into the drop tool: a call with `confirm:false`
      could return `{ preview: {...}, requiresConfirm: true }` — one round-trip instead of
      two. Nice-to-have. `skills/drop-memory-entity-type/SKILL.md:15`.

---

## 2. Correctness bugs in the stack

### 2.1 Cycle prompt omits `foundry_memory_search` — **BUG**
- [ ] `scripts/lib/memory/prompt.js:54–66` lists `get / list / neighbours / query / put /
      relate / unrelate` but **not `foundry_memory_search`**, which Plan 5 added. Cycles
      with read permissions but no awareness of semantic search. Conditionally include
      the line when `store.schema.embeddings?.dimensions` is set.

### 2.2 Drop/rename leak Cozo relations in `.db`
- [ ] `admin/drop-entity-type.js` and `admin/rename-entity-type.js` update files on disk
      and call `invalidateStore` but never issue `::remove ent_<old>` against the live
      DB. On reopen the old relation is still in the sqlite file (the invalidation
      closes and reopens — `openStore` only creates relations that are in the current
      schema, so old ones become orphans). `.db` is gitignored so benign, but
      `::relations` output will be misleading and disk footprint grows. Drop the
      relation in the admin operation, or run `::remove` for any relation not in the
      target schema during `openStore`.

### 2.3 `runQuery` write-token blacklist is incomplete
- [ ] `scripts/lib/memory/query.js:1` blocks `:put / :rm / :create / :replace / :ensure
      / :ensure_not / ::remove` but **not** `::hnsw create`, `::hnsw drop`, `::index
      create`, `::index drop`, `::fts …`. A cycle with read-only permission can drop
      the vector index via `foundry_memory_query("::hnsw drop ent_class:vec")`. Extend
      the regex to cover `::hnsw`, `::index`, `::fts`, and any `::` prefix that is not
      in an allowlist (`::relations`, `::columns`, `::describe`, `::compact`,
      `::indices`).

### 2.4 Escape inconsistency between reads and writes
- [ ] `scripts/lib/memory/writes.js:4` escapes `\`, `"`, `\n`. `scripts/lib/memory/
      reads.js:3` escapes only `\` and `"`. Neither escapes CR, tab, or NUL. Extract a
      single `cozoStringLit` helper in `cozo.js` and use it everywhere. Low risk but
      trivially exploitable if a `value` contains `\r`. Same duplication in
      `store.js:14` and `writes.js:4`.

### 2.5 `validate.js` does not reject newlines/control chars in `name`
- [ ] `validateEntityWrite` accepts any non-empty string as `name`. Since `name` is the
      primary key and embedded into the NDJSON serialisation order, a name containing
      `\n` would break round-trip. Reject `\n`, `\r`, `\0` in both `name` and edge
      endpoint names.

### 2.6 `loadMemoryConfig` + `DEFAULT_CONFIG` edge case
- [ ] `config.js:4–17`: `DEFAULT_CONFIG.embeddings.enabled = true`. If a user writes
      `enabled: false` at the top-level but omits the `embeddings:` block, `mergeEmbeddings`
      returns defaults, leaving `embeddings.enabled: true`. `validate()` then enforces a
      baseURL / model / dimensions against a provider the user never configured. The
      probe in `init-memory` step 5 would then run unexpectedly. Either:
      - gate `embeddings` defaults on the outer `enabled`, or
      - default `embeddings.enabled` to `false` and require explicit opt-in.

### 2.7 `config.js` strict `=== true` on YAML bool (ref: followups §Plan 1 / config.js)
- [ ] `fm.enabled === true` silently rejects a YAML value of the string `"true"`. Either
      coerce (`fm.enabled === true || fm.enabled === 'true'`) or throw on non-boolean.

### 2.8 `config.js` / `types.js` CRLF frontmatter divergence (ref: followups §Plan 1)
- [ ] `config.js:20` regex requires `\n`; `types.js:6` accepts `\r?\n`. A CRLF-saved
      config.md parses as empty → `enabled:false`. Ship a shared frontmatter helper
      (`scripts/lib/memory/frontmatter.js`) and use it in `config.js`, `types.js`,
      `admin/drop-entity-type.js:29`, `admin/rename-entity-type.js:30`,
      `admin/drop-edge-type.js`, `admin/rename-edge-type.js`.

### 2.9 `splitFrontmatter` bare `YAMLException` (ref: followups §Plan 1 / types.js — "Important")
- [ ] `types.js:8` calls `yaml.load(m[1])` with no try/catch. Malformed YAML in a type
      file produces an error with no filename context. Wrap and rethrow with the
      filename prefix. The shared helper from §2.8 is the natural home.

---

## 3. Cross-cutting cleanups (carry-overs from followups)

- [ ] Extract `scripts/lib/memory/frontmatter.js` helper (parse + split + CRLF + error
      context). Used by `config.js`, `types.js`, all admin files. (ref: followups §Cross-cutting)
- [ ] Apply `node:` import prefix uniformly across `scripts/lib/memory/**`
      (`paths.js:1` → `node:path`, etc.). (ref: followups §Cross-cutting)
- [ ] Shared `tests/lib/memory/_helpers.js` with a canonical `memIO` mock — every test
      file re-invents one. (ref: followups §Cross-cutting)
- [ ] `normaliseForWrite` in `schema.js:21–34` uses shallow key sort. Use the existing
      `canonicalise` so nested objects stabilise. (ref: followups §Plan 1 / schema.js)
- [ ] Dedupe `sources` / `targets` in `create-edge-type.js:7–13` — currently
      `[class, class]` is accepted. (ref: followups §Plan 1 / types.js)
- [ ] `drift.js:26` emits a string `"rename-... or drop-..."`. Change to
      `suggestedSkills: [...]` array for programmatic consumption. (ref: followups §Plan 1 / drift.js)

---

## 4. Plan-5 additions not yet reflected in docs

- [ ] `docs/plans/review-followups.md` section "Plan 2+" is empty — backfill or retire
      the file once this review is acted on.
- [ ] Document the Cozo 0.7 adaptations (`::compact` instead of `::checkpoint`, typed
      `<F32; N>?` columns for HNSW, `?[...] <- [[...]]` inline-put syntax) in
      `MEMORY.md` or a `docs/cozo-notes.md`. Future maintainers will re-derive this
      painfully.
- [ ] Record the `change_embedding_model` context-null fix (commit `3147409`) as the
      canonical example of "tools that may be first-call-of-session must load from
      disk, not rely on the singleton context".

---

## 5. Suggested order of operations

1. **2.1** (prompt omits search) — one-line fix, user-facing.
2. **1.1** (change-embedding-model config.md) — correctness + skill simplification.
3. **2.3** (query write-token gaps) — security posture.
4. **2.8 + 2.9** via the shared `frontmatter.js` helper — unblocks §2.7, §3 items.
5. **1.2** (`foundry_memory_init` tool) — the big skill-to-tool conversion; touches
   init-memory integration tests but no behaviour change.
6. Remaining cleanups in §3.
7. Retire `docs/plans/review-followups.md`.
