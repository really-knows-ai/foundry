# Architecture

This document provides a high-level overview of how Foundry works. For concept definitions, see [concepts.md](concepts.md). For the complete WORK.md specification, see [work-spec.md](work-spec.md).

---

## Design principles

Foundry's guiding rule is **if it can be deterministic, it will be**. Where a guarantee matters — routing, commits, state transitions, write invariants, feedback lifecycle — the logic lives in tested plugin code. This embodies several architectural commitments:

### Everything is markdown

Flows, cycles, artefact types, laws, appraiser personalities, and skills are all markdown with YAML frontmatter. They are readable by humans, consumable by LLMs, diff-able in git, and stored directly in the repo.

### Skills are the pipeline, tools are the machinery

Composition happens at the skill layer. `flow` reads a definition and invokes `orchestrate`. `orchestrate` calls `foundry_orchestrate` in a loop. The hard guarantees — routing, commits, state transitions, enforcement — live inside the plugin's custom tools and the libraries under `src/scripts/lib/`. Skills handle creative and subjective work; tools handle everything deterministic.

### WORK.md as shared state

Inter-stage communication goes through `WORK.md`, `WORK.feedback.yaml`, and `WORK.history.yaml` via the `foundry_workfile_*`, `foundry_artefacts_*`, `foundry_feedback_*`, and `foundry_history_*` tools. This gives a complete audit trail, makes flows resumable after a crash, and lets any stage be re-run independently.

### Cycles own their routing

A flow declares starting points; individual cycles declare `targets` and input contracts. The flow skill walks the resulting graph. Cycles stay composable across flows; the flow file stays declarative.

### Feedback as structured state

Feedback lives in `WORK.feedback.yaml` with source tracking and tags. It remains human-readable and diff-able, whilst the plugin enforces lifecycle transitions as structured state. Feedback is append-only; the full transition history is preserved alongside each item. Every issue is raised, every decision is recorded, and every resolution is auditable.

### Wont-fix requires approval

A forge sub-agent can decline subjective feedback with a justification, and an appraiser approves or rejects that decision on the next iteration. Validation and human feedback cannot be wont-fixed.

### Humans can step in at known points

Human-in-the-loop gates are first-class stages. A cycle can declare `human-appraise: true` to run a human quality gate every iteration, or rely on `deadlock-appraise: true` (the default) to pull a human in only when LLM appraisers and forge ping-pong on the same items. Human feedback takes absolute priority and cannot be wont-fixed.

### Multi-model diversity

Cycle definitions specify per-stage models; individual appraisers may override. Different models catch different issues; consolidation is a union. One appraiser flagging an issue is enough to raise it.

### Input artefacts are read-only

When a cycle reads from another cycle's output, those files cannot be modified. This is enforced at the file-write stage. Downstream cycles cannot corrupt upstream work.

### Glob patterns must not overlap

Two artefact types cannot have file patterns that match the same files. Hard-blocked at creation time; the file-ownership rule does not have a meaningful answer otherwise.

### Flow memory is strictly opt-in and per-cycle

Memory is a separate, optional subsystem. Without `foundry/memory/`, the system runs with memory features disabled; prompt injection, tools, and vocabulary stay out. With memory initialised, a cycle accesses it by declaring a `memory: { read, write }` block in its frontmatter. The live Cozo database is gitignored and rebuildable from committed NDJSON; vocabulary (`entities/<type>.md`, `edges/<name>.md`) and row data (`relations/*.ndjson`) are the durable source of truth. Destructive operations preview before they mutate.

---

## Enforcement model

Foundry enforces correctness through deterministic plugin tools that own state transitions, routing, and write boundaries. Skills perform creative and evaluative work; tools handle everything that must be reliable.

### Tool-enforced guarantees

The following guarantees live in plugin code and are outside LLM control:

