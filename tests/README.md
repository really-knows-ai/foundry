# Tests

Tests are classified into three tiers based on **what they exercise**.
Each tier has its own filename suffix and its own pnpm script.

| Tier | Suffix | Runner | What it exercises |
|---|---|---|---|
| unit | `*.test.js` | `pnpm test:unit` (alias `pnpm test`) | One unit, with all collaborators and externals mocked |
| integration | `*.integration.test.js` | `pnpm test:integration` | The composition of multiple internal units, with every external mocked |
| e2e | `*.e2e.test.js` | `pnpm test:e2e` | Real externals: git, subprocesses, cozo, network, OS timers, the real file-system |

Run everything with `pnpm test:all`. CI runs `pnpm build:all`, which
includes the full suite.

## What counts as an "external"

An external is anything outside the process and its purely-internal
state. We treat each of the following as an external:

- **subprocesses** — `node:child_process` (`spawn`, `exec`,
  `execFile`, `execSync`, `execFileSync`, `spawnSync`)
- **git** — invoking `git` directly, or any client (`simple-git`,
  `simpleGit`) that runs real git against an on-disk repository
- **databases** — a real cozo store opened against a real backing
  file (`cozo-node`, `openStore`, `getStore`, `openMemoryDb`)
- **network** — real HTTP, real fetch, real sockets
- **embedding models** — a real model load or real provider call
- **OS timers and the wall clock** — `setTimeout` / `setInterval`
  used as a delay the test waits on, real retry backoff, or
  performance assertions of the form `elapsed < N`
- **the file-system** — anything that touches real disk, including
  `mkdtemp`/`os.tmpdir` sandboxes. The fact that the directory is
  scoped to the test doesn't make the file-system any less external.

Reading `Date.now()` once to construct a fixture value is fine and
stays in `unit`. Sleeping on `setTimeout` or asserting on elapsed
wall-clock time is not — that depends on the OS scheduler.

## Tier definitions

### unit

Tests focused on a single unit (one module, one function, one class)
where every collaborator and every external is mocked or stubbed.

The defining trait is **scope**: a unit test imports one module from
`src/` (the unit under test) and exercises it in isolation.
Collaborators are stubbed via `node:test` mocks (`mock.method`,
`mock.fn`) or by passing in test doubles like `makeMockIO`.

Strong unit signals:

- Pure-function tests with no IO at all.
- Imports exactly one module from `src/` plus standard-library
  helpers and any test doubles.
- Uses `node:test` mocks to stub the unit's collaborators, or
  passes in an in-memory IO double (`makeMockIO`,
  `makeAsyncMockIO`) for the unit to write through.

A unit test should run in milliseconds and never reach outside the
process. The whole unit suite should finish in a second or two.

### integration

Tests focused on the **interactions between multiple internal units**,
with every external mocked. Composition tests, in other words.

The defining trait is **scope**: an integration test imports several
modules from `src/` and verifies they wire together correctly. It
never reaches outside the process. The file-system, git, the
network, subprocesses, the OS clock, real databases, real embedding
models: all of it is faked at the boundary, just as in a unit test.

The in-memory IO doubles (`makeMockIO`, `makeAsyncMockIO`) appear
in both unit and integration tests. Tier comes from how many `src/`
modules are under test, not from the doubles in use.

Strong integration signals:

- Imports several modules from `src/` and tests their wiring.
- Uses an in-memory IO double or similar in-memory abstraction
  shared across the modules under test.
- Tests an orchestration / wrapper / plugin layer that ties
  multiple internal modules together with all externals stubbed.

If a test needs the real file-system to do its job — even a
`mkdtemp` sandbox, even just to read fixtures from disk — it
belongs in `e2e`, not `integration`. The cost of "real fs in temp"
is unbounded in the same way subprocess time is: it depends on the
host machine, on what else is running, on the OS scheduler. Keep
integration deterministic.

### e2e

Tests that exercise the full stack with real externals.

Strong e2e signals:

- Spawns subprocesses via `node:child_process`.
- Runs real `git` against a real on-disk repo (`git init`,
  `simpleGit`, etc.).
- Opens a real cozo database (`cozo-node`, `CozoDb`, `openStore`,
  `openMemoryDb`).
- Loads a real embedding model or makes real network calls.
- Waits on real timers — real retry backoff, real timeouts, or
  asserts on elapsed wall-clock time.
- Performance / stress tests that assert "this workload finishes in
  under N seconds".

E2e tests are slow by definition. Keep them honest.

## Mixed files

A single test file may contain a mix of tiers — for example, ten
fetch-mocked behaviour tests alongside six tests that wait on real
retry backoff. When that happens, **split the file**:

```
embeddings.test.js          # unit cases
embeddings.e2e.test.js      # cases that wait on real timers
```

Co-located with the same base name and suffixed by tier. Splitting
keeps the unit tier honest (fast, deterministic, no externals) and
makes the cost of each test obvious from its filename.

If you find yourself reaching for `setTimeout`, real git, or any
other external from a unit test, the answer is one of:

- inject the dependency so the test can mock it (best), or
- move the test to a higher tier (cheap and immediate).

## Adding a test

1. Decide what the test exercises and pick the tier from the table
   above.
2. Name the file with the matching suffix:
   - `foo.test.js` for unit
   - `foo.integration.test.js` for integration
   - `foo.e2e.test.js` for e2e
3. Co-locate it next to similar tests under `tests/`.
4. Run the matching script (`pnpm test:unit`, etc.) to verify.

## Conventions and tools

- All tests use the built-in [`node:test`](https://nodejs.org/api/test.html)
  runner. Assertions use `node:assert/strict`.
- In-memory IO doubles for unit and integration tests live in
  `tests/helpers/`:
  - `mock-io.js` — synchronous (`makeMockIO`)
  - `async-mock-io.js` — async (`makeAsyncMockIO`)
- A real-fs helper, `tests/lib/helpers/real-fs-io.js`, exposes the
  same surface as the in-memory doubles but writes through to a
  `mkdtemp` sandbox. Used by a couple of e2e tests where the
  module under test needs a real file-system to drive.
- Static fixture files for config-validator tests live under
  `tests/lib/config-validators/fixtures/`.

## Scripts

| Command | What it runs |
|---|---|
| `pnpm test` | Unit tests (alias for `test:unit`) |
| `pnpm test:unit` | Unit tests |
| `pnpm test:integration` | Integration tests |
| `pnpm test:e2e` | End-to-end tests |
| `pnpm test:all` | Every tier |
| `pnpm test:coverage` | Every tier with V8 coverage |
| `pnpm build:all` | `lint` → `test:all` → `build` (CI uses this) |
| `pnpm build:full` | `lint --fix` → `test:all` → `build` |
