# Orchestrate (v2.3.0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace LLM-driven sort orchestration with a deterministic `foundry_orchestrate` plugin tool, collapsing the 7-step sort protocol into a 3-line LLM loop.

**Architecture:** New `scripts/orchestrate.js` composes existing internal functions (`runSort`, `historyAppend`, `stageFinalize`, `gitCommit`, `workfileConfigureFromCycle`) into a single entry point. Plugin registers only `foundry_orchestrate` for cycle-level work; the lower-level tools are deregistered and become internal imports. Skills `cycle` and `sort` are deleted; new thin `orchestrate` skill drives the loop.

**Tech Stack:** Node.js ESM, `@opencode-ai/plugin ^1.4.0`, `node --test`, existing foundry plugin architecture.

**Spec:** `docs/specs/2026-04-20-orchestrate-design.md`

---

## File Structure

**Create:**
- `scripts/orchestrate.js` — the `runOrchestrate` function + private helpers
- `skills/orchestrate/SKILL.md` — the thin LLM loop skill
- `tests/orchestrate.test.js` — unit tests for `runOrchestrate` (imports scripts/orchestrate.js directly)
- `tests/plugin/orchestrate.test.js` — plugin-level test for `foundry_orchestrate` tool registration

**Modify:**
- `.opencode/plugins/foundry.js` — register `foundry_orchestrate`, deregister internal tools
- `skills/flow/SKILL.md` — invoke orchestrate instead of cycle
- `skills/human-appraise/SKILL.md` — accept context from orchestrate, ensure stage_end call
- `skills/upgrade-foundry/SKILL.md` — v2.3 migration block
- `package.json`, `package-lock.json` — version bump to 2.3.0
- `CHANGELOG.md` — 2.3.0 section

**Delete:**
- `skills/cycle/SKILL.md`
- `skills/sort/SKILL.md`

---

## Task 1: Scaffold `scripts/orchestrate.js` with `renderDispatchPrompt`

**Files:**
- Create: `scripts/orchestrate.js`
- Create: `tests/orchestrate.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/orchestrate.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert';
import { renderDispatchPrompt } from '../scripts/orchestrate.js';

test('renderDispatchPrompt includes stage, cycle, token, cwd, file-patterns', () => {
  const prompt = renderDispatchPrompt({
    stage: 'forge:create-haiku',
    cycle: 'create-haiku',
    token: 'TOKEN_XYZ',
    cwd: '/tmp/work',
    filePatterns: ['haikus/*.md']
  });
  assert.match(prompt, /Stage: forge:create-haiku/);
  assert.match(prompt, /Cycle: create-haiku/);
  assert.match(prompt, /Token: TOKEN_XYZ/);
  assert.match(prompt, /Working directory: \/tmp\/work/);
  assert.match(prompt, /File patterns \(forge only\): \["haikus\/\*\.md"\]/);
  assert.match(prompt, /foundry_stage_begin\({stage, cycle, token}\)/);
  assert.match(prompt, /foundry_stage_end\({summary}\)/);
  assert.match(prompt, /Do NOT call foundry_history_append/);
});

test('renderDispatchPrompt omits file-patterns line for non-forge stages', () => {
  const prompt = renderDispatchPrompt({
    stage: 'quench:create-haiku',
    cycle: 'create-haiku',
    token: 'T',
    cwd: '/w',
    filePatterns: null
  });
  assert.doesNotMatch(prompt, /File patterns/);
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm test -- tests/orchestrate.test.js`
Expected: FAIL — `Cannot find module '../scripts/orchestrate.js'`

- [ ] **Step 3: Implement the helper**

Create `scripts/orchestrate.js`:
```js
// Foundry v2.3.0 orchestrate: deterministic cycle orchestration.
// Composes internal functions (sort, finalize, history, commit, configure)
// into a single entry point the LLM drives via a 3-line loop.

export function renderDispatchPrompt({ stage, cycle, token, cwd, filePatterns }) {
  const lines = [
    `You are a Foundry stage agent. Invoke the ${stage.split(':')[0]} skill and follow its instructions exactly.`,
    ``,
    `Stage: ${stage}`,
    `Cycle: ${cycle}`,
    `Token: ${token}`,
    `Working directory: ${cwd}`,
  ];
  if (filePatterns && filePatterns.length) {
    lines.push(`File patterns (forge only): ${JSON.stringify(filePatterns)}`);
  }
  lines.push(
    ``,
    `Your FIRST tool call MUST be foundry_stage_begin({stage, cycle, token}) using the values above.`,
    `Your LAST tool call MUST be foundry_stage_end({summary}).`,
    ``,
    `When done, report back a brief summary. Do NOT call foundry_history_append, foundry_git_commit, or foundry_artefacts_add — the orchestrator handles all of those.`
  );
  return lines.join('\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/orchestrate.test.js`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add scripts/orchestrate.js tests/orchestrate.test.js
git commit -m "feat(orchestrate): scaffold with renderDispatchPrompt"
```

---

## Task 2: Add `synthesizeStages` helper

Determine the default stage list for a cycle from its artefact-type validation and human-appraise flag.

**Files:**
- Modify: `scripts/orchestrate.js`
- Modify: `tests/orchestrate.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `tests/orchestrate.test.js`:
```js
import { synthesizeStages } from '../scripts/orchestrate.js';

test('synthesizeStages: forge + quench + appraise when validation exists', () => {
  const stages = synthesizeStages({
    cycleId: 'c1',
    hasValidation: true,
    humanAppraise: false
  });
  assert.deepStrictEqual(stages, ['forge:c1', 'quench:c1', 'appraise:c1']);
});

test('synthesizeStages: forge + appraise when no validation', () => {
  const stages = synthesizeStages({
    cycleId: 'c1',
    hasValidation: false,
    humanAppraise: false
  });
  assert.deepStrictEqual(stages, ['forge:c1', 'appraise:c1']);
});

test('synthesizeStages: appends human-appraise when flag true', () => {
  const stages = synthesizeStages({
    cycleId: 'c1',
    hasValidation: true,
    humanAppraise: true
  });
  assert.deepStrictEqual(stages, [
    'forge:c1', 'quench:c1', 'appraise:c1', 'human-appraise:c1'
  ]);
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm test -- tests/orchestrate.test.js`
Expected: FAIL — `synthesizeStages is not a function`

- [ ] **Step 3: Implement**

Append to `scripts/orchestrate.js`:
```js
export function synthesizeStages({ cycleId, hasValidation, humanAppraise }) {
  const stages = [`forge:${cycleId}`];
  if (hasValidation) stages.push(`quench:${cycleId}`);
  stages.push(`appraise:${cycleId}`);
  if (humanAppraise) stages.push(`human-appraise:${cycleId}`);
  return stages;
}
```

- [ ] **Step 4: Run test**

Run: `npm test -- tests/orchestrate.test.js`
Expected: PASS (5 tests total)

- [ ] **Step 5: Commit**

```bash
git add scripts/orchestrate.js tests/orchestrate.test.js
git commit -m "feat(orchestrate): add synthesizeStages helper"
```

---

## Task 3: Add `runOrchestrate` skeleton — "no WORK.md" violation path

The core function. Starts minimal: just detects absence of WORK.md.

**Files:**
- Modify: `scripts/orchestrate.js`
- Modify: `tests/orchestrate.test.js`

- [ ] **Step 1: Write the failing test**

