# Assay Stage — Implementation Plan (Master Index)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement each phase document. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** [docs/specs/2026-04-23-assay-stage-design.md](../specs/2026-04-23-assay-stage-design.md)

**Goal:** Introduce a new deterministic stage `assay` that runs before the first `forge` of a cycle, executing project-authored CLI scripts to populate flow memory with entities and edges.

**Architecture:** Follow Foundry's established "skills are thin, tools are tested" discipline. All subprocess, parsing, validation, and upsert logic lives in `scripts/lib/assay/*` as pure-ish modules with injectable I/O. Two new plugin tools (`foundry_assay_run`, `foundry_extractor_create`) wrap the library. Orchestration wiring threads a new stage base through `scripts/orchestrate.js` and `scripts/sort.js`. Two new skills (`skills/assay/`, `skills/add-extractor/`) provide the LLM-facing protocols.

**Tech Stack:** Node ≥18.3, `node:test`, `node:child_process` (spawn + AbortController for timeouts), existing Foundry memory lib (Cozo via `cozo-node`, `js-yaml`, `minimatch`).

---

## Phases

Each phase is an independent plan document. Execute them in order — later phases depend on earlier ones.

| # | Phase | Document | Produces |
|---|---|---|---|
| 1 | Core library plumbing | [phase-1-library.md](./2026-04-23-assay-stage-phase-1-library.md) | Pure-function primitives in `scripts/lib/assay/*`, fully unit-tested. Nothing user-visible. |
| 2 | Plugin tools | [phase-2-plugin-tools.md](./2026-04-23-assay-stage-phase-2-plugin-tools.md) | `foundry_assay_run` and `foundry_extractor_create` tools registered and tested. |
| 3 | Orchestration wiring | [phase-3-orchestration.md](./2026-04-23-assay-stage-phase-3-orchestration.md) | Assay stage scheduled when cycle opts in; iteration-0-only rule enforced; failure-feedback wiring. |
| 4 | Skills | [phase-4-skills.md](./2026-04-23-assay-stage-phase-4-skills.md) | `skills/assay/` and `skills/add-extractor/` skill files. |
| 5 | End-to-end + docs | [phase-5-e2e-docs.md](./2026-04-23-assay-stage-phase-5-e2e-docs.md) | Full-stack integration test; `concepts.md`, `memory-maintenance.md`, `README.md`, `CHANGELOG.md` updates. |

## Dependency graph

```
Phase 1 (library)
   ↓
Phase 2 (plugin tools)         ← depends on Phase 1's runAssay + createExtractor
   ↓
Phase 3 (orchestration)        ← needs the tools registered so stages can be dispatched
   ↓
Phase 4 (skills)               ← skills call the tools registered in Phase 2 and rely on stage dispatch from Phase 3
   ↓
Phase 5 (e2e + docs)
```

## Cross-phase conventions

- **Testing.** All library modules have co-located tests under `tests/lib/assay/`. Plugin-level tests live under `tests/plugin/`. Test runner: `npm test` (which is `node --test`).
- **Commits.** Every numbered step that changes files ends with a commit. Conventional commit prefixes follow the repo's existing style (see `git log --oneline`): `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`.
- **Failure-surfacing design (decided during brainstorming).** `foundry_assay_run` writes `#validation` feedback against `WORK.md` itself when it aborts, then returns `{ok:false, aborted:true}`. The `assay` skill treats the result as opaque and reports the summary. See Phase 2 for the exact wiring.
- **I/O shim.** Library modules take an injectable `io` parameter matching the `makeMemoryIO(worktreeRoot)` async shim shape. Tests use the `diskIO(root)` helper at `tests/lib/memory/_helpers.js`.
- **Extractor file location.** `foundry/memory/extractors/<name>.md`. Decided in the spec.
- **JSONL wire format.** Discriminated by top-level `kind` field; see spec §"Wire format" for the authoritative schema.

## Scope recap (from spec)

**In scope:** new stage base `assay`; opt-in per cycle via `assay: { extractors: [...] }`; iteration-0-only execution; strict failure semantics (abort cycle on any parse/schema/permission/timeout/exit-nonzero).

**Out of scope (deferred):** per-iteration re-extraction; parallel extractor execution; git-SHA-based caching; built-in extractors; `remove-extractor` skill; editing extractors via tool.

## Exit criteria

All of the following true:

- [ ] All phases merged.
- [ ] `npm test` passes.
- [ ] A minimal fixture project (memory enabled, one entity type, one extractor that emits two entities and one edge) can run a full cycle through `foundry_orchestrate` with assay populating memory before forge.
- [ ] Forge prompt for an assay-using cycle includes the extractor's prose brief (same injection as entity-type briefs).
- [ ] A cycle declaring `assay:` without memory enabled fails to load with a clear error pointing at `init-memory`.
- [ ] A cycle whose extractor writes an entity type not in the cycle's `memory.write` fails to load with a clear error.
- [ ] A failing extractor (exit≠0 OR bad JSONL OR oversized value OR timeout OR permission violation) aborts the cycle and writes `#validation` feedback against `WORK.md`.
- [ ] `docs/concepts.md`, `docs/memory-maintenance.md`, `README.md`, `CHANGELOG.md` updated.

---

Proceed to [Phase 1](./2026-04-23-assay-stage-phase-1-library.md).
