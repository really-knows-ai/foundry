---
name: upgrade-foundry
type: atomic
description: Rebuilds foundry configuration for the current version from preserved source configuration.
---

# Upgrade Foundry

You upgrade a project by preserving its existing Foundry configuration, creating a clean current-version configuration, and recreating supported concepts through current Foundry tools.

This is a rebuild-style upgrade. Treat the old `foundry/` directory as source material. The new `foundry/` directory must be valid for the installed Foundry version.

## Prerequisites

Before running this skill, verify that the project root contains `foundry/`. If it does not, stop and tell the user:

> Foundry is not initialised in this project. Run the `init-foundry` skill first to create the foundry/ directory structure.

Verify a safe base state before making changes:

- The worktree is clean, or the user explicitly chooses how to handle dirty files.
- `WORK.md` is absent from the repository root.
- The upgrade runs from a config branch such as `config/upgrade-foundry`, or you create one with `foundry_git_branch({ kind: 'config', description: 'upgrade-foundry' })` before making config changes.
- Use an isolated worktree where practical, matching the normal config-edit workflow.

If `WORK.md` exists, stop and tell the user:

> An in-flight workfile is present. Complete or discard the active flow before upgrading; active flow state is not migrated.

## Protocol

### 1. Identify versions and source directory

Detect the installed Foundry version from the package manager metadata where possible. Detect the source project version from the existing package metadata or preserved configuration clues where possible.

Choose the preserved source directory name:

- Use a versioned preserved directory when the source version is known, for example `foundry_2.3.2/`.
- Use `foundry_unknown/` when the source version cannot be determined.
- If the chosen directory already exists, ask the user for a different suffix before proceeding.

Before renaming anything, warn the user:

> I will move the existing `foundry/` directory to the preserved source directory, initialise a clean current-version `foundry/`, then recreate supported configuration through current tools. I will not delete the preserved source directory unless you explicitly approve cleanup after review.

Wait for explicit user approval before moving the directory.

### 2. Preserve existing configuration

Move the existing `foundry/` directory to the approved preserved source directory.

Do not modify the preserved source directory after moving it. Read from it as source material only.

### 3. Initialise current-version configuration

Run the current `init-foundry` flow to create a fresh `foundry/` directory for the installed Foundry version.

After initialisation, confirm the new config directory exists and contains the expected current top-level structure.

### 4. Analyse the preserved source

Read source material from the preserved directory:

- Flow definitions.
- Cycle definitions.
- Artefact type definitions.
- Type-specific laws.
- Type-specific validation commands.
- Global laws.
- Appraisers.
- Memory schema, relations, and extractors when present.

Build an inventory with these sections:

- Artefact types to recreate.
- Laws to recreate.
- Appraisers to recreate.
- Cycles to recreate.
- Flows to recreate.
- Memory schema and extractors to recreate.
- Items that need clarification.
- Items with no current-version equivalent.

### 5. Ask clarifying questions

Ask the user before proceeding whenever the old configuration does not map safely to current concepts.

Ask one question at a time. Continue only after the user answers.

Common clarification points:

- Flow routing when old cycle order does not define current `targets` semantics.
- Starting cycles when the old flow has no explicit current-version equivalent.
- Input contracts when old inputs do not state `any-of` or `all-of` intent.
- Artefact ownership when file patterns overlap or are missing.
- Validation commands whose purpose or failure meaning is unclear.
- Appraiser selection when old config lacks counts, allowed appraisers, or personality detail.
- Human appraisal and deadlock settings that map to current fields with changed semantics.
- Memory permissions, extractor outputs, relation files, or schema details whose current contract is ambiguous.
- Deprecated concepts that have no current-version equivalent.

### 6. Recreate configuration through current tools

Use current Foundry tools wherever they exist. Prefer tool-created config over direct file edits.

Recreate concepts in dependency order:

1. Global laws.
2. Appraisers.
3. Artefact types, including type laws and validation commands.
4. Memory schema and extractors when safely inferable.
5. Cycles.
6. Flows.

Use direct file edits only when current tools do not cover a required current-version configuration field. Record each direct edit in the migration report.

Do not recreate active flow state, `WORK.md`, feedback ledgers, branch state, generated artefacts, or historical runtime state.

### 7. Validate current configuration

Run current validation tools for every recreated config kind:

- `foundry_config_validate_law`
- `foundry_config_validate_appraiser`
- `foundry_config_validate_artefact_type`
- `foundry_config_validate_cycle`
- `foundry_config_validate_flow`
- `foundry_memory_validate` when memory is present

Fix validation failures by using current tools or by asking the user for clarification when the fix changes migration intent.

### 8. Commit meaningful checkpoints

Prefer commits at meaningful checkpoints on the config branch:

- Preserved source and fresh initialisation.
- Recreated laws, appraisers, and artefact types.
- Recreated cycles and flows.
- Recreated memory schema and extractors.
- Final validation/report updates.

Use concise commit messages, for example:

```bash
git commit -m "chore: preserve old foundry config for upgrade"
git commit -m "chore: recreate foundry config for current version"
git commit -m "chore: validate upgraded foundry config"
```

### 9. Present migration report

End with a migration report containing these sections:

- Source version and target version.
- Preserved source directory path.
- Created artefact types.
- Created laws.
- Created appraisers.
- Created cycles.
- Created flows.
- Created memory schema and extractors.
- Assumptions made.
- User decisions made during migration.
- Warnings.
- Skipped items.
- Manual follow-up.
- Validation results.
- Cleanup recommendation.

Warnings must be concrete and actionable. Identify files or concepts that need human review.

### 10. Cleanup policy

Do not delete the preserved source directory automatically.

After the user reviews the migration report, ask whether they want to keep or remove the preserved source directory. Keeping it is the safest default until the upgraded configuration has been used successfully.

## What You Do

- Preserve old configuration before creating current configuration.
- Recreate supported concepts through current tools.
- Ask clarifying questions for ambiguous mappings.
- Report assumptions, skipped items, warnings, validation results, and manual follow-up.
- Keep cleanup opt-in.

## What You Do Not Do

- You do not perform byte-for-byte migration of old config files.
- You do not migrate active `WORK.md`, feedback state, branch state, or in-flight flow execution.
- You do not silently infer ambiguous routing, input contracts, memory permissions, or deprecated concepts.
- You do not delete preserved source configuration without explicit user approval.
- You do not modify produced artefacts as part of the upgrade.