Append:
```js
import { runOrchestrate } from '../scripts/orchestrate.js';

// Minimal in-memory io fixture
function makeIo(files = {}) {
  const fs = new Map(Object.entries(files));
  return {
    fs,
    exists: (p) => fs.has(p),
    readFile: (p) => {
      if (!fs.has(p)) throw new Error(`ENOENT: ${p}`);
      return fs.get(p);
    },
    writeFile: (p, c) => fs.set(p, c),
    unlink: (p) => fs.delete(p),
    mkdir: () => {},
  };
}

test('runOrchestrate: no WORK.md returns violation', () => {
  const io = makeIo({});
  const result = runOrchestrate({}, io);
  assert.strictEqual(result.action, 'violation');
  assert.match(result.details, /no WORK\.md/i);
});
```

- [ ] **Step 2: Run test**

Run: `npm test -- tests/orchestrate.test.js`
Expected: FAIL — `runOrchestrate is not a function`

- [ ] **Step 3: Implement minimal version**

Append to `scripts/orchestrate.js`:
```js
export function runOrchestrate(args = {}, io) {
  if (!io.exists('WORK.md')) {
    return {
      action: 'violation',
      details: 'no WORK.md; flow skill must create it first',
      recoverable: false,
      affected_files: []
    };
  }
  // Stubbed — will be filled in by subsequent tasks
  throw new Error('runOrchestrate: not yet implemented beyond violation path');
}
```

- [ ] **Step 4: Run test**

Run: `npm test -- tests/orchestrate.test.js`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add scripts/orchestrate.js tests/orchestrate.test.js
git commit -m "feat(orchestrate): add runOrchestrate skeleton with no-workfile violation"
```

---

## Task 4: Extract setup-needed detection

Factor out the check "does WORK.md already have `stages` populated?" into a helper so runOrchestrate can call it cleanly.

**Files:**
- Modify: `scripts/orchestrate.js`
- Modify: `tests/orchestrate.test.js`

- [ ] **Step 1: Write the failing test**

Append:
```js
import { needsSetup } from '../scripts/orchestrate.js';

test('needsSetup: true when stages field missing from frontmatter', () => {
  const workMd = `---
flow: creative-flow
cycle: create-haiku
---
# Goal

hello
`;
  assert.strictEqual(needsSetup(workMd), true);
});

test('needsSetup: false when stages populated', () => {
  const workMd = `---
flow: creative-flow
cycle: create-haiku
stages:
  - forge:create-haiku
max-iterations: 3
---
# Goal

hello
`;
  assert.strictEqual(needsSetup(workMd), false);
});
```

- [ ] **Step 2: Run test**

Run: `npm test -- tests/orchestrate.test.js`
Expected: FAIL — `needsSetup is not a function`

- [ ] **Step 3: Implement**

Append to `scripts/orchestrate.js`:
```js
export function needsSetup(workMdContent) {
  // Parse just enough frontmatter to check for `stages:`
  const match = workMdContent.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return true;
  const fm = match[1];
  // Look for a `stages:` key at top level (no leading whitespace)
  return !/^stages:/m.test(fm);
}
```

- [ ] **Step 4: Run test**

Run: `npm test -- tests/orchestrate.test.js`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add scripts/orchestrate.js tests/orchestrate.test.js
git commit -m "feat(orchestrate): add needsSetup helper"
```

---

## Task 5: Wire up first-call bootstrap — setup + commit + first sort

This is the largest single task. Implements the path: fresh WORK.md → synthesize stages → configure → commit → sort → return dispatch action.

**Files:**
- Modify: `scripts/orchestrate.js`
- Modify: `tests/orchestrate.test.js`

- [ ] **Step 1: Study existing module signatures to import**

Read these to understand what you'll call:
- `scripts/sort.js` — `runSort({workPath, historyPath, foundryDir, cycleDef, agentsDir, mint, now}, io)` returns `{route, model?, token?, details?}`
- `scripts/lib/workfile.js` — has `readFrontmatter`, `writeFrontmatter`, and related helpers. Read the file to confirm exact exports.
- `scripts/lib/config.js` — cycle def reading; look for `readCycleDef(cycleId, foundryDir, io)` or equivalent.

- [ ] **Step 2: Write the failing test**

Append to `tests/orchestrate.test.js`:
```js
// Helper: build a minimal in-memory project with cycle definition on disk
function makeBootstrapFixture() {
  const cycleDef = JSON.stringify({
    id: 'create-haiku',
    output: 'haiku',
    inputs: [],
    targets: [],
    stages: ['forge', 'quench', 'appraise'],
    'human-appraise': false,
    'deadlock-appraise': true,
    'deadlock-iterations': 3,
    models: {
      forge: 'github-copilot/claude-sonnet-4.6',
      quench: 'github-copilot/claude-sonnet-4.6',
      appraise: 'github-copilot/gpt-5.4'
    }
  });
  return makeIo({
    'WORK.md': `---
flow: creative-flow
cycle: create-haiku
---
# Goal

haiku about airports
`,
    // Cycle def location — adjust path per scripts/lib/config.js conventions
    'foundry/flows/creative-flow/cycles/create-haiku.md': `---
id: create-haiku
output: haiku
inputs: []
targets: []
stages: [forge, quench, appraise]
human-appraise: false
deadlock-appraise: true
deadlock-iterations: 3
models:
  forge: github-copilot/claude-sonnet-4.6
  quench: github-copilot/claude-sonnet-4.6
  appraise: github-copilot/gpt-5.4
---
# Create Haiku
`,
    'foundry/artefact-types/haiku.md': `---
id: haiku
file-patterns: ["haikus/*.md"]
appraisers:
  count: 3
---
`,
    // Simulate an agent file exists for the forge model slug
    '.opencode/agents/foundry-github-copilot-claude-sonnet-4-6.md': '# agent',
  });
}

test('runOrchestrate first call: runs setup, commits, returns dispatch for forge', (t) => {
  const io = makeBootstrapFixture();
  const commits = [];
  const git = {
    commit: (msg) => { commits.push(msg); return 'abc1234'; },
    status: () => ({ clean: true, dirty: [] }),
  };
  const result = runOrchestrate({
    cwd: '/tmp/project',
    cycleDef: null,
    git,
    mint: () => 'MINTED_TOKEN',
    now: () => 1000000,
  }, io);

  assert.strictEqual(result.action, 'dispatch');
  assert.strictEqual(result.stage, 'forge:create-haiku');
  assert.strictEqual(result.subagent_type, 'foundry-github-copilot-claude-sonnet-4-6');
  assert.match(result.prompt, /Token: MINTED_TOKEN/);
  assert.match(result.prompt, /File patterns \(forge only\): \["haikus\/\*\.md"\]/);

  // WORK.md now has stages populated
  const work = io.readFile('WORK.md');
  assert.match(work, /stages:/);
  assert.match(work, /forge:create-haiku/);

  // A setup commit was recorded
  assert.ok(commits.some(m => m.includes('[create-haiku] setup')),
    `expected a setup commit, got: ${commits.join(', ')}`);
});
```

- [ ] **Step 3: Run test**

Run: `npm test -- tests/orchestrate.test.js`
Expected: FAIL — test throws "not yet implemented"

- [ ] **Step 4: Implement the bootstrap path**

Replace the `runOrchestrate` stub in `scripts/orchestrate.js`:

