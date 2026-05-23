---
name: add-law
type: atomic
description: Creates a new law, checking for conflicts with existing laws.
---

# Add Law

You help the user create a new law. You ensure it's well-scoped, doesn't conflict with existing laws, and ends up in the right file.

## Foundry Agent Preflight

If you are clearly operating as the Foundry agent, continue.

If you are not clearly operating as the Foundry agent, pause and tell the user:

> This work is best handled by the Foundry agent. Restart OpenCode if you have just initialised Foundry, switch to the **Foundry** agent, and continue this request there.

This is an advisory guard. Continue only when the active instructions make it clear you are the Foundry agent or the user explicitly asks to proceed here.

## Config Branch Handling

Before writing Foundry configuration:

- Confirm `foundry/` exists. If it is missing, initialise Foundry first when that serves the user's goal.
- Check the current branch.
- On `main` or another clean non-work branch, create a `config/<short-description>` branch internally.
- On `config/*`, continue on the current branch.
- On `work/*`, stop and explain that active flow work must be finished before configuration changes.
- On `dry-run/*/*`, stop and explain that the dry run must be finished before configuration changes.
- If unrelated uncommitted changes could be affected by branching or writing files, ask before proceeding.

Do not tell the user to call branch tools directly.

## Protocol

### Context object

When invoked with pre-filled fields matching the `foundry_config_add_law` tool args, skip questions for provided fields. Missing fields trigger clarifying questions.

Context fields (global): `{id, name, description, passing, failing, target: {kind: "global", file}, validators?}`
Context fields (type-specific): `{id, name, description, passing, failing, target: {kind: "type-specific", typeId}, validators?}`

When invoked with a context:
- If all required fields are present, skip the Understand phase and proceed to Plan → Confirm → Build.
- If only some fields are present, ask only for the missing ones.

### 1. Understand

**Scope**: Ask "Should this law apply globally to all artefact types, or to a specific type?" If the user names a type-specific law for an artefact type that does not exist, create the artefact type first when that supports the user's stated goal using the `add-artefact-type` workflow internally.

If global, ask for the `file` (the filename under `foundry/laws/`, e.g. `rules.md`). If type-specific, ask for the `typeId`.

**Fields**: Ask for `id`, `name`, `description`, `passing` criteria, and `failing` criteria one at a time.

**Validators**: For each law, identify which elements can be validated deterministically:

- **Script-checkable** — can be checked by a validator without human or LLM judgment. Examples: line count, syllable count, word minimum, forbidden patterns, file existence, formatting rules. These become `validators:` entries in the law. Since quench runs before appraise, validators that pass mean those elements are already verified — the appraiser is aware of this and can de-prioritise them, focusing judgment on elements without validators.
- **Requires judgment** — needs the appraiser's evaluation. Examples: imagery quality, emotional resonance, persuasiveness, aesthetic appeal, clarity of argument. The law's prose alone guides the appraiser — no validator entry needed.

Walk the user through which elements of the law can be validated deterministically:

> This law covers [summary]. Here's which parts can be checked with validators:
> - Validatable: [list elements that can be script-checked]
> - Requires judgment: [list elements the appraiser evaluates]
>
> Shall I add validators for the script-checkable elements?

For each script-checkable element, write a standalone `.mjs` script next to the artefacts it validates (e.g. `foundry/artefacts/<type>/check-line-count.mjs`) and reference it in the command (e.g. `node foundry/artefacts/<type>/check-line-count.mjs {files}`). Place validators alongside the artefacts so they colocate with what they validate. Use existing project dependencies and Node.js built‑ins. Hand‑rolled heuristics (custom syllable counters, regex parsers, manual character walks) are a last resort — they produce false positives, waste tokens on debugging, and break on edge cases. Install a library instead. Only write validation logic from scratch when no npm package exists for the task and the heuristic is trivially correct.

**Validators**: Ask about `validators` (optional) — offer to create one or skip.

**Conflict check**: Read all existing laws that would apply to the same artefact types. Check for contradiction, duplication, or overlap. If any conflict is found, present it to the user:

> The new law `<new-id>` may conflict with existing law `<existing-id>`:
> - New: <summary of new law>
> - Existing: <summary of existing law>
> - Conflict: <what the conflict is>
>
> Options:
> 1. Proceed anyway (both laws will apply)
> 2. Replace the existing law with the new one
> 3. Rephrase the new law to avoid the conflict
> 4. Cancel

### 2. Plan

Present a structured summary: law id, name, description, passing/failing criteria, target (global or type-specific with typeId), and validators (which elements are checked deterministically). Ask: "Does this capture what you want, or should we adjust the wording?" Iterate until the user is satisfied.

### 3. Confirm

Ask: "Proceed with this plan?" — wait for user answer before building. If the user rejects the plan, return to the Understand phase and adjust.

### 4. Build

1. **Validate**: Call `foundry_config_validate_law({ name: "<id>", body: "<assembled markdown>" })`. Assemble the body from the fields using the `## <id>` heading format the tool produces internally. If the result is `{ ok: false, errors: [...] }`, address each error and re-run until `{ ok: true }`. Common issues: missing required frontmatter keys, references to artefact types that do not exist yet.

