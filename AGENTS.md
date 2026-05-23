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

## Module structure

A source file serves one responsibility. When it grows beyond that, split
it — the lint rules tell you when.

### File size: `max-lines` (300)

The limit counts non-blank, non-comment lines. A file that hits 300
lines contains multiple concerns that each deserve their own module.

When this fires:

1. Identify the largest cohesive block of functions that could stand alone
2. Extract it into a new file `src/<dir>/<name>.js`
3. Update imports in the original file to pull from the new module
4. The split is correct when both files sit comfortably below the limit

Do not delete blank lines, inline functions, or compress formatting to
stay under the limit. These address the symptom, not the cohesion
problem.

### Function size: `max-lines-per-function` (40) and `max-statements` (30)

A function that exceeds 40 lines of code or 30 statements is doing more
than one thing. Extract logical blocks into well-named helper functions
at module scope. A helper named `buildSomething` or `checkSomething`
immediately tells the reader what the extracted block does.

### Branching: `complexity` (5)

Each `if`, `for`, `while`, `catch`, and ternary adds a branch. A function
with more than 5 paths has too many decisions. Extract conditional blocks
into helper functions. A guard clause (`if (x) return early`) is
preferable to nested conditionals.

### Nesting: `max-depth` (4)

More than 4 levels of nesting makes code hard to scan. Flatten with early
returns, guard clauses, or by extracting inner blocks into helpers.

### Parameters: `max-params` (5)

A function that takes more than 5 parameters is asking for too many
inputs. Group related parameters into an options object. A constructor
or factory with many inputs is a signal that the concept being modelled
should be split into smaller composable pieces.

## Git worktrees

Git worktrees are stored in `.worktrees/` at the project root. Each
worktree subdirectory is a fully functional clone sharing the repository
object store. When running tools or scripts that inspect the working
tree, be aware that changes may live in a worktree rather than the main
working copy.

List worktrees with `git worktree list`.
