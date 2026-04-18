# Foundry Custom Tools — Design Spec

## Problem

Foundry skills instruct the LLM to read and write structured data (WORK.md frontmatter, artefacts tables, feedback sections, WORK.history.yaml) using generic Read/Write/Edit tools. The LLM interprets YAML structure, markdown sections, and feedback format — and gets it wrong. Ordering bugs, malformed YAML, misplaced feedback items, and incorrect table manipulation are all observed failure modes.

The more deterministic we can make these operations, the more reliable the pipeline becomes and the simpler the skills get.

## Solution

Move all deterministic operations out of skills and into custom tools exposed via the existing Foundry plugin (`foundry.js`). Extract shared parsing/writing logic into `scripts/lib/` modules. Refactor `sort.js` to use the same shared code. Skills shrink to orchestration and judgment — the only things the LLM is actually good at.

## Architecture

### Shared Library (`scripts/lib/`)

Pure functions with injectable I/O for testability. Each module owns one domain.

#### `scripts/lib/workfile.js` — WORK.md frontmatter and structure

- `parseFrontmatter(text)` → object — extract YAML frontmatter (moved from sort.js)
- `writeFrontmatter(fields)` → string — serialize fields to `---\n...\n---` block
- `createWorkfile(frontmatter, goal)` → string — full WORK.md template with frontmatter, goal, artefacts table header, feedback heading
- `setFrontmatterField(text, key, value)` → string — update single field in-place, preserving rest of document
- `getFrontmatterField(text, key)` → value

#### `scripts/lib/artefacts.js` — artefacts table

- `parseArtefactsTable(text)` → array of `{file, type, cycle, status}` (moved from sort.js)
- `addArtefactRow(text, {file, type, cycle, status})` → string — insert row, create table if missing
- `setArtefactStatus(text, file, newStatus)` → string — update status column for a given file

#### `scripts/lib/history.js` — WORK.history.yaml

- `loadHistory(path, cycle, io)` → array sorted by timestamp ascending (moved from sort.js, includes timestamp sort fix)
- `appendEntry(path, {cycle, stage, iteration, comment}, io)` — always appends to end of file, auto-generates ISO 8601 UTC timestamp, validates required fields
- `getIteration(path, cycle, io)` → number — count of forge entries for the cycle (for iteration tracking)

#### `scripts/lib/feedback.js` — feedback section

- `parseFeedback(text, cycle, artefacts)` → array of items (moved from sort.js)
- `parseFeedbackItem(line)` → `{raw, state, tags, resolved}` (moved from sort.js)
- `addFeedbackItem(text, file, itemText, tag)` → string — creates `## Feedback` and `### <file>` headings if needed, appends `- [ ] <text> #<tag>`
- `resolveFeedbackItem(text, file, index, resolution, reason?)` → string — appends `| approved` or `| rejected: <reason>` to the nth item under that file
- `actionFeedbackItem(text, file, index)` → string — changes `[ ]` to `[x]`
- `wontfixFeedbackItem(text, file, index, reason)` → string — changes `[ ]` to `[~]`, appends `| wont-fix: <reason>`
- `listFeedback(text, cycle, artefacts, file?)` → array of `{file, index, text, state, tags, resolved, resolution}`

#### `scripts/lib/config.js` — foundry config reads

- `getCycleDefinition(foundryDir, cycleId, io)` → `{frontmatter, body}`
- `getArtefactType(foundryDir, typeId, io)` → `{frontmatter, body}`
- `getLaws(foundryDir, typeId?, io)` → array of `{id, text, source}` — global laws, plus type-specific if typeId provided
- `getValidation(foundryDir, typeId, io)` → array of command strings, or null if no validation.md
- `getAppraisers(foundryDir, io)` → array of `{id, personality, model?}`
- `getFlow(foundryDir, flowId, io)` → `{frontmatter, body}`
- `selectAppraisers(foundryDir, typeId, count?, io)` → array of `{id, personality, model}` with resolved models per the priority chain (appraiser model → cycle models.appraise → session default)