2. **Create**: Translate the scope into the `target` argument:
   - Global → `target: { kind: "global", file: "<file-name>.md" }`
   - Type-specific → `target: { kind: "type-specific", typeId: "<artefact-type>" }`

   Call:

   ```
   foundry_config_add_law({
     id: "<id>",
     name: "<name>",
     description: "<description>",
     passing: "<passing>",
     failing: "<failing>",
     target: { kind: "global", file: "<file-name>.md" }
              // or { kind: "type-specific", typeId: "<artefact-type>" }
   })
   ```

   The tool re-validates the body (TOCTOU), writes the law file at the path determined by `target`, and produces one git commit on the current `config/*` branch. Show the user the resulting commit hash.

   The tool appends to an existing `laws.md` automatically when the new law id is not already present. It only errors when a law with the same id is already in the file — in that case use `foundry_config_edit_law({ id: "<law-id>", description: "<updated>", passing: "<updated>", failing: "<updated>" })` to modify the existing law in place.

3. **Verify uniqueness**: After the file is created, confirm the law id is unique across all law files. If a collision exists, read the colliding law, present the conflict to the user, propose a rename or merge, ask one focused question about the user's preference, then write and commit the resolution.

### 5. Editing existing laws (prose or validators)

When the user wants to modify an existing law — whether updating the prose description or adding/changing validators — use this flow:

#### 5a. Read the existing law

Call `foundry_config_read_law({ id: "<law-id>" })` to fetch the full markdown content.

#### 5b. Refine with the user

Show the current content and ask what should change. Iterate on the updated markdown until the user is satisfied.

#### 5c. Drift mitigation: Prose changes

**If the user is modifying the law's prose description**, insert this prompt before updating:

> 🔍 **Drift check:** Verify that all existing validators on this law still accurately enforce the updated intent. Open each validator's command and confirm it catches the same class of failure the prose now describes.

Then proceed with the update.

#### 5d. Drift mitigation: Validator changes

**If the user is adding or modifying a validator**, insert this prompt before updating:

> 🔍 **Drift check:** Verify that the changed validator still aligns with the law's prose. If the validator has narrowed or broadened, the prose may need a corresponding update.

Then proceed with the update.

#### 5e. Apply the update

Call `foundry_config_edit_law({ id: "<law-id>", description: "<updated>", passing: "<updated>", failing: "<updated>", validators: [...] })` with the full updated fields.

Validate the result. If the tool returns `{ ok: true }`, show the user the commit hash. If it returns `{ ok: false, errors }`, address each error and retry.

### 6. Validator contract

A law's `validators:` entries declare CLI commands that `quench` runs
during a cycle. The plugin parses each command's stdout as **JSONL**
(one JSON object per line). Authors must follow this contract exactly;
nothing in plugin source needs to be read.

#### Output format (stdout, parsed as JSONL)

One JSON object per line. Empty lines are ignored. Required fields:

- `file` *(string)* — path of the offending file, relative to the
  worktree root. Must match at least one of the artefact type's
  `file-patterns:`; otherwise the line becomes a validator-level
  error, not feedback.
- `text` *(string)* — the feedback message.

Optional fields:

- `location` *(string, e.g. `"3:1"`)* — line:column reference,
  prepended to `text` as `file:location — text`.
- `severity` *(string, e.g. `"error"` or `"warning"`)* — prepended to
  `text` as `[severity] file:location — text` (or `[severity] file —
  text` when no `location`).

Anything else on the line is preserved verbatim on the parsed item.
The validator's exit code is **ignored** — the parser reads stdout
either way, and falls back to stderr when stdout is empty (so tools
like `rg` that exit non-zero on hits still work).

#### Command placeholders

Inside `command:`, two placeholders may appear, alone, together, or
not at all. They are recognised only as standalone tokens (bounded by
whitespace or string start/end). Authors may wrap a placeholder in
single or double quotes for readability — surrounding quotes are
stripped before substitution.

- `{pattern}` → the artefact type's `file-patterns:` rendered as
  space-separated, shell-quoted globs (e.g.
  `'haikus/*.md' 'drafts/*.md'`). Use this when the validator does
  its own globbing or accepts globs directly (e.g. `rg --glob`).
- `{files}` → the matching files in the worktree, rendered as
  space-separated, shell-quoted paths (e.g.
  `'haikus/one.md' 'haikus/two.md'`). Use this when the validator
  takes an explicit list of file paths.

A command with neither placeholder runs verbatim — useful for
self-resolving validators such as `npm test`, `tsc --noEmit`, or
`pnpm run lint`.

#### Skip rule

A validator is skipped iff its command contains `{files}` and there
are no matching files in the worktree. Commands using `{pattern}` only,
or no placeholders at all, always run.

#### Working directory

Validators run with `cwd` set to the worktree root, so root-level
`node_modules/`, `package.json`, and project tooling all resolve
normally. Do not assume the validator runs from inside the artefact
type's directory.

#### Worked example

A validator that checks each `.md` file in `haikus/` has exactly three
non-empty lines, attached to a haiku artefact type
(`file-patterns: ["haikus/*.md"]`):

`foundry/artefacts/haiku/check-line-count.mjs`:

~~~js
#!/usr/bin/env node
import { readFile } from 'node:fs/promises';

for (const file of process.argv.slice(2)) {
  const content = await readFile(file, 'utf8');
  const lines = content
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length !== 3) {
    process.stdout.write(JSON.stringify({
      file,
      text: `Expected 3 non-empty lines, got ${lines.length}.`,
      severity: 'error',
    }) + '\n');
  }
}
~~~

Declared in the law:

~~~markdown
## three-lines

A haiku must consist of exactly three non-empty lines.

validators:
  - id: line-count
    command: node foundry/artefacts/haiku/check-line-count.mjs {files}
    failure-means: The artefact file does not contain exactly three non-empty lines.
~~~

## What you do NOT do

- You do not skip the conflict check
- You do not silently overwrite existing laws
- You do not create artefact types unless the user's stated goal clearly requires it; ask one focused question when multiple designs are plausible
