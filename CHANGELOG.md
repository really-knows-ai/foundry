# Changelog

## [3.5.1] - 2026-05-22

### Fixed

- Run CI against the active Node release lines: 22.x, 24.x, 25.x, and 26.x.
- Use Node 22-compatible `mock.module({ namedExports })` test mocks.

## [3.5.0] - 2026-05-22

### Changed

- Add branch-based artefact discovery with `getArtefactFiles` and git change-state tracking.
- Remove the `WORK.md` artefact table, artefact registration side effects, and per-artefact status updates.
- Update quench, appraise, orchestration, plugin tools, and attestation to use branch artefact discovery.
- Remove `foundry_artefacts_set_status` and update `foundry_artefacts_list` to return `{file, state}` entries.
- Remove artefact table generation from new `WORK.md` files.
- Update tests and docs for branch artefact discovery.

### Fixed

- Include all non-deleted artefact files in missing-model violation payloads.
- Thread base-branch selection through artefact discovery contexts.

## [3.4.0] - 2026-05-20

### Changed

- **Quench runs as an internal orchestrator module.** Quench no longer
  dispatches an LLM subagent — it runs validators directly within the
  orchestrator, posting feedback and resolving prior items without any
  model involvement. A single `foundry_orchestrate` call handles the
  full quench stage inline.
- **Appraise dispatch moves into the orchestrator.** Instead of
  dispatching a single appraise subagent that can't use `task`, the
  orchestrator gathers context internally, returns a `dispatch_multi`
  action with pre-built prompts, and the LLM dispatches individual
  appraiser subagents in parallel. After dispatch, the orchestrator
  consolidates results internally — unioning, de-duplicating, and
  posting feedback — all within the `foundry_orchestrate` loop.
- **New `dispatch_multi` action and `lastResults` input.** The
  `foundry_orchestrate` tool now returns `action: "dispatch_multi"`
  with `tasks: [{subagent_type, prompt}, ...]` and accepts
  `lastResults: [{ok, output?, error?}, ...]` for consolidating
  multi-dispatch results. Mutual exclusivity with `lastResult` is
  enforced.
- **Stage model fallback.** When a cycle's `models:` map omits a stage,
  the orchestrator falls back to the caller's `defaultModel`, then
  `models.default`, then any available model in the map.

### Added

- `src/scripts/quench-module.js` — `runQuench(ctx)` runs validators
  deterministically with no LLM.
- `src/scripts/appraise-module.js` — `gatherAppraiseContext(ctx)` and
  `consolidateAppraise(ctx, lastResults)` for multi-appraiser dispatch.
- `src/scripts/lib/validation.js` — extracted `performValidation` and
  related functions from `validate-tools.js`.
- `getArtefactsForCycle()` on `src/scripts/lib/artefacts.js`.
- `DISPATCH_MULTI_ACTION`, `validateDispatchMulti`, and
  `buildDispatchMultiResponse` on `orchestrate-cycle.js`.
- `guardLastResults()` and `dispatchByRoute()` in `orchestrate.js`.
- Defensive guards in `handleSortResult` for quench and appraise routes.
- Integration tests: `tests/orchestrate-quench.integration.test.js`,
  `tests/orchestrate-appraise.integration.test.js`,
  `tests/orchestrate-contract.test.js`.
- Unit tests: `tests/quench-module.test.js`, `tests/appraise-module.test.js`.

## [3.3.9] - 2026-05-19

### Fixed

- **Stage model fallback.** When a cycle's `models:` map omits a stage (e.g.,
  `quench`), the orchestrator now falls back to the caller's `defaultModel`,
  then `models.default`, then any available model in the map, instead of
  failing with a hard violation. `foundry_orchestrate` accepts an optional
  `defaultModel` arg for this purpose.
- **No-models-map fallback.** When the cycle has no `models:` block at all but
  `defaultModel` is provided, the orchestrator uses it — previously returned
  a violation.

## [3.3.8] - 2026-05-19

### Fixed

- **Build script now rewrites dynamic `import()` paths.** The `rewriteImports`
  function only handled static `from '...'` imports, missing `await import()`
  calls in `orchestrate-tool.js`. Added a second regex pass for dynamic imports.
- **New packaging test** verifies every relative import in `dist/` resolves.
- **add-flow now offers next steps after building.** After creating a flow on a
  `config/*` branch, the skill presents dry-run / merge / leave options instead
  of telling the LLM to auto-merge.

## [3.3.7] - 2026-05-18

### Fixed

- **Skills table in agent + file copying.** The Foundry agent lists all 27
  skills in an "Available Skills" table. The plugin also copies them to
  `.opencode/skills/` on every startup, making them loadable via the
  `skill` tool. Both pieces together ensure the LLM knows about the skills
  AND can load them.

## [3.3.6] - 2026-05-18

### Fixed

- **Foundry skills reference in agent.** The Foundry agent now lists all 27
  skills in an "Available Skills" table with their purposes and instructions
  on how to load them via the `skill` tool. The LLM can call
  `skill({name: "add-flow"})` etc. without needing them listed in the
  system prompt's `available_skills` section.

## [3.3.4] - 2026-05-18

### Fixed

- **Corrected law/validator framing across all skills and agent.** Laws are
  rules — they are never "deterministic" or "subjective." Validators are
  optional scripts attached to laws that check script-checkable elements
  during quench. Appraisers evaluate every law, de-prioritising elements
  already covered by passed validators. Removed all `[deterministic|subjective]`
  law labelling from add-flow's plan template and add-law's Understand phase.

## [3.3.3] - 2026-05-15

### Fixed