```js
import { runSort } from './sort.js';
import { readFrontmatter, writeFrontmatter } from './lib/workfile.js';
import { readCycleDef, readArtefactType, readValidation } from './lib/config.js';
// ^^ Confirm exact names by reading scripts/lib/config.js. If names differ,
// use what exists. This plan assumes these three reader functions; adjust
// imports in Step 4 to match the actual exports.

export function runOrchestrate(args = {}, io) {
  const {
    cwd = process.cwd(),
    cycleDef: cycleDefOverride = null,
    git,
    mint,
    now = Date.now,
    lastResult = null,
  } = args;

  if (!io.exists('WORK.md')) {
    return violation('no WORK.md; flow skill must create it first');
  }

  const workContent = io.readFile('WORK.md');
  const fm = readFrontmatter(workContent);
  const cycleId = fm.cycle;
  if (!cycleId) {
    return violation('WORK.md frontmatter missing `cycle` field');
  }

  // --- FIRST-CALL BOOTSTRAP ---
  if (needsSetup(workContent)) {
    if (lastResult) {
      return violation('lastResult provided but WORK.md not yet configured — inconsistent state');
    }
    const cycleDef = cycleDefOverride
      ? JSON.parse(cycleDefOverride)
      : readCycleDef(cycleId, 'foundry', io);
    if (!cycleDef) {
      return violation(`cycle definition not found for id: ${cycleId}`);
    }
    const artefactType = readArtefactType(cycleDef.output, 'foundry', io);
    const validation = readValidation(cycleDef.output, 'foundry', io);
    const stages = cycleDef.stages
      ? cycleDef.stages.map(s => s.includes(':') ? s : `${s}:${cycleId}`)
      : synthesizeStages({
          cycleId,
          hasValidation: !!validation,
          humanAppraise: cycleDef['human-appraise'] === true,
        });

    // Write stages + all cycle-level config into WORK.md frontmatter
    const newFm = {
      ...fm,
      stages,
      'max-iterations': cycleDef['max-iterations'] ?? 3,
      'human-appraise': cycleDef['human-appraise'] === true,
      'deadlock-appraise': cycleDef['deadlock-appraise'] !== false,
      'deadlock-iterations': cycleDef['deadlock-iterations'] ?? 5,
    };
    if (cycleDef.models) newFm.models = cycleDef.models;
    io.writeFile('WORK.md', writeFrontmatter(workContent, newFm));

    git.commit(`[${cycleId}] setup: configure stages and limits`);
  }

  // --- SORT & RETURN NEXT ACTION ---
  const sortResult = runSort({
    cycleDef: cycleDefOverride,
    mint,
    now: now(),
  }, io);

  return handleSortResult(sortResult, { cycleId, cwd, io });
}

function violation(details, affectedFiles = []) {
  return { action: 'violation', details, recoverable: false, affected_files: affectedFiles };
}

function handleSortResult(sortResult, { cycleId, cwd, io }) {
  const { route, model, token, details } = sortResult;

  if (route === 'done') {
    const artefact = findCycleOutputArtefact(cycleId, io);
    return {
      action: 'done',
      cycle: cycleId,
      artefact_file: artefact?.file ?? null,
      next_cycles: readCycleTargets(cycleId, io),
    };
  }
  if (route === 'blocked') {
    const artefact = findCycleOutputArtefact(cycleId, io);
    return {
      action: 'blocked',
      cycle: cycleId,
      artefact_file: artefact?.file ?? null,
      reason: details || 'iteration limit reached with unresolved feedback',
    };
  }
  if (route === 'violation') {
    return violation(details || 'sort returned violation', []);
  }
  if (route.startsWith('human-appraise:')) {
    return {
      action: 'human_appraise',
      stage: route,
      token,
      context: {
        cycle: cycleId,
        artefact_file: findCycleOutputArtefact(cycleId, io)?.file ?? null,
        recent_feedback: readRecentFeedback(cycleId, io),
      },
    };
  }
  // forge|quench|appraise
  const base = route.split(':')[0];
  const filePatterns = base === 'forge'
    ? readForgeFilePatterns(cycleId, io)
    : null;
  return {
    action: 'dispatch',
    stage: route,
    subagent_type: model || 'general',
    prompt: renderDispatchPrompt({
      stage: route,
      cycle: cycleId,
      token,
      cwd,
      filePatterns,
    }),
  };
}

// --- helpers (stubs for next task) ---

function findCycleOutputArtefact(cycleId, io) {
  // Scan WORK.md artefact table for row with matching cycle. Return {file, type, status}.
  // Implementation in Task 6.
  return null;
}

function readCycleTargets(cycleId, io) {
  // Read cycle def, return `targets` array. Implementation in Task 6.
  return [];
}

function readRecentFeedback(cycleId, io) {
  // Return the most recent N feedback items for cycle's artefact. Task 6.
  return [];
}

function readForgeFilePatterns(cycleId, io) {
  // Read cycle.output → artefact-type → file-patterns. Task 6.
  return null;
}
```

**Note:** the import line for `config.js` may need adjustment. Before running the test, open `scripts/lib/config.js` and confirm the exact export names. If the three named readers don't exist, use whatever does (e.g., a single `readYamlFrontmatter` + call it per file).

- [ ] **Step 5: Run test**

Run: `npm test -- tests/orchestrate.test.js`
Expected: PASS — bootstrap path works.

If failing due to config.js import mismatch: read that file, adjust imports, re-run. This is expected; the plan assumes reader names without having inspected the file.

- [ ] **Step 6: Commit**

```bash
git add scripts/orchestrate.js tests/orchestrate.test.js
git commit -m "feat(orchestrate): first-call bootstrap with setup + commit + dispatch"
```

---

## Task 6: Fill in the artefact/target/feedback/file-patterns helpers

Replace the four stub helpers at the bottom of `scripts/orchestrate.js` with real implementations.

**Files:**
- Modify: `scripts/orchestrate.js`
- Modify: `tests/orchestrate.test.js`

- [ ] **Step 1: Write tests for each helper**

Append to `tests/orchestrate.test.js`:
```js
import {
  findCycleOutputArtefact,
  readCycleTargets,
  readForgeFilePatterns,
} from '../scripts/orchestrate.js';

test('findCycleOutputArtefact: returns the artefact row matching cycle', () => {
  const io = makeIo({
    'WORK.md': `---
cycle: create-haiku
---
| File | Type | Cycle | Status |
|------|------|-------|--------|
| haikus/a.md | haiku | create-haiku | draft |
| other/b.md | other | other-cycle | done |
`,
  });
  const a = findCycleOutputArtefact('create-haiku', io);
  assert.strictEqual(a.file, 'haikus/a.md');
  assert.strictEqual(a.type, 'haiku');
  assert.strictEqual(a.status, 'draft');
});

test('findCycleOutputArtefact: returns null when no match', () => {
  const io = makeIo({
    'WORK.md': `---
cycle: create-haiku
---
| File | Type | Cycle | Status |
|------|------|-------|--------|
`,
  });
  assert.strictEqual(findCycleOutputArtefact('create-haiku', io), null);
});

test('readCycleTargets: reads targets from cycle def', () => {
  const io = makeIo({
    'foundry/flows/creative-flow/cycles/create-haiku.md': `---
id: create-haiku
targets: [create-short-story, other]
---
`,
    'WORK.md': `---
flow: creative-flow
cycle: create-haiku
---
`,
  });
  assert.deepStrictEqual(
    readCycleTargets('create-haiku', io),
    ['create-short-story', 'other']
  );
});

test('readForgeFilePatterns: reads via cycle.output → artefact-type', () => {
  const io = makeIo({
    'foundry/flows/creative-flow/cycles/create-haiku.md': `---
id: create-haiku
output: haiku
---
`,
    'foundry/artefact-types/haiku.md': `---
id: haiku
file-patterns: ["haikus/*.md", "haikus/**/*.md"]
---
`,
    'WORK.md': `---
flow: creative-flow
cycle: create-haiku
---
`,
  });
  assert.deepStrictEqual(
    readForgeFilePatterns('create-haiku', io),
    ['haikus/*.md', 'haikus/**/*.md']
  );
});
```

- [ ] **Step 2: Run tests**

