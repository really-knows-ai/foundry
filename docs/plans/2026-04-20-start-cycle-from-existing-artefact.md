# Start Cycle From Existing Artefact — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow any cycle in a flow to be the starting cycle, with its `inputs` contract satisfied by pre-existing files on disk. No tool or schema changes — the fix lives entirely in skill prose.

**Architecture:** Artefacts are just files on disk, classified by their artefact type's `file-patterns`. Forge discovers inputs via filesystem scan against input-type patterns and uses the goal to decide which specific files are relevant. The invariant "only the output artefact type's files may be written" is already enforced by `sort.js`'s `checkModifiedFiles` — nothing to add at the enforcement layer.

**Tech Stack:** Markdown skills only. No Node changes.

**Release:** patch (v2.3.1).

---

## File Structure

- **Modify** `skills/flow/SKILL.md` — starting-cycle selection, between-cycles simplification.
- **Modify** `skills/forge/SKILL.md` — input discovery via filesystem scan; correct the read/write invariant wording.
- **Modify** `CHANGELOG.md` — add v2.3.1 entry.
- **Modify** `package.json` — bump version to 2.3.1.

No code files, no tests, no tool-surface changes.

---

## Task 1: Broaden starting-cycle selection in flow skill

**Files:**
- Modify: `skills/flow/SKILL.md` ("Starting a flow" section, step 3)

- [ ] **Step 1: Read the current flow skill to confirm section anchors**

Run: `sed -n '18,35p' skills/flow/SKILL.md`
Expected: shows the current "Starting a flow" steps 1–5.

- [ ] **Step 2: Replace step 3**

Current step 3 in `skills/flow/SKILL.md`:

```markdown
3. Determine the starting cycle:
   - If only one starting cycle, use it
   - If multiple starting cycles, check whether the user's request makes the choice obvious (e.g., "write a haiku" clearly maps to `create-haiku`)
   - If ambiguous, prompt the user to choose
```

Replace with:

```markdown
3. Determine the starting cycle:
   - Any cycle listed in the flow can be the starting cycle. The flow's `starting-cycles` list is a hint for when the user's request is ambiguous.
   - Map the user's goal to a cycle by matching the requested output (e.g. "write a short story from the tennis haiku" → `create-short-story`; "write a haiku" → `create-haiku`).
   - If the goal is ambiguous, prompt the user to choose from the flow's cycles, defaulting the recommendation to entries in `starting-cycles`.
   - A cycle whose `inputs` contract cannot be satisfied from files already on disk should not be chosen as the starting cycle. If no other cycle matches, inform the user which input types are missing and offer to run a cycle that produces them first.
```

- [ ] **Step 3: Commit**

```bash
git add skills/flow/SKILL.md
git commit -m "feat(flow): allow any cycle in a flow to be the starting cycle"
```

---

## Task 2: Simplify between-cycles logic in flow skill

**Files:**
- Modify: `skills/flow/SKILL.md` ("Between cycles" section, step 5)

- [ ] **Step 1: Replace step 5**

Current step 5:

```markdown
5. Set up the next cycle:
   - Call `foundry_workfile_delete` to clear the completed cycle's WORK.md
   - Call `foundry_workfile_create` with **only** the flow ID, the next cycle ID, and the goal — do **not** pass `stages` or `maxIterations`. The orchestrate skill will detect `needsSetup` on its first call and bootstrap the rest of the frontmatter from the cycle definition.
   - Execute the cycle by invoking the orchestrate skill
```

Replace with:

```markdown
5. Set up the next cycle:
   - Call `foundry_workfile_delete` to clear the completed cycle's WORK.md.
   - Call `foundry_workfile_create` with **only** the flow ID, the next cycle ID, and the goal — do **not** pass `stages` or `maxIterations`. The orchestrate skill will detect `needsSetup` on its first call and bootstrap the rest of the frontmatter from the cycle definition.
   - Do **not** register the completed cycle's output as an input to the next cycle. The output file is on disk and the next cycle's forge discovers it through the input type's `file-patterns` — see the forge skill's input-discovery protocol.
   - Execute the cycle by invoking the orchestrate skill.
```

- [ ] **Step 2: Commit**

```bash
git add skills/flow/SKILL.md
git commit -m "docs(flow): clarify that between-cycle carry-over is unnecessary"
```

---

## Task 3: Define input discovery and correct the write-invariant in forge skill

**Files:**
- Modify: `skills/forge/SKILL.md`

- [ ] **Step 1: Replace step 6 of "First generation"**

Current:

```markdown
6. If the cycle has inputs, read the input artefacts (read-only context).
```

Replace with:

```markdown
6. If the cycle declares `inputs`, discover input files by filesystem scan:
   - For each type listed in `inputs`, call `foundry_config_artefact_type` to get its `file-patterns`.
   - Glob the working tree against those patterns to enumerate candidate input files.
   - Read the goal (from `foundry_workfile_get`) and select the files that are relevant to this run. If the goal names specific files or slugs, use those; if it describes a category ("all the auth tests"), select the matching subset; if it's open-ended, you may consume all candidates or ask the user when the set is clearly ambiguous.
   - Read the selected files for context.
```

