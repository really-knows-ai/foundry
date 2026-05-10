# Foundry docs

This directory contains the reference set behind the project README. Every document here has a single purpose; each entry below tells you when to reach for it.

## Start here

- **getting-started.md** — Complete end-to-end installation, bootstrap (`init-foundry`), and first flow walkthrough. Read this after installing the plugin but before authoring any of your own configuration; it establishes the operating model, directory structure, and hands-on confidence in one pass. Includes practical guidance on authoring the five foundational concepts (artefact types, laws, appraisers, cycles, flows).

- **concepts.md** — The glossary and conceptual foundation for Foundry's key terms and ideas, arranged top-down from flows through cycles, stages, artefacts, and feedback. Reach for this when you encounter terminology you need to understand, or as a reference map before diving into work-spec or architecture; it defines each concept affirmatively and links outward to the spec documents that elaborate them.

## Reference

- **work-spec.md** — Complete specification of the `WORK.md`, `WORK.feedback.yaml`, and `WORK.history.yaml` file formats, including frontmatter fields, the artefact registry, and the full feedback state machine with all valid transitions. Use this when implementing tooling around work files, validating state transitions, or understanding what metadata flows carry through an execution. It is the source of truth for all transient work-branch structures.

- **tools.md** — Categorical index and reference documentation for all 64 custom tools, organised by family (lifecycle, artefacts, feedback, config, memory, etc.). Consult this when you need to understand what a specific tool does, its branch requirements, what stage lock guards apply, and how it integrates with the overall system. It covers calling conventions, enforcement invariants, and the permission model for memory access.

- **architecture.md** — The design and enforcement model covering token lifecycle, stage-locked mutations, write invariants, branch namespaces, multi-model routing, and core design principles. Read this when you need to understand how Foundry maintains safety (how tokens prevent replay, why stages lock mutations, how writes are validated), its guarantees and where they live, or why it is structured the way it is.

## Contributors

- **memory-maintenance.md** — Cozo 0.7 adaptations, memory session lifecycle notes, and derived implementation wisdom for contributors working on the memory subsystem. Start here if you are maintaining or extending memory-related functionality; it documents footguns (string literal syntax, HNSW index pseudo-relations), session-lifecycle edge cases, and the runtime extractor system. Captures learning from actual bugs so the next maintainer does not have to discover them again.