Run: `npm test -- tests/orchestrate.test.js`
Expected: FAIL on all four new tests — helpers are stubs/not exported.

- [ ] **Step 3: Implement & export helpers**

In `scripts/orchestrate.js`, replace the four stub functions at the bottom with:

```js
export function findCycleOutputArtefact(cycleId, io) {
  if (!io.exists('WORK.md')) return null;
  const content = io.readFile('WORK.md');
  // Match table rows: | file | type | cycle | status |
  const rowRe = /^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|$/gm;
  let m;
  while ((m = rowRe.exec(content))) {
    const [, file, type, cycle, status] = m;
    if (file === 'File' || file.startsWith('-')) continue; // skip header/divider
    if (cycle.trim() === cycleId) {
      return { file: file.trim(), type: type.trim(), status: status.trim() };
    }
  }
  return null;
}

export function readCycleTargets(cycleId, io) {
  const cycleDef = readCycleDef(cycleId, 'foundry', io);
  return cycleDef?.targets ?? [];
}

export function readForgeFilePatterns(cycleId, io) {
  const cycleDef = readCycleDef(cycleId, 'foundry', io);
  if (!cycleDef?.output) return null;
  const artefactType = readArtefactType(cycleDef.output, 'foundry', io);
  return artefactType?.['file-patterns'] ?? null;
}

function readRecentFeedback(cycleId, io) {
  // For v2.3.0 initial release, return empty — human-appraise skill
  // re-reads feedback itself. Expand later if needed.
  return [];
}
```

**Note:** `findCycleOutputArtefact` parses the WORK.md table manually. If `scripts/lib/artefacts.js` already exposes a suitable reader (e.g., `listArtefacts(io)`), import and use it instead. Check that file first.

- [ ] **Step 4: Run tests**

