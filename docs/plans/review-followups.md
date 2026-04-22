# Flow Memory — Review Follow-ups

Non-blocking issues raised by code / spec reviewers during subagent-driven implementation.
Each item is faithful to the plan as written — these are improvements to return to after the
full flow-memory stack lands.

## Plan 1: Foundation

### `scripts/lib/memory/paths.js` (Task 1)
- [ ] Use `from 'node:path'` instead of `from 'path'` for consistency with `node:test` / `node:assert/strict` convention used elsewhere in the memory modules.
- [ ] Consider `path.posix.join` (or platform-aware test assertions) if Windows support ever matters. Tests currently assert literal POSIX strings.
- [ ] Optional: input validation on `foundryDir` and the `name` arg to `entityTypeFile` / `edgeTypeFile` / `relationFile` to prevent `../` escapes.

### `scripts/lib/memory/config.js` (Task 2)
- [ ] `parseFrontmatter` regex doesn't tolerate CRLF; `types.js` does. Harmonise once a shared frontmatter helper exists.
- [ ] `mergeEmbeddings` silently drops unknown embedding keys. Consider a warning or strict-mode rejection.
- [ ] `validate` doesn't check `apiKey` / `timeoutMs` types.
- [ ] `fm.enabled === true` is strict — a YAML string `"true"` silently becomes `false`. Consider coercing or rejecting.

### `scripts/lib/memory/schema.js` (Task 3)
- [ ] `normaliseForWrite` uses shallow `sortedKeys`. Switch to the existing `canonicalise` helper so nested values are also ordered — removes a latent non-determinism if future writers build entries with varying key order.
- [ ] Add JSDoc to `bumpVersion` clarifying it mutates in place and returns the new version number (not the schema).
- [ ] No type guard on parsed JSON in `loadSchema` — arrays or scalars would slip through `??` defaults. Add a shape check.
- [ ] Tests missing: `writeSchema` mkdir-when-missing vs mkdir-skipped, `loadSchema` partial-JSON defaults, `hashFrontmatter` over nested objects / arrays.

### `scripts/lib/memory/ndjson.js` (Task 4)
- [ ] `parseEntityRows === parseEdgeRows` alias — no structural validation of edge shape. Add row-shape guards if downstream relies on it.
- [ ] `compareEntity` / `compareEdge` silently return 0 when sort keys are missing/undefined.
- [ ] `serialiseEntityRows` / `serialiseEdgeRows` don't guard against non-array input.
- [ ] Tests missing: non-finite detection in nested objects (only embedding array tested), `Infinity` (only `NaN`), recursive key alphabetisation, full four-key edge tiebreak.

### `scripts/lib/memory/types.js` (Task 5)
- [ ] **Important:** `splitFrontmatter` doesn't wrap `yaml.load` — malformed frontmatter throws a bare `YAMLException` with no filename context. Wrap and rethrow with `filename:` prefix to match the other validation errors.
- [ ] `.gitkeep` filter is dead code (doesn't end with `.md`) — keep or remove explicitly.
- [ ] `splitFrontmatter` overlaps with `parseFrontmatter` in `config.js`. Extract a shared `scripts/lib/memory/frontmatter.js` helper.
- [ ] No duplicate `type` detection across files (prevented in practice by stem==type rule + filesystem uniqueness, but worth an explicit check).
- [ ] Edge `sources` / `targets` arrays accept duplicates (`[class, class]`). Deduplicate or reject.
- [ ] Opening fence regex requires `\n` (no `\r\n` tolerance on the opener).

### `scripts/lib/memory/drift.js` (Task 6)
- [ ] `suggestedSkill` is a freeform string like `"rename-... or drop-..."` — not programmatically consumable. Change to `suggestedSkills: [...]` array once callers appear.
- [ ] No guard against malformed input (`vocabulary.entities` undefined would throw on `Object.keys`, contradicting the "does not throw" contract in a weak sense).
- [ ] Assumes every `loaded[name]` has a `.frontmatter`. Relies on upstream invariants from `types.js`.

### `skills/init-memory/SKILL.md` (Task 7)
- [ ] No items. Spec-compliant, verbatim match.

### `tests/lib/memory/integration.test.js` (Task 8)
- [ ] The plan's `memIO` mock originally didn't recognise directories implied by file paths. Fix was applied in-place during implementation (extended `exists` to check file-path prefixes). Update the plan doc (`docs/plans/01-foundation.md` Task 8) if regenerating from spec.

## Cross-cutting

- [ ] Extract shared frontmatter helper (`config.js` and `types.js` both parse frontmatter differently).
- [ ] Decide on `node:` import prefix convention and apply uniformly across `scripts/lib/memory/**`.
- [ ] Establish a shared `mockIO` / `memIO` test helper under `tests/lib/memory/_helpers.js` — currently each test file rolls its own.

## Plan 2+
_(to be filled in as later plans are executed)_
