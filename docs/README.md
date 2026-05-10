# Foundry docs

This directory contains the reference set behind the project README. Every document here serves a single purpose; use this index to find what you need.

**How to navigate:** Work through the sections in order: **Start here** establishes conceptual foundations, **Reference** provides detailed specifications for implementation, and **Contributors** covers subsystem maintenance and extensions.

## Start here

Getting oriented with Foundry means understanding both the concepts it uses and how to work within it practically. These documents establish the mental model and hands-on practice you need before authoring configuration or working with flows.

**Reading order:** Work through them in order; [getting-started.md](getting-started.md) builds hands-on confidence, and [concepts.md](concepts.md) provides reference depth. Most implementers spend 1–2 hours on getting-started before moving to Reference materials.

- **getting-started.md** — Complete end-to-end installation, bootstrap (`init-foundry`), and first flow walkthrough. Read this immediately after installing the plugin and before authoring any of your own configuration. 

  It establishes the operating model, directory structure, and practical confidence in one pass. Includes hands-on guidance on authoring the five foundational concepts (artefact types, laws, appraisers, cycles, flows) with worked examples you can run against real code. 

  Implementers must follow every step and complete the bootstrap; architects typically skim for structure before moving to [concepts.md](concepts.md) and [architecture.md](architecture.md) to reason about their designs.

- **concepts.md** — The glossary and conceptual foundation for Foundry's key terms and ideas, arranged top-down from flows through cycles, stages, artefacts, and feedback loops. 

  Reach for this when you encounter terminology you need to understand, or as a reference map before diving into [work-spec.md](work-spec.md) or [architecture.md](architecture.md). Defines each concept affirmatively with concrete examples and links outward to spec documents that elaborate them in detail. 

  Architects especially need this to reason about system boundaries, design decisions, and invariants; implementers reference it iteratively as they build configuration, debug unexpected behaviour, and reason about state transitions.

## Reference

These documents specify formats, tools, and design principles. Use them when implementing tooling, understanding the work-file lifecycle, debugging state transitions, or reasoning about Foundry's guarantees and safety properties.

**Key property:** These are sources of truth and normative references. Changes to Foundry flow formats or tool behaviour must be reflected here first. Use them together—cross-references appear throughout.

- **work-spec.md** — Complete specification of the `WORK.md`, `WORK.feedback.yaml`, and `WORK.history.yaml` file formats, including frontmatter fields, the artefact registry, and the full feedback state machine with all valid transitions and guards. 

  Use this when implementing tooling around work files, validating state transitions, or understanding what metadata flows carry through an execution. It is the authoritative source of truth for all transient work-branch structures, format validation rules, and field semantics. 

  Implementers and tool builders rely on this heavily; keep it updated immediately as formats evolve or new fields are added.

- **tools.md** — Categorical index and reference documentation for all custom tools, organised by family (lifecycle, artefacts, feedback, config, memory, etc.) with complete signatures and permissions. 

  Consult this when you need to understand what a specific tool does, its branch requirements, what stage locks apply, what arguments it accepts, and how it integrates with the overall system. Covers calling conventions, enforcement invariants, and the permission model for memory access. 

  Tool authors and system integrators use this constantly; it is the comprehensive reference for all custom tools in the Foundry ecosystem.

- **architecture.md** — The design and enforcement model covering token lifecycle, stage-locked mutations, write invariants, branch namespaces, multi-model routing, and core design principles. 

  Read this when you need to understand how Foundry maintains safety (how tokens prevent replay, why stages lock mutations, how writes are validated), what guarantees it makes and where they live in the code, or why it is structured the way it is. 

  Architects and contributors working on core systems need this to reason about changes and implications; see also concepts.md for the high-level flow model context and work-spec.md for specifics on format validation and state machines.

## Contributors

Documentation for those extending Foundry's internals or maintaining subsystems. These documents go deeper into implementation detail and capture learning from production experience.

**When to use:** Start here if you are modifying core functionality, debugging subsystem behaviour, or maintaining systems beyond the public API.

- **memory-maintenance.md** — Cozo 0.7 adaptations, memory session lifecycle notes, and derived implementation wisdom for contributors working on the memory subsystem. 

  Start here if you are maintaining or extending memory-related functionality; it documents known footguns (string literal syntax, HNSW index pseudo-relations), session-lifecycle edge cases, tracing techniques, and the runtime extractor system in precise detail. 

  Captures learning from actual bugs and debugging sessions so the next maintainer does not have to discover them again through repeated debugging. Core contributors should read this before touching memory code; it explains why certain patterns are necessary, which changes cascade across the system, and common pitfalls to avoid.