Run: `npm test -- tests/orchestrate.test.js`
Expected: PASS (all 12 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/orchestrate.js tests/orchestrate.test.js
git commit -m "feat(orchestrate): implement artefact/target/file-patterns helpers"
```

---

## Task 7: Subsequent-call path — finalize + atomic history + commit + next sort

Handles the `lastResult` arm: subagent just finished, now close out the stage and route the next one.

**Files:**
- Modify: `scripts/orchestrate.js`
- Modify: `tests/orchestrate.test.js`

- [ ] **Step 1: Study `scripts/lib/finalize.js`, `scripts/lib/history.js`, `scripts/lib/state.js`**

Confirm exact export names for: `stageFinalize`, `historyAppend`, `readLastStage`. The plan uses these names.

- [ ] **Step 2: Write the failing test**

Append to `tests/orchestrate.test.js`:
```js
test('runOrchestrate subsequent call: finalizes, writes history, commits, routes next', (t) => {
  // Build a fixture where stages are already configured, active token exists,
  // subagent just finished (simulate by writing last-stage.json with a summary).
  const io = makeIo({
    'WORK.md': `---
flow: creative-flow
cycle: create-haiku
stages:
  - forge:create-haiku
  - quench:create-haiku
  - appraise:create-haiku
max-iterations: 3
human-appraise: false
deadlock-appraise: true
deadlock-iterations: 3
---
# Goal

haiku

| File | Type | Cycle | Status |
|------|------|-------|--------|
| haikus/a.md | haiku | create-haiku | draft |
`,
    'WORK.history.yaml': `- cycle: create-haiku
  stage: sort
  route: forge:create-haiku
  timestamp: 1
`,
    '.foundry/last-stage.json': JSON.stringify({
      cycle: 'create-haiku',
      stage: 'forge:create-haiku',
      baseSha: 'abc',
      summary: 'wrote haiku'
    }),
    '.foundry/active-stage.json': JSON.stringify({
      cycle: 'create-haiku',
      stage: 'forge:create-haiku',
      token: 'T',
      baseSha: 'abc'
    }),
    'haikus/a.md': 'cup of coffee / terminal delay / the rain returns',
    'foundry/flows/creative-flow/cycles/create-haiku.md': /* same as fixture above */ ``,
    'foundry/artefact-types/haiku.md': /* same */ ``,
    '.opencode/agents/foundry-github-copilot-claude-sonnet-4-6.md': '# agent',
  });
  const commits = [];
  const git = {
    commit: (msg) => { commits.push(msg); return 'def5678'; },
    status: () => ({ clean: true, dirty: [] }),
  };
  const result = runOrchestrate({
    cwd: '/tmp/project',
    git,
    mint: () => 'TOKEN_2',
    now: () => 2000000,
    lastResult: { kind: 'dispatch', ok: true },
  }, io);

  // Should commit the forge stage
  assert.ok(commits.some(m => m.includes('[create-haiku] forge')),
    `expected forge commit, got: ${commits.join(', ')}`);
  // And return a dispatch for quench
  assert.strictEqual(result.action, 'dispatch');
  assert.strictEqual(result.stage, 'quench:create-haiku');
  // History now has both the original sort entry and a forge completion entry
  const history = io.readFile('WORK.history.yaml');
  assert.match(history, /stage: forge:create-haiku/);
});

test('runOrchestrate subsequent call with lastResult.ok=false marks artefact blocked', () => {
  const io = makeIo({
    'WORK.md': `---
flow: creative-flow
cycle: create-haiku
stages: [forge:create-haiku]
max-iterations: 3
---
| File | Type | Cycle | Status |
|------|------|-------|--------|
| haikus/a.md | haiku | create-haiku | draft |
`,
    '.foundry/active-stage.json': JSON.stringify({
      cycle: 'create-haiku', stage: 'forge:create-haiku', token: 'T', baseSha: 'abc'
    }),
  });
  const git = { commit: () => 'x', status: () => ({ clean: true }) };
  const result = runOrchestrate({
    git, mint: () => 'T', now: () => 1,
    lastResult: { kind: 'dispatch', ok: false, error: 'subagent crashed' },
  }, io);
  assert.strictEqual(result.action, 'violation');
  const work = io.readFile('WORK.md');
  assert.match(work, /\| haikus\/a\.md \| haiku \| create-haiku \| blocked \|/);
});
```

- [ ] **Step 3: Run tests**

Run: `npm test -- tests/orchestrate.test.js`
Expected: FAIL — subsequent-call path not implemented.

- [ ] **Step 4: Implement subsequent-call branch**

In `scripts/orchestrate.js`, add the `lastResult` branch inside `runOrchestrate`, AFTER the `needsSetup` block and BEFORE the unconditional `runSort` call:

```js
  // --- SUBSEQUENT CALL: close out the previous stage ---
  if (lastResult) {
    const activeStage = readActiveStage(io);
    if (!activeStage) {
      return violation('lastResult provided but no active stage recorded — orphaned state');
    }

    // Platform-level failure (task tool errored, subagent crashed) → block.
    if (lastResult.ok === false) {
      markArtefactBlocked(cycleId, io);
      clearActiveStage(io);
      return violation(
        `subagent dispatch failed: ${lastResult.error || 'unknown error'}`,
        [findCycleOutputArtefact(cycleId, io)?.file].filter(Boolean)
      );
    }

    // Finalize: registers artefacts, detects unexpected_files
    const finalizeResult = stageFinalize({ cycle: cycleId }, io);
    if (finalizeResult.error === 'unexpected_files') {
      markArtefactBlocked(cycleId, io);
      clearActiveStage(io);
      return violation(
        `unexpected files written by subagent: ${finalizeResult.files.join(', ')}`,
        finalizeResult.files
      );
    }
    if (finalizeResult.error) {
      markArtefactBlocked(cycleId, io);
      clearActiveStage(io);
      return violation(`stage_finalize error: ${finalizeResult.error}`, []);
    }

    // Read the summary the subagent wrote via stage_end
    const lastStage = readLastStage(io);
    const summary = lastStage?.summary || '(no summary)';

    // Atomic: sort-history entry first (records what sort decided),
    // then stage-history entry (enforcement matches the route).
    historyAppend({
      cycle: cycleId,
      stage: 'sort',
      route: activeStage.stage,
      comment: `route ${activeStage.stage}`,
    }, io);
    historyAppend({
      cycle: cycleId,
      stage: activeStage.stage,
      comment: summary,
    }, io);

    git.commit(`[${cycleId}] ${activeStage.stage}: ${summary}`);
    clearActiveStage(io);
  }

  // --- SORT FOR NEXT ACTION ---
  const sortResult = runSort({
    cycleDef: cycleDefOverride,
    mint,
    now: now(),
  }, io);

  return handleSortResult(sortResult, { cycleId, cwd, io });
```

Add the imports at the top:
```js
import { stageFinalize } from './lib/finalize.js';
import { historyAppend } from './lib/history.js';
import { readActiveStage, readLastStage, clearActiveStage } from './lib/state.js';
```

And add the `markArtefactBlocked` helper:
```js
function markArtefactBlocked(cycleId, io) {
  // Update the artefact row's status column to 'blocked'
  const content = io.readFile('WORK.md');
  const updated = content.replace(
    new RegExp(`(\\|\\s*[^|]+?\\s*\\|\\s*[^|]+?\\s*\\|\\s*${cycleId}\\s*\\|\\s*)([^|]+?)(\\s*\\|)`, 'g'),
    '$1blocked$3'
  );
  io.writeFile('WORK.md', updated);
}
```

**Note:** confirm the exact exports of `finalize.js`, `history.js`. If names differ (e.g., `finalizeStage` not `stageFinalize`), adjust imports.

- [ ] **Step 5: Run tests**

Run: `npm test -- tests/orchestrate.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/orchestrate.js tests/orchestrate.test.js
git commit -m "feat(orchestrate): subsequent-call finalize+history+commit+route"
```

---

## Task 8: Orphaned stage detection (today's bug)

If orchestrate is called without `lastResult` but `active-stage.json` exists, the prior stage was never closed. This is today's ses_256c failure mode.

**Files:**
- Modify: `scripts/orchestrate.js`
- Modify: `tests/orchestrate.test.js`

- [ ] **Step 1: Write the failing test**

Append:
```js
test('runOrchestrate: active stage with no lastResult returns violation (orphaned)', () => {
  const io = makeIo({
    'WORK.md': `---
cycle: create-haiku
stages: [forge:create-haiku]
max-iterations: 3
---
| File | Type | Cycle | Status |
|------|------|-------|--------|
| haikus/a.md | haiku | create-haiku | draft |
`,
    '.foundry/active-stage.json': JSON.stringify({
      cycle: 'create-haiku', stage: 'forge:create-haiku', token: 'T', baseSha: 'abc'
    }),
  });
  const git = { commit: () => 'x', status: () => ({ clean: true }) };
  const result = runOrchestrate({
    git, mint: () => 'T', now: () => 1,
    // no lastResult
  }, io);
  assert.strictEqual(result.action, 'violation');
  assert.match(result.details, /orphaned|prior stage/i);
});
```

- [ ] **Step 2: Run test**

Run: `npm test -- tests/orchestrate.test.js`
Expected: FAIL — currently the no-lastResult path proceeds to runSort without checking for an active stage.

- [ ] **Step 3: Add the orphan check**

In `scripts/orchestrate.js`, inside `runOrchestrate` AFTER `needsSetup` handling and BEFORE the `lastResult` branch, add:

```js
  const activeStage = readActiveStage(io);
  if (activeStage && !lastResult) {
    return violation(
      `prior stage ${activeStage.stage} orphaned — no lastResult provided but active stage exists. ` +
      `Likely cause: previous orchestrate call returned dispatch but caller did not follow up.`,
      []
    );
  }
```

Note: move the `readActiveStage(io)` call from inside the `lastResult` branch up here, and reuse the `activeStage` binding.

- [ ] **Step 4: Run tests**

Run: `npm test -- tests/orchestrate.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/orchestrate.js tests/orchestrate.test.js
git commit -m "feat(orchestrate): detect orphaned active stage (fixes ses_256c bug)"
```

---

## Task 9: Done + blocked + human-appraise routing tests

Tests and small fixups to ensure `handleSortResult` covers all sort routes correctly. Most of the code already exists from Task 5; this task verifies it with targeted tests and fills any gaps.

**Files:**
- Modify: `scripts/orchestrate.js`
- Modify: `tests/orchestrate.test.js`

- [ ] **Step 1: Write tests**

Append three tests, each using a `runSort` stub injected via dependency so we don't have to construct full scenarios:

```js
import * as orchestrate from '../scripts/orchestrate.js';

test('handleSortResult: done route returns done action with next_cycles', () => {
  const io = makeIo({
    'WORK.md': `---
flow: cf
cycle: create-haiku
---
| File | Type | Cycle | Status |
|------|------|-------|--------|
| haikus/a.md | haiku | create-haiku | draft |
`,
    'foundry/flows/cf/cycles/create-haiku.md': `---
id: create-haiku
output: haiku
targets: [create-short-story]
---
`,
  });
  const result = orchestrate.__handleSortResultForTest(
    { route: 'done' },
    { cycleId: 'create-haiku', cwd: '/tmp', io }
  );
  assert.strictEqual(result.action, 'done');
  assert.strictEqual(result.artefact_file, 'haikus/a.md');
  assert.deepStrictEqual(result.next_cycles, ['create-short-story']);
});

test('handleSortResult: blocked route returns blocked action', () => {
  const io = makeIo({
    'WORK.md': `---
cycle: create-haiku
---
| File | Type | Cycle | Status |
|------|------|-------|--------|
| haikus/a.md | haiku | create-haiku | draft |
`,
    'foundry/flows/cf/cycles/create-haiku.md': `---
id: create-haiku
---
`,
  });
  const result = orchestrate.__handleSortResultForTest(
    { route: 'blocked', details: 'iteration limit' },
    { cycleId: 'create-haiku', cwd: '/tmp', io }
  );
  assert.strictEqual(result.action, 'blocked');
  assert.match(result.reason, /iteration limit/);
});

test('handleSortResult: human-appraise route returns human_appraise action', () => {
  const io = makeIo({
    'WORK.md': `---
cycle: create-haiku
---
| File | Type | Cycle | Status |
|------|------|-------|--------|
| haikus/a.md | haiku | create-haiku | draft |
`,
  });
  const result = orchestrate.__handleSortResultForTest(
    { route: 'human-appraise:create-haiku', token: 'HA_TOKEN' },
    { cycleId: 'create-haiku', cwd: '/tmp', io }
  );
  assert.strictEqual(result.action, 'human_appraise');
  assert.strictEqual(result.stage, 'human-appraise:create-haiku');
  assert.strictEqual(result.token, 'HA_TOKEN');
  assert.strictEqual(result.context.cycle, 'create-haiku');
  assert.strictEqual(result.context.artefact_file, 'haikus/a.md');
});
```

- [ ] **Step 2: Run tests**

Run: `npm test -- tests/orchestrate.test.js`
Expected: FAIL — `__handleSortResultForTest` not exported.

- [ ] **Step 3: Export a test shim**

In `scripts/orchestrate.js`, add at the bottom (after the definition of `handleSortResult`):

```js
// Test-only export; keep underscored to discourage runtime use.
export { handleSortResult as __handleSortResultForTest };
```

- [ ] **Step 4: Run tests**

Run: `npm test -- tests/orchestrate.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/orchestrate.js tests/orchestrate.test.js
git commit -m "test(orchestrate): cover done/blocked/human-appraise routing"
```

---

## Task 10: Register `foundry_orchestrate`; deregister absorbed tools

**Files:**
- Modify: `.opencode/plugins/foundry.js`
- Create: `tests/plugin/orchestrate.test.js`

- [ ] **Step 1: Write the failing integration test**

Create `tests/plugin/orchestrate.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';

const PLUGIN = readFileSync('.opencode/plugins/foundry.js', 'utf8');

test('plugin registers foundry_orchestrate', () => {
  assert.match(PLUGIN, /foundry_orchestrate:\s*tool/);
});

test('plugin does NOT register foundry_sort', () => {
  assert.doesNotMatch(PLUGIN, /foundry_sort:\s*tool/);
});

test('plugin does NOT register foundry_history_append', () => {
  assert.doesNotMatch(PLUGIN, /foundry_history_append:\s*tool/);
});

test('plugin does NOT register foundry_stage_finalize', () => {
  assert.doesNotMatch(PLUGIN, /foundry_stage_finalize:\s*tool/);
});

test('plugin does NOT register foundry_git_commit', () => {
  assert.doesNotMatch(PLUGIN, /foundry_git_commit:\s*tool/);
});

test('plugin does NOT register foundry_workfile_configure_from_cycle', () => {
  assert.doesNotMatch(PLUGIN, /foundry_workfile_configure_from_cycle:\s*tool/);
});

test('plugin does NOT register foundry_workfile_set', () => {
  assert.doesNotMatch(PLUGIN, /foundry_workfile_set:\s*tool/);
});
```

- [ ] **Step 2: Run tests**

Run: `npm test -- tests/plugin/orchestrate.test.js`
Expected: FAIL — first test (no `foundry_orchestrate` yet); others may pass or fail depending.

- [ ] **Step 3: Modify `.opencode/plugins/foundry.js`**

1. Remove the six tool registrations: `foundry_history_append`, `foundry_stage_finalize`, `foundry_workfile_set`, `foundry_workfile_configure_from_cycle`, `foundry_sort`, `foundry_git_commit`. Delete the entire `tool({ ... })` block for each.

2. Add `foundry_orchestrate` registration. Insert after `foundry_workfile_delete`:

```js
foundry_orchestrate: tool({
  description: 'Run the next step of the current cycle. Call with no args on first invocation; call with lastResult={kind,ok} after a dispatch/human_appraise completes. Returns {action, ...} describing what the caller should do next.',
  args: {
    lastResult: tool.schema.object({
      kind: tool.schema.string(),
      ok: tool.schema.boolean(),
      error: tool.schema.string().optional(),
    }).optional(),
    cycleDef: tool.schema.string().optional().describe('Test-mode cycle definition override (JSON string)'),
  },
  async execute(args) {
    const { runOrchestrate } = await import('../../scripts/orchestrate.js');
    const git = {
      commit: (msg) => gitCommitInternal(msg, io),  // reuse existing helper
      status: () => gitStatusInternal(io),
    };
    return JSON.stringify(runOrchestrate({
      cwd: process.cwd(),
      cycleDef: args.cycleDef,
      git,
      mint: makeTokenMinter(),
      now: () => Date.now(),
      lastResult: args.lastResult ?? null,
    }, io));
  },
}),
```

**Note:** the exact `git` and `io` bindings must match existing plugin patterns. Read the deleted `foundry_git_commit` block for the commit helper shape. Read an existing tool like `foundry_stage_begin` for how `io` is constructed. Copy those patterns.

3. Remove imports that are no longer used (e.g., if `workfileConfigureFromCycle` was imported only for its tool, remove it — but keep it if `runOrchestrate` reaches it transitively).

- [ ] **Step 4: Run tests**

Run: `npm test -- tests/plugin/orchestrate.test.js`
Expected: PASS (all 7).

Also run the full suite:
Run: `npm test`
Expected: All pass, except any tests that directly exercised the deregistered tools — those should be deleted or refactored in Task 11.

- [ ] **Step 5: Commit**

```bash
git add .opencode/plugins/foundry.js tests/plugin/orchestrate.test.js
git commit -m "feat(plugin): register foundry_orchestrate; deregister absorbed tools"
```

---

## Task 11: Clean up tests that exercise deregistered tools

**Files:**
- Modify: `tests/plugin/preconditions.test.js` (and possibly others)

- [ ] **Step 1: Run the full suite and identify failures**

Run: `npm test`

Expected: some tests fail because they invoked the deregistered tools directly through the plugin harness.

- [ ] **Step 2: For each failing test, decide:**

- If the test's intent is to verify the tool-layer behavior of a now-deregistered tool → **delete the test**. The underlying logic is still tested via `tests/sort.test.js` etc. (internal function tests).
- If the test's intent is a precondition/flow that happens to touch the tool → **refactor** to call the internal function directly (`import { historyAppend } from '../../scripts/lib/history.js'`).

- [ ] **Step 3: Apply changes**

Make the edits per Step 2.

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add tests/
git commit -m "test: clean up tests for deregistered plugin tools"
```

---

## Task 12: Delete `cycle` and `sort` skills

**Files:**
- Delete: `skills/cycle/SKILL.md`
- Delete: `skills/sort/SKILL.md`

- [ ] **Step 1: Remove the skill directories**

```bash
git rm -r skills/cycle skills/sort
```

- [ ] **Step 2: Verify nothing else references them**

```bash
rg -n "skills/cycle|skills/sort|'cycle'|'sort'" --type md --type js . | grep -v node_modules
```

For each hit:
- Documentation references → update to mention `orchestrate` skill.
- Code references to skill names (e.g., `invoke the 'cycle' skill`) → update.
- `AGENTS.md`, `README.md`, `docs/concepts.md`, `docs/getting-started.md` — scan and update.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "refactor(skills): delete cycle and sort skills (replaced by orchestrate)"
```

---

## Task 13: Create `orchestrate` skill

**Files:**
- Create: `skills/orchestrate/SKILL.md`

- [ ] **Step 1: Write the skill**

Create `skills/orchestrate/SKILL.md`:

```markdown
---
name: orchestrate
description: Runs a foundry cycle by calling foundry_orchestrate in a loop and acting on the returned action.
---

# Orchestrate

You drive a foundry cycle by calling `foundry_orchestrate` repeatedly and acting on each returned `action`. The tool owns all step-ordering, history, committing, and routing. Your job is to dispatch subagents, run human-appraise when asked, and report terminal states.

## Prerequisites

Before running this skill, verify that `foundry/` exists in the project root and `WORK.md` has been created by the flow skill (with `flow`, `cycle`, and `goal` fields). If not, stop and tell the user to run the flow skill first.

## Protocol

Loop until `foundry_orchestrate` returns a terminal action (`done`, `blocked`, or `violation`):

1. Call `foundry_orchestrate({lastResult})`. Omit `lastResult` on the first iteration. On subsequent iterations, pass `{kind, ok}` reflecting the previous action's outcome.

2. Switch on the returned `action`:

### `dispatch`

Payload: `{stage, subagent_type, prompt}`.

Call the `task` tool:
```
task tool:
  subagent_type: <subagent_type-from-payload>
  description: "Run <stage> for <cycle>"
  prompt: <prompt-from-payload — pass verbatim>
```

When the task returns, call `foundry_orchestrate({lastResult: {kind: 'dispatch', ok: true}})`. If the task tool itself errored or reported a subagent crash, pass `{kind: 'dispatch', ok: false, error: '<message>'}`.

### `human_appraise`

Payload: `{stage, token, context}`.

Invoke the `human-appraise` skill inline, passing `{cycle, token, context}`. The skill will prompt the user, collect feedback, and call `foundry_stage_end({summary})`.

When it returns, call `foundry_orchestrate({lastResult: {kind: 'human_appraise', ok: true}})`.

### `done`

Payload: `{cycle, artefact_file, next_cycles}`.

1. Call `foundry_artefacts_set_status({file: artefact_file, status: 'done'})`.
2. Report to the user: "Cycle `<cycle>` complete. Output: `<artefact_file>`. Next cycles available: `<next_cycles>`."
3. Return control to the flow skill.

### `blocked`

Payload: `{cycle, artefact_file, reason}`.

Report to the user: "Cycle `<cycle>` blocked on `<artefact_file>`: `<reason>`." Return control to the flow skill. The artefact has already been marked blocked.

### `violation`

Payload: `{details, affected_files}`.

Report to the user: "Cycle halted (violation): `<details>`. Affected files: `<affected_files>`." Return control to the flow skill. Affected artefacts have already been marked blocked.

## What you do NOT do

- You do NOT inline forge / quench / appraise work. Always dispatch via `task`.
- You do NOT mint, modify, or cache tokens. The `prompt` from orchestrate already contains the token verbatim.
- You do NOT call `foundry_history_append`, `foundry_git_commit`, `foundry_stage_finalize`, or `foundry_sort`. These are not registered tools in v2.3+; orchestrate handles them internally.
- You do NOT reorder the protocol. `foundry_orchestrate` returns, you act, you call back. Nothing else between.
```

- [ ] **Step 2: Commit**

```bash
git add skills/orchestrate/SKILL.md
git commit -m "feat(skills): add orchestrate skill (thin LLM loop)"
```

---

## Task 14: Update `flow` skill to invoke orchestrate

**Files:**
- Modify: `skills/flow/SKILL.md`

- [ ] **Step 1: Update the two references**

Open `skills/flow/SKILL.md`. Find the two places that say "invoke the cycle skill" (one in "Starting a flow" step 6, one in "Between cycles" step 5 or similar) and replace with "invoke the **orchestrate** skill".

Also find the step that says `foundry_workfile_create` must be called with only `{flow, cycle, goal}` and confirm it's still accurate (it is — orchestrate handles setup on first call).

- [ ] **Step 2: Verify**

```bash
rg -n "cycle skill" skills/flow/SKILL.md
```

Expected: no matches.

```bash
rg -n "orchestrate skill" skills/flow/SKILL.md
```

Expected: at least two matches.

- [ ] **Step 3: Commit**

```bash
git add skills/flow/SKILL.md
git commit -m "docs(skills): flow invokes orchestrate instead of cycle"
```

---

## Task 15: Update `human-appraise` skill

**Files:**
- Modify: `skills/human-appraise/SKILL.md`

- [ ] **Step 1: Read current skill**

Read `skills/human-appraise/SKILL.md` to understand current entry signature and behavior.

- [ ] **Step 2: Add context acceptance**

At the top of the skill's "Protocol" section (or equivalent), add:

```markdown
## Input

When invoked from orchestrate, you receive `{cycle, token, context}`:
- `cycle` — the current cycle id
- `token` — single-use token for `foundry_stage_begin`
- `context.artefact_file` — the target artefact
- `context.recent_feedback` — recent deadlocked feedback items to present to the user

Your FIRST tool call must be `foundry_stage_begin({stage: 'human-appraise:<cycle>', cycle, token})`.

Your LAST tool call must be `foundry_stage_end({summary: '<one-sentence description of the user verdict>'})` — orchestrate reads this summary for the commit message.
```

- [ ] **Step 3: Verify stage_end is mentioned**

```bash
rg -n "stage_end" skills/human-appraise/SKILL.md
```

Expected: at least one match.

- [ ] **Step 4: Commit**

```bash
git add skills/human-appraise/SKILL.md
git commit -m "docs(skills): human-appraise accepts orchestrate context, requires stage_end"
```

---

## Task 16: Update `upgrade-foundry` with v2.3.0 migration block

**Files:**
- Modify: `skills/upgrade-foundry/SKILL.md`

- [ ] **Step 1: Add v2.3.0 section**

Append to `skills/upgrade-foundry/SKILL.md` (or insert at the top of the version-specific blocks, whatever the existing convention is):

```markdown
## v2.2.x → v2.3.0

v2.3.0 replaces the LLM-driven sort orchestrator with the `foundry_orchestrate` plugin tool. The `cycle` and `sort` skills are removed. Six tools are deregistered: `foundry_sort`, `foundry_history_append`, `foundry_stage_finalize`, `foundry_git_commit`, `foundry_workfile_configure_from_cycle`, `foundry_workfile_set`. `foundry_artefacts_add` is removed entirely.

### Pre-flight checks

Before upgrading, verify a clean base state. Abort the upgrade if any of these fail:

1. **Branch**: must be on `main` (or the user's configured default base branch).
   - Check: `git rev-parse --abbrev-ref HEAD` — must match expected default.
   - If on `work/*`: abort with "You're on a work branch. Switch to main and complete or discard any in-flight flow before upgrading."

2. **Working tree**: must be clean.
   - Check: `git status --porcelain` — must be empty.
   - If dirty: abort with "Uncommitted changes. Commit or stash before upgrading."

3. **In-flight workfile**: `WORK.md` must not exist.
   - Check: is `WORK.md` present in the repo root?
   - If yes: abort with "In-flight workfile detected. Delete it (`foundry_workfile_delete`) or complete the cycle before upgrading."

Only when all three pass, proceed with the plugin swap.

### Upgrade steps

1. Install the new plugin package version: `npm install @really-knows-ai/foundry@2.3.0 --save-dev`.
2. Swap `.opencode/plugins/foundry.js` with the new version from `node_modules/@really-knows-ai/foundry/.opencode/plugins/foundry.js`.
3. Remove `skills/cycle/` and `skills/sort/` directories from the project if they exist locally (they shouldn't — skills live in the package).
4. Commit the upgrade: `chore: upgrade foundry to 2.3.0`.

No state migration is performed. In-flight cycles from v2.2.x must be completed or discarded before upgrading.
```

- [ ] **Step 2: Commit**

```bash
git add skills/upgrade-foundry/SKILL.md
git commit -m "docs(skills): upgrade-foundry pre-flight checks and steps for v2.3.0"
```

---

## Task 17: Full-cycle integration test

End-to-end test that drives `runOrchestrate` through a complete happy-path cycle (forge → quench → appraise → done). Uses a scripted sequence of `lastResult` inputs.

**Files:**
- Create: `tests/orchestrate-integration.test.js`

- [ ] **Step 1: Write the test**

Create `tests/orchestrate-integration.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert';
import { runOrchestrate } from '../scripts/orchestrate.js';

// This test drives a complete cycle by calling runOrchestrate repeatedly,
// simulating subagent completion by manipulating the in-memory fs between calls.
//
// Flow: first call (bootstrap → dispatch forge) → simulate forge completion →
//       call again (commit forge → dispatch quench) → simulate quench completion →
//       call again (commit quench → dispatch appraise) → simulate appraise completion →
//       call again (commit appraise → done)

test('runOrchestrate integration: full happy-path cycle', () => {
  // ... build a fixture with cycle def that has no quench validation,
  // so the cycle is forge → appraise only (simpler). Extend later.
  // Drive the loop:
  //   1. result = runOrchestrate({}) → expect action='dispatch', stage='forge:...'
  //   2. Write output file, write active-stage.json, write last-stage.json with summary
  //   3. result = runOrchestrate({lastResult: {kind:'dispatch', ok:true}}) → expect action='dispatch', stage='appraise:...'
  //   4. Write last-stage.json for appraise, write resolved feedback
  //   5. result = runOrchestrate({lastResult: {kind:'dispatch', ok:true}}) → expect action='done'

  // Full implementation left as a concrete exercise — the plan sketches the shape.
  // Concrete code expected: ~150 lines of fixture setup + 5-6 orchestrate calls with assertions.
});
```

**Note:** this is the one task where I'm allowing a sketch rather than full code, because the exact fixture shape depends on final signatures from Tasks 5-9 and is best written against the real module. The test author should flesh it out to cover the full loop and drive at least one real cycle end-to-end.

- [ ] **Step 2: Implement the integration test**

Fill in the test body. The expected shape:

1. Build an in-memory fixture identical to `makeBootstrapFixture()` in `tests/orchestrate.test.js`, but with `quench` omitted from cycle-def stages (so the cycle is forge → appraise).
2. Add a `git` stub that records commits.
3. Call `runOrchestrate({git, mint, now})` → expect `action: 'dispatch'`, `stage: 'forge:create-haiku'`.
4. Simulate the forge subagent: write `haikus/a.md`, write `.foundry/last-stage.json` with `{summary: 'wrote haiku'}`, clear `active-stage.json` is done by orchestrate not subagent — check current behavior. You may need to simulate what `stage_begin`/`stage_end` would write.
5. Call `runOrchestrate({git, mint, now, lastResult: {kind:'dispatch', ok:true}})` → expect `action: 'dispatch'`, `stage: 'appraise:create-haiku'`. Assert that `git.commit` was called with a `[create-haiku] forge:` message.
6. Simulate appraise subagent: write approved feedback, last-stage.json summary.
7. Call again → expect `action: 'done'`, `artefact_file: 'haikus/a.md'`.
8. Assert total commit count and content.

- [ ] **Step 3: Run test**

Run: `npm test -- tests/orchestrate-integration.test.js`
Expected: PASS.

If it fails due to unexpected `runSort` behavior with the simulated state, iterate on the fixture until the sort decisions match expectations. This test is as much about validating the contract between orchestrate and sort as about orchestrate itself.

- [ ] **Step 4: Run full suite**

Run: `npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add tests/orchestrate-integration.test.js
git commit -m "test(orchestrate): full happy-path integration test"
```

---

## Task 18: Version bump + CHANGELOG

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Bump version in package.json**

Open `package.json`, change `"version": "2.2.1"` → `"version": "2.3.0"`.

- [ ] **Step 2: Regenerate lockfile**

Run: `npm install`
Expected: updates `package-lock.json` to reference 2.3.0.

- [ ] **Step 3: Add CHANGELOG entry**

Prepend to `CHANGELOG.md` (above the 2.2.1 section):

```markdown
## 2.3.0 — 2026-04-20

### Breaking

- **LLM orchestration replaced with deterministic `foundry_orchestrate` tool.** The `cycle` and `sort` skills are removed; replaced by a single thin `orchestrate` skill that drives a 3-line loop.
- **Six tools deregistered** from the plugin (still exist as internal imports for tests): `foundry_sort`, `foundry_history_append`, `foundry_stage_finalize`, `foundry_git_commit`, `foundry_workfile_configure_from_cycle`, `foundry_workfile_set`.
- **`foundry_artefacts_add` removed entirely.** `foundry_stage_finalize` (internal) registers forge outputs.
- Upgrade requires clean main + no in-flight workfile (see `upgrade-foundry` skill).

### Added

- `foundry_orchestrate` — single tool that owns the sort → history → dispatch → finalize → history → commit loop. Atomic stage completion.
- `scripts/orchestrate.js` — deterministic orchestration logic, composes existing internal functions.
- Orphaned-stage detection: if orchestrate is called without `lastResult` but an active stage exists, returns `violation`. Fixes the ses_256c failure mode where an LLM skipped the post-dispatch history append and wedged the cycle.

### Fixed

- Root cause of all deferred HARDEN.md bugs (B, C, D, E, G) and the ses_256c bug: LLM misfollowing a deterministic protocol. Protocol now lives inside the plugin tool.

### Migration

See `skills/upgrade-foundry/SKILL.md` for v2.3.0 pre-flight checks. No automated state migration — complete or discard in-flight cycles on v2.2.x before upgrading.
```

- [ ] **Step 4: Verify tests still pass**

Run: `npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json CHANGELOG.md
git commit -m "chore(release): 2.3.0"
```

---

## Task 19: Tag and publish (manual, operator-supervised)

- [ ] **Step 1: Confirm on main with clean tree**

```bash
git status
git rev-parse --abbrev-ref HEAD
```

Expected: `main`, clean.

- [ ] **Step 2: Tag**

```bash
git tag v2.3.0
```

- [ ] **Step 3: Push**

```bash
git push origin main
git push origin v2.3.0
```

- [ ] **Step 4: Publish to npm**

```bash
npm publish --access=public
```

Expected: `@really-knows-ai/foundry@2.3.0` published. May prompt for OTP.

- [ ] **Step 5: Verify**

```bash
npm view @really-knows-ai/foundry@2.3.0 version
```

Expected: `2.3.0`.

---

## Self-Review

**Spec coverage check** (walking each spec section):

- ✅ Architecture overview → Tasks 1–10 implement the runOrchestrate pipeline
- ✅ Plugin split (registered vs internal) → Task 10 handles registration, Task 11 cleans up tests
- ✅ `foundry_orchestrate` contract (input/output/internal flow) → Tasks 3–9
- ✅ Skill changes (flow, cycle-deleted, sort-deleted, orchestrate-new, human-appraise) → Tasks 12–15
- ✅ Migration (upgrade-foundry pre-flight) → Task 16
- ✅ Error recovery table (all 7 scenarios) → Tasks 3 (no WORK.md), 7 (subagent crash, unexpected_files, stage_not_ended), 8 (orphaned), Bug E check retained (not explicitly re-tested, noted in spec as belt-and-suspenders)
- ✅ Testing approach → Tasks 1–9 unit, Task 17 integration, Task 10 plugin-level
- ✅ `cycleDef` test-mode input → plumbed in Task 5

**Placeholder scan:** Task 17 intentionally sketches rather than fully codes the integration test, because the exact fixture depends on final signatures from prior tasks. Explicit note added. No other placeholders.

**Type/name consistency:**
- `runOrchestrate` signature stable across tasks: `(args, io)` where args = `{cwd, cycleDef, git, mint, now, lastResult}`.
- `handleSortResult` signature stable: `(sortResult, {cycleId, cwd, io})`.
- Internal function imports (`runSort`, `stageFinalize`, `historyAppend`, `readActiveStage`, etc.) — plan includes a pre-step instructing the developer to verify exact export names before wiring, because I didn't inspect every lib file. This is a known soft spot.
- `lastResult` field shape `{kind, ok, error?}` used consistently across Tasks 3, 7, 10, 13, 17.

**Scope check:** one spec, ~19 tasks, single plan feasible. No decomposition needed.

## Execution Approach

**Decided: Subagent-Driven Development** (via `superpowers:subagent-driven-development` skill).

Fresh subagent per task, review between tasks. Rationale: most tasks are TDD red/green/refactor cycles with contained scope — clean context per task avoids drift and produces cleaner commits than inline batching.

When executing:
- Load the `subagent-driven-development` skill at session start
- Dispatch one subagent per Task (1 through 19), in order
- Review each subagent's commit before dispatching the next
- Tasks 5 and 7 require a pre-step to verify exact export names in `scripts/lib/config.js`, `scripts/lib/history.js`, `scripts/lib/finalize.js` — flag this to the subagent up front
