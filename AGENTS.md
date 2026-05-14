# AGENTS.md

Project-wide writing rules for any agent producing prose, comments, doc
strings, commit messages, or user-facing text in this repository.

## Voice: define things affirmatively

Define things on their own terms. Lead with what something **is** and
what it **does**. Confident, direct, affirmative.

Drop the legacy-docs habit of defining systems by what they aren't. It
assumes the reader brought baggage you need to unpack, and it wastes
the reader's attention on a strawman before getting to the actual
definition.

### The rule

If Bob is blue, write "Bob is blue." Skip "Bob, who isn't pink and is
in fact blue…".

### Patterns to avoid

- "X is not Y, it is Z" → just say "X is Z"
- "Unlike Y, X does Z" → just say "X does Z"
- "rather than Y, X does Z" → just say "X does Z"
- "X doesn't do Y; instead it does Z" → just say "X does Z"
- "not just Y but also Z" → just say "X covers Y and Z"
- "This isn't your typical foo" / "Don't think of this as a bar" → name
  what it is, in one phrase
- Strawman comparisons the reader did not bring up

### Negation that stays

Negation as the actual semantic content is welcome:

- Constraints and prohibitions ("the tool must not be called during X",
  "do not commit secrets")
- Guard messages and error strings
- API contracts ("returns null when not found")
- Imperatives in skills, runbooks, and policy documents

The rule targets *definitional* prose, not behavioural rules.

## Spelling: British English

Use British English spelling throughout: prose, comments, doc strings,
tool descriptions, commit messages.

Common forms:

- behaviour, colour, defence, honour, centre, grey, fulfil, favour,
  honour, labour, neighbour, licence (noun) / license (verb)
- travelled, modelled, cancelled, labelled, signalled
- modelling, labelling, travelling, cancelling, signalling
- analyse, organise (Oxford `-ize` is also acceptable; pick one and
  stay consistent within a file)

Code identifiers, package names, and external API names keep their
upstream spelling (`color: '#fff'` in CSS, `initialize()` from a
third-party library, etc.).

## Plans directory

The `plans/` directory is intentionally untracked and gitignored. Tools
that respect `.gitignore` or rely on the git index, including Glob-style
file discovery and git status/diff output, will not reliably find plan
files.

When working with plans, use explicit `plans/...` paths or commands that
include ignored files. Treat missing results from git-aware discovery as
an indexing limitation, not evidence that a plan file is absent.

Use `ls` directly to list plan files and project folders, for example
`ls plans` or `ls plans/[project-name]`.

Plans use this structure:

```text
plans/[project-name]/
  SPEC.md       # Work specification
  PLAN.md       # Implementation plan
  PHASE_XX.md   # Plan phases referenced by PLAN.md
```

The `make-project-spec`, `make-phased-plan`, and `execute-phased-plan`
skills work with this structure.

## Package manager: pnpm

This project uses **pnpm** (`packageManager: pnpm@10.15.1`). Always use
`pnpm` commands — never `npm` or `yarn`.

```sh
pnpm install          # install dependencies
pnpm add <pkg>        # add a runtime dependency
pnpm add -D <pkg>     # add a dev dependency
```

## Available scripts

Run scripts via `pnpm run <script>`.

| Script | Purpose |
|--------|---------|
| `build` | Compiles the plugin via `scripts/build.js` |
| `test` | Runs the test suite with Node's built-in test runner |
| `test:coverage` | Runs tests with experimental coverage reporting |
| `lint` | Lints `src/`, `tests/`, and `scripts/` with ESLint |
| `build:all` | Lints, tests, then builds — the full quality gate |

Use `build:all` before publishing or opening a pull request to confirm
the entire pipeline passes.
