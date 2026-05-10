# Foundry docs

This directory contains the reference set behind the project README. Every document here has a single purpose; each entry below tells you when to reach for it.

## Start here

- **getting-started.md** — Complete end-to-end installation, bootstrap, and first flow walkthrough. Read this after installing the plugin but before authoring your own configuration; it establishes the operating model and builds confidence in one pass.

- **concepts.md** — The glossary of Foundry's key terms and ideas arranged from flows through cycles, stages, artefacts, and feedback. Reach for this when you encounter terminology you need to understand or as a reference map before diving into work-spec or architecture.

## Reference

- **work-spec.md** — Complete specification of the `WORK.md`, `WORK.feedback.yaml`, and `WORK.history.yaml` file formats, including frontmatter fields, the artefact registry, and the full feedback state machine. Use this when implementing tooling around work files, validating state transitions, or understanding metadata flow.

- **tools.md** — Categorical index and reference documentation for all 64 custom tools, organised by family (lifecycle, artefacts, feedback, config, memory, etc.). Consult this when you need to understand what a specific tool does, its calling conventions, and how it integrates with the overall system.

- **architecture.md** — The design and enforcement model covering token lifecycle, stage-locked mutations, write invariants, branch namespaces, and multi-model routing. Read this when you need to understand how Foundry maintains safety, its guarantees, or why it is structured the way it is.

## Contributors

- **memory-maintenance.md** — Cozo 0.7 adaptations, memory session lifecycle notes, and implementation wisdom for contributors working on the memory subsystem. Start here if you are maintaining or extending memory-related functionality; it documents footguns and edge cases discovered through actual bugs.