- **Stage-locked mutations.** Mutation tools (`foundry_feedback_*`, `foundry_artefacts_*`, `foundry_workfile_*`) require the caller's role to match the active stage. A forge sub-agent cannot add feedback; a quench sub-agent cannot register artefacts. Stage identity is verified through the token lifecycle (below).
- **Single-use tokens.** Every dispatched stage receives an HMAC-signed token minted by `foundry_orchestrate`. The sub-agent's first call must be `foundry_stage_begin({stage, cycle, token})` to redeem it. Replays, forgery, and cross-stage reuse all fail closed.
- **Commit-per-stage contract.** The orchestrator refuses to proceed if uncommitted changes to `WORK.md`, `WORK.feedback.yaml`, `WORK.history.yaml`, or `.foundry/` state files are present when a new stage is requested and history is non-empty. Every stage ends with a micro-commit, enforced by `foundry_orchestrate` after calling the stage's internal finalize step.
- **Write invariants.** The orchestrator's internal finalize step scans the git diff after `foundry_stage_end`. Files outside the stage's allowed patterns (artefact file-patterns for forge, tool-managed WORK files for evaluation stages) cause a hard stop with `{error: 'unexpected_files'}`.
- **Feedback state machine.** Transitions are source-based. Only legal state changes are accepted: `resolved` is terminal; quench cannot approve/reject a `wont-fix`; validation cannot be wont-fixed. See [work-spec.md](work-spec.md) for the full state machine.
- **Artefact-type glob uniqueness.** `add-artefact-type` refuses to create a type whose file patterns overlap with an existing type. The write-invariant enforcer relies on unambiguous file ownership.

### Deterministic orchestration

The `orchestrate` skill is a thin driver around `foundry_orchestrate`. Its entire loop is:

```text
call foundry_orchestrate({lastResult})
switch on action:
  dispatch        → dispatch the requested subagent → report back
  human_appraise  → run human-appraise inline → report back
  done / blocked / violation → terminate the loop
```

`foundry_orchestrate` owns:

- **Sort routing** — which stage runs next, based on feedback state, iteration depth, and deadlock detection.
- **Commit enforcement** — every stage ends with a micro-commit; the orchestrator refuses to proceed if dirty files are present.
- **History** — appends a record of every stage execution to `WORK.history.yaml`.
- **Finalize** — scans the git diff, registers matching artefacts, rejects unexpected writes.
- **Violation handling** — returns terminal envelopes (`unexpected_files`, `blocked`, `done`) that the `orchestrate` skill translates into user-facing outcomes.

Because the protocol lives in a plugin tool, the LLM cannot skip steps, reorder them, or silently drop a commit.

---

## Token lifecycle

Foundry uses HMAC-SHA256 tokens to gate stage execution. Tokens are single-use, cryptographically signed, and carry metadata about the stage they authorise.

### Flow

1. **Mint.** `foundry_orchestrate` creates a token when dispatching a stage. The token includes:
   - `stage` — the stage identifier (e.g. `forge:write-haiku`)
   - `cycle` — the cycle ID
   - `nonce` — a random ULID
   - `exp` — expiry timestamp (default: 1 hour from mint time)
   - `hmac` — HMAC-SHA256 signature over `{stage, cycle, nonce, exp}` using the worktree's secret key
2. **Dispatch.** The token is embedded in the sub-agent's dispatch prompt.
3. **Redeem.** The sub-agent's **first** call is `foundry_stage_begin({stage, cycle, token})`. The tool verifies:
   - The HMAC signature is valid.
   - The nonce has not been used (checked against the pending store).
   - The token has not expired.
   - The claimed `stage` and `cycle` match the token's signed payload.
4. **Activate.** On success, the stage is recorded in `.foundry/active-stage.json`. Mutation tools (`foundry_feedback_*`, `foundry_artefacts_*`, etc.) now check that their role matches the active stage.
5. **End.** The sub-agent's **last** call is `foundry_stage_end({summary})`. This removes `.foundry/active-stage.json` and writes `.foundry/last-stage.json` for the orchestrator's finalize step.
6. **Finalize.** The orchestrator's internal finalize step runs after `stage_end`, scanning the git diff and committing the stage.

### Secret key

The HMAC key lives in `.foundry/.secret` (mode 0600, gitignored, one per worktree). It is generated on first boot and never transmitted. Because it is worktree-local, tokens cannot be replayed across clones or forks.

### Pending store

The pending store (`src/scripts/lib/pending.js`) tracks consumed nonces to prevent replay attacks. It is an in-memory `Map` with automatic garbage collection: expired entries are swept periodically via the `gc()` method.

---

## Branch guards

Foundry partitions mutation across three branch namespaces. The plugin enforces this split at tool-call time, preventing config changes on work branches and flow data changes on config branches.

### Namespace rules