#### `scripts/lib/tags.js` — already exists, no changes

### sort.js Refactor

`sort.js` drops all inline parsing functions and imports from `scripts/lib/`. The routing logic (`determineRoute`, `nextAfterQuench`, `nextAfterAppraise`) stays in `sort.js` since it's sort-specific. The CLI entry point is removed — sort logic is called directly by the `foundry_sort` tool.

Exported functions for the tool: `determineRoute`, `nextAfterQuench`, `nextAfterAppraise`, `checkModifiedFiles`, `getModifiedFiles`, `getAllowedPatterns`.

### Plugin Tools

All tools added to the `tool: { }` block in `.opencode/plugins/foundry.js`. Each tool is a thin wrapper: validate args → resolve paths → call lib → return result.

Tools receive `context.worktree` for resolving WORK.md, WORK.history.yaml, and foundry/ paths.

#### History tools

**`foundry_history_append`**
- Args: `cycle` (string), `stage` (string), `comment` (string)
- Behavior: Computes iteration from existing history, appends entry with auto-generated timestamp
- Returns: The entry written

**`foundry_history_list`**
- Args: `cycle` (string)
- Returns: All history entries for cycle, sorted ascending by timestamp

#### Workfile tools

**`foundry_workfile_create`**
- Args: `flow` (string), `cycle` (string), `stages` (string[]), `maxIterations` (number), `goal` (string), `models` (object, optional)
- Behavior: Creates WORK.md, errors if it already exists
- Returns: Confirmation

**`foundry_workfile_get`**
- Args: none
- Returns: Parsed frontmatter + goal text

**`foundry_workfile_set`**
- Args: `key` (string), `value` (any)
- Behavior: Updates a single frontmatter field
- Returns: Confirmation

**`foundry_workfile_delete`**
- Args: none
- Behavior: Deletes WORK.md
- Returns: Confirmation

#### Artefacts tools

**`foundry_artefacts_add`**
- Args: `file` (string), `type` (string), `cycle` (string), `status` (string, default "draft")
- Behavior: Inserts row into artefacts table, creates table if missing
- Returns: Confirmation

**`foundry_artefacts_set_status`**
- Args: `file` (string), `status` (string)
- Behavior: Updates the status column for that file
- Returns: Confirmation

**`foundry_artefacts_list`**
- Args: none
- Returns: Array of `{file, type, cycle, status}`

#### Feedback tools

**`foundry_feedback_add`**
- Args: `file` (string), `text` (string), `tag` (string — `validation`, `law:<id>`, or `hitl`)
- Behavior: Adds `- [ ] <text> #<tag>` under the correct file heading
- Returns: Confirmation with item index

**`foundry_feedback_action`**
- Args: `file` (string), `index` (number)
- Behavior: Changes `[ ]` to `[x]`
- Returns: Confirmation

**`foundry_feedback_wontfix`**
- Args: `file` (string), `index` (number), `reason` (string)
- Behavior: Changes to `[~]`, appends `| wont-fix: <reason>`
- Returns: Confirmation

**`foundry_feedback_resolve`**
- Args: `file` (string), `index` (number), `resolution` (enum: "approved" | "rejected"), `reason` (string, optional — required if rejected)
- Behavior: Appends `| approved` or `| rejected: <reason>`
- Returns: Confirmation

**`foundry_feedback_list`**
- Args: `file` (string, optional)
- Returns: Array of `{file, index, text, state, tags, resolved, resolution}`

#### Sort tool

**`foundry_sort`**
- Args: `cycleDef` (string, optional)
- Behavior: Runs sort routing logic, file modification enforcement, tag validation
- Returns: `{route, details?, model?}` — route is a stage alias, "done", "blocked", or "violation". `model` is the resolved agent name if the `models` map specifies one for that stage.

#### Git tools

