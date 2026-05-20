/**
 * Integration tests for the internal quench route (Phase 4).
 *
 * Verifies that when sort returns a quench route, runOrchestrate calls
 * runQuench internally instead of dispatching a subagent, and that the
 * cycle advances to the next stage without an intermediate dispatch.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { runOrchestrate } from '../src/scripts/orchestrate.js';
import { writeActiveStage, clearActiveStage, writeLastStage } from '../src/scripts/lib/state.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
    rename: (from, to) => {
      if (!fs.has(from)) throw new Error(`ENOENT: ${from}`);
      fs.set(to, fs.get(from));
      fs.delete(from);
    },
    unlink: (p) => fs.delete(p),
    mkdir: () => {},
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

// ---------------------------------------------------------------------------
// AC4.1 — Quench runs without intermediate dispatch
// ---------------------------------------------------------------------------

test('AC4.1: quench route runs internally, never returns action:dispatch for quench', async () => {
  const io = makeIo({
    'WORK.md': `---
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
`,
    'foundry/artefacts/haiku/definition.md': `---
id: haiku
file-patterns: ["out/*.md"]
---
`,
    '.opencode/agents/foundry-openai-gpt-4o.md': '# agent',
  });

  const finalizeCalls = [];
  const finalize = async (ctx) => {
    finalizeCalls.push(ctx.stage);
    return { ok: true, artefacts: [] };
  };

  const args = makeArgs({ finalize });

  // ------------------------------------------------------------------
  // Call 1: setup → forge dispatch
  // ------------------------------------------------------------------
  const r1 = await runOrchestrate(args, io);
  assert.strictEqual(r1.action, 'dispatch', `first call should dispatch forge, got action=${r1.action} details=${JSON.stringify(r1.details || r1.reason)}`);
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

  // ------------------------------------------------------------------
  // Call 2: finalize forge → internal quench → next stage (appraise)
  // ------------------------------------------------------------------
  const r2 = await runOrchestrate(
    { ...args, lastResult: { ok: true }, finalize },
    io
  );

  // Quench must NOT dispatch — the result should be the next stage
  assert.notStrictEqual(r2.stage, 'quench:test-cycle',
    'quench route must not dispatch — quench runs internally');
  assert.ok(!(r2.action === 'dispatch' && r2.stage?.startsWith('quench:')),
    'no dispatch action for quench stage');

  // The cycle advanced past quench
  assert.strictEqual(r2.action, 'dispatch');
  assert.strictEqual(r2.stage, 'appraise:test-cycle');

  // Both forge and quench were finalized (forge from runPostDispatch,
  // quench from internal runQuench)
  assert.strictEqual(finalizeCalls.length, 2);
  assert.strictEqual(finalizeCalls[0], 'forge:test-cycle');
  assert.strictEqual(finalizeCalls[1], 'quench:test-cycle');
});

// ---------------------------------------------------------------------------
// AC4.3 — No artefacts → SKIP and advance
// ---------------------------------------------------------------------------

test('AC4.3: quench with no draft artefacts returns SKIP and advances to next stage', async () => {
  const io = makeIo({
    'WORK.md': `---
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
| out/a.md | haiku | test-cycle | done  |
`,  // <-- artefact already done, no draft artefacts
    '.opencode/agents/foundry-openai-gpt-4o.md': '# agent',
  });

  const finalize = async () => ({ ok: true, artefacts: [] });
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

  // Call 2: finalize forge → internal quench (no artefacts → SKIP) → appraise
  const r2 = await runOrchestrate(
    { ...args, lastResult: { ok: true }, finalize },
    io
  );

  assert.strictEqual(r2.action, 'dispatch');
  assert.strictEqual(r2.stage, 'appraise:test-cycle',
    'should skip quench and advance to appraise');
});

// ---------------------------------------------------------------------------
// AC4.5 — Forge dispatch unchanged
// ---------------------------------------------------------------------------

test('AC4.5: forge dispatch is unchanged (still action:dispatch via subagent)', async () => {
  const io = makeIo({
    'WORK.md': `---
flow: test-flow
cycle: test-cycle
stages:
  - forge:test-cycle
  - quench:test-cycle
max-iterations: 3
human-appraise: false
deadlock-appraise: true
deadlock-iterations: 5
models:
  forge: openai/gpt-4o
  quench: openai/gpt-4o
---
# Test
`,
    '.opencode/agents/foundry-openai-gpt-4o.md': '# agent',
  });

  const args = makeArgs();
  const r1 = await runOrchestrate(args, io);

  // Forge must dispatch as a subagent (unchanged behaviour)
  assert.strictEqual(r1.action, 'dispatch');
  assert.strictEqual(r1.stage, 'forge:test-cycle');
  assert.strictEqual(typeof r1.subagent_type, 'string');
  assert.strictEqual(typeof r1.prompt, 'string');
  assert.match(r1.prompt, /foundry_stage_begin/);
  assert.match(r1.prompt, /foundry_stage_end/);
});

// ---------------------------------------------------------------------------
// Quench with artefacts: stage advances, history written
// ---------------------------------------------------------------------------

test('quench handles artefacts, writes history, and advances the cycle', async () => {
  const io = makeIo({
    'WORK.md': `---
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
`,
    'foundry/cycles/test-cycle.md': `---
id: test-cycle
output-type: haiku
---
`,
    'foundry/artefacts/haiku/definition.md': `---
id: haiku
file-patterns: ["out/*.md"]
---
`,
    '.opencode/agents/foundry-openai-gpt-4o.md': '# agent',
  });

  const commits = [];
  const git = {
    commit: (msg) => { commits.push(msg); return 'sha' + commits.length; },
    status: () => ({ clean: true, dirty: [] }),
  };
  const finalize = async () => ({ ok: true, artefacts: [] });
  const args = makeArgs({ git, finalize });

  // Call 1: setup → forge
  const r1 = await runOrchestrate(args, io);
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

  // Call 2: finalize forge → internal quench → appraise
  const r2 = await runOrchestrate(
    { ...args, lastResult: { ok: true }, git, finalize },
    io
  );

  assert.strictEqual(r2.stage, 'appraise:test-cycle',
    'cycle advanced past quench to appraise');

  // History should contain both forge and quench entries
  const history = io.readFile('WORK.history.yaml');
  assert.match(history, /stage: forge:test-cycle/);
  assert.match(history, /stage: quench:test-cycle/);
});

// ---------------------------------------------------------------------------
// Quench with failing validation blocks artefact and returns violation
// ---------------------------------------------------------------------------

test('quench with all validators failing blocks artefact and returns violation', async () => {
  // Set up a cycle where forge is complete, sort routes to quench, but the
  // artefact type definition is missing so performValidation fails.
  const io = makeIo({
    'WORK.md': `---
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
`,
    '.opencode/agents/foundry-openai-gpt-4o.md': '# agent',
    // NOTE: No foundry/artefacts/haiku/definition.md — this causes
    // performValidation to fail with "artefact type not found"
  });

  const finalize = async () => ({ ok: true, artefacts: [] });
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

  // Call 2: finalize forge → internal quench → performValidation fails
  const r2 = await runOrchestrate(
    { ...args, lastResult: { ok: true }, finalize },
    io
  );

  // The artefact should be blocked and a violation returned
  assert.strictEqual(r2.action, 'violation');
  assert.match(r2.details || '', /One or more artefacts failed validation/);

  // Verify the artefact was marked blocked in WORK.md
  const workAfter = io.readFile('WORK.md');
  assert.match(workAfter, /\| out\/a\.md .* blocked \|/);
});