| Namespace | Pattern | Owns | Created from | Finished by |
|-----------|---------|------|--------------|-------------|
| **config** | `config/<description>` | `foundry/` (schema and config) | `main` via `foundry_git_branch({ kind: "config", description })` | PR or direct merge to `main` |
| **work** | `work/<flowId>-<description>` | `WORK.md`, `WORK.feedback.yaml`, `WORK.history.yaml`, `foundry-memory/` (row data) | `main` via `foundry_git_branch({ kind: "work", flowId, description })` | `foundry_git_finish` (squash-merges to base, preserves forensic archive) |
| **dry-run** | `dry-run/<parentConfig>/<flowId>-<description>` | Same as `work/*` | `config/*` via `foundry_git_branch({ kind: "dry-run", flowId, description })` | `foundry_git_finish` (captures snapshot, force-deletes branch) |

### Guard implementation

Every mutating tool composes one of three guards before its handler runs:

- **`requireOnConfigBranch`** — accepts only `config/<description>`. Used by schema-mutation tools (`foundry_config_create_*`, `foundry_memory_create_*`, `foundry_extractor_create`, memory admin tools). Dry-run is rejected by design — schema must change on a real config branch.
- **`requireOnFlowBranch`** — accepts `work/<flow>-<desc>` or `dry-run/<x>/<y>`. Used by flow-data tools (`foundry_orchestrate`, workfile/feedback/artefact-status/assay/appraisers families, `foundry_memory_put`/`_relate`/`_unrelate`).
- **`requireOnConfigOrFlowBranch`** — accepts any of the three namespaces. Used by read-only diagnostic tools.

Implementation: `src/scripts/lib/branch-guard.js`.

### Forensic branches and snapshots

- **Work branches** are preserved as `archive/work/<flowId>-<description>-<hash>` when `foundry_git_finish` completes. The full stage micro-commit history, `WORK.*` files, and all intermediate artefact states remain intact. The signed squash commit on the base branch references the archive branch tip SHA in its attestation block.
- **Dry-run branches** are force-deleted after `foundry_git_finish` captures a snapshot to `.snapshots/<runId>/` on the parent `config/*` working tree. Each snapshot includes `README.md` (metadata), `work/WORK*` (workfile triple), `diff.patch` (full diff), and `trace.jsonl` (tool-call trace).

---

## Memory layout

Foundry's optional flow memory subsystem uses a two-tree split: configuration lives under `foundry/memory/` (committed alongside the rest of the foundry config), and row data lives under `foundry-memory/relations/` (a top-level sibling of `foundry/`) so it can be tracked or replaced independently.

### Directory structure

```
foundry/memory/                # config (committed)
├── config.md                  # frontmatter: enabled, validation, embeddings
├── schema.json                # canonical, deterministic, derived from entity/edge files
├── entities/<type>.md         # prose brief per entity type (LLM-facing)
├── edges/<name>.md            # frontmatter (sources/targets) + prose brief
├── extractors/<name>.md       # extractor definitions (assay stage)
├── memory.db                  # live Cozo 0.7 store (gitignored)
├── memory.db-wal              # WAL (gitignored)
└── memory.db-shm              # shared memory (gitignored)

foundry-memory/                # row data (committed; top-level sibling of foundry/)
└── relations/<type>.ndjson    # one line per row, source of truth for memory contents
```

### Data model

- **Entity** — `{ type, name, value }`, where `value` (≤ 4 KB) is free text describing intrinsic characteristics only. Relationships belong in edges.
- **Edge** — directed row `{ from_type, from_name, edge_type, to_type, to_name }`.
- **Entity type** — declared in `foundry/memory/entities/<type>.md`. The prose body is injected into the prompt of every cycle that reads or writes this type.
- **Edge type** — declared in `foundry/memory/edges/<name>.md`. Frontmatter declares `sources` and `targets` (list of entity types or `any`).

### Schema and source of truth

- **`schema.json`** is a fully key-sorted derivation of the entity/edge files plus the active embedding configuration. It is regenerated by admin tools and serves as a diff-friendly artefact of the vocabulary, not a source of truth.
- **`relations/<type>.ndjson`** files are the durable source of truth for memory contents. The live `memory.db` is rebuildable from these files.
- **Self-healing reopen.** On store open, orphan relations left by drops/renames are reconciled (`::relations` filtered to `^(ent|edge)_[^:]+$`, HNSW indices dropped before `::remove`).

### Per-cycle permissions

Cycles opt in to memory via frontmatter:

