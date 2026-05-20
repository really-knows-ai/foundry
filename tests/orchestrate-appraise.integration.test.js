/**
 * Integration tests for the internal appraise route (Phase 5).
 *
 * Verifies that:
 * - Appraise gather returns dispatch_multi with correct task structure
 * - Empty appraisers/artefacts produce empty dispatch_multi
 * - Consolidation correctly posts feedback, resolves prior items, finalises
 * - Full cycle with forge → quench → appraise → done works end-to-end
 * - Forge dispatch and human-appraise are unchanged
 * - handleSortResult returns violation for appraise routes
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { runOrchestrate } from '../src/scripts/orchestrate.js';
import { readActiveStage, readLastStage, writeActiveStage, writeLastStage, clearActiveStage } from '../src/scripts/lib/state.js';
import { consolidateAppraise } from '../src/scripts/appraise-module.js';
import { openFeedbackStore } from '../src/scripts/lib/feedback-store.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeIo(files = {}) {
  const fs = new Map(Object.entries(files));
  const dirs = new Map();
  // Track directories implicitly via writeFile
  const trackDir = (p) => {
    const parts = p.split('/');
    for (let i = 1; i < parts.length; i++) {
      const dir = parts.slice(0, i).join('/');
      if (dir) dirs.set(dir, true);
    }
  };
  for (const key of fs.keys()) trackDir(key);

  return {
    fs, dirs,
    exists: (p) => fs.has(p) || dirs.has(p),
    readFile: (p) => {
      if (!fs.has(p)) throw new Error(`ENOENT: ${p}`);
      return fs.get(p);
    },
    writeFile: (p, c) => { fs.set(p, c); trackDir(p); },
    rename: (from, to) => {
      if (!fs.has(from)) throw new Error(`ENOENT: ${from}`);
      fs.set(to, fs.get(from));
      fs.delete(from);
    },
    unlink: (p) => fs.delete(p),
    mkdir: () => {},
    readDir: async (p) => {
      const prefix = p.endsWith('/') ? p : `${p}/`;
      const entries = [];
      for (const key of fs.keys()) {
        if (key.startsWith(prefix)) {
          const rest = key.slice(prefix.length);
          const idx = rest.indexOf('/');
          entries.push(idx === -1 ? rest : rest.slice(0, idx));
        }
      }
      return [...new Set(entries)].sort();
    },
    exec: () => '',
  };
}

function makeArgs(overrides = {}) {
  return {
    cwd: '/tmp/project',
    git: {
      commit: () => 'abc1234',
      status: () => ({ clean: true, dirty: [] }),
    },
    mint: () => 'T1',
    now: () => 1700000000000,
    ...overrides,
  };
}

function makeFinalizeTracker() {
  const calls = [];
  const finalize = async (ctx) => {
    calls.push(ctx);
    return { ok: true, artefacts: [] };
  };
  return { calls, finalize };
}

const BASE_WORK = `---
flow: test-flow
cycle: test-cycle
stages:
  - forge:test-cycle
  - quench:test-cycle
  - appraise:test-cycle
max-iterations: 3
human-appraise: false
deadlock-appraise: true
deadlock-iterations: 5
models:
  forge: openai/gpt-4o
  quench: openai/gpt-4o
  appraise: openai/gpt-4o
---
# Test

| File | Type | Cycle | Status |
|------|------|-------|--------|
| out/a.md | haiku | test-cycle | draft |
`;

const CYCLE_DEF = `---
id: test-cycle
output-type: haiku
stages: [forge, quench, appraise]
---`;

const ARTEFACT_DEF = `---
id: haiku
file-patterns: ["out/*.md"]
appraisers:
  count: 2
  allowed: [strict-reviewer]
---`;

const APPRAISER_FILE = `---
id: strict-reviewer
model: openai/gpt-4o
---
You are a strict reviewer who checks for clarity and correctness.
`;

const AGENT_FILE = '# agent';

// ---------------------------------------------------------------------------
// AC5.1 — Appraise gather returns dispatch_multi with correct task structure
// ---------------------------------------------------------------------------

test('AC5.1: appraise gather returns dispatch_multi with one task per appraiser', async () => {
  const io = makeIo({
    'WORK.md': BASE_WORK,
    'foundry/cycles/test-cycle.md': CYCLE_DEF,
    'foundry/artefacts/haiku/definition.md': ARTEFACT_DEF,
    'foundry/appraisers/strict-reviewer.md': APPRAISER_FILE,
    '.opencode/agents/foundry-openai-gpt-4o.md': AGENT_FILE,
    'out/a.md': 'a haiku about code',
  });

  const { finalize } = makeFinalizeTracker();
  const args = makeArgs({ finalize });

  // Call 1: setup → forge dispatch
  const r1 = await runOrchestrate(args, io);
  assert.strictEqual(r1.action, 'dispatch');
  assert.strictEqual(r1.stage, 'forge:test-cycle');

  // Simulate forge lifecycle
  writeActiveStage(io, {
    cycle: 'test-cycle',
    stage: 'forge:test-cycle',
    token: 'T1',
    baseSha: 'abc1234',
  });
  writeLastStage(io, {
    cycle: 'test-cycle',
    stage: 'forge:test-cycle',
    baseSha: 'abc1234',
    summary: 'wrote draft',
  });
  clearActiveStage(io);

  // Call 2: finalize forge → internal quench → appraise gather
  const r2 = await runOrchestrate({ ...args, lastResult: { ok: true }, finalize }, io);

  // Must return dispatch_multi, not dispatch
  assert.strictEqual(r2.action, 'dispatch_multi',
    'appraise gather must return dispatch_multi');
  assert.strictEqual(r2.stage, 'appraise:test-cycle');
  assert.strictEqual(r2.cycle, 'test-cycle');

  // Tasks should contain one per appraiser (we configured count: 2)
  assert.ok(Array.isArray(r2.tasks), 'tasks must be an array');
  assert.strictEqual(r2.tasks.length, 2, 'expected 2 appraiser tasks');
  for (let i = 0; i < r2.tasks.length; i++) {
    assert.strictEqual(typeof r2.tasks[i].subagent_type, 'string',
      `tasks[${i}].subagent_type must be a string`);
    assert.strictEqual(typeof r2.tasks[i].prompt, 'string',
      `tasks[${i}].prompt must be a string`);
    assert.match(r2.tasks[i].prompt, /You are an appraiser/,
      `tasks[${i}].prompt must start with appraiser greeting`);
    assert.match(r2.tasks[i].prompt, /You are a strict reviewer/,
      `tasks[${i}].prompt should include appraiser personality`);
  }
});

// ---------------------------------------------------------------------------
// AC5.2 — Consolidation after dispatch_multi
// ---------------------------------------------------------------------------

test('AC5.2: consolidate appraise posts feedback for appraiser issues', async () => {
  const io = makeIo({
    'out/a.md': 'a haiku about code',
  });

  // Set up active stage as the gather phase would
  writeActiveStage(io, {
    cycle: 'test-cycle',
    stage: 'appraise:test-cycle',
    token: null,
    baseSha: 'abc1234',
  });

  // Track finalize calls
  const finalizeCalls = [];
  const ctx = {
    cycleId: 'test-cycle',
    io,
    git: { commit: () => 'sha', status: () => ({ clean: true, dirty: [] }) },
    finalize: async ({ lastStage, activeStage }) => {
      finalizeCalls.push(lastStage);
      return null;
    },
    foundryDir: 'foundry',
    defaultModel: 'openai/gpt-4o',
    activeStage: readActiveStage(io),
    lastStage: readLastStage(io),
    feedback: {
      add: (item) => {
        const store = openFeedbackStore('WORK.feedback.yaml', io);
        return store.add({
          file: item.file,
          tag: item.tag,
          text: item.text,
          source: 'appraise:test-cycle',
          cycle: 'test-cycle',
        });
      },
      list: (query) => {
        const store = openFeedbackStore('WORK.feedback.yaml', io);
        let items = store.list();
        if (query?.file) items = items.filter(it => it.file === query.file);
        if (query?.source) items = items.filter(it => it.source === query.source);
        return items;
      },
      resolve: (id, decision) => {
        const store = openFeedbackStore('WORK.feedback.yaml', io);
        const target = decision === 'approved' ? 'resolved' : 'rejected';
        return store.transition({ id, target, stage: 'appraise:test-cycle', cycle: 'test-cycle' });
      },
    },
  };

  // Call consolidateAppraise directly with two successful appraiser results
  const lastResults = [
    {
      ok: true,
      output: `- file: out/a.md\n  law: style\n  issue: Use consistent line length\n  evidence: Lines vary between 5 and 12 syllables`,
    },
    {
      ok: true,
      output: `- file: out/a.md\n  law: clarity\n  issue: Metaphor is unclear\n  evidence: "terminal delay" does not evoke a clear image`,
    },
  ];

  const result = await consolidateAppraise(ctx, lastResults);

  // Consolidation must succeed
  assert.strictEqual(result.ok, true, 'consolidation must succeed');
  assert.ok(result.summary, 'consolidation should return a summary');

  // Finalize must have been called
  assert.strictEqual(finalizeCalls.length, 1,
    'finalize must be called during consolidation');

  // Feedback should have been posted for both issues
  const store = openFeedbackStore('WORK.feedback.yaml', io);
  const allItems = store.list();
  const appraiseItems = allItems.filter(it => it.source === 'appraise:test-cycle');
  assert.strictEqual(appraiseItems.length, 2,
    'expected 2 feedback items from appraise consolidation');
  assert.ok(appraiseItems.some(it => it.tag === 'law:style'),
    'expected feedback tagged law:style');
  assert.ok(appraiseItems.some(it => it.tag === 'law:clarity'),
    'expected feedback tagged law:clarity');
});

// ---------------------------------------------------------------------------
// AC5.3 — No appraisers → empty tasks → done
// ---------------------------------------------------------------------------

test('AC5.3: no appraisers available returns empty tasks, cycle proceeds to done', async () => {
  const io = makeIo({
    'WORK.md': BASE_WORK,
    'foundry/cycles/test-cycle.md': CYCLE_DEF,
    'foundry/artefacts/haiku/definition.md': `---
id: haiku
file-patterns: ["out/*.md"]
---`,
    // No appraisers configured — appraisers key is absent
    '.opencode/agents/foundry-openai-gpt-4o.md': AGENT_FILE,
    'out/a.md': 'a haiku about code',
  });

  const { finalize } = makeFinalizeTracker();
  const args = makeArgs({ finalize });

  // Call 1: setup → forge dispatch
  const r1 = await runOrchestrate(args, io);
  assert.strictEqual(r1.action, 'dispatch');

  // Simulate forge lifecycle
  writeActiveStage(io, {
    cycle: 'test-cycle',
    stage: 'forge:test-cycle',
    token: 'T1',
    baseSha: 'abc1234',
  });
  writeLastStage(io, {
    cycle: 'test-cycle',
    stage: 'forge:test-cycle',
    baseSha: 'abc1234',
    summary: 'wrote draft',
  });
  clearActiveStage(io);

  // Call 2: forge → quench → appraise (empty tasks → consolidate → done)
  const r2 = await runOrchestrate({ ...args, lastResult: { ok: true }, finalize }, io);

  // No appraisers → empty dispatch_multi → internal consolidate → done
  assert.strictEqual(r2.action, 'done',
    'no appraisers should lead to done');
});

// ---------------------------------------------------------------------------
// AC5.4 — Failed appraiser treated as no issues (non-fatal)
// ---------------------------------------------------------------------------

test('AC5.4: a failed appraiser subagent contributes no issues, non-fatal', async () => {
  const io = makeIo({
    'out/a.md': 'a haiku about code',
  });

  // Set up active stage as gather phase would
  writeActiveStage(io, {
    cycle: 'test-cycle',
    stage: 'appraise:test-cycle',
    token: null,
    baseSha: 'abc1234',
  });

  // Build context for consolidateAppraise
  const ctx = {
    cycleId: 'test-cycle',
    io,
    git: { commit: () => 'sha', status: () => ({ clean: true, dirty: [] }) },
    finalize: async () => null,
    foundryDir: 'foundry',
    defaultModel: 'openai/gpt-4o',
    activeStage: readActiveStage(io),
    lastStage: readLastStage(io),
    feedback: {
      add: (item) => {
        const store = openFeedbackStore('WORK.feedback.yaml', io);
        return store.add({
          file: item.file,
          tag: item.tag,
          text: item.text,
          source: 'appraise:test-cycle',
          cycle: 'test-cycle',
        });
      },
      list: (query) => {
        const store = openFeedbackStore('WORK.feedback.yaml', io);
        let items = store.list();
        if (query?.file) items = items.filter(it => it.file === query.file);
        if (query?.source) items = items.filter(it => it.source === query.source);
        return items;
      },
      resolve: (id, decision) => {
        const store = openFeedbackStore('WORK.feedback.yaml', io);
        const target = decision === 'approved' ? 'resolved' : 'rejected';
        return store.transition({ id, target, stage: 'appraise:test-cycle', cycle: 'test-cycle' });
      },
    },
  };

  // One appraiser succeeds, one fails
  const lastResults = [
    { ok: true, output: `- file: out/a.md\n  law: style\n  issue: Use consistent line length\n  evidence: Lines vary` },
    { ok: false, error: 'subagent crashed' },
  ];

  const result = await consolidateAppraise(ctx, lastResults);

  // Not a violation — the one success is enough
  assert.strictEqual(result.ok, true,
    'one successful appraiser should not produce a violation');

  // Only the successful appraiser's issue should be posted
  const store = openFeedbackStore('WORK.feedback.yaml', io);
  const issues = store.list().filter(it => it.source === 'appraise:test-cycle');
  assert.strictEqual(issues.length, 1,
    'only one issue from the successful appraiser');
  assert.strictEqual(issues[0].tag, 'law:style');
});

// ---------------------------------------------------------------------------
// AC5.5 — All appraisers fail → violation
// ---------------------------------------------------------------------------

test('AC5.5: all appraisers failing produces a violation', async () => {
  const io = makeIo({
    'out/a.md': 'a haiku about code',
  });

  // Set up active stage as gather phase would
  writeActiveStage(io, {
    cycle: 'test-cycle',
    stage: 'appraise:test-cycle',
    token: null,
    baseSha: 'abc1234',
  });

  const ctx = {
    cycleId: 'test-cycle',
    io,
    git: { commit: () => 'sha', status: () => ({ clean: true, dirty: [] }) },
    finalize: async () => null,
    foundryDir: 'foundry',
    defaultModel: 'openai/gpt-4o',
    activeStage: readActiveStage(io),
    lastStage: readLastStage(io),
    feedback: {
      add: () => {},
      list: () => [],
      resolve: () => {},
    },
  };

  // Both appraisers fail
  const lastResults = [
    { ok: false, error: 'subagent timed out' },
    { ok: false, error: 'subagent crashed' },
  ];

  const result = await consolidateAppraise(ctx, lastResults);

  assert.strictEqual(result.action, 'violation',
    'all appraisers failing must return violation');
  assert.match(result.details || '', /All appraisers failed/,
    'violation details should mention all appraisers failed');
});

// ---------------------------------------------------------------------------
// AC5.6 — handleSortResult guard for appraise route
// ---------------------------------------------------------------------------

test('AC5.6: handleSortResult returns violation if appraise route reaches it', async () => {
  // Import handleSortResult directly
  const { __handleSortResultForTest } = await import('../src/scripts/orchestrate.js');
  const ctx = { cycleId: 'test-cycle', cwd: '/tmp', io: makeIo() };
  const sortResult = { route: 'appraise:test-cycle', model: 'some-model', token: 'T1' };

  const result = await __handleSortResultForTest(sortResult, ctx);
  assert.strictEqual(result.action, 'violation');
  assert.match(result.details || '', /handleSortResult/,
    'violation must indicate appraise should have been handled upstream');
});

// ---------------------------------------------------------------------------
// AC5.7 — Full cycle: forge → quench → appraise → done
// ---------------------------------------------------------------------------

test('AC5.7: full cycle forge → quench → appraise (dispatch_multi) → consolidate → done', async () => {
  const io = makeIo({
    'WORK.md': BASE_WORK,
    'foundry/cycles/test-cycle.md': CYCLE_DEF,
    'foundry/artefacts/haiku/definition.md': ARTEFACT_DEF,
    'foundry/appraisers/strict-reviewer.md': APPRAISER_FILE,
    '.opencode/agents/foundry-openai-gpt-4o.md': AGENT_FILE,
    'out/a.md': 'a haiku about code',
  });

  const commits = [];
  const git = {
    commit: (msg) => { commits.push(msg); return 'sha' + commits.length; },
    status: () => ({ clean: true, dirty: [] }),
  };
  const { finalize } = makeFinalizeTracker();
  const args = makeArgs({ git, finalize });

  // Call 1: setup → forge dispatch
  const r1 = await runOrchestrate(args, io);
  assert.strictEqual(r1.action, 'dispatch');
  assert.strictEqual(r1.stage, 'forge:test-cycle');

  // Simulate forge lifecycle
  writeActiveStage(io, {
    cycle: 'test-cycle',
    stage: 'forge:test-cycle',
    token: 'T1',
    baseSha: 'abc1234',
  });
  writeLastStage(io, {
    cycle: 'test-cycle',
    stage: 'forge:test-cycle',
    baseSha: 'abc1234',
    summary: 'wrote draft',
  });
  clearActiveStage(io);

  // Call 2: forge finalize → internal quench → appraise gather (dispatch_multi)
  const r2 = await runOrchestrate({ ...args, lastResult: { ok: true }, finalize }, io);

  assert.strictEqual(r2.action, 'dispatch_multi',
    'after quench, appraise gather returns dispatch_multi');
  assert.strictEqual(r2.tasks.length, 2,
    'dispatch_multi should have tasks for each appraiser');

  // The gather phase already wrote activeStage — simulate the LLM calling
  // back with empty lastResults (no issues found) to reach done
  const r3 = await runOrchestrate({ ...args, lastResults: [], finalize }, io);

  assert.strictEqual(r3.action, 'done',
    'after consolidation with no issues, the cycle completes');

  // History should show all stages
  const history = io.readFile('WORK.history.yaml');
  assert.match(history, /stage: forge:test-cycle/);
  assert.match(history, /stage: quench:test-cycle/);
  assert.match(history, /stage: appraise:test-cycle/);

  // With empty lastResults, no feedback should have been posted
  const store = openFeedbackStore('WORK.feedback.yaml', io);
  const issues = store.list().filter(it => it.source === 'appraise:test-cycle');
  assert.strictEqual(issues.length, 0,
    'no feedback items since lastResults was empty');
});

// ---------------------------------------------------------------------------
// AC5.8 — Forge dispatch unchanged
// ---------------------------------------------------------------------------

test('AC5.8: forge dispatch is unchanged (still action:dispatch via subagent)', async () => {
  const io = makeIo({
    'WORK.md': BASE_WORK,
    'foundry/cycles/test-cycle.md': CYCLE_DEF,
    'foundry/artefacts/haiku/definition.md': ARTEFACT_DEF,
    '.opencode/agents/foundry-openai-gpt-4o.md': AGENT_FILE,
  });

  const args = makeArgs();
  const r1 = await runOrchestrate(args, io);

  assert.strictEqual(r1.action, 'dispatch');
  assert.strictEqual(r1.stage, 'forge:test-cycle');
  assert.strictEqual(typeof r1.subagent_type, 'string');
  assert.strictEqual(typeof r1.prompt, 'string');
  assert.match(r1.prompt, /foundry_stage_begin/);
  assert.match(r1.prompt, /foundry_stage_end/);
});

// ---------------------------------------------------------------------------
// AC5.9 — Human-appraise unchanged
// ---------------------------------------------------------------------------

test('AC5.9: human-appraise dispatch is unchanged', async () => {
  const WORK_WITH_HUMAN = `---
flow: test-flow
cycle: test-cycle
stages:
  - forge:test-cycle
  - quench:test-cycle
  - appraise:test-cycle
  - human-appraise:test-cycle
max-iterations: 3
human-appraise: true
deadlock-appraise: true
deadlock-iterations: 5
models:
  forge: openai/gpt-4o
  quench: openai/gpt-4o
  appraise: openai/gpt-4o
---
# Test

| File | Type | Cycle | Status |
|------|------|-------|--------|
| out/a.md | haiku | test-cycle | draft |
`;

  const CYCLE_WITH_HUMAN = `---
id: test-cycle
output-type: haiku
stages: [forge, quench, appraise, human-appraise]
human-appraise: true
---`;

  const io = makeIo({
    'WORK.md': WORK_WITH_HUMAN,
    'foundry/cycles/test-cycle.md': CYCLE_WITH_HUMAN,
    'foundry/artefacts/haiku/definition.md': ARTEFACT_DEF,
    'foundry/appraisers/strict-reviewer.md': APPRAISER_FILE,
    '.opencode/agents/foundry-openai-gpt-4o.md': AGENT_FILE,
    'out/a.md': 'a haiku about code',
  });

  const { finalize } = makeFinalizeTracker();
  const args = makeArgs({ finalize });

  // Call 1: setup → forge dispatch
  const r1 = await runOrchestrate(args, io);
  assert.strictEqual(r1.action, 'dispatch');

  // Simulate forge lifecycle
  writeActiveStage(io, {
    cycle: 'test-cycle',
    stage: 'forge:test-cycle',
    token: 'T1',
    baseSha: 'abc1234',
  });
  writeLastStage(io, {
    cycle: 'test-cycle',
    stage: 'forge:test-cycle',
    baseSha: 'abc1234',
    summary: 'wrote draft',
  });
  clearActiveStage(io);

  // Call 2: forge → quench → appraise gather (dispatch_multi)
  const r2 = await runOrchestrate({ ...args, lastResult: { ok: true }, finalize }, io);
  assert.strictEqual(r2.action, 'dispatch_multi',
    'appraise returns dispatch_multi');

  // Consolidate with empty results (no appraiser issues)
  const r3 = await runOrchestrate({ ...args, lastResults: [], finalize }, io);

  // After appraise consolidation, sort should route to human-appraise
  assert.strictEqual(r3.action, 'human_appraise',
    'after appraise, should route to human-appraise');
  assert.strictEqual(r3.stage, 'human-appraise:test-cycle');
  assert.strictEqual(typeof r3.token, 'string',
    'human-appraise must include a token');
  assert.ok(r3.context, 'human-appraise must include context');
  assert.strictEqual(r3.context.cycle, 'test-cycle');
});
