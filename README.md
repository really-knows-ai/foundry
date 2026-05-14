# Foundry

> Engineered confidence for AI-generated work. Define what good looks like.

[![npm version](https://img.shields.io/npm/v/@really-knows-ai/foundry.svg)](https://www.npmjs.com/package/@really-knows-ai/foundry)
[![Tests](https://github.com/really-knows-ai/foundry/actions/workflows/test.yml/badge.svg)](https://github.com/really-knows-ai/foundry/actions/workflows/test.yml)
[![license](https://img.shields.io/npm/l/@really-knows-ai/foundry.svg)](LICENSE)

---

## Engineering confidence

### Confidence is engineered

Generation is cheap; trust is expensive. An agent can produce output quickly, skip
validation, or lose feedback between iterations. The work arrives fast, but the
evidence is incomplete and trust is fragile. Nobody can see the path from prompt to
finish. Nobody knows how many times the agent tried, what it fixed, or why it
stopped.

Foundry is the system around the prompt: explicit standards, repeatable checks, and
recorded sign-off applied to every artefact your AI produces. It transforms "ask an
agent and hope" into a staged system where the checks are structural and mandatory.
If an artefact should be validated, it is validated. If feedback must be resolved,
that state is recorded. If a stage writes outside its lane, the cycle stops. The
framework is deterministic; the LLM is not. Your laws are.

Variability helps where creativity matters; control enforces discipline where
reliability does. You choose what gates each stage passes through, what laws your
artefacts must satisfy, and which models you trust for each decision. Foundry runs
the loop and records every step in git, so the path from draft to approved artefact
is auditable, repeatable, and defensible to auditors and stakeholders. You can show
exactly how the output was made. Confidence is engineered; it is not hoped for.

### The operating model: assay, then forge → quench → appraise

A codebase-aware cycle can begin with **assay**: a deterministic pre-forge stage
that runs project-authored extractor scripts, parses the strict JSONL facts they
emit, and writes typed facts into flow memory. In the foundry metaphor, an assay
establishes composition before work begins. In Foundry, assay gives forge a
measured map of the project before it creates an artefact. Cycles without memory
configuration skip this stage.

After assay, one draft enters a short loop and leaves only when it passes quality
gates. Each loop has four distinct roles that turn a candidate into a verified output:

- **Forge** produces or revises the artefact. The stage that creates and reshapes
  work, responding to feedback from appraisers or building on prior drafts.

- **Quench** runs deterministic checks that harden or reject the work. Validation is
  fast and non-negotiable, catching errors before they reach appraisers.

- **Appraise** judges quality against written laws. Independent evaluators inspect
  whether the work meets the subjective standards you define.

- **Human-appraise** provides direct judgement when the stakes require it or the loop
  deadlocks. Offers human oversight at critical decision points.

Every stage commits separately, so every step leaves a record. Every decision is
timestamped. A single loop produces an **output** — a verified draft. A flow
composes one or more such loops to produce an **outcome** — the final artefact that
reaches your codebase or customers.

### What you describe, what Foundry enforces

You write the laws — the criteria that define acceptable. You describe the artefact
types you want produced and what files they generate. You choose which stages each
cycle passes through and what models to use at each step. You control the operating
model entirely. Your configuration is law.

Foundry runs the loop, gates writes per stage so only the right mutation happens at
the right time, records every decision in git, and stops when there is nothing left
to fix. Each stage holds a token that authorises its mutations. Stages cannot write
outside their assigned lane. Feedback state moves through a state machine that
prevents invalid transitions. The framework owns the process and enforces the rules;
the LLM performs the creative and evaluative work inside each stage. You define the
machine; Foundry runs it. Confidence is the difference.

---

## Compatibility

Foundry works primarily with OpenCode. The skills and tools are portable to other
skill-aware AI systems. Multi-model stage routing is OpenCode-specific today.

- **OpenCode** — full support. Multi-model routing via file-based `foundry-*` agents.
  This is the primary target platform.

- **Other skill-aware AI tools** — the skills and tools are portable to any
  skill-aware AI system. Multi-model stage routing is OpenCode-specific today
  because it relies on `.opencode/agents/` files.

---

## Install

Add the plugin to `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["@really-knows-ai/foundry"]
}
```

Restart OpenCode so the plugin registers. On startup, Foundry bootstraps the
directory structure, generates stage agents, and installs the Foundry guide
agent automatically.

After restart, type **hello foundry**. The assistant will tell you whether a
further restart is needed and when to switch to the Foundry agent.

Optionally, to make the package available to your project's local `node_modules`:

```sh
pnpm add -D @really-knows-ai/foundry
```

---

## Upgrade

Run the `upgrade-foundry` skill from a clean project state when moving an existing project to the installed Foundry version. The skill preserves the existing `foundry/` directory, initialises a fresh current-version configuration, analyses the preserved configuration as source material, and recreates supported concepts through current tools.

The upgrade process asks clarifying questions for ambiguous routing, input contracts, validation behaviour, memory settings, and deprecated concepts. It leaves the preserved source directory in place until you explicitly approve cleanup.

---

## Quick start

### Phase 1 — Install

Add the plugin to `opencode.json` (see Install section above), then restart
OpenCode.

Type **hello foundry**. The assistant will guide you through any remaining
setup. If Foundry was just initialised, it will ask you to restart and switch
to the **Foundry** agent. If Foundry is already set up, it will tell you to
switch to the Foundry agent directly.

### Phase 2 — Switch to the Foundry agent

Switch to the **Foundry** agent. The Foundry agent is the normal interface for
authoring and running Foundry workflows.

### Phase 3 — Ask the Foundry agent for a flow

With the **Foundry** agent active, ask it to set up a flow:

```
> set up a flow that writes haikus
```

Foundry will ask clarifying questions about the flow's purpose, constraints, and
entry points. It will then scaffold a haiku artefact type with a syllable-count
validator, laws for form / imagery / mood, two appraisers with different
sensibilities and bias profiles, a cycle that connects them in sequence, and a flow
that ties it all together. Everything is scaffolded; you do not write any
configuration by hand. This demonstrates the full system in action.

Now run it:

```
> write me a haiku about autumn
```

Here is what the loop produces:

```
forge     → drafts a haiku                          [commit]
quench    → 7/7/5 — fails syllable check            [commit]
forge     → revises                                 [commit]
quench    → 5/7/5 — passes                          [commit]
appraise  → 2 appraisers, one flags weak imagery    [commit]
forge     → revises                                 [commit]
appraise  → clean                                   [commit]
done      → squash-merged to main with attestation
```

Every stage commits. Every decision is recorded. Every piece of feedback and every
revision leaves a trace in the work branch. The final artefact on `main` carries a
signed attestation showing exactly how that output was produced, which models
contributed, and when each appraiser signed off.

This trace is the proof. You can play it back, audit it, replay it under a different
model, or use it to argue that the AI output is trustworthy. Every step is visible.
Nothing is hidden.

For codebase-aware flows, add flow memory after the first run: initialise memory,
declare the entity and edge vocabulary, add extractors, and opt a cycle into
`assay.extractors`. See [Optional: flow memory](docs/getting-started.md#optional-flow-memory)
and [Assay](docs/concepts.md#assay) for the configuration path.

> **Note (3.0.0):** flow memory currently persists to `cozo-node`, which is
> unmaintained upstream. Installation produces six cosmetic deprecation warnings
> from transitive dependencies (`pnpm audit` is clean). Foundry will migrate to
> a maintained backend in a future release; the public `foundry_memory_*` tools
> and on-disk vocabulary/NDJSON format are designed to survive that migration.
> See `CHANGELOG.md` and [docs/memory-maintenance.md](docs/memory-maintenance.md#backend-status-as-of-300).

---

## What you can show your team

After the quick start completes, you have five concrete artefacts to point at to
demonstrate engineered confidence:

- **The artefact itself** — `haikus/autumn.md` on `main`. The final, approved output
  ready for use or deployment.

- **The laws it satisfied** — `foundry/artefacts/haiku/laws.md`. The criteria it was
  measured against, written in markdown and version-controlled.

- **The feedback ledger** — `WORK.feedback.yaml` on the archived work branch. Every
  issue raised, by whom, and how it was resolved during the loop.

- **The per-stage commit history** — the raw commits on `archive/work/<flow>-<...>`.
  A micro-commit per stage showing exactly what changed and why at each step.

- **The signed attestation on main** — the squash commit with the Foundry attestation
  block embedded in its message. Proof of approval, signed and timestamped.

This is what makes "engineered confidence" concrete. You can show your team exactly
how that AI output was produced, what it passed through, why you trust it, and who
signed off. Every step is auditable. Every decision is recorded. The loop is
reproducible.

---

## What's in the box

- **Deterministic governance** — routing, commits, write boundaries, and feedback
  state live in tested plugin code, outside LLM control.

- **Written quality criteria** — laws are markdown files; an appraiser panel scores
  each artefact against them, so quality is objective.

- **Multi-model diversity** — forge on one model, appraise on another, every
  appraiser on a different model if you want. Different models catch different
  mistakes.

- **Full git audit trail** — one commit per stage with `WORK.md`,
  `WORK.feedback.yaml`, and `WORK.history.yaml`. Every iteration is recorded.

- **Signed attestation on main** — every flow finishes with a squash commit carrying
  a canonical Foundry attestation block that proves the artefact was processed.

- **Archived forensic branch** — the raw work branch is retained for auditors as
  `archive/work/<flow>-<desc>-<hash>`. The full micro-history is never lost.

- **Bring your own pipeline** — artefact types, laws, and stages are yours; works
  for code, specs, docs, data, and anything else you can describe as files with
  pass/fail criteria.

- **Assay preflight** — deterministic extractor stage that measures the project
  before forge starts, so codebase-aware flows can begin from structured facts.

- **Flow memory** — typed graph store with scoped tools, semantic search when
  enabled, and committed NDJSON rows for cross-cycle reuse.

---

## Further reading

The full reference set lives in [docs/](docs/) — start at [docs/README.md](docs/README.md)
for a guided index of every document and when to read it.

---

## License

MIT.
