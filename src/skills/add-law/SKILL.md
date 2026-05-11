---
name: add-law
type: atomic
description: Creates a new law, checking for conflicts with existing laws.
---

# Add Law

You help the user create a new law. You ensure it's well-scoped, doesn't conflict with existing laws, and ends up in the right file.

## Prerequisites

Before running this skill, verify all three of the following:

1. The `foundry/` directory exists in the project root. If it does not
   exist, stop and tell the user:

   > Foundry is not initialized in this project. Run the
   > `init-foundry` skill first to create the foundry/ directory
   > structure.

2. The current git branch is a `config/*` branch. Run
   `git rev-parse --abbrev-ref HEAD` and confirm it matches
   `config/<description>`.

3. If the branch does not start with `config/`, instruct the user to
   create one before continuing:

   > Foundry configuration changes must be made on a config/* branch.
   > From a clean main branch, call:
   >
   > `foundry_git_branch({ kind: "config", description: "<short-name>" })`
   >
   > Then re-run this skill.

   If the user is on a `dry-run/*/*` branch, they must finish
   that dry-run first (`foundry_git_finish({ message, confirm: true })`)
   before re-running this skill on the parent `config/*`.

## Protocol

### 1. Determine scope

If the user specifies where the law applies:
- "global law" → goes in `foundry/laws/` (ask which file, or create a new one)
- "law for X artefacts" → goes in `foundry/artefacts/<type>/laws.md`

If the user doesn't specify, ask:

> Should this law apply globally to all artefact types, or to a specific type?

If they name a type, verify it exists in `foundry/artefacts/`. If it doesn't, tell them and ask if they want to create the artefact type first.

### 2. Draft the law

Write the law following the standard format:

```markdown
## <law-id>

<What this law checks — one or two sentences.>

validators:
  - id: validator-id
    command: ./script.sh
    failure-means: (optional description)
```

The `law-id` (heading) should be:
- Lowercase, hyphenated
- Short but descriptive
- Unique across all laws (global and type-specific)

The `validators:` block is optional. Include it only when a
deterministic check can decide pass/fail. See **Validator contract**
below for the exact shape a validator command must satisfy.

### 3. Check for conflicts

Read all existing laws that would apply to the same artefact types:
- All files in `foundry/laws/` (global)
- `foundry/artefacts/<type>/laws.md` if the law is type-specific
- If the law is global, also read all `foundry/artefacts/*/laws.md` since a global law applies everywhere

For each existing law, check:
- Does the new law contradict an existing law? (e.g., "must be formal" vs "must be conversational")
- Does the new law duplicate an existing law? (same criterion, different wording)
- Does the new law overlap with an existing law? (partially covers the same ground)

If any conflict is found, present it to the user:

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

### 4. Refine with the user

Present the drafted law to the user before writing it. Ask:

> Here's the draft law:
>
> ## <law-id>
>
> <law content>
>
> Does this capture what you want, or should we adjust the wording?

Iterate until the user is happy.

### 5. Validate the draft

Call `foundry_config_validate_law({ name: "<file-name-without-extension>", body: "<full markdown>" })`.

If the result is `{ ok: false, errors: [...] }`, address each error (adjust the body) and re-run until you get `{ ok: true }`. Common issues: missing required frontmatter keys, references to artefact types that don't exist yet.

### 6. Create the file

Pick the target. The user has already chosen scope in step 1 — translate that into the `target` argument:

- Global → `target: { kind: "global", file: "<file-name>.md" }` (lives at `foundry/laws/<file-name>.md`).
- Type-specific → `target: { kind: "type-specific", typeId: "<artefact-type>" }` (lives at `foundry/artefacts/<typeId>/laws.md`).

Then call:

```
foundry_config_add_law({
  name: "<file-name-without-extension>",
  body: "<full markdown>",
  target: { kind: "global", file: "<file-name>.md" }   // OR
           { kind: "type-specific", typeId: "<artefact-type>" }
})
```

The tool:

- re-validates the body (TOCTOU);
- writes the law file at the path determined by `target`;
- produces one git commit on the current `config/*` branch.

The tool appends to an existing `laws.md` automatically when the
new `## <law-id>` heading is not already present. It only errors when
a law with the same id is already in the file — in that case use
`foundry_config_edit_law({ id: "<law-id>", body: "<updated-body>" })`
to modify the existing law in place.

Show the user the resulting commit hash from the response.

### 7. Verify uniqueness

After the file is created, confirm the law id is unique across all law files. If a collision exists, ask the user to rename and edit by hand on this branch.

### 7a. Validator contract

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

### 8. Editing existing laws (prose or validators)

When the user wants to modify an existing law — whether updating the prose description or adding/changing validators — use this flow:

#### 8a. Read the existing law

Call `foundry_config_read_law({ id: "<law-id>" })` to fetch the full markdown content.

#### 8b. Refine with the user

Show the current content and ask what should change. Iterate on the updated markdown until the user is satisfied.

#### 8c. Drift mitigation: Prose changes

**If the user is modifying the law's prose description**, insert this prompt before updating:

> 🔍 **Drift check:** Verify that all existing validators on this law still accurately enforce the updated intent. Open each validator's command and confirm it catches the same class of failure the prose now describes.

Then proceed with the update.

#### 8d. Drift mitigation: Validator changes

**If the user is adding or modifying a validator**, insert this prompt before updating:

> 🔍 **Drift check:** Verify that the changed validator still aligns with the law's prose. If the validator has narrowed or broadened, the prose may need a corresponding update.

Then proceed with the update.

#### 8e. Apply the update

Call `foundry_config_edit_law({ id: "<law-id>", body: "<updated-markdown>" })` with the full updated body (prose and validators combined).

Validate the result. If the tool returns `{ ok: true }`, show the user the commit hash. If it returns `{ ok: false, errors }`, address each error and retry.

## What you do NOT do

- You do not skip the conflict check
- You do not silently overwrite existing laws
- You do not create artefact types — that is a separate skill