**`foundry_git_branch`**
- Args: `flowId` (string), `description` (string)
- Behavior: Creates `work/<flowId>-<description>` branch off main
- Returns: Branch name

**`foundry_git_commit`**
- Args: `cycle` (string), `stage` (string), `description` (string)
- Behavior: `git add . && git commit -m "[<cycle>] <stage>: <description>"`
- Returns: Commit hash

#### Config tools

**`foundry_config_cycle`**
- Args: `cycleId` (string)
- Returns: `{frontmatter, body}`

**`foundry_config_artefact_type`**
- Args: `typeId` (string)
- Returns: `{frontmatter, body}`

**`foundry_config_laws`**
- Args: `typeId` (string, optional)
- Returns: Array of `{id, text, source}`

**`foundry_config_validation`**
- Args: `typeId` (string)
- Returns: Array of command strings, or null

**`foundry_config_appraisers`**
- Args: none
- Returns: Array of `{id, personality, model?}`

**`foundry_config_flow`**
- Args: `flowId` (string)
- Returns: `{frontmatter, body}`

#### Validation tool

**`foundry_validate_run`**
- Args: `typeId` (string), `file` (string)
- Behavior: Reads validation.md, substitutes `{file}`, runs each command
- Returns: Array of `{command, passed, output}`

#### Appraiser selection tool

**`foundry_appraisers_select`**
- Args: `typeId` (string), `count` (number, optional)
- Behavior: Runs selection algorithm, resolves models
- Returns: Array of `{id, personality, model}`

### Skill Changes

Each skill is updated to use tools instead of direct file manipulation.

**sort** — Call `foundry_sort`, `foundry_history_append`, dispatch sub-agent using `model` from sort response. No bash, no file parsing.

**forge** — Call `foundry_config_cycle`, `foundry_config_artefact_type`, `foundry_config_laws`, `foundry_feedback_list` for context. Produce artefact (judgment). Call `foundry_artefacts_add` or `foundry_artefacts_set_status`, `foundry_feedback_action`/`foundry_feedback_wontfix`, `foundry_history_append`, `foundry_git_commit`.

**quench** — Call `foundry_validate_run`. For failures: `foundry_feedback_add`. For actioned items: re-run via `foundry_validate_run`, then `foundry_feedback_resolve`. Call `foundry_history_append`.

**appraise** — Call `foundry_config_laws`, `foundry_appraisers_select`. Dispatch sub-agents and consolidate (judgment). Call `foundry_feedback_add` for new items, `foundry_feedback_resolve` for reviews. Call `foundry_history_append`.

**hitl** — Call `foundry_workfile_get`, `foundry_history_list`. Summarize for human (judgment). Call `foundry_feedback_add`, `foundry_history_append`.

**cycle** — Call `foundry_config_cycle`, `foundry_config_validation` (existence check). Call `foundry_workfile_set` for frontmatter fields. On completion: `foundry_artefacts_set_status`.

**flow** — Call `foundry_config_flow`, `foundry_git_branch`, `foundry_workfile_create`. Iterate cycles. Call `foundry_workfile_set("cycle", nextCycle)`. On completion: `foundry_workfile_delete`.

### Implementation Phases

**Phase 1: Extract shared library**
- Create `scripts/lib/` modules by moving existing functions from sort.js and adding new write functions
- Refactor `sort.js` to import from `scripts/lib/`
- Write tests for all lib functions
- Run existing sort.js tests to confirm nothing breaks

**Phase 2: Add tools to plugin**
- Add all 22 tool endpoints to `foundry.js`
- Each tool wraps lib functions with arg validation and path resolution
- Test tools against a sample WORK.md

**Phase 3: Update skills**
- Update one at a time: sort → quench → hitl → forge → appraise → cycle → flow
- Remove format specifications, YAML examples, markdown structure instructions
- Replace with tool call instructions

**Phase 4: Cleanup**
- Remove sort.js CLI entry point
- Remove dead code
- Update/consolidate tests
