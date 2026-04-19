# Flow DAG, Human Appraise, and Branch Management — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Evolve Foundry flows from linear cycle lists to DAGs with cycle-owned routing, replace HITL with human-appraise (quality gate + deadlock breaker), add deterministic branch cleanup, and create an upgrade-foundry migration skill.

**Architecture:** Flows declare starting cycles; cycles declare inputs (with any-of/all-of contracts), outputs, and target cycles. Sort gains human-appraise routing with deadlock detection. A new `foundry_git_finish` tool handles squash merge cleanup. The upgrade-foundry skill migrates old-format configs interactively.

**Tech Stack:** Node.js (ESM), js-yaml, minimatch, node:test for testing.

**Spec:** `docs/superpowers/specs/2026-04-19-flow-dag-and-human-appraise-design.md`

---

## File Map

### New files
- `skills/human-appraise/SKILL.md` — human appraise skill (replaces hitl)
- `skills/upgrade-foundry/SKILL.md` — migration skill for upgrading foundry configs

### Modified files — Code
- `scripts/sort.js` — remove hitl routing, add human-appraise routing, add deadlock detection, fix nextAfterAppraise
- `scripts/lib/feedback.js` — add deadlock detection helper
- `.opencode/plugins/foundry.js` — fix workfile_delete, add foundry_git_finish tool

### Modified files — Skills
- `skills/flow/SKILL.md` — rewrite from sequential to DAG traversal
- `skills/add-flow/SKILL.md` — collect starting-cycles instead of ordered list
- `skills/add-cycle/SKILL.md` — collect targets, input contracts, human-appraise config
- `skills/cycle/SKILL.md` — remove hitl references, add human-appraise stage generation
- `skills/sort/SKILL.md` — add human-appraise dispatch rules
- `skills/forge/SKILL.md` — add #human feedback priority rules
- `skills/appraise/SKILL.md` — note human override awareness

### Deleted files
- `skills/hitl/SKILL.md` — replaced by human-appraise

### Test files
- `tests/sort.test.js` — new tests for human-appraise routing, deadlock detection, nextAfterAppraise fix
- `tests/lib/feedback.test.js` — new tests for deadlock detection helper

---

## Task 1: Fix foundry_workfile_delete to clean up WORK.history.yaml

**Files:**
- Modify: `.opencode/plugins/foundry.js:211-221`

- [ ] **Step 1: Write the failing test scenario**

This is a plugin tool — no unit test file exists for it. Verify the current behavior manually:

```bash
# In the foundry project root:
node -e "
import { readFileSync } from 'fs';
const src = readFileSync('.opencode/plugins/foundry.js', 'utf-8');
const match = src.match(/foundry_workfile_delete[\s\S]*?execute\([\s\S]*?\}/);
console.log(match[0]);
"
```

Confirm it only deletes `WORK.md`, not `WORK.history.yaml`.

- [ ] **Step 2: Fix foundry_workfile_delete to also delete WORK.history.yaml**

In `.opencode/plugins/foundry.js`, find the `foundry_workfile_delete` tool (line ~211) and update:

```javascript
      foundry_workfile_delete: tool({
        description: 'Delete WORK.md and WORK.history.yaml',
        args: {},
        async execute(_args, context) {
          const workPath = path.join(context.worktree, 'WORK.md');
          const historyPath = path.join(context.worktree, 'WORK.history.yaml');
          if (existsSync(workPath)) {
            unlinkSync(workPath);
          }
          if (existsSync(historyPath)) {
            unlinkSync(historyPath);
          }
          return JSON.stringify({ ok: true });
        },
      }),
```

- [ ] **Step 3: Run full test suite**

```bash
node --test 'tests/**/*.test.js'
```

Expected: all 152 tests pass (no regressions — this tool has no unit tests).

- [ ] **Step 4: Commit**

```bash
git add .opencode/plugins/foundry.js
git commit -m "fix: foundry_workfile_delete also removes WORK.history.yaml"
```

---

## Task 2: Add foundry_git_finish tool

**Files:**
- Modify: `.opencode/plugins/foundry.js` (add new tool after `foundry_git_commit`)

- [ ] **Step 1: Add the foundry_git_finish tool**

In `.opencode/plugins/foundry.js`, after the `foundry_git_commit` tool definition (~line 393), add:

