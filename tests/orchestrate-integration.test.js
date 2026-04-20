import { test } from 'node:test';
import assert from 'node:assert';
import { runOrchestrate } from '../scripts/orchestrate.js';
import { writeActiveStage, clearActiveStage, writeLastStage } from '../scripts/lib/state.js';

// In-memory IO that mimics tests/orchestrate.test.js but adds an `exec`
// stub so sort.js's git invocations (dirty-tree check, modified-files
// check, log scan) all see a clean working tree.
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
    exec: () => '',
  };
}

test('runOrchestrate full happy-path: setup -> forge -> quench -> appraise -> done', async () => {
  const io = makeIo({
    'WORK.md': `---
flow: creative-flow
cycle: create-haiku
---
# Goal

haiku about airports

| File | Type | Cycle | Status |
|------|------|-------|--------|
| haikus/a.md | haiku | create-haiku | draft |
`,
    'foundry/cycles/create-haiku.md': `---
id: create-haiku
output: haiku
inputs: []
targets: [create-short-story]
stages: [forge, quench, appraise]
human-appraise: false
deadlock-appraise: true
deadlock-iterations: 3
max-iterations: 3
models:
  forge: github-copilot/claude-sonnet-4.6
  quench: github-copilot/claude-sonnet-4.6
  appraise: github-copilot/claude-sonnet-4.6
---
# Create Haiku
`,
    'foundry/artefacts/haiku/definition.md': `---
id: haiku
file-patterns: ["haikus/*.md"]
appraisers:
  count: 3
---
`,
    'foundry/artefacts/haiku/validation.md': `## compile
Command: \`echo ok\`
`,
    '.opencode/agents/foundry-github-copilot-claude-sonnet-4-6.md': '# agent',
  });

  const commits = [];
  const git = {
    commit: (msg) => { commits.push(msg); return 'sha' + commits.length; },
    status: () => ({ clean: true, dirty: [] }),
  };

  let tokenCounter = 0;
  const mint = () => `T${++tokenCounter}`;

  // Stub finalize: in production, foundry.js wraps lib/finalize.finalizeStage
  // (which shells out via execSync). For an integration test we mirror the
  // shape runOrchestrate consumes: { ok, artefacts, [error] }.
  const finalizeCalls = [];
  const finalize = async (ctx) => {
    finalizeCalls.push({ cycleId: ctx.cycleId, stage: ctx.stage });
    return { ok: true, artefacts: [] };
  };

  const baseArgs = {
    cwd: '/tmp/project',
    git,
    mint,
    now: () => 1700000000000,
    finalize,
  };

  // ------------------------------------------------------------------
  // Call 1: needs setup -> writes stages into WORK.md, commits setup,
  //         then sort routes to forge as first stage.
  // ------------------------------------------------------------------
  const r1 = await runOrchestrate(baseArgs, io);
  assert.strictEqual(r1.action, 'dispatch', 'first call should dispatch');
  assert.strictEqual(r1.stage, 'forge:create-haiku');
  assert.strictEqual(
    r1.subagent_type,
    'foundry-github-copilot-claude-sonnet-4-6'
  );
  assert.match(r1.prompt, /Stage: forge:create-haiku/);
  assert.match(r1.prompt, /Token: T1/);
  assert.match(r1.prompt, /File patterns \(forge only\): \["haikus\/\*\.md"\]/);

  const workAfterSetup = io.readFile('WORK.md');
  assert.match(workAfterSetup, /^stages:/m, 'setup writes stages: into WORK.md');
  assert.match(workAfterSetup, /forge:create-haiku/);
  assert.match(workAfterSetup, /quench:create-haiku/);
  assert.match(workAfterSetup, /appraise:create-haiku/);

  assert.ok(
    commits.some(m => m.startsWith('[create-haiku] setup')),
    `expected setup commit, got: ${commits.join(' | ')}`
  );
  assert.strictEqual(finalizeCalls.length, 0, 'no finalize on first call');

  // Simulate the dispatched forge agent's full lifecycle:
  //   stage_begin → writeActiveStage
  //   (subagent does work)
  //   stage_end → writeLastStage + clearActiveStage
  io.writeFile('haikus/a.md', 'cup of coffee\nterminal delay\nthe rain returns');
  writeActiveStage(io, {
    cycle: 'create-haiku',
    stage: 'forge:create-haiku',
    token: 'T1',
    baseSha: 'sha1',
  });
  writeLastStage(io, {
    cycle: 'create-haiku',
    stage: 'forge:create-haiku',
    baseSha: 'sha1',
    summary: 'wrote first draft',
  });
  clearActiveStage(io);

  // ------------------------------------------------------------------
  // Call 2: finalize forge, append history, commit, dispatch quench.
  // ------------------------------------------------------------------
  const r2 = await runOrchestrate(
    { ...baseArgs, lastResult: { kind: 'dispatch', ok: true } },
    io
  );
  assert.strictEqual(r2.action, 'dispatch');
  assert.strictEqual(r2.stage, 'quench:create-haiku');
  assert.match(r2.prompt, /Token: T2/);
  assert.doesNotMatch(r2.prompt, /File patterns/, 'quench has no file-patterns');

  assert.strictEqual(finalizeCalls.length, 1);
  assert.strictEqual(finalizeCalls[0].stage, 'forge:create-haiku');

  assert.ok(
    commits.some(m => m.startsWith('[create-haiku] forge:create-haiku')),
    `expected forge commit, got: ${commits.join(' | ')}`
  );

  const histAfterForge = io.readFile('WORK.history.yaml');
  assert.match(histAfterForge, /stage: forge:create-haiku/);
  assert.match(histAfterForge, /wrote first draft/);
  assert.match(histAfterForge, /route: forge:create-haiku/);
  assert.strictEqual(
    io.exists('.foundry/active-stage.json'),
    false,
    'active stage cleared after finalize'
  );

  // Simulate quench agent (full lifecycle)
  writeActiveStage(io, {
    cycle: 'create-haiku',
    stage: 'quench:create-haiku',
    token: 'T2',
    baseSha: 'sha2',
  });
  writeLastStage(io, {
    cycle: 'create-haiku',
    stage: 'quench:create-haiku',
    baseSha: 'sha2',
    summary: 'all checks passed',
  });
  clearActiveStage(io);

  // ------------------------------------------------------------------
  // Call 3: finalize quench, dispatch appraise.
  // ------------------------------------------------------------------
  const r3 = await runOrchestrate(
    { ...baseArgs, lastResult: { kind: 'dispatch', ok: true } },
    io
  );
  assert.strictEqual(r3.action, 'dispatch');
  assert.strictEqual(r3.stage, 'appraise:create-haiku');
  assert.strictEqual(finalizeCalls.length, 2);
  assert.strictEqual(finalizeCalls[1].stage, 'quench:create-haiku');
  assert.ok(
    commits.some(m => m.startsWith('[create-haiku] quench:create-haiku')),
    `expected quench commit, got: ${commits.join(' | ')}`
  );

  // Simulate appraise agent (full lifecycle)
  writeActiveStage(io, {
    cycle: 'create-haiku',
    stage: 'appraise:create-haiku',
    token: 'T3',
    baseSha: 'sha3',
  });
  writeLastStage(io, {
    cycle: 'create-haiku',
    stage: 'appraise:create-haiku',
    baseSha: 'sha3',
    summary: 'unanimous approval',
  });
  clearActiveStage(io);

  // ------------------------------------------------------------------
  // Call 4: finalize appraise -> sort returns 'done'.
  // ------------------------------------------------------------------
  const r4 = await runOrchestrate(
    { ...baseArgs, lastResult: { kind: 'dispatch', ok: true } },
    io
  );
  assert.strictEqual(r4.action, 'done');
  assert.strictEqual(r4.cycle, 'create-haiku');
  assert.strictEqual(r4.artefact_file, 'haikus/a.md');
  assert.deepStrictEqual(r4.next_cycles, ['create-short-story']);

  assert.strictEqual(finalizeCalls.length, 3);
  assert.strictEqual(finalizeCalls[2].stage, 'appraise:create-haiku');
  assert.ok(
    commits.some(m => m.startsWith('[create-haiku] appraise:create-haiku')),
    `expected appraise commit, got: ${commits.join(' | ')}`
  );
  assert.strictEqual(
    io.exists('.foundry/active-stage.json'),
    false,
    'active stage cleared after final finalize'
  );

  // ------------------------------------------------------------------
  // Final state: history contains all stages + sort routing entries,
  // and we have at least one commit per finalized stage plus setup.
  // ------------------------------------------------------------------
  const histFinal = io.readFile('WORK.history.yaml');
  assert.match(histFinal, /stage: forge:create-haiku/);
  assert.match(histFinal, /stage: quench:create-haiku/);
  assert.match(histFinal, /stage: appraise:create-haiku/);
  assert.match(histFinal, /unanimous approval/);

  // 1 setup + 3 stage commits = 4 minimum
  assert.ok(
    commits.length >= 4,
    `expected >=4 commits (setup + forge + quench + appraise), got ${commits.length}: ${commits.join(' | ')}`
  );
});
