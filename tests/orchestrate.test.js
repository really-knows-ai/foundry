import { test } from 'node:test';
import assert from 'node:assert';
import {
  renderDispatchPrompt,
  synthesizeStages,
  runOrchestrate,
  needsSetup,
  findCycleOutputArtefact,
  readCycleTargets,
  readForgeFilePatterns,
} from '../scripts/orchestrate.js';

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

test('runOrchestrate: no WORK.md returns violation', async () => {
  const io = makeIo({});
  const result = await runOrchestrate({}, io);
  assert.strictEqual(result.action, 'violation');
  assert.match(result.details, /no WORK\.md/i);
});

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

function makeBootstrapFixture() {
  return makeIo({
    'WORK.md': `---
flow: creative-flow
cycle: create-haiku
---
# Goal

haiku about airports

| File | Type | Cycle | Status |
|------|------|-------|--------|
`,
    'foundry/cycles/create-haiku.md': `---
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
    'foundry/artefacts/haiku/definition.md': `---
id: haiku
file-patterns: ["haikus/*.md"]
appraisers:
  count: 3
---
`,
    '.opencode/agents/foundry-github-copilot-claude-sonnet-4-6.md': '# agent',
  });
}

test('runOrchestrate first call: runs setup, commits, returns dispatch for forge', async () => {
  const io = makeBootstrapFixture();
  const commits = [];
  const git = {
    commit: (msg) => { commits.push(msg); return 'abc1234'; },
    status: () => ({ clean: true, dirty: [] }),
  };
  const result = await runOrchestrate({
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

  const work = io.readFile('WORK.md');
  assert.match(work, /stages:/);
  assert.match(work, /forge:create-haiku/);

  assert.ok(commits.some(m => m.includes('[create-haiku] setup')),
    `expected a setup commit, got: ${commits.join(', ')}`);
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

test('readCycleTargets: reads targets from cycle def', async () => {
  const io = makeIo({
    'foundry/cycles/create-haiku.md': `---
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
    await readCycleTargets('create-haiku', io),
    ['create-short-story', 'other']
  );
});

test('readForgeFilePatterns: reads via cycle.output → artefact-type', async () => {
  const io = makeIo({
    'foundry/cycles/create-haiku.md': `---
id: create-haiku
output: haiku
---
`,
    'foundry/artefacts/haiku/definition.md': `---
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
    await readForgeFilePatterns('create-haiku', io),
    ['haikus/*.md', 'haikus/**/*.md']
  );
});