```javascript
      foundry_git_finish: tool({
        description: 'Clean up work files, squash merge to base branch, and delete the work branch',
        args: {
          message: tool.schema.string().describe('Squash merge commit message'),
          baseBranch: tool.schema.string().optional().describe('Target branch (default: main)'),
        },
        async execute(args, context) {
          const base = args.baseBranch || 'main';
          const cwd = context.worktree;
          const opts = { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] };

          // Get current branch name
          const workBranch = execSync('git branch --show-current', opts).trim();
          if (workBranch === base) {
            return JSON.stringify({ error: `Already on ${base} — nothing to merge` });
          }

          // Delete work files
          const workPath = path.join(cwd, 'WORK.md');
          const historyPath = path.join(cwd, 'WORK.history.yaml');
          if (existsSync(workPath)) unlinkSync(workPath);
          if (existsSync(historyPath)) unlinkSync(historyPath);

          // Commit cleanup if there are changes
          try {
            execSync('git add -A', opts);
            const status = execSync('git status --porcelain', opts).trim();
            if (status) {
              const cleanupMsg = `[${workBranch.replace('work/', '')}] cleanup: remove work files`;
              execSync(`git commit -m "${cleanupMsg.replace(/"/g, '\\"')}"`, opts);
            }
          } catch { /* no changes to commit */ }

          // Switch to base and squash merge
          execSync(`git checkout ${base}`, opts);
          execSync(`git merge --squash ${workBranch}`, opts);
          const msg = args.message.replace(/"/g, '\\"');
          execSync(`git commit -m "${msg}"`, opts);
          const hash = execSync('git rev-parse --short HEAD', opts).trim();

          // Force-delete work branch (required after squash)
          execSync(`git branch -D ${workBranch}`, opts);

          return JSON.stringify({ ok: true, hash, branch: base });
        },
      }),
