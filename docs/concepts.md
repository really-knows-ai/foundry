# Concepts

Core concepts and how they relate.

## Foundry Flow

A foundry flow is the top-level unit of work. It is defined in `foundry/flows/` and lists the foundry cycles to execute in order. Starting a foundry flow creates a work branch and a WORK.md file. A foundry flow is complete when all its foundry cycles are done.

## Foundry Cycle

A foundry cycle is an iterative loop that produces a single artefact type. It is defined in `foundry/cycles/` and specifies:
- An output artefact type (read-write)
- Zero or more input artefact types (read-only, from previous foundry cycles)

A foundry cycle runs: forge → quench → appraise, repeating until all feedback is resolved or the iteration limit is hit.

## Stage

The steps within a foundry cycle. Each stage is referenced using a `base:alias` format (e.g. `forge:write-haiku`) where the base is the stage type and the alias describes its role in that cycle.

- Forge — produce or revise the artefact
- Quench — run deterministic CLI checks
- Appraise — subjective evaluation by multiple appraisers
- HITL — human-in-the-loop checkpoint (see below)

## Artefact type

A definition of what kind of thing is being produced. Lives in `foundry/artefacts/<type>/` with:
- `definition.md` — identity, file patterns, output location, prose description
- `laws.md` — type-specific subjective evaluation criteria
- `validation.md` — CLI commands for deterministic quench checks

## Law

A subjective pass/fail criterion. Global laws live in `foundry/laws/` (all files concatenated). Type-specific laws live in `foundry/artefacts/<type>/laws.md`. Each law has an identifier (its heading), used in feedback tags.

## Appraiser

An independent evaluator with a defined personality. Lives in `foundry/appraisers/`. Each appraiser can optionally specify a `model` to override the cycle-level appraise model. Model diversity is configured at the cycle level (via the `models` frontmatter map) and optionally per-appraiser. They can be assigned to specific artefact types or appraise everything.

## WORK.md

The transient shared state for a foundry flow. Created on the work branch, it tracks: where the foundry flow is (frontmatter cursor), what artefacts exist, and all feedback with its full lifecycle. See [work-spec.md](work-spec.md) for the full spec.

## Feedback

The communication mechanism between stages. Written as markdown checklist items in WORK.md with tags (`#validation` or `#law:<id>`). Follows a lifecycle: open → actioned/wont-fix → approved/rejected. See [work-spec.md](work-spec.md) for details.

## HITL

Human-in-the-loop checkpoint. A stage type that pauses the foundry cycle and requests human input before continuing. Configured per cycle by including a `hitl:alias` entry in the `stages` list. When a hitl stage runs, it presents the current artefact state to the human and collects feedback tagged `#hitl`. Like other feedback, hitl feedback follows the standard lifecycle (open → actioned → approved/rejected).

## Micro commit

Every stage ends with a commit (via the `foundry_git_commit` tool). This enables file modification enforcement — the sort tool checks the git diff to ensure each stage only touched files it was allowed to.

## Custom tools

All deterministic pipeline operations are exposed as custom tools via the Foundry plugin. Skills call tools instead of manipulating files directly. The tools are backed by shared library modules in `scripts/lib/` with injectable I/O for testability. This separation ensures that file format parsing, state transitions, and routing logic are handled by tested code rather than LLM interpretation.