```yaml
memory:
  read:  [class, method]      # types this cycle can read
  write: [method]             # types this cycle can upsert
```

- `read` types expose `foundry_memory_{get,list,neighbours,query,search}` (search requires embeddings).
- `write` types additionally expose `foundry_memory_{put,relate,unrelate}`.
- `read` and `write` are independent sets. A type listed in `write` only is writable but invisible to read tools. List a type in both sets for full access.
- Edge permissions are derived: an edge is readable if either endpoint type is in `read` or `write`, writable if either endpoint is in `write`.
- `foundry_memory_query` rejects Datalog that references `ent_*` / `edge_*` relations outside the read set.

### Embeddings

Optional. When `embeddings.enabled: true` in `config.md`, entity values are embedded against an OpenAI-compatible endpoint (default: local Ollama `nomic-embed-text`, 768 dims) and stored in a typed `<F32; N>?` column with an HNSW index. `foundry_memory_search` exposes semantic nearest-neighbour search. `change-embedding-model` re-embeds all entities atomically (nothing is written on failure).

### Operational guarantees

- **Deterministic scaffolding.** `foundry_memory_init` creates directories, config, schema, and gitignore entries in one call.
- **Preview-then-confirm for destructive ops.** Drop tools called without `confirm: true` return an impact report (row counts, affected edges).
- **Prompt-injection guard.** If memory is misconfigured or drifted, dispatch still succeeds with the base prompt (memory context is omitted, not fatal).

---

## Stage execution model

Every stage runs inside a token-gated lifecycle. The sub-agent must call `foundry_stage_begin`, do its work, then call `foundry_stage_end`. The orchestrator's finalize step then scans the disk, registers artefacts, and commits the stage.

### Per-stage write rules

| Stage | May write |
|-------|-----------|
| `forge` | Files matching the output artefact type's `file-patterns`, plus `WORK.md` / `WORK.feedback.yaml` / `WORK.history.yaml` via tools |
| `quench` | `WORK.feedback.yaml` via feedback tools; `WORK.history.yaml` via stage finalization |
| `appraise` | `WORK.feedback.yaml` via feedback tools; `WORK.history.yaml` via stage finalization |
| `human-appraise` | `WORK.feedback.yaml` via feedback tools; `WORK.history.yaml` via stage finalization |
| `assay` | Flow memory via `foundry_assay_run` (not direct `foundry_memory_put`); marks the workfile failed on abort (no feedback writes) |