- [ ] **Step 2: Apply the same change to step 4 of "Revision"**

Current:

```markdown
4. If the cycle has inputs, read the input artefacts (read-only context).
```

Replace with:

```markdown
4. If the cycle declares `inputs`, discover them via filesystem scan against each input type's `file-patterns` (same protocol as first-generation step 6). Re-read the relevant files — they may have changed on disk since the previous iteration is not guaranteed (though nothing in this cycle wrote to them; they could be modified by the user between iterations).
```

- [ ] **Step 3: Replace the "File-pattern hygiene" section**

Current:

```markdown
## File-pattern hygiene

Writes during forge must match the output artefact type's `file-patterns`. Writing to any other path causes `foundry_stage_finalize` to return `{error: 'unexpected_files'}` and the orchestrator will mark the cycle's target artefact `blocked`. You will not get a retry. Plus `WORK.md` and `WORK.history.yaml` (managed by tools). Nothing else.
```

Replace with:

```markdown
## Write invariant

Forge may only write to:
- Files matching the output artefact type's `file-patterns`.
- `WORK.md` and `WORK.history.yaml` (tool-managed).

Everything else on disk — including files of the cycle's input types, files of unrelated artefact types, and files outside any artefact type — is read-only for this stage. This is not an honor-system rule: `foundry_stage_finalize` returns `{error: 'unexpected_files'}` and `sort`'s `checkModifiedFiles` routes a violation on the next call. Either outcome marks the cycle's target artefact `blocked` and you do not get a retry.

When a cycle's output type overlaps with one of its input types (e.g. a `refine-haiku` cycle with input `haiku` and output `haiku`), the overlap is intentional: the cycle's job is to modify existing files of that type. The write invariant still holds — you may only touch files matching the output type's patterns, which in this case includes the files you read as inputs.
```

- [ ] **Step 4: Update the "What you do NOT do" section**

Current line:

```markdown
- You do not modify input artefacts — they are read-only.
```

Replace with:

```markdown
- You do not write to any file outside the output artefact type's `file-patterns` (plus `WORK.md` / `WORK.history.yaml`). Input files are read-only unless the output type's patterns happen to cover them.
```

- [ ] **Step 5: Commit**

```bash
git add skills/forge/SKILL.md
git commit -m "docs(forge): filesystem-scan input discovery; correct write invariant wording"
```

---

## Task 4: Release hygiene

**Files:**
- Modify: `package.json`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Bump version to 2.3.1 in `package.json`**

Change `"version": "2.3.0"` → `"version": "2.3.1"`.

- [ ] **Step 2: Prepend a 2.3.1 entry to `CHANGELOG.md`**

Insert below the `# Changelog` header, above `## 2.3.0`:

```markdown
## 2.3.1 — 2026-04-20

### Changed
- `flow` skill: any cycle in a flow may now be the starting cycle (previously limited to `starting-cycles`). The list becomes a hint for ambiguous requests. A cycle whose `inputs` contract cannot be satisfied from files on disk is not eligible to start.
- `flow` skill: between-cycles logic no longer implies any carry-over ceremony. The next cycle's forge discovers the previous cycle's output via filesystem scan against its input types' `file-patterns`.
- `forge` skill: input discovery now explicitly uses filesystem scan against each input type's `file-patterns`, with the goal guiding which candidates are relevant.
- `forge` skill: the write invariant is restated accurately — forge may only write to files matching the output artefact type's `file-patterns` (plus the tool-managed files). All other files on disk are read-only. The previous "inputs are read-only" framing was a special case of this rule.

### Notes
- No tool, schema, or enforcement changes. Existing flows continue to work. `sort.js`'s `checkModifiedFiles` already enforces the write invariant.
```

- [ ] **Step 3: Run tests as a smoke check**

Run: `npm test`
Expected: all tests pass (no code changed, so no new failures).

- [ ] **Step 4: Commit**

```bash
git add package.json CHANGELOG.md
git commit -m "chore: release v2.3.1"
```

---

## Self-Review Checklist

- **Spec coverage:**
  - ✅ Start `create-short-story` from an existing haiku → Task 1 (flow skill accepts any cycle) + Task 3 (forge discovers the haiku via filesystem scan).
  - ✅ No artefact registration required → no tasks touch tool surface.
  - ✅ Orchestrator/sort enforces write invariant → already present, called out in Task 3 prose.
- **Placeholder scan:** none — every step includes the exact before/after text.
- **Type consistency:** no types or signatures involved; all changes are prose.

## Out of Scope

- Hard tool-enforcement of `inputs` contracts (today they remain advisory for the LLM; enforcement is via output-write invariant).
- Any change to `foundry_workfile_create`, `foundry_artefacts_add`, or related tools.
- Flow definitions — existing flows and their `starting-cycles` fields continue to work unchanged.