- **Foundry agent now follows the wizard protocol.** The agent instructions
  previously told the LLM to auto-create configuration ("instead of telling
  the user to invoke another skill"). Updated to load the relevant authoring
  skill first and follow Understand → Plan → Confirm → Build — never
  creating configuration without user confirmation.

## [3.3.2] - 2026-05-14

### Changed

- **All 15 creation and edit skills converted to an interactive wizard
  protocol.** Every skill now follows Understand → Plan → Confirm → Build
  instead of auto-creating configuration. The AI asks questions, presents a
  plan, waits for confirmation, then builds — no file is created before the
  user says yes.

  Skills converted:

  | Phase | Skills |
  |-------|--------|
  | Core config | `add-artefact-type`, `add-appraiser`, `add-law` |
  | Cycle and flow | `add-cycle`, `add-flow` (composite — invokes sub-skills with context) |
  | Memory creation | `add-extractor`, `add-memory-entity-type`, `add-memory-edge-type`, `init-memory` |
  | Memory edit/destructive | `rename-memory-entity-type`, `rename-memory-edge-type`, `change-embedding-model`, `reset-memory`, `drop-memory-entity-type`, `drop-memory-edge-type` |

- **Sub-skill composition via context object contract.** Parent skills (e.g.
  `add-flow`, `add-artefact-type`) pass pre-filled field objects to
  sub-skills (e.g. `add-law`, `add-cycle`). Sub-skills skip questions for
  provided fields and only ask for gaps. `add-flow` presents a single
  combined plan covering all dependencies and confirms once before building.
- **Destructive skills require typed confirmation.** `reset-memory` requires
  typing "reset"; `drop-*` skills show previews of affected rows and edges
  before requiring explicit confirmation.

## [3.3.1] - 2026-05-14

### Fixed

- **Appraiser tool description** now explicitly states that appraisers are
  personalities only — boundaries and constraints belong in laws. Prevents
  the AI from embedding criteria in appraiser descriptions that should be
  encoded as laws.
- **Validator command description** now mandates `.mjs` scripts and NDJSON
  stdout format (`file`, `text`, optional `location`/`severity`, exit code
  ignored). Prevents the AI from using inline bash/Python validators that
  don't produce machine-parseable output.
- **add-law skill** gains §2a: a deterministic-vs-subjective split step
  that walks the user through which law elements can be script-checked and
  which are left to appraisers. Includes guidance to prefer existing
  libraries over hand-rolled validation logic.
- **add-artefact-type skill** no longer carries validator guidance
  (validators are exclusively law-related, not artefact-type-related).

## [3.3.0] - 2026-05-14

### Added

- **Structured config tool signatures.** All six config creation and editing
  tools now accept typed, self-documenting fields instead of raw `body`
  strings containing YAML frontmatter. Each tool generates the correct
  markdown file internally from the provided fields. The AI no longer needs
  to hand-craft YAML frontmatter or reverse-engineer format from validation
  errors. Tool descriptions include field names and types.

  | Tool | New args |
  |------|----------|
  | `foundry_config_create_artefact_type` | `id`, `name`, `filePatterns`, `description`, `appraisers?` |
  | `foundry_config_create_appraiser` | `id`, `name`, `description`, `model?` |
  | `foundry_config_create_flow` | `id`, `name`, `startingCycles`, `description` |
  | `foundry_config_create_cycle` | `id`, `name`, `outputType` + 10 optional fields |
  | `foundry_config_add_law` | `id`, `name`, `description`, `passing`, `failing`, `target`, `validators?` |
  | `foundry_config_edit_law` | `id` + per-field optional updates |

  All five authoring skills updated to use the new signatures. Validate tools
  unchanged — they still accept `{ name, body }`.

### Changed

- **`tool-paths.js` resolves command paths from `PATH`.** `git` and `opencode`
  paths are resolved lazily and overridable via `FOUNDRY_GIT_PATH` /
  `FOUNDRY_OPENCODE_PATH` env vars. Removed `sonarjs/no-os-command-from-path`
  overrides for `foundry.js` and `agent-refresh.js`.

## [3.2.7] - 2026-05-14

### Added

- **Git repo initialisation during bootstrap.** If the worktree has no
  `.git` directory, Foundry now runs `git init`, `git add .`, and
  `git commit` after creating the initial directory structure. Projects
  start with a clean initial commit of the generated configuration.
- **Tool path resolution from PATH.** A new `tool-paths.js` module
  resolves `git` and `opencode` from `PATH` on each call instead of
  executing bare command names. Overridable via `FOUNDRY_GIT_PATH` and
  `FOUNDRY_OPENCODE_PATH` environment variables. Removed
  `sonarjs/no-os-command-from-path` lint overrides for `foundry.js`
  and `agent-refresh.js`.

### Changed

- **`.foundry/` added to default `.gitignore`.** The runtime state
  directory was previously created but not ignored by default.

## [3.2.6] - 2026-05-14

### Fixed

- **Bootstrap context messages confused the AI.** The injected `FOUNDRY_CONTEXT`
  messages were written as direct user instructions ("Restart OpenCode..."),
  but the AI reads them as system context and interprets them as commands to
  itself. Rewritten as AI-facing framing: "Tell the user to restart...",
  "The user should switch to the Foundry agent...".

## [3.2.5] - 2026-05-14

### Changed

- **Startup flow simplified to "hello foundry".** Removed the TUI client
  retry approach for startup messages. Users now type **hello foundry**
  after restarting; the AI reads the injected `FOUNDRY_CONTEXT` and responds
  with restart instructions or readiness confirmation. This replaces the
  silent double-restart dance.
- **E2E tests no longer depend on Python or `dd`.** The SIGTERM trap test
  now uses shell builtins (`trap`/`echo`/`while`). The output cap tests use
  small Node.js scripts instead of `dd` piped to `tr`. Tests are faster and
  have no external dependencies.
- **Install docs updated** (`README.md`, `docs/getting-started.md`) to
  reflect the "hello foundry" flow.

## [3.2.4] - 2026-05-14

### Fixed

- **Bootstrap error in cached npm installs.** The `packageRoot` was resolved
  from `__dirname` using a hardcoded relative path (`../..`) that only worked
  in the source tree. In the dist tree (`dist/.opencode/plugins/`), the same
  path resolved to `dist/` instead of the package root, causing
  `ENOENT: package.json` errors. The resolution now walks up from `__dirname`
  until it finds `package.json`.

## [3.2.3] - 2026-05-14

### Fixed

- **Config hook blocked startup waiting for TUI client.** `showStartupMessage`
  was awaited in the config hook, and its `retryUntilReady` loop could block
  opencode startup for up to 30 seconds if the TUI client wasn't immediately
  available. The call is now fire-and-forget: the config hook returns
  immediately, and the message either shows within the 3-second retry window
  or falls back to the `messages.transform` hook.

## [3.2.2] - 2026-05-14

### Added

- **Immediate startup feedback via TUI.** Instead of waiting for the first
  user prompt to inject the Foundry context message, the config hook now
  shows feedback immediately. When a restart is needed, the message is
  appended directly to the prompt bar via `client.tui.appendPrompt`. When
  Foundry is already active, a non-intrusive toast notification confirms
  readiness via `client.tui.showToast`. The `messages.transform` hook
  remains as a fallback for AI context injection.
- **Injectable timer for startup retry logic.** `retryUntilReady` accepts
  injectable `sleep`, `now`, and `maxMs` functions so tests can control
  timing without real delays. `showStartupMessage` bails early when the
  TUI client is unavailable to avoid hanging in environments without a
  client.

## [3.2.1] - 2026-05-14

### Fixed

- **Plugin hangs on startup due to infinite recursion.** The config hook's
  `refreshAgents` call spawns `opencode models` via `execFileSync`. When the
  project directory has the foundry plugin configured, the child process
  loads plugins too, triggering another `opencode models` — infinite
  synchronous recursion that hangs the parent. The plugin now sets
  `FOUNDRY_SKIP_BOOTSTRAP=1` in the child process environment and skips the
  bootstrap in the config hook when that variable is set.

## [3.2.0] - 2026-05-14

Plugin auto-bootstrapping release. Foundry now ensures the guide agent is
present on every plugin load and deletes the now-redundant `init-foundry`
skill. The project also ships a publish-release skill and documented
workflows for plans and git worktrees.

### Added

- **Bootstrap logic** (`src/plugin.js`). On every `detectChanges` call,
  Foundry ensures the guide agent file (`foundry.md`) exists in
  `.opencode/agents/`, running the same deterministic agent-refresh path
  that the `foundry_refresh_agents` tool uses. If the guide agent is
  newly created, a post-install restart message is injected into the
  detection context.
- **`publish-release` skill** (`.opencode/skills/publish-release/`). A
  workflow skill that commits loose changes, runs the quality gate,
  bumps the version, updates the changelog, tags, pushes, and publishes
  to npm.

### Changed

- **`init-foundry` skill removed.** The manual installation step is
  replaced by deterministic auto-bootstrapping on plugin load.
  `init-foundry` was the last on-ramp skill; new users no longer need
  to run any skill after `pnpm add`.
- **Shared agent-refresh utility extracted** (`src/lib/agent-refresh.js`).
  The deterministic agent generation logic that lived in
  `scripts/tools/foundry_refresh_agents.js` is now a shared module,
  consumed by both the tool and the `detectChanges` bootstrap path.
- **Phase reviews run in parallel** with partitioned iteration via
  parallel implementer agents.
- **Implementer agent model** updated to `deepseek-v4-flash`.

### Fixed

- **Guide agent now always present after `detectChanges`.** Previously
  the guide agent could be absent until `init-foundry` or
  `foundry_refresh_agents` was explicitly run.
- **Guide agent preserved during `foundry_refresh_agents`.** The refresh
  tool now ensures `foundry.md` is generated alongside stage agents,
  not just preserved.

### Docs

- Git worktrees in `.worktrees/` directory documented.
- Plans directory workflow and phased planning skills documented.

## [3.1.0] - 2026-05-11

The Foundry guide agent release. Foundry now ships a user-facing agent that
routes configuration authoring through Foundry concepts — users ask the Foundry
agent for outcomes, and the agent composes dependent work internally rather than
handing users a chain of individual tools and skills.

### Added

- **Foundry guide agent** (`src/agents/foundry.md`). A user-facing agent with
  identity marker *"You are the Foundry agent"* that maps user requests to
  Foundry concepts, routes through the standard config-branch workflow, and
  delegates to authoring skills internally.
- **`foundry_refresh_agents` tool.** Deterministic stage-agent generation: runs
  `opencode models`, deletes stale `.opencode/agents/foundry-*.md` files, and
  writes fresh agent files — one per available model. Replaces the prior
  skill-only protocol where the LLM had to implement the logic with shell
  commands.
- **`init-foundry` installs the guide agent.** Step 5 creates
  `.opencode/agents/foundry.md` (preferring `dist/agents/foundry.md`, falling
  back to `src/agents/foundry.md`), then instructs the user to restart OpenCode
  and switch to the Foundry agent.
- **Comprehensive guidance audit tests.** `tests/skills/foundry-guidance-audit.test.js`
  (357 lines) and `tests/skills/authoring-guidance.test.js` (45 lines) enforce
  that skills avoid dead-end delegation patterns, route through the Foundry
  agent, keep internal tool-call syntax out of normal user guidance, and handle
  config branches and dependencies internally.
- **Packaging test** (`tests/plugin/packaging.test.js`). Verifies the published
  package ships `dist/agents/` so `init-foundry` can locate the guide agent
  template in a packaged install.

### Changed

- **Authoring skills reworked around the Foundry agent.** `add-flow`,
  `add-cycle`, `add-artefact-type`, `add-law`, and `add-appraiser` now include a
  `## Foundry Agent Preflight` section; and frame user requests as Foundry
  outcomes, compose missing dependencies internally in validation order, and
  hide internal tool-call syntax from normal user guidance (`foundry_git_branch`,
  `foundry_git_finish`, `foundry_config_create_*`).
- **Memory/config skills handle branches and dependencies internally.**
  `init-memory`, `reset-memory`, `add-memory-entity-type`, `add-memory-edge-type`,
  `add-extractor`, and the `rename-memory-*` / `drop-memory-*` /
  `change-embedding-model` skills no longer tell the user to create config
  branches or run prerequisite skills. All use *"move to a suitable `config/*`
  branch internally when the current branch is safe"* with `work/*` /
  `dry-run/*/*` / uncommitted-change guards.
- **`add-extractor` composes cycle wiring internally.** The skill updates
  relevant cycle definitions rather than presenting manual frontmatter editing
  as the normal outcome.
- **`add-cycle` hides generated stage-agent files.** Model selection guidance
  now references *"Available session models are listed in your session
  configuration"* instead of exposing `.opencode/agents/foundry-*.md`.
- **Existing-file recovery keeps the agent in the loop.** When
  `foundry_config_create_*` returns `{ ok: false }` because the target file
  already exists, `add-artefact-type`, `add-appraiser`, `add-law`, and
  `add-cycle` now read the existing content, incorporate the user's requested
  changes, propose the merged result, and commit — rather than telling the user
  to *"edit by hand."*
- **Bootstrap context** (`helpers.js`) presents capabilities as Foundry
  outcomes (*"ask the Foundry agent to add flow memory"*, *"ask the Foundry
  agent to run that flow"*) instead of listing internal skills.
- **`getting-started.md` reworked.** The walkthrough now routes through the
  Foundry agent, removes direct `foundry_git_branch({` /
  `foundry_git_finish({` / `Run \`add-*\`` / `foundry_config_validate_*({` /
  `foundry_config_create_*({` references, and uses `pnpm add -D
  @really-knows-ai/foundry`.
- **`README.md` quick-start** updated for the install → init → ask-agent
  workflow (`pnpm add -D @really-knows-ai/foundry`, ask the Foundry agent
  to add a haiku flow).
- **`refresh-agents` skill** delegates to `foundry_refresh_agents()`. The skill
  is now a thin wrapper around the deterministic tool.
- **`init-foundry`, `list-agents`, `sort.js`, `upgrade-foundry`** updated to
  reference the `foundry_refresh_agents` tool.
- **Docs** (`architecture.md`, `concepts.md`, `tools.md`) updated to reference
  guide-agent installation and the refresh tool. Tool count increased from 66 to
  67.

### Fixed

- **`dist/agents/` added to the published package.** The build script already
  copied `src/agents/` to `dist/agents/`, but the `files` array in
  `package.json` excluded `dist/agents/`. `init-foundry` can now locate the
  guide agent template in a packaged install.
- **`foundry_refresh_agents` preserves the guide agent.** Only
  `foundry-*.md` stage agents are regenerated; `.opencode/agents/foundry.md`
  survives refresh.

## [3.0.3] - 2026-05-11

A patch release that makes agent-file generation deterministic by moving
`refresh-agents` from a skill-only protocol into a tested plugin tool.

### Added

- **`foundry_refresh_agents` tool.** Runs `opencode models`, deletes stale
  `.opencode/agents/foundry-*.md` files, and generates fresh agent files — one
  per available model. The tool is idempotent, handles missing directories, and
  returns `{ ok: true, count: <n> }` on success. This replaces the prior
  skill-only protocol where the LLM had to implement the logic with shell
  commands, which was error-prone and non-deterministic.

### Changed

- **`refresh-agents` skill** now simply calls `foundry_refresh_agents()` and
  reports the result.
- **`init-foundry` skill** step 4 now calls `foundry_refresh_agents()` instead
  of instructing the LLM to run the `refresh-agents` skill.
- **`list-agents` skill** error message now references the tool.
- **`sort.js`** missing-agent error now references the tool.
- **`helpers.js`** bootstrap message now references the tool.
- **Docs** (`tools.md`, `getting-started.md`, `architecture.md`, `concepts.md`)
  updated to reference the tool. Tool count increased from 65 to 66.

## [3.0.2] - 2026-05-11

A documentation and tool-correctness patch driven by a failing
haiku-flow setup session. Closes the loop on the laws-with-validators
migration: the validator contract is now fully documented in
`add-law`; the `add_law` tool appends additional laws to an existing
file and rolls back its file write when the commit fails;
`init-foundry` seeds a `node_modules/` ignore so npm-installed
validator dependencies never collide with the config-tier write
guard.

### Validator contract is canonical in `add-law`

- `add-law` SKILL.md gains a **§7a. Validator contract** that covers
  the JSONL output shape (`file`, `text` required; `location`,
  `severity` optional), command placeholders, working directory, skip
  rule, and a worked Node example. Authors no longer need to read
  plugin source to write a validator.
- `add-artefact-type` step 5 drops its half-duplicate contract and
  cross-references `add-law` §7a. Step 1 and step 4 now make clear
  that the frontmatter `name:` field equals the artefact type's id
  (lowercase, hyphenated); human-readable labels go in the
  `## Definition` prose. Step 9 reflects the new append-aware
  `add_law`.

### Validator command placeholders split

- `{pattern}` now renders the artefact type's `file-patterns:` as
  space-separated, shell-quoted globs (e.g.
  `'haikus/*.md' 'drafts/*.md'`). Use it when a validator does its
  own globbing or accepts globs directly (e.g. `rg --glob`).
- `{files}` renders the matching files in the worktree as
  space-separated, shell-quoted paths. Use it when the validator
  takes an explicit list of file paths.
- A validator is skipped iff its command contains `{files}` and there
  are no matching files. `{pattern}`-only and verbatim commands
  always run.
- **Migration:** any existing validator authored against the prior
  semantics (where `{pattern}` substituted expanded paths) must be
  updated to use `{files}` instead. Foundry was tagged 3.0.1 only
  12 hours before this release; no migration helper is provided.

### `foundry_config_add_law` correctness

- The tool now appends a new law to an existing `laws.md` instead of
  erroring on file-exists. It only errors when a law with the same
  id is already present in the file — in that case the caller
  switches to `foundry_config_edit_law`.
- File writes are atomic with the commit. If the commit fails (most
  commonly `unexpected_files`), the tool restores `laws.md` to its
  prior content (or deletes it if it didn't exist before the call).
  This eliminates the orphaned-file state that previously broke the
  next call with "already exists".

### `init-foundry` seeds `node_modules/`

- `.gitignore` now starts with `.snapshots/`, `node_modules/`, and
  `.DS_Store`. The new entry stops `npm install` from immediately
  blocking every config-tier tool with `unexpected_files`.

### Migration

- Update any validator commands that used `{pattern}` for file
  expansion to use `{files}` instead.
- No action needed for projects already on 3.0.1 that have not yet
  authored validators using `{pattern}`.
- Existing projects can add `node_modules/` to `.gitignore` by hand;
  the `init-foundry` change only affects newly-initialised projects.

## [3.0.1] - 2026-05-11

A documentation and cleanup patch. No runtime behaviour change. `quench`
already read deterministic checks via `getLawsForQuench`; this release
aligns the authoring skills, end-user docs, and source tree with that
reality and removes the deprecated `validation.md` reader path.

### Authoring skills now teach laws-with-validators

- `add-artefact-type` folds deterministic checks into laws via the
  optional `validators:` block. The skill walks the user through laws
  and their validators in a single step; the previously separate
  "Validation" step is gone.
- `upgrade-foundry` describes type-specific laws (with validators where
  applicable) instead of standalone "validation commands".
- The `validators:` YAML shape in `add-artefact-type` is now identical
  to the canonical shape in `add-law`.

### Documentation

- `docs/architecture.md`, `docs/concepts.md`, `docs/getting-started.md`,
  and `docs/work-spec.md` drop every reference to `validation.md` and
  describe `quench` as running validators declared inside laws.
- The `quench` stage is now correctly documented as included iff any
  applicable law declares validators.

### Internal cleanup

- Remove the deprecated `getValidation` and `parseValidationLines`
  exports from `src/scripts/lib/config.js`, plus their six private
  helpers. Nothing in production called them; `quench` reads via
  `getLawsForQuench`.
- Remove the `describe('getValidation', …)` test block and three inert
  `validation.md` fixtures from the orchestrate integration tests.

### Migration

No action required for projects that already use laws-with-validators.
Projects still carrying a `foundry/artefacts/<type>/validation.md` file
have been carrying dead weight since the move to `getLawsForQuench`;
the file is now safe to delete by hand, or `upgrade-foundry` will
rebuild the configuration through the current tools.

## [3.0.0] - 2026-05-10

A consolidation release covering every change since v2.4.2. Foundry 3.0.0
restructures the branch model into three explicit kinds (`config/*`,
`work/*`, `dry-run/*/*`), introduces deterministic attestation, replaces
the markdown-parsed feedback section with a typed YAML store, adds the
assay pre-forge stage and the flow-memory subsystem, unifies law
authoring around a JSONL-validator model, and adds a verbose tracing /
forensic-snapshot loop for dry-runs. The work was developed across what
were originally numbered as 2.5.0, 2.6.0, 2.7.0, and 3.0.0 internal
milestones; only 3.0.0 is being released. Where an intermediate
milestone introduced a feature and a later milestone modified it, this
entry documents the 3.0.0 end-state only.

### Branch-model breaking changes

- **`foundry_git_branch` requires explicit `kind`.** The previous
  `{ flowId, description }` signature is removed. Callers must now pass
  `kind: 'config' | 'work' | 'dry-run'`. Per-kind requirements:
  `kind: 'config'` needs `description` and a non-`config/*`,
  non-`work/*` starting branch; `kind: 'work'` needs `flowId`,
  `description`, and a non-`config/*`, non-`work/*` starting branch;
  `kind: 'dry-run'` needs `flowId`, `description`, and the operator
  must already be on a `config/<x>` branch. `flowId` is invalid for
  `kind: 'config'`.
- **`foundry_git_finish` dispatches on the current branch prefix.**
  `work/<x>` retains existing semantics (squash-merge plus WORK
  cleanup); `config/<x>` is new (squash-merge, no WORK cleanup);
  `dry-run/<x>/<y>` writes a forensic snapshot under `.snapshots/`
  on the parent `config/<x>` working tree and force-deletes the
  dry-run branch (see "Dry-run finish writes a forensic snapshot"
  below). Any other branch is refused with "nothing to finish".
  `baseBranch` is rejected for dry-run finish (the parent config
  branch is encoded in the dry-run branch name).
- **Dry-run namespace is `dry-run/<parent>/<flowId>-<desc>`, not
  nested under `config/<parent>`.** Originally specified as
  `config/<x>/dry-run/<y>`; git refuses to coexist a parent ref with
  a child-prefixed ref, so the namespace is a flat sibling instead.
- **Schema/config mutation now requires a `config/*` branch.**
  Affected tools: `foundry_config_create_artefact_type`,
  `_create_appraiser`, `_create_flow`, `_create_cycle`,
  `foundry_config_add_law`, `foundry_config_edit_law`,
  `foundry_memory_create_entity_type` / `_create_edge_type` /
  `_rename_entity_type` / `_rename_edge_type` / `_drop_entity_type` /
  `_drop_edge_type`, `foundry_extractor_create`, `foundry_memory_init`,
  `foundry_memory_reset`, `foundry_memory_change_embedding_model`. All
  refuse on any branch other than `config/<description>`.
- **Flow-data mutation now requires a `work/*` or `dry-run/*/*`
  branch.** Affected tools: `foundry_orchestrate`,
  `foundry_workfile_create` / `_delete`, `foundry_artefacts_set_status`,
  `foundry_feedback_*` (mutating variants), `foundry_assay_run`,
  `foundry_validate_run`, `foundry_appraisers_select`,
  `foundry_stage_begin` / `_end` / `_retry`, `foundry_memory_put` /
  `_relate` / `_unrelate`.

### Attestation, dry-run, and snapshot breaking changes

- **`foundry_git_finish` on `work/*` refuses without ATTEST.md at HEAD.**
  Work-branch merges are gated on a deterministic attestation commit
  produced by `foundry_attest`. Operators must run `foundry_attest`
  with `confirm: true` before finishing a work branch.
- **Dry-run finish writes a forensic snapshot.** `foundry_git_finish`
  on a `dry-run/<x>/<y>` branch writes `.snapshots/<run-id>/` on the
  parent `config/<x>` working tree (containing `README.md`,
  `work/WORK*`, `diff.patch`, `trace.jsonl`) and force-deletes the
  dry-run branch. No merge, no commit.
- **`.snapshots/` is a new gitignored top-level directory.** It
  appears in projects only after the first dry-run finish. Snapshots
  are local operator artefacts and never committed by foundry.
- **Verbose tool-call tracing on dry-run branches.** Every `foundry_*`
  tool call (except `foundry_orchestrate`, which uses inline guards)
  appends a JSONL record to `.foundry/trace/<branch-slug>.jsonl` while
  on a dry-run branch. The trace is truncated when the dry-run branch
  is created and copied into the snapshot at finish.

### Feedback and state-machine breaking changes

- **Feedback storage moved from markdown to YAML.** The `## Feedback`
  section in `WORK.md` is removed. Feedback items now live in
  `WORK.feedback.yaml` with full transition history per item. Any
  legacy `## Feedback` content in an old `WORK.md` is inert text:
  not parsed, not deleted, not written to.
- **Feedback tools switch from `{ file, index }` to `{ id }`
  addressing.** `foundry_feedback_add` drops the `stageBase?`
  argument (source is read from the active stage).
  `foundry_feedback_list` response shape is now
  `{ id, file, tag, text, source, state, depth, reason? }`. Item ids
  are ULIDs.
- **Feedback state machine expands from 4 states to 6:** `open |
  actioned | wont-fix | rejected | deadlocked | resolved`. `approved`
  is renamed to `resolved` internally; the public resolve tool still
  accepts `resolution: 'approved' | 'rejected'` as input.
- **Deadlock detection is per-item.** Each item's depth in its own
  transition history is checked against `deadlock-iterations`. Items
  freshly added in the threshold-th iteration are never auto-deadlocked.
- **Source-authorship rule.** Only the stage that created a feedback
  item can resolve or reject it. `human-appraise` has universal
  override authority — it may transition any non-resolved item to any
  legal target state regardless of source.
- **Assay rejected as a feedback source.** `foundry_feedback_add`
  and `WORK.feedback.yaml` refuse `source: 'assay'`. Assay failures
  surface as a hard flow failure (see Assay breaking changes below).

### Cycle and artefact-type breaking changes

- **Cycle frontmatter key renamed: `output:` → `output-type:`.** The
  orchestrator no longer reads `output:`. Cycle definitions in
  `foundry/flows/*/cycles/*.md` must use `output-type:` to declare
  the artefact-type id the cycle produces. Unmigrated cycles yield a
  hard violation pointing to the upgrade skill.
- **Artefact-type frontmatter `output:` is removed.** The field had
  zero runtime consumers — forge's write scope is governed by
  `file-patterns`, and `file-patterns` legitimately spans multiple
  directories, so a single `output:` (or earlier-proposed
  `output-dir:`) could not honestly describe artefact location.
  Stale `output:` entries are harmless but should be deleted.

### Assay and memory breaking changes

- **Assay extractor failure marks the workfile failed.** When an
  extractor exits non-zero, parses incorrectly, violates permissions,
  or times out, `foundry_assay_run` calls `markWorkfileFailed` and
  returns `{flow_failed: true, error, …}`. It does not file a
  `#validation` feedback item. Rationale: the failure cause (a
  project-authored script under `foundry/memory/extractors/`) lives
  outside any artefact's `file-patterns`, so forge has no way to act
  on assay-sourced feedback; the prior behaviour produced
  unsatisfiable state-machine items. Tooling that pattern-matched
  assay-sourced feedback must instead detect `flow_failed: true` on
  the assay-run response.
- **Memory NDJSON relations moved to `foundry-memory/relations/`.**
  Per-type row data (`<entity-type>.ndjson`, `<edge-type>.ndjson`)
  lives at the top-level `foundry-memory/relations/` directory,
  sibling to `foundry/`. The rest of the memory tree (`config.md`,
  `schema.json`, `entities/`, `edges/`, `extractors/`, the gitignored
  `memory.db*` runtime files) stays under `foundry/memory/`.
  Rationale: the relations directory is large, frequently rewritten,
  and benefits from being separable from the human-authored config.

### Law model breaking changes

- **Quench executes law-defined JSONL validators.** Each law in
  `foundry/laws/*.md` or `foundry/artefacts/<typeId>/laws.md` declares
  one or more validator commands in a fenced code block.
  `foundry_validate_run` executes them, parses their JSONL output, and
  returns per-item feedback (`{ lawId, validatorId, file, text,
  location?, severity? }`). The quench skill emits one
  `foundry_feedback_add` call per item tagged
  `law:<lawId>:<validatorId>`. Items whose `file` falls outside the
  artefact type's `file-patterns` are surfaced as `pattern-mismatch`
  errors rather than silently swallowed.
- **Law authoring split into `add` and `edit`.** There is no
  `foundry_config_create_law`; use `foundry_config_add_law` for new
  laws and `foundry_config_edit_law` to replace an existing law in
  place. `foundry_config_read_law` returns the full markdown for a
  single law by id, and `foundry_config_validate_law` runs schema
  validation against a candidate body without writing.

### Added

- **`foundry_attest`, `foundry_attestation_show`,
  `foundry_attestation_verify`.** Deterministic attestation
  primitives. `foundry_attest` verifies the current work cycle is
  complete (all required stages ran, no unresolved feedback, no
  blocked artefacts), writes a canonical-JSON ATTEST.md payload
  (cycle id, diff sha, stages, attestation tools, models), and
  commits it to the work branch. `foundry_attestation_show` and
  `_verify` read and re-verify an attestation after the fact. Takes
  `baseBranch` (optional, default `main`), `message` (required goal
  text), and `confirm` (must be `true` to write).
- **`foundry_stage_retry` tool.** Re-runs the last failed stage on a
  failed workfile without abandoning the cycle. Requires the
  workfile to be in `status: failed` and the cause to be transient
  (network, model error). Restores the active-stage token and clears
  the failed marker.
- **`foundry_config_create_*` tools** for the four kinds with a
  single-file canonical layout (artefact-type, appraiser, flow,
  cycle). Each produces one git commit per invocation on the current
  `config/*` branch. Updates (replacing an existing file) are not
  exposed as MCP tools for these kinds; operators edit by hand on
  the current `config/*` branch.
- **`foundry_config_validate_*` tools** for all five config kinds
  (artefact-type, law, appraiser, flow, cycle). Schema-only, no
  branch guard, callable from any branch. Authors iterate on a draft
  body, then call the corresponding `_create_*` or `_add_law` /
  `_edit_law` to commit.
- **`foundry_config_read_law` tool.** Reads a single law by id,
  returning its full markdown including the validators block. No
  branch guard.
- **`foundry_snapshot_*` tools.** `foundry_snapshot_list`, `_show`,
  `_delete`, `_prune` — programmatic inspection and cleanup of
  dry-run forensic snapshots. Allowed on every branch.
- **Assay stage.** A deterministic pre-forge stage that runs
  project-authored extractor scripts to populate flow memory before
  forge starts. Opt-in per cycle via `assay: { extractors: [...] }`
  in cycle frontmatter. Iteration-0-only. See
  [docs/concepts.md](docs/concepts.md#assay).
- **`foundry_assay_run` and `foundry_extractor_create` plugin tools.**
  `foundry_assay_run` executes the extractors declared by the active
  assay stage. `foundry_extractor_create` registers a new extractor
  definition at `foundry/memory/extractors/<name>.md`.
- **`add-extractor` skill.** Authoring loop for extractor definitions.
- **Flow memory subsystem.** A typed, graph-shaped knowledge store
  that persists across cycles. Entity types, edge types, and their
  prose briefs live in `foundry/memory/`; row data is committed as
  NDJSON under `foundry-memory/relations/`; the live database
  (`foundry/memory/memory.db*`) is gitignored and rebuilt on demand
  from the NDJSON files. Each cycle declares read/write permissions
  in its frontmatter (`memory: { read: [...], write: [...] }`). The
  dispatched stage prompt is augmented with a vocabulary block
  listing the entity/edge types and memory tools visible to that
  cycle.
- **20 memory tools.** `foundry_memory_{put,relate,unrelate,get,list,
  neighbours,query,search}` for read/write,
  `foundry_memory_{create,rename,drop}_{entity,edge}_type` for
  vocabulary management, `foundry_memory_{init,validate,reset,dump,
  vacuum,change_embedding_model}` for admin. Destructive operations
  (`_drop_*`) take an optional `confirm` — without it they return a
  preview of affected rows.
- **9 memory authoring skills.** `init-memory`,
  `add-memory-entity-type`, `add-memory-edge-type`,
  `rename-memory-entity-type`, `rename-memory-edge-type`,
  `drop-memory-entity-type`, `drop-memory-edge-type`, `reset-memory`,
  `change-embedding-model`.
- **Optional semantic search.** When `embeddings.enabled` is true in
  `foundry/memory/config.md`, entities are embedded on write against
  an OpenAI-compatible endpoint (default: local Ollama
  `nomic-embed-text`, 768 dims) and exposed via
  `foundry_memory_search`. Embeddings can be disabled; the graph
  still works without them.
- **`dry-run` skill.** Documents the
  config-edit → dry-run → finish → inspect-snapshot loop.
- **`WORK.feedback.yaml`.** First-class persistent record of every
  feedback item and its full transition history. Atomic writes via
  write-temp-then-rename.
- **`open_feedback` and `seq` on every `WORK.history.yaml` entry.**
  `open_feedback` records the count of open items at each tick; `seq`
  acts as a tiebreaker for same-millisecond timestamps.
- **Failed-flow guards on mutating tools.** `foundry_validate_run`
  and 11 mutating memory admin tools (`foundry_memory_init`,
  `_reset`, `_vacuum`, `_change_embedding_model`,
  `_create_entity_type`, `_create_edge_type`, `_rename_entity_type`,
  `_rename_edge_type`, `_drop_entity_type`, `_drop_edge_type`, and
  `foundry_extractor_create`) refuse on a failed workfile. Read-only
  memory tools (`_dump`, `_validate`) remain callable.
- **Deterministic orchestration.** `foundry_orchestrate` owns the
  sort → history → dispatch → finalize → history → commit loop in
  plugin code. Orphaned-stage detection: if `orchestrate` is called
  without `lastResult` while an active stage exists, returns
  `violation`.
- **Atomic stage tokens.** `foundry_stage_begin(stage, cycle, token)`
  consumes a single-use HMAC-signed token issued by `foundry_sort`;
  `foundry_stage_end(summary)` closes a stage preserving `baseSha`
  for finalize; `foundry_stage_finalize` verifies stage output
  against allowed file patterns and registers matching files as
  draft artefacts, rejecting stray writes with
  `{error: "unexpected_files", files: [...]}`.
- **`.foundry/` state directory** (gitignored) — holds `.secret`
  (per-worktree HMAC key, mode 0600), `active-stage.json` (present
  only during an active stage), `last-stage.json` (for finalize
  lookup), and `trace/` (dry-run JSONL traces).

### Changed

- **`foundry_memory_dump` response wrapped in a JSON envelope.** Now
  returns `{ dump: "<text>" }`, matching every other plugin tool's
  contract. Callers that previously consumed the raw string must
  read `.dump`.
- **`foundry_git_branch` errors return a JSON envelope.** Failures
  are returned as `{ error: "<message>" }`, giving callers a
  structured alternative to raw `execFileSync` errors.
- **`cozo-node` is now an optional dependency.** Foundry installs
  without it; the memory subsystem reports
  `"cozo-node is not installed on this platform"` if a memory tool
  is invoked. This unblocks installation on platforms without
  prebuilt cozo binaries.
- **Test suite split into unit, integration, and e2e tiers.** Run
  individually with `pnpm run test`, `pnpm run test:integration`,
  `pnpm run test:e2e`, or all together with `pnpm run test:all`.
  `pnpm run build:all` chains lint → test:all → build.
- **`prepublishOnly` runs `build:all`.** Publish is now gated on the
  full quality pipeline, not just `build`.

### Fixed

- **Stage-end memory sync failure is a hard flow failure.** When
  `foundry_stage_end` cannot flush the in-memory DB to the NDJSON
  source of truth, WORK.md is marked `status: failed` with the sync
  error as `reason`, and every mutating tool refuses until the cycle
  is abandoned via `foundry_workfile_delete`. Read-only tools and
  the escape hatches (`workfile_delete`, `git_finish`) remain
  callable. Skills driving each stage (`forge`, `quench`, `appraise`,
  `human-appraise`, `orchestrate`, `assay`, `flow`) were updated to
  check for the failed state at the top of their procedure and hand
  control back to the user. Previously, sync failures were silently
  swallowed and the live DB was allowed to drift ahead of on-disk
  NDJSON.
- **`foundry_orchestrate` catches `requireNotFailed` violations.**
  Moved the failed-flow check inside the wrapper try/catch so a
  malformed-frontmatter `YAMLException` collapses to
  `{action: 'violation'}` instead of an uncaught throw.
- **Missing artefact-type definitions surface a typed finalize error.**
  The orchestrator's finalize bridge now returns
  `{ok: false, error: "missing_artefact_type: <type> (<reason>)"}`
  when `getArtefactType` fails, preserving the real error and
  avoiding a false `unexpected_files` violation.
- **Atomic history writes.** `WORK.history.yaml` writes use
  write-temp-then-rename, closing observed incompleteness in the
  wild. Malformed history on read now marks the flow failed via
  `markWorkfileFailed`, allowing graceful recovery rather than
  silent corruption.
- **Validation results structured per item.** `foundry_validate_run`
  returns `{ ok, validatorsRun, items, errors }` with `items` as
  parsed JSONL entries and `errors` separating parse failures from
  pattern mismatches. Replaces the prior unstructured aggregate.

### Migration

Run the `upgrade-foundry` skill from a clean project state. Foundry
upgrades use a rebuild-style workflow: the skill preserves the
existing `foundry/` directory, initialises a clean current-version
configuration, analyses the preserved directory as source material,
and recreates supported concepts through current tools.

The skill asks clarifying questions for ambiguous flow routing, input
contracts, validation behaviour, memory settings, and deprecated
concepts. It does not migrate in-flight `WORK.md` state, feedback
state, branch state, or active flow execution. Complete or discard
active flows before upgrading.

Cycle definitions must rename `output:` to `output-type:`. Artefact-type
definitions should delete the `output:` line. Projects with a populated
memory store should `git mv foundry/memory/relations
foundry-memory/relations` before re-initialising; projects that have
not yet populated memory can simply re-run `foundry_memory_init` on a
fresh `config/*` branch. Pre-3.0.0 in-flight feedback in the markdown
`## Feedback` section is not auto-migrated: finish or discard
in-flight cycles before upgrading.

Projects with populated memory should validate memory before upgrading
so the preserved source material reflects committed state. The
recreated current-version config should be validated with the current
config and memory validation tools before merging the config branch.

### Known issues

- **Flow memory backend (`cozo-node`) is unmaintained.** The optional
  flow-memory subsystem persists to `cozo-node`, whose upstream
  packages have not seen a release since December 2023
  (`cozo-node@0.7.6`) and whose Rust core (`cozodb/cozo`) has not
  been pushed to since December 2024. The memory tools continue to
  work and there are no known runtime issues, but `cozo-node@0.7.6`
  transitively depends on `@mapbox/node-pre-gyp@^1`, which surfaces
  six `deprecated subdependency` warnings at install time
  (`are-we-there-yet`, `gauge`, `glob@7`, `inflight`, `npmlog`,
  `rimraf@3`). These warnings are cosmetic: `pnpm audit` reports
  zero vulnerabilities. Foundry will migrate to a maintained graph +
  vector backend in a future release; the memory tool surface
  (`foundry_memory_*`) and the on-disk vocabulary / NDJSON format
  are designed to remain stable across that migration.

## 2.4.2 — 2026-04-23

### Changed

- README: new hero-style "Governed work for AI" section before the TOC — names the discipline problem, lists what developers get, speaks to teams under a "structural, not cultural" framing.
- README: old "Why Foundry?" section removed; the five bullets it contained now live under a renamed "Design principles" section (was "Design decisions"), prefaced with the governing rule (*trust the tool, not the LLM*) and extended with a new principle entry on human-in-the-loop gates.

## 2.4.1 — 2026-04-23

### Fixed

- `docs/getting-started.md` install snippet used a `packages` key that doesn't exist in OpenCode's config schema. Corrected to the `plugin: ["@really-knows-ai/foundry"]` form already shown in `README.md`.

## 2.4.0 — 2026-04-23

### Added

- **Flow memory** — a typed, graph-shaped knowledge store that persists across cycles. Entity types, edge types, and their prose briefs live in `foundry/memory/`; entity rows and edge rows are committed as NDJSON under `foundry/memory/relations/`; the live Cozo 0.7 database (`foundry/memory/memory.db*`) is gitignored and rebuilt on demand from the NDJSON files. Each cycle declares read/write permissions in its frontmatter (`memory: { read: [...], write: [...] }`); the dispatched stage prompt is augmented with a vocabulary block listing the entity/edge types visible to that cycle and the memory tools available to it.
- **Optional semantic search.** When `embeddings.enabled` is true in `foundry/memory/config.md`, entities are embedded on write against an OpenAI-compatible endpoint (default: local Ollama `nomic-embed-text`, 768 dims) and exposed via `foundry_memory_search`. Embeddings can be disabled; the graph still works.
- **20 memory tools** registered by the plugin: `foundry_memory_{put,relate,unrelate,get,list,neighbours,query,search}` for read/write, `foundry_memory_{create,rename,drop}_{entity,edge}_type` for vocabulary management, `foundry_memory_{init,validate,reset,dump,vacuum,change_embedding_model}` for admin. Destructive operations (`drop_*`) take an optional `confirm` — without it they return a preview of affected rows.
- **9 memory skills**: `init-memory`, `add-memory-entity-type`, `add-memory-edge-type`, `rename-memory-entity-type`, `rename-memory-edge-type`, `drop-memory-entity-type`, `drop-memory-edge-type`, `reset-memory`, `change-embedding-model`. All wrap the deterministic admin tools with the usual conflict-checking, preview-then-confirm, and commit discipline.
- `docs/memory-maintenance.md` — contributor notes on Cozo 0.7 adaptations (`::compact`, typed `<F32;N>?` vector columns, `?[...] <- [[...]]` put syntax, single-vs-double-quote string literal semantics, `::relations` HNSW filtering) and the session-singleton lifecycle constraint.

### Notes

- Memory is strictly opt-in. A project without `foundry/memory/` behaves exactly as before; the prompt-extras injection no-ops, and cycles that don't declare a `memory:` block see no vocabulary and no memory tools in their prompt.
- On store open, orphan relations left behind by drops/renames are reconciled automatically (`::relations` filtered to `^(ent|edge)_[^:]+$`, HNSW indices dropped before `::remove`).
- Memory prompt injection is wrapped in a swallow-errors guard: if memory is misconfigured or drifted, dispatch still succeeds with no vocabulary block rather than failing the cycle.

## 2.3.2 — 2026-04-21

### Changed

- Config-modifying skills (`add-flow`, `add-cycle`, `add-law`, `add-appraiser`, `add-artefact-type`) now refuse to run on a work branch. They require the current branch to not start with `work/`, directing the user to complete or discard the in-flight flow before changing foundry configuration. Structural changes belong on the base branch, not alongside transient flow state.

### Removed

- Historical planning docs (`docs/plans/`, `docs/specs/`, `docs/superpowers/`) and `HARDEN.md`. All described features that shipped in v2.2.0–v2.3.1; git history preserves the full record.

## 2.3.1 — 2026-04-20

### Changed

- `flow` skill: any cycle in a flow may now be the starting cycle (previously limited to `starting-cycles`). The list becomes a hint for ambiguous requests. A cycle whose `inputs` contract cannot be satisfied from files on disk is not eligible to start.
- `flow` skill: between-cycles logic no longer implies any carry-over ceremony. The next cycle's forge discovers the previous cycle's output via filesystem scan against its input types' `file-patterns`.
- `forge` skill: input discovery now explicitly uses filesystem scan against each input type's `file-patterns`, with the goal guiding which candidates are relevant.
- `forge` skill: the write invariant is restated accurately — forge may only write to files matching the output artefact type's `file-patterns` (plus the tool-managed files). All other files on disk are read-only. The previous "inputs are read-only" framing was a special case of this rule.

### Notes

- No tool, schema, or enforcement changes. Existing flows continue to work. `sort.js`'s `checkModifiedFiles` already enforces the write invariant.

## 2.3.0 — 2026-04-20

### Breaking

- **LLM orchestration replaced with deterministic `foundry_orchestrate` tool.** The `cycle` and `sort` skills are removed; replaced by a single thin `orchestrate` skill that drives a 3-line loop.
- **Six tools deregistered** from the plugin (still exist as internal imports for tests): `foundry_sort`, `foundry_history_append`, `foundry_stage_finalize`, `foundry_git_commit`, `foundry_workfile_configure_from_cycle`, `foundry_workfile_set`.
- Upgrade requires clean main + no in-flight workfile (see `upgrade-foundry` skill).

### Added

- `foundry_orchestrate` — single tool that owns the sort → history → dispatch → finalize → history → commit loop. Atomic stage completion.
- `scripts/orchestrate.js` — deterministic orchestration logic, composes existing internal functions.
- Orphaned-stage detection: if orchestrate is called without `lastResult` but an active stage exists, returns `violation`. Fixes the ses_256c failure mode where an LLM skipped the post-dispatch history append and wedged the cycle.

### Fixed

- Root cause of all deferred HARDEN.md bugs (B, C, D, E, G) and the ses_256c bug: LLM misfollowing a deterministic protocol. Protocol now lives inside the plugin tool.

### Migration

See `skills/upgrade-foundry/SKILL.md` for v2.3.0 pre-flight checks. No automated state migration — complete or discard in-flight cycles on v2.2.x before upgrading.

## 2.2.1 — 2026-04-20

Follow-up patch addressing the five bugs deferred from v2.2.0 (see `HARDEN.md` §Deferred).

### Breaking changes

- **Cycle-definition deadlock config flattened.** The nested `human-appraise: {enabled, deadlock-threshold}` block is replaced by three flat keys:
  - `human-appraise: <bool>` (default `false`) — include `human-appraise` in the stage loop every iteration
  - `deadlock-appraise: <bool>` (default `true`) — route to `human-appraise` when LLM appraisers deadlock
  - `deadlock-iterations: <number>` (default `5`) — deadlock threshold
  Run the `upgrade-foundry` skill to migrate existing cycle defs — the old nested form is no longer read.

### New

- **`foundry_workfile_configure_from_cycle({cycleId, stages})`** — populates WORK.md frontmatter from a cycle definition in one call. Replaces the prior 6–7 sequential `foundry_workfile_set` calls at cycle start. Defaults for `max-iterations`, `human-appraise`, `deadlock-appraise`, `deadlock-iterations`, and `models` now live in plugin code rather than skill prose.
- **`foundry_artefacts_list({cycle})`** — optional cycle filter. Callers should always pass the current cycle to avoid picking up stale rows from prior aborted sessions.

### Fixed

- **Bug B — deadlock routing.** Sort now reads the flat deadlock keys from WORK.md frontmatter and routes to `human-appraise` on deadlock (either an existing `human-appraise:<cycle>` stage in `stages`, or a synthesized one). When `deadlock-appraise: false`, deadlock marks the cycle `blocked`.
- **Bug C — stale artefact validation.** `quench`, `appraise`, and `human-appraise` skills now pass the current cycle to `foundry_artefacts_list`, scoping validation to artefacts produced by the current cycle.
- **Bug D — overwriting WORK.md.** The `flow` skill now calls `foundry_workfile_get` before `foundry_workfile_create` and prompts the user to resume, discard, or abort when an existing workfile is detected. Silent overwrite is not offered; resume requires matching `flow` and `cycle`.
- **Bug E — missing micro-commits.** `foundry_sort` now returns `{route: 'violation'}` when `WORK.md`, `WORK.history.yaml`, or anything under `.foundry/` has uncommitted changes at the start of a sort call and history is non-empty. Structurally enforces the one-commit-per-stage contract that previously lived only in skill prose. First sort of a cycle is exempt (empty history).
- **Bug G — workfile setup boilerplate.** See `foundry_workfile_configure_from_cycle` above.

### Migration

Run the `upgrade-foundry` skill to migrate cycle definitions to the flat deadlock keys (Bug B). No other migration required — WORK.md, `.foundry/`, and feedback state are forward-compatible.

## 2.2.0 — 2026-04-19

### Breaking changes

- **`foundry_artefacts_add` removed.** Artefact registration now happens exclusively via `foundry_stage_finalize` after a forge stage closes.
- **`foundry_artefacts_set_status` no longer accepts `draft`.** Only `done` and `blocked` are valid. New artefacts are registered as `draft` automatically by `stage_finalize`.
- **Feedback / artefact / workfile mutation tools now enforce stage-lock preconditions.** Tools callable by subagents require an active stage matching their role; tools callable by the orchestrator require no active stage. Out-of-band calls return a structured error.
- **Feedback state machine strictly enforced.** `approved` is terminal. `quench` cannot approve/reject `wont-fix` items. See `HARDEN.md` §4 for the full matrix.
- **`foundry_sort` dispatchable routes now return a `token` field.** Subagents must redeem the token via `foundry_stage_begin`; forged or replayed tokens are rejected.

### New

- **`foundry_stage_begin(stage, cycle, token)`** — subagents open a work stage by consuming a single-use HMAC-signed token.
- **`foundry_stage_end(summary)`** — subagents close a stage; preserves `baseSha` for finalize.
- **`foundry_stage_finalize(cycle)`** — orchestrator verifies stage output against allowed file patterns, registers matching files as draft artefacts, rejects stray writes with `{error: "unexpected_files", files: [...]}`.
- **`.foundry/` state directory** (gitignored) — holds `.secret` (per-worktree HMAC key, mode 0600), `active-stage.json` (present only during an active stage), `last-stage.json` (for finalize lookup).

### Fixed

- Normalized `maxIterations` → `max-iterations` across workfile read/write paths (previously inconsistent between flow and cycle skills, causing latent deadlock-detection issues).

### Migration

Upgrade with the `upgrade-foundry` skill. `.foundry/` is created automatically on first plugin boot; `.secret` is generated idempotently. No data migration required — existing `WORK.md` and `foundry/*` configs are compatible.