Input artefacts (files matching an input type's `file-patterns`) are read-only. Files outside any artefact type's patterns are read-only. Violations hard-stop the cycle with `{error: 'unexpected_files'}`.

### Failed flow state

When an unrecoverable error occurs (e.g. assay extractor abort, memory-sync failure), the orchestrator marks `WORK.md` frontmatter with `status: failed` and a `reason`. The flow is then locked:

- **Blocked tools.** All mutation tools refuse to run and return an error referencing the failure reason:
  - **Lifecycle:** `foundry_stage_begin`, `foundry_orchestrate`, `foundry_workfile_create`, `foundry_artefacts_set_status`
  - **Stage work:** `foundry_assay_run`, `foundry_validate_run`
  - **Feedback writes:** `foundry_feedback_add`, `foundry_feedback_action`, `foundry_feedback_wontfix`, `foundry_feedback_resolve` (`foundry_feedback_list` remains callable)
  - **Appraiser selection:** `foundry_appraisers_select`
  - **Memory writes:** `foundry_memory_put`, `foundry_memory_relate`, `foundry_memory_unrelate`
  - **Memory admin:** `foundry_memory_init`, `foundry_memory_reset`, `foundry_memory_vacuum`, `foundry_memory_change_embedding_model`, `foundry_memory_create_entity_type`, `foundry_memory_create_edge_type`, `foundry_memory_rename_entity_type`, `foundry_memory_rename_edge_type`, `foundry_memory_drop_entity_type`, `foundry_memory_drop_edge_type`, `foundry_extractor_create` (read-only `foundry_memory_validate` and `foundry_memory_dump` remain callable)
  - **Config schema mutation:** `foundry_config_create_artefact_type`, `foundry_config_create_law`, `foundry_config_create_appraiser`, `foundry_config_create_flow`, `foundry_config_create_cycle` (read-only `foundry_config_validate_*` remain callable)
- **Escape hatches.** `foundry_workfile_get` (to read the reason) and `foundry_workfile_delete({confirm: true})` (to abandon the cycle) remain callable. `foundry_git_finish` sits outside the failed-flow guard, allowing the user to exit the failed branch.
- **Recovery.** Read the reason via `foundry_workfile_get`, fix the root cause, then either call `foundry_stage_retry()` to clear the failed state and re-run the blocked stage, or abandon the cycle with `foundry_workfile_delete({confirm: true})` and start again.

All pipeline skills (`orchestrate`, `flow`, stage skills) check for this state at the top of their procedure and hand control back to the user immediately if found.

---

## Routing and feedback lifecycle

### Sort routing

`src/scripts/sort.js` (exported as `runSort`) owns the routing engine. It reads `WORK.md`, `WORK.feedback.yaml`, and `WORK.history.yaml`, then decides which stage runs next based on:

- **Unresolved feedback.** If `quench` or `appraise` feedback exists in a non-terminal state (`open`, `actioned`, `wont-fix`), the next stage is usually `forge` or the originating evaluation stage.
- **Deadlock detection.** If the same feedback items ping-pong between forge and appraise for `deadlock-iterations` (default 5) iterations, sort marks them `deadlocked` and inserts a `human-appraise` stage (if `deadlock-appraise: true`, the default).
- **Iteration limits.** If `max-iterations` is exceeded, the cycle is marked `blocked` and control returns to the user.
- **Clean state.** If all feedback is resolved and no new validation or appraisal failures exist, the cycle is `done`.

### Feedback state machine

Feedback items live in `WORK.feedback.yaml` with a full transition history. Each item has:

- `id` — a ULID.
- `source` — the stage that created it (e.g. `quench:check-syllables`, `appraise:pedantic`, `human-appraise:hitl`).
- `state` — current state (`open`, `actioned`, `wont-fix`, `resolved`, `rejected`, `deadlocked`).
- `history` — append-only log of state transitions with timestamps and metadata.

Transitions are **source-based**:

| Source stage | Forge can `wont-fix`? | Resolved by |
|--------------|------------------------|-------------|
| `quench` (CLI validation) | No — must `actioned` | the originating `quench` stage, or `human-appraise` override |
| `appraise` (subjective law) | Yes (with reason) | the originating `appraise` stage, or `human-appraise` override |
| `human-appraise` (user instruction) | No — must `actioned` | the originating `human-appraise` stage |

Implementation: `src/scripts/lib/feedback-transitions.js` and `src/scripts/lib/feedback-store.js`. See [work-spec.md](work-spec.md) for the full state machine table.

---

## Multi-model routing

Different stages can run on different models for cognitive diversity. Cycle definitions specify per-stage models; individual appraisers may override.

### Configuration

- **Cycle-level.** Declare a `models` map in the cycle frontmatter:
  ```yaml
  models:
    forge: anthropic/claude-opus-4.7
    appraise: openai/gpt-5
  ```
- **Appraiser-level.** Individual appraisers can declare a `model` field in their personality definition; this overrides the cycle-level appraise model on a per-appraiser basis.

### Agent files

`refresh-agents` generates a `foundry-<slug>.md` agent file in `.opencode/agents/` for every model available in the session, where `<slug>` is the model ID with both `/` and `.` replaced by `-` (e.g. `anthropic-claude-opus-4-7.md`).

### Dispatch behaviour

- **Non-appraise stages** (forge, quench, assay): if the cycle declares `models.<stage>`, the orchestrator dispatches to `foundry-<slug>` and hard-fails if `.opencode/agents/foundry-<slug>.md` is missing. If `models.<stage>` is not set, the stage is dispatched with the `general` subagent (session default).
- **Appraise stage**: each appraiser is dispatched independently by the `appraise` skill. If an appraiser has its own `model`, the skill dispatches to `foundry-<slug>` and hard-fails if that agent file is missing; otherwise the appraiser runs under the `general` subagent.

Implementation: `src/plugin/tools/helpers.js` (`buildCyclePromptExtras`) and `src/skills/appraise/SKILL.md`.

---

## Project layout

### Package (this repo)

```
@really-knows-ai/foundry
├── src/
│   ├── plugin/
│   │   ├── foundry.js          # plugin entrypoint: skills + 64 custom tools
│   │   └── tools/              # tool registration + plugin helpers
│   ├── skills/                 # shipped skill definitions
│   │   ├── flow/               # pipeline
│   │   ├── orchestrate/
│   │   ├── forge/
│   │   ├── quench/
│   │   ├── appraise/
│   │   ├── human-appraise/
│   │   ├── init-foundry/       # authoring
│   │   ├── add-artefact-type/
│   │   ├── add-law/
│   │   ├── add-appraiser/
│   │   ├── add-cycle/
│   │   ├── add-flow/
│   │   ├── add-extractor/
│   │   ├── list-agents/        # utility
│   │   ├── refresh-agents/
│   │   ├── upgrade-foundry/
│   │   ├── init-memory/        # memory
│   │   ├── add-memory-entity-type/
│   │   ├── add-memory-edge-type/
│   │   ├── rename-memory-entity-type/
│   │   ├── rename-memory-edge-type/
│   │   ├── drop-memory-entity-type/
│   │   ├── drop-memory-edge-type/
│   │   ├── reset-memory/
│   │   └── change-embedding-model/
│   └── scripts/
│       ├── lib/                # shared libraries (injectable I/O)
│       │   ├── workfile.js     # WORK.md frontmatter
│       │   ├── artefacts.js    # artefact table operations
│       │   ├── history.js      # WORK.history.yaml operations
│       │   ├── feedback-store.js
│       │   ├── feedback-transitions.js
│       │   ├── finalize.js     # stage finalization
│       │   ├── stage-guard.js
│       │   ├── branch-guard.js
│       │   ├── foundational-guards.js
│       │   ├── guards.js
│       │   ├── token.js
│       │   ├── secret.js
│       │   ├── pending.js
│       │   ├── state.js
│       │   ├── config.js       # foundry/ config readers
│       │   ├── slug.js
│       │   ├── ulid.js
│       │   ├── tracing.js
│       │   ├── failed-flow.js
│       │   ├── git-bridge.js
│       │   ├── git-policy.js
│       │   ├── assay/
│       │   ├── config-creators/
│       │   ├── config-validators/
│       │   ├── snapshot/
│       │   └── memory/         # flow memory (Cozo 0.7)
│       ├── orchestrate.js      # orchestration loop (exports runOrchestrate)
│       └── sort.js             # routing engine (exports runSort)
├── scripts/
│   └── build.js                # builds src/ into dist/
├── dist/
│   ├── .opencode/plugins/      # packaged plugin output
│   ├── skills/                 # packaged skill output
│   └── scripts/                # packaged runtime libraries
├── tests/                      # node:test suite
├── docs/                       # concepts, getting-started, work-spec
├── CHANGELOG.md
└── README.md
```

### User project (after `init-foundry`)

```
your-project/
├── foundry/
│   ├── flows/                  # flow definitions
│   ├── cycles/                 # cycle definitions
│   ├── artefacts/              # artefact type definitions
│   │   └── <type>/
│   │       ├── definition.md
│   │       ├── laws.md         # optional
│   │       └── validation.md   # optional
│   ├── laws/                   # global laws
│   ├── appraisers/             # appraiser personalities
│   └── memory/                 # optional flow memory config (init-memory)
│       ├── config.md
│       ├── schema.json
│       ├── entities/<type>.md
│       ├── edges/<name>.md
│       ├── extractors/<name>.md
│       └── memory.db*          # gitignored
├── foundry-memory/             # flow memory row data (top-level sibling)
│   └── relations/<type>.ndjson
├── .foundry/                   # runtime state (gitignored)
│   └── .secret                 # per-worktree HMAC key (mode 0600)
├── .opencode/
│   └── agents/
│       └── foundry-*.md        # generated by refresh-agents
├── opencode.json
└── ...
```

During a flow, a work branch also contains `WORK.md`, `WORK.feedback.yaml`, and `WORK.history.yaml` at the repo root. These are ephemeral work state; they are deleted before the squash-merge completes.

---

## Further reading

- [concepts.md](concepts.md) — every concept defined concisely.
- [work-spec.md](work-spec.md) — the full WORK.md + WORK.feedback.yaml + WORK.history.yaml spec.
- [memory-maintenance.md](memory-maintenance.md) — contributor notes on Cozo 0.7 and memory session lifecycle.
- [tools.md](tools.md) — full reference for all 64 custom tools.
- [getting-started.md](getting-started.md) — end-to-end walkthrough.