```

- [ ] **Step 2: Run full test suite**

```bash
node --test 'tests/**/*.test.js'
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add .opencode/plugins/foundry.js
git commit -m "feat: add foundry_git_finish tool for deterministic branch cleanup"
```

---

## Task 3: Fix nextAfterAppraise to advance to next stage

**Files:**
- Modify: `scripts/sort.js:107-122`
- Test: `tests/sort.test.js`

- [ ] **Step 1: Write the failing test**

In `tests/sort.test.js`, find the `describe('nextAfterAppraise'` block and add:

```javascript
  it('advances to next stage when all feedback resolved', () => {
    const stages = ['forge:write', 'quench:review', 'appraise:check', 'human-appraise:review'];
    const feedback = [{ state: 'approved', resolved: true }];
    assert.equal(nextAfterAppraise(stages, 'appraise:check', feedback, 0, 3), 'human-appraise:review');
  });

  it('returns done when appraise is last stage and all resolved', () => {
    const stages = ['forge:write', 'quench:review', 'appraise:check'];
    const feedback = [{ state: 'approved', resolved: true }];
    assert.equal(nextAfterAppraise(stages, 'appraise:check', feedback, 0, 3), 'done');
  });
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --test tests/sort.test.js
```

Expected: first new test FAILS — `nextAfterAppraise` doesn't accept a `current` parameter today.

- [ ] **Step 3: Update nextAfterAppraise signature and implementation**

In `scripts/sort.js`, update `nextAfterAppraise` to accept and use the current stage:

```javascript
function nextAfterAppraise(stages, current, feedback, forgeCount, maxIterations) {
  const needsForge = feedback.some(f => f.state === 'open' || f.state === 'rejected');
  if (needsForge) {
    if (forgeCount >= maxIterations) return 'blocked';
    return findFirst(stages, 'forge') ?? 'blocked';
  }

  const pendingApproval = feedback.some(
    f => (f.state === 'actioned' || f.state === 'wont-fix') && !f.resolved
  );
  if (pendingApproval) {
    return findFirst(stages, 'appraise') ?? 'blocked';
  }

  return nextInRoute(stages, current) ?? 'done';
}
```

- [ ] **Step 4: Update the call site in determineRoute**

In `scripts/sort.js`, update the `determineRoute` function to pass the current stage:

```javascript
  if (lastBase === 'appraise') {
    return nextAfterAppraise(stages, lastEntry, feedback, forgeCount, maxIterations);
  }
```

- [ ] **Step 5: Update existing nextAfterAppraise tests**

The existing tests call `nextAfterAppraise(stages, feedback, forgeCount, maxIterations)` with 4 args. Update them all to pass the current stage as the second parameter. Find all calls in the `describe('nextAfterAppraise'` block and update:

For each existing test, insert `'appraise:check'` as the second argument. For example:

```javascript
// Before:
assert.equal(nextAfterAppraise(stages, feedback, 0, 3), 'forge:write');
// After:
assert.equal(nextAfterAppraise(stages, 'appraise:check', feedback, 0, 3), 'forge:write');
```

Do this for every existing test in the `nextAfterAppraise` block.

- [ ] **Step 6: Run tests**

```bash
node --test tests/sort.test.js
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add scripts/sort.js tests/sort.test.js
git commit -m "fix: nextAfterAppraise advances to next stage instead of returning done"
```

---

## Task 4: Add deadlock detection

**Files:**
- Modify: `scripts/lib/feedback.js`
- Modify: `scripts/sort.js`
- Test: `tests/lib/feedback.test.js`
- Test: `tests/sort.test.js`

- [ ] **Step 1: Write the failing test for detectDeadlocks helper**

In `tests/lib/feedback.test.js`, add at the end:

```javascript
import { detectDeadlocks } from '../../scripts/lib/feedback.js';

describe('detectDeadlocks', () => {
  it('returns empty when no feedback', () => {
    assert.deepEqual(detectDeadlocks([], []), []);
  });

  it('detects feedback that has been rejected multiple times', () => {
    const feedback = [
      { file: 'haiku.md', index: 0, text: 'tone is wrong', tag: 'law:dark-moody-tone', state: 'rejected' },
    ];
    const history = [
      { stage: 'forge:write', cycle: 'c1' },
      { stage: 'appraise:check', cycle: 'c1' },
      { stage: 'forge:write', cycle: 'c1' },
      { stage: 'appraise:check', cycle: 'c1' },
      { stage: 'forge:write', cycle: 'c1' },
      { stage: 'appraise:check', cycle: 'c1' },
    ];
    const result = detectDeadlocks(feedback, history, 3);
    assert.equal(result.length, 1);
    assert.equal(result[0].text, 'tone is wrong');
  });

  it('returns empty when under threshold', () => {
    const feedback = [
      { file: 'haiku.md', index: 0, text: 'tone is wrong', tag: 'law:dark-moody-tone', state: 'rejected' },
    ];
    const history = [
      { stage: 'forge:write', cycle: 'c1' },
      { stage: 'appraise:check', cycle: 'c1' },
    ];
    assert.deepEqual(detectDeadlocks(feedback, history, 3), []);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --test tests/lib/feedback.test.js
```

Expected: FAIL — `detectDeadlocks` is not exported.

- [ ] **Step 3: Implement detectDeadlocks**

In `scripts/lib/feedback.js`, add and export:

```javascript
/**
 * Detect feedback items stuck in a deadlock — rejected N or more times.
 * A deadlock occurs when forge-appraise cycles keep rejecting the same item.
 */
export function detectDeadlocks(feedback, history, threshold = 3) {
  // Count forge→appraise cycles (each pair = one iteration)
  const forgeAppraiseCount = history.filter(
    e => (e.stage || '').split(':')[0] === 'appraise'
  ).length;

  if (forgeAppraiseCount < threshold) return [];

  // Items that are still rejected after threshold iterations are deadlocked
  return feedback.filter(f => f.state === 'rejected' || f.state === 'open');
}
```

- [ ] **Step 4: Run tests**

```bash
node --test tests/lib/feedback.test.js
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/feedback.js tests/lib/feedback.test.js
git commit -m "feat: add detectDeadlocks helper for human-appraise escalation"
```

---

## Task 5: Add human-appraise routing to sort

**Files:**
- Modify: `scripts/sort.js`
- Test: `tests/sort.test.js`

- [ ] **Step 1: Write the failing test for human-appraise routing**

In `tests/sort.test.js`, add to the `determineRoute` describe block:

```javascript
  it('routes to human-appraise after appraise when enabled', () => {
    const stages = ['forge:write', 'quench:review', 'appraise:check', 'human-appraise:review'];
    const history = [
      { stage: 'forge:write', cycle: 'c1' },
      { stage: 'quench:review', cycle: 'c1' },
      { stage: 'appraise:check', cycle: 'c1' },
    ];
    assert.equal(determineRoute(stages, history, [], 3), 'human-appraise:review');
  });
```

- [ ] **Step 2: Run test to verify it passes**

This should already pass after Task 3's `nextAfterAppraise` fix (it now uses `nextInRoute`). If it does, this is a confirmation test. Run:

```bash
node --test tests/sort.test.js
```

- [ ] **Step 3: Write test for human-appraise advancing to done**

```javascript
  it('advances to done after human-appraise', () => {
    const stages = ['forge:write', 'quench:review', 'appraise:check', 'human-appraise:review'];
    const history = [
      { stage: 'forge:write', cycle: 'c1' },
      { stage: 'quench:review', cycle: 'c1' },
      { stage: 'appraise:check', cycle: 'c1' },
      { stage: 'human-appraise:review', cycle: 'c1' },
    ];
    assert.equal(determineRoute(stages, history, [], 3), 'done');
  });

  it('loops back to forge when human-appraise adds feedback', () => {
    const stages = ['forge:write', 'quench:review', 'appraise:check', 'human-appraise:review'];
    const history = [
      { stage: 'forge:write', cycle: 'c1' },
      { stage: 'quench:review', cycle: 'c1' },
      { stage: 'appraise:check', cycle: 'c1' },
      { stage: 'human-appraise:review', cycle: 'c1' },
    ];
    const feedback = [{ state: 'open', tag: 'human' }];
    assert.equal(determineRoute(stages, history, feedback, 3), 'forge:write');
  });
```

- [ ] **Step 4: Add human-appraise handling to determineRoute**

In `scripts/sort.js`, in the `determineRoute` function, add a case for `human-appraise` before the final `return 'blocked'`:

```javascript
  if (lastBase === 'human-appraise') {
    return nextAfterAppraise(stages, lastEntry, feedback, forgeCount, maxIterations);
  }
```

Human-appraise follows the same logic as appraise — if there's open/rejected feedback, loop to forge; otherwise advance.

- [ ] **Step 5: Remove hitl routing from determineRoute**

In `scripts/sort.js`, remove the hitl case:

```javascript
  // DELETE these lines:
  if (lastBase === 'hitl') {
    const next = nextInRoute(stages, lastEntry);
    return next ?? 'done';
  }
```

- [ ] **Step 6: Write test for deadlock escalation to human-appraise**

In `tests/sort.test.js`, add a new describe block:

```javascript
describe('deadlock escalation', () => {
  it('routes to human-appraise on deadlock when enabled', () => {
    const stages = ['forge:write', 'quench:review', 'appraise:check', 'human-appraise:review'];
    const history = [
      { stage: 'forge:write', cycle: 'c1' },
      { stage: 'appraise:check', cycle: 'c1' },
      { stage: 'forge:write', cycle: 'c1' },
      { stage: 'appraise:check', cycle: 'c1' },
      { stage: 'forge:write', cycle: 'c1' },
      { stage: 'appraise:check', cycle: 'c1' },
    ];
    const feedback = [{ state: 'rejected' }];
    assert.equal(determineRoute(stages, history, feedback, 5), 'human-appraise:review');
  });

  it('returns blocked on deadlock when human-appraise not in stages', () => {
    const stages = ['forge:write', 'quench:review', 'appraise:check'];
    const history = [
      { stage: 'forge:write', cycle: 'c1' },
      { stage: 'appraise:check', cycle: 'c1' },
      { stage: 'forge:write', cycle: 'c1' },
      { stage: 'appraise:check', cycle: 'c1' },
      { stage: 'forge:write', cycle: 'c1' },
      { stage: 'appraise:check', cycle: 'c1' },
    ];
    const feedback = [{ state: 'rejected' }];
    assert.equal(determineRoute(stages, history, feedback, 5), 'blocked');
  });
});
```

- [ ] **Step 7: Implement deadlock escalation in determineRoute**

Import `detectDeadlocks` at the top of `scripts/sort.js`:

```javascript
import { parseFeedback, parseFeedbackItem, detectDeadlocks } from './lib/feedback.js';
```

In the `nextAfterAppraise` function, add deadlock check before the `if (needsForge)` block. The function needs the `history` parameter added — update signature and call site:

```javascript
function nextAfterAppraise(stages, current, feedback, forgeCount, maxIterations, history = []) {
  // Check for deadlock escalation
  const deadlocked = detectDeadlocks(feedback, history);
  if (deadlocked.length > 0) {
    const humanAppraise = findFirst(stages, 'human-appraise');
    if (humanAppraise && baseStage(current) !== 'human-appraise') {
      return humanAppraise;
    }
    // Human-appraise not available or we're already in it — blocked
    if (forgeCount >= maxIterations) return 'blocked';
  }

  const needsForge = feedback.some(f => f.state === 'open' || f.state === 'rejected');
  if (needsForge) {
    if (forgeCount >= maxIterations) return 'blocked';
    return findFirst(stages, 'forge') ?? 'blocked';
  }

  const pendingApproval = feedback.some(
    f => (f.state === 'actioned' || f.state === 'wont-fix') && !f.resolved
  );
  if (pendingApproval) {
    return findFirst(stages, 'appraise') ?? 'blocked';
  }

  return nextInRoute(stages, current) ?? 'done';
}
```

Update call sites in `determineRoute` to pass `history`:

```javascript
  if (lastBase === 'appraise') {
    return nextAfterAppraise(stages, lastEntry, feedback, forgeCount, maxIterations, nonSortHistory);
  }

  if (lastBase === 'human-appraise') {
    return nextAfterAppraise(stages, lastEntry, feedback, forgeCount, maxIterations, nonSortHistory);
  }
```

Also update `nextAfterQuench` call — it doesn't need history, but verify signature is unchanged.

- [ ] **Step 8: Update all existing nextAfterAppraise tests**

Add the `history` parameter (default `[]` so existing tests don't need it unless testing deadlock). Verify no existing tests break.

- [ ] **Step 9: Run full test suite**

```bash
node --test 'tests/**/*.test.js'
```

Expected: all tests pass.

- [ ] **Step 10: Commit**

```bash
git add scripts/sort.js tests/sort.test.js
git commit -m "feat: human-appraise routing and deadlock escalation in sort"
```

---

## Task 6: Create human-appraise skill

**Files:**
- Create: `skills/human-appraise/SKILL.md`

- [ ] **Step 1: Write the human-appraise skill**

Create `skills/human-appraise/SKILL.md`:

```markdown
---
name: human-appraise
type: atomic
description: Human quality gate. Presents the artefact to the human for review and collects feedback tagged #human.
---

# Human Appraise

You are a human quality gate. Sort has routed to you either because the LLM appraisers have finished (normal flow) or because a deadlock was detected between forge and appraisers.

## Prerequisites

Before running this skill, verify that the `foundry/` directory exists in the project root. If it does not exist, stop and tell the user:

> Foundry is not initialized in this project. Run the `init-foundry` skill first to create the foundry/ directory structure.

## Protocol

1. Gather context by calling:
   - `foundry_workfile_get` — current state, goal, artefacts
   - `foundry_artefacts_list` — current artefact files and status
   - `foundry_feedback_list` — all existing feedback
   - `foundry_history_list` — what has happened so far

2. Read the artefact file(s) for this cycle.

3. Present to the human:
   - The current artefact content (full file content or multi-file diff)
   - A summary of this iteration's feedback (resolved and open)
   - If this is a deadlock escalation, clearly explain the deadlock:
     - Which feedback item(s) are stuck
     - The appraiser's reasoning
     - Forge's wont-fix or revision justification
     - Ask the human to resolve the disagreement

4. Wait for the human's response.

5. Act on the response:
   - **Approve** — "looks good" / "continue" — no feedback added, sort will advance
   - **Provide feedback** — call `foundry_feedback_add` with the human's feedback and tag `human`. Sort will route back to forge.
   - **Dismiss deadlocked feedback** — call `foundry_feedback_resolve` with `resolution: "approved"` on the deadlocked item(s). This overrides the appraiser.
   - **Abort** — call `foundry_artefacts_set_status` with status `"blocked"`, cycle ends

6. Return a clear summary of what the human decided so sort can log it in history.

## #human feedback rules

- Feedback tagged `human` takes priority over all LLM appraiser feedback
- Forge MUST address `#human` feedback — it cannot wont-fix it
- When `#human` feedback contradicts LLM appraiser feedback, forge follows the human's direction

## What you do NOT do

- You do not make decisions for the human — present the state and wait
- You do not modify the artefact
- You do not skip the pause — the human must respond before continuing
- You do not filter or summarise away important details — show the full picture
- You do not call `foundry_history_append` — sort owns history writing
```

- [ ] **Step 2: Commit**

```bash
git add skills/human-appraise/SKILL.md
git commit -m "feat: add human-appraise skill"
```

---

## Task 7: Delete hitl skill and update referencing skills

**Files:**
- Delete: `skills/hitl/SKILL.md`
- Modify: `skills/cycle/SKILL.md`
- Modify: `skills/sort/SKILL.md`
- Modify: `skills/forge/SKILL.md`
- Modify: `skills/appraise/SKILL.md`

- [ ] **Step 1: Delete hitl skill**

```bash
rm skills/hitl/SKILL.md
rmdir skills/hitl
```

- [ ] **Step 2: Update cycle skill**

In `skills/cycle/SKILL.md`:

Update the frontmatter `composes` to replace `hitl` with `human-appraise`:

```yaml
composes: [sort, forge, quench, appraise, human-appraise]
```

Replace the description on line 10:

```markdown
A foundry cycle reads its definition, sets up the work file for routing, then hands control to the sort skill which drives the forge/quench/appraise/human-appraise loop.
```

Update step 3 (stage route determination) to replace hitl references:

```markdown
3. Determine the stage route:
   - Use the cycle definition's `stages` field if present
   - Otherwise generate defaults: always `forge`, add `quench` if `foundry_config_validation` returns non-null for the type, always `appraise`
   - If the cycle definition has `human-appraise.enabled: true`, append `human-appraise` as the final stage
   - Stages should use `base:alias` format (e.g. `forge:write-haiku`, `quench:check-syllables`). If you pass bare names, the tool will auto-append the cycle ID as the alias.
```

Replace the `## HITL stages` section (lines 50-52) with:

```markdown
## Human Appraise

If the cycle definition has `human-appraise.enabled: true`, the human-appraise stage is included after appraise. Sort will route to it after LLM appraisers pass, or earlier if a deadlock is detected.
```

Update the tag types line (line 73) to replace `hitl` with `human`:

```markdown
Tag types: `validation` (from quench), `law:<law-id>` (from appraise), `human` (from human-appraise) — indicates the source and category of feedback.
```

- [ ] **Step 3: Update sort skill**

In `skills/sort/SKILL.md`, update the route actions in step 3:

Replace:
```markdown
   - `hitl:*` — invoke the hitl skill (no model dispatch — human stage)
```

With:
```markdown
   - `human-appraise:*` — invoke the human-appraise skill (no model dispatch — human stage)
```

- [ ] **Step 4: Update forge skill**

In `skills/forge/SKILL.md`, add a new section before "## What you do NOT do":

```markdown
## #human feedback

Feedback tagged `human` (from the human-appraise stage) takes absolute priority:
- You MUST address it — you cannot wont-fix `#human` feedback
- When `#human` feedback contradicts LLM appraiser feedback on the same topic, follow the human's direction
- Acknowledge the human's input in your revision
```

- [ ] **Step 5: Update appraise skill**

In `skills/appraise/SKILL.md`, add a note in the protocol section about human overrides:

```markdown
### Human override awareness

When reviewing an artefact, check the feedback history for `#human` tagged items. If a human has already ruled on a topic in a prior iteration, do not re-raise the same issue — the human's decision is final.
```

- [ ] **Step 6: Run full test suite**

```bash
node --test 'tests/**/*.test.js'
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: replace hitl with human-appraise across all skills"
```

---

## Task 8: Update cycle definition format (targets + input contracts)

**Files:**
- Modify: `skills/add-cycle/SKILL.md`

- [ ] **Step 1: Update add-cycle skill to collect targets**

In `skills/add-cycle/SKILL.md`, update step 2 (Gather basics) to include:

```markdown
- `targets` — cycle(s) to route to after this cycle completes (may be empty for terminal cycles)
```

- [ ] **Step 2: Update input format to include contract type**

In step 2, update the `inputs` description:

```markdown
- `inputs` — artefact types this cycle reads, with a contract type:
  - `type`: `any-of` (at least one must exist) or `all-of` (all must exist)
  - `artefacts`: list of artefact type IDs
  - May be empty for starting cycles
```

- [ ] **Step 3: Add human-appraise configuration to step 3**

After the model configuration step, add:

```markdown
### 4. Configure human appraise

Ask the user:

> Do you want a human quality gate on this cycle? If enabled, a human reviewer will check the artefact after LLM appraisers pass, and can break deadlocks between forge and appraisers.
>
> - Enable human-appraise? (yes/no)
> - If yes, deadlock threshold (default: 3 — number of forge/appraise iterations before escalating to human)
```

Renumber subsequent steps accordingly.

- [ ] **Step 4: Update the draft definition format**

Update step 8 (Draft the definition) to show the new format:

```markdown
---
id: <id>
name: <name>
output: <artefact-type-id>
inputs:
  type: <any-of|all-of>
  artefacts:
    - <artefact-type-id>
targets:
  - <cycle-id>
human-appraise:
  enabled: <true|false>
  deadlock-threshold: <number>
models:
  appraise: <model-id>
---

# <Name>

<description>
```

- [ ] **Step 5: Replace step 9 (position in flow)**

The old step 9 determined ordering position in the flow's cycle list. Replace with:

```markdown
### 10. Validate target routing

For each target cycle:
- Verify the target cycle exists in `foundry/cycles/`
- Verify this cycle's output type satisfies at least one of the target's input artefacts
- If the target doesn't exist yet, note it as pending

For input validation:
- Verify that at least one cycle in the flow has the input artefact type(s) as its output
- If using `all-of`, verify all input types are producible
```

- [ ] **Step 6: Update step 10 (Write files)**

The old step updated the flow's ordered cycle list. Now it just ensures the cycle is listed in the flow's `## Cycles` section (unordered):

```markdown
### 11. Write files

- Create `foundry/cycles/<id>.md` with the cycle definition
- Update `foundry/flows/<flow-id>.md` to add the cycle to the `## Cycles` list (if not already present)
```

- [ ] **Step 7: Commit**

```bash
git add skills/add-cycle/SKILL.md
git commit -m "feat: update add-cycle skill for targets, input contracts, and human-appraise"
```

---

## Task 9: Update flow definition format and add-flow skill

**Files:**
- Modify: `skills/add-flow/SKILL.md`

- [ ] **Step 1: Update add-flow skill**

In `skills/add-flow/SKILL.md`:

Update the intro (line 9):

```markdown
You help the user create a new foundry flow. A foundry flow is a set of foundry cycles with declared starting points — cycles own their own routing via targets and input contracts.
```

Update step 3 (Determine cycles):

```markdown
### 3. Determine foundry cycles and starting cycles

Ask the user which foundry cycles this flow includes. List available cycles from `foundry/cycles/*.md` for reference.

Then ask: which of these are **starting cycles** — the cycles that can be entered first when the flow begins?

- Starting cycles typically have no input dependencies
- Multiple starting cycles are fine — the user (or context) determines which one to run first
```

Replace step 4 (Validate cycle ordering) with:

```markdown
### 4. Validate cycle graph

For each non-starting cycle, verify it is reachable:
- At least one other cycle in the flow has it as a target
- Its input contract can be satisfied by cycles in the flow

If a cycle is unreachable (no cycle targets it and it's not a starting cycle), warn:

> Cycle `<id>` is not a starting cycle and no other cycle targets it. It will never be reached in this flow.
```

Update step 5 (Draft the definition):

```markdown
### 5. Draft the definition

Present the flow definition to the user:

\`\`\`markdown
---
id: <id>
name: <name>
starting-cycles:
  - <cycle-id>
---

# <Name>

<description>

## Cycles

- <cycle-id>
- <cycle-id>
\`\`\`

The `starting-cycles` field lists entry points. `## Cycles` lists all cycles in the flow (no ordering implied — routing is owned by individual cycle definitions via their `targets` field).

Ask: does this capture the flow correctly?
```

- [ ] **Step 2: Commit**

```bash
git add skills/add-flow/SKILL.md
git commit -m "feat: update add-flow skill for DAG format with starting-cycles"
```

---

## Task 10: Rewrite flow skill for DAG traversal

**Files:**
- Modify: `skills/flow/SKILL.md`

- [ ] **Step 1: Rewrite the flow skill**

Replace the entire content of `skills/flow/SKILL.md` with:

```markdown
---
name: flow
type: composite
description: Orchestrates foundry cycles as a dependency graph, driven by a flow definition.
composes: [cycle]
---

# Flow

A foundry flow reads a flow definition, creates a work branch, and executes cycles by following the dependency graph — each cycle declares its own targets and input contracts.

## Prerequisites

Before running this skill, verify that the `foundry/` directory exists in the project root. If it does not exist, stop and tell the user:

> Foundry is not initialized in this project. Run the `init-foundry` skill first to create the foundry/ directory structure.

## Starting a flow

1. Call `foundry_config_flow` with the flow ID — get the flow definition
2. Call `foundry_git_branch` with the flow ID and a short description — create the work branch
3. Determine the starting cycle:
   - If only one starting cycle, use it
   - If multiple starting cycles, check whether the user's request makes the choice obvious (e.g., "write a haiku" clearly maps to `create-haiku`)
   - If ambiguous, prompt the user to choose
4. Call `foundry_workfile_create` with the flow ID, chosen cycle ID, and goal
5. Execute the cycle by invoking the cycle skill

## Between cycles

When a cycle completes (sort returns `done`):

1. Read the completed cycle's definition to find its `targets`
2. If no targets → this branch of the flow is done. Proceed to "Completing a flow"
3. If one target:
   - Read the target cycle's definition
   - Check input contract: `any-of` requires at least one listed artefact type to exist as a completed artefact; `all-of` requires all
   - If satisfied → ask the user if they want to proceed, or run another starting cycle first
   - If not satisfied → inform the user which artefacts are missing, offer to run cycles that produce them
4. If multiple targets:
   - Present the options to the user
   - Check input contracts for each
   - The user chooses which target to pursue (or which to pursue first)
5. Set up the next cycle:
   - Call `foundry_workfile_set` with `key: "cycle"`, `value: <next-cycle-id>`
   - Reset stages and iteration count for the new cycle
   - Execute the cycle by invoking the cycle skill

## Completing a flow

When all desired cycles are done:

1. Present a summary of what was produced (all artefacts and their status)
2. Ask the user how they want to finish:
   - **Squash merge** — call `foundry_git_finish` with a commit message and base branch
   - **Keep the branch** — leave as-is for manual handling
   - **Create a PR** — push and create a pull request
3. Execute the chosen option

## What you do NOT do

- You do not skip input contract validation
- You do not modify artefacts directly — only cycles modify artefacts
- You do not delete or rewrite feedback history during the flow
- You do not route to a target cycle whose input contract is not met
- You do not assume cycle order — follow the targets declared by each cycle
```

- [ ] **Step 2: Commit**

```bash
git add skills/flow/SKILL.md
git commit -m "feat: rewrite flow skill for DAG traversal with input contracts"
```

---

## Task 11: Create upgrade-foundry skill

**Files:**
- Create: `skills/upgrade-foundry/SKILL.md`

- [ ] **Step 1: Write the upgrade-foundry skill**

Create `skills/upgrade-foundry/SKILL.md`:

```markdown
---
name: upgrade-foundry
type: atomic
description: Analyses and migrates foundry configuration to the current version format.
---

# Upgrade Foundry

You analyse the entire `foundry/` directory and migrate configuration files to the current format, asking the user for clarification where needed.

## Prerequisites

Before running this skill, verify that the `foundry/` directory exists in the project root. If it does not exist, stop and tell the user:

> Foundry is not initialized in this project. Run the `init-foundry` skill first to create the foundry/ directory structure.

## Protocol

### 1. Scan entire foundry directory

Read all configuration files:
- `foundry/flows/*.md` — flow definitions
- `foundry/cycles/*.md` — cycle definitions
- `foundry/artefacts/*/definition.md` — artefact type definitions
- `foundry/artefacts/*/laws.md` — type-specific laws
- `foundry/artefacts/*/validation.md` — validation commands
- `foundry/laws/*.md` — global laws
- `foundry/appraisers/*.md` — appraiser definitions

For each file, parse the frontmatter and body content.

### 2. Detect what needs migration

Check each file against the current expected format:

**Flows:**
- Has `starting-cycles` field? If not → needs DAG migration
- Has ordered numbered list under `## Cycles`? → needs conversion to unordered list

**Cycles:**
- Has `targets` field? If not → needs target routing
- Has `inputs.type` (`any-of`/`all-of`)? If `inputs` is a plain list → needs contract type
- Has `hitl` in stages or frontmatter? → needs human-appraise migration
- Has `human-appraise` config? Check format is correct
- Has `models` map? Check format

**Artefact types:**
- Has required frontmatter fields (`id`, `name`, `file-patterns`)?
- Has `appraisers` config if applicable?

**Appraisers:**
- Has `id` and personality content?
- Has optional `model` field?
- References any deprecated stage types?

**Laws:**
- Uses `## heading` per law?
- Any structural issues?

**Validation:**
- Uses `Command:` / `Failure means:` format?
- Commands have backticks that could cause issues? (Suggest removing — the parser strips them but clean is better)

### 3. Present findings

Present a grouped summary of all issues found:

> **Migration Report**
>
> **Flows (N issues):**
> - `creative-flow.md` — missing `starting-cycles`, has ordered cycle list
>
> **Cycles (N issues):**
> - `create-haiku.md` — missing `targets` field
> - `create-short-story.md` — inputs is plain list, needs `any-of`/`all-of` contract
>
> **Artefact types (N issues):**
> - (none found)
>
> **Appraisers (N issues):**
> - (none found)
>
> **Everything else clean** ✓

If nothing needs migration, say so and stop.

### 4. Migrate flows

For each flow needing migration:
- Show the current ordered cycle list
- Ask: which cycles are starting cycles?
- Infer targets from adjacency (cycle N → cycle N+1)
- Present the proposed `starting-cycles` and confirm
- Convert numbered `## Cycles` list to unordered

### 5. Migrate cycles

For each cycle needing migration:

**Targets:** Infer from the flow's old ordering. Present and confirm:
> Cycle `create-haiku` was followed by `create-short-story` in the flow. Set `targets: [create-short-story]`?

**Input contracts:** If inputs exist as a plain list, ask:
> Cycle `create-short-story` has inputs `[haiku, limerick]`. Should it require:
> 1. `any-of` — at least one must exist
> 2. `all-of` — all must exist

**HITL migration:** If `hitl` is found in stages:
> Cycle `create-haiku` has an `hitl` stage. This has been replaced by `human-appraise`.
> - Enable human-appraise? (yes/no)
> - Deadlock threshold? (default: 3)

Remove `hitl` from stages and add `human-appraise` config if enabled.

### 6. Migrate other config

For artefact types, appraisers, laws, and validation with issues:
- Present each issue with a suggested fix
- Ask the user to confirm or adjust

### 7. Present migration plan

Before writing anything, show the complete list of changes:
- Group by category
- Show each file and the specific changes
- Ask for confirmation

### 8. Apply changes

- Update all affected files
- Commit with message: `[foundry] upgrade: migrate to current format`

## What you do NOT do

- You do not create new cycles, artefact types, or appraisers
- You do not delete existing files without confirmation
- You do not modify artefact content (produced artefacts, not config)
- You do not run automatically — the user invokes it explicitly
- You do not guess when uncertain — ask the user
```

- [ ] **Step 2: Commit**

```bash
git add skills/upgrade-foundry/SKILL.md
git commit -m "feat: add upgrade-foundry skill for config migration"
```

---

## Task 12: Final integration test and version bump

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Run full test suite**

```bash
node --test 'tests/**/*.test.js'
```

Expected: all tests pass.

- [ ] **Step 2: Verify all skills are listed**

Check that all skill directories exist and have SKILL.md:

```bash
ls skills/*/SKILL.md
```

Expected: should include `human-appraise` and `upgrade-foundry`, should NOT include `hitl`.

- [ ] **Step 3: Verify plugin loads without errors**

```bash
node -e "import('./.opencode/plugins/foundry.js').then(() => console.log('OK')).catch(e => console.error(e))"
```

Expected: `OK`

- [ ] **Step 4: Bump version**

In `package.json`, update version to `2.0.0` (breaking change — flow format changed, hitl removed):

```json
"version": "2.0.0"
```

- [ ] **Step 5: Commit and tag**

```bash
git add -A
git commit -m "release: v2.0.0 — DAG flows, human-appraise, branch management"
git tag v2.0.0
```

- [ ] **Step 6: Push and publish**

```bash
git push && git push --tags
npm publish --otp <OTP>
```
