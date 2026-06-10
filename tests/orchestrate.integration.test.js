import { test, describe, it } from 'node:test';
import assert from 'node:assert';
import yaml from 'js-yaml';
import {
  renderDispatchPrompt,
  synthesizeStages,
  readCycleTargets,
  readForgeFilePatterns,
} from '../src/scripts/orchestrate-cycle.js';
// runOrchestrate and needsSetup removed in Phase 4 (SDK orchestration migration).
// Tests using these are skipped below.
const runOrchestrate = async (_a, _b) => ({ action: 'violation', details: 'runOrchestrate removed in Phase 4' });
const needsSetup = (_w) => false;

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
    readDir: (p) => {
      const prefix = p.endsWith('/') ? p : `${p}/`;
      const entries = [];
      for (const key of fs.keys()) {
        if (key.startsWith(prefix)) {
          const rest = key.slice(prefix.length);
          entries.push(rest.includes('/') ? rest.slice(0, rest.indexOf('/')) : rest);
        }
      }
      return [...new Set(entries)].sort();
    },
    exec: (args) => {
      const cmd = args.join(' ');
      if (cmd.includes('merge-base')) return 'basesha\n';
      return '';
    },
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
  assert.match(prompt, /Working directory: \/tmp\/work/);
  assert.match(prompt, /File patterns \(forge only\): \["haikus\/\*\.md"\]/);
  assert.match(prompt, /foundry_stage_begin\({stage: "forge:create-haiku", cycle: "create-haiku"}\)/);
  assert.match(prompt, /foundry_stage_end\(\)/);
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

test('renderDispatchPrompt includes forgeItem text when forgeItem is provided', () => {
  const prompt = renderDispatchPrompt({
    stage: 'forge:create-haiku',
    cycle: 'create-haiku',
    token: 'TOKEN',
    cwd: '/tmp/work',
    filePatterns: ['haikus/*.md'],
    forgeItem: { id: 'fb1', file: 'haikus/a.md', tag: 'law:x', text: 'needs work', source: 'quench' },
  });
  assert.match(prompt, /FEEDBACK ITEM TO ADDRESS/);
  assert.match(prompt, /Source: quench\b/);
  assert.doesNotMatch(prompt, /Source: quench:test-cycle/);
  assert.match(prompt, /File: haikus\/a\.md/);
  assert.match(prompt, /Issue: needs work/);
});

test('renderDispatchPrompt omits feedback-tool references when forgeItem is provided', () => {
  const prompt = renderDispatchPrompt({
    stage: 'forge:create-haiku',
    cycle: 'create-haiku',
    token: 'T',
    cwd: '/tmp',
    filePatterns: ['haikus/*.md'],
    forgeItem: { id: 'fb1', file: 'haikus/a.md', tag: 'law:x', text: 'fix it', source: 'quench' },
  });
  assert.doesNotMatch(prompt, /foundry_feedback_list/);
});

test('synthesizeStages: forge + quench + appraise when validation exists', () => {
  const stages = synthesizeStages({
    cycleId: 'c1',
    hasValidation: true,
    alwaysHumanAppraise: false
  });
  assert.deepStrictEqual(stages, ['forge:c1', 'quench:c1', 'appraise:c1']);
});

test('synthesizeStages: forge + appraise when no validation', () => {
  const stages = synthesizeStages({
    cycleId: 'c1',
    hasValidation: false,
    alwaysHumanAppraise: false
  });
  assert.deepStrictEqual(stages, ['forge:c1', 'appraise:c1']);
});

test('synthesizeStages: appends human-appraise when flag true', () => {
  const stages = synthesizeStages({
    cycleId: 'c1',
    hasValidation: true,
    alwaysHumanAppraise: true
  });
  assert.deepStrictEqual(stages, [
    'forge:c1', 'quench:c1', 'appraise:c1', 'human-appraise:c1'
  ]);
});

describe('synthesizeStages with assay', () => {
  it('prepends assay:<cycleId> when assay is true', () => {
    const out = synthesizeStages({ cycleId: 'c', hasValidation: true, alwaysHumanAppraise: false, assay: true });
    assert.deepEqual(out, ['assay:c', 'forge:c', 'quench:c', 'appraise:c']);
  });

  it('omits assay by default', () => {
    const out = synthesizeStages({ cycleId: 'c', hasValidation: false, alwaysHumanAppraise: false });
    assert.deepEqual(out, ['forge:c', 'appraise:c']);
  });

  it('works alongside human-appraise', () => {
    const out = synthesizeStages({ cycleId: 'c', hasValidation: false, alwaysHumanAppraise: true, assay: true });
    assert.deepEqual(out, ['assay:c', 'forge:c', 'appraise:c', 'human-appraise:c']);
  });
});

test.skip('runOrchestrate: no WORK.md returns violation', async () => {
  const io = makeIo({});
  const result = await runOrchestrate({}, io);
  assert.strictEqual(result.action, 'violation');
  assert.match(result.details, /no WORK\.md/i);
});

test.skip('needsSetup: true when stages field missing from frontmatter', () => {
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
`,
    'foundry/cycles/create-haiku.md': `---
id: create-haiku
output-type: haiku
inputs: []
targets: []
stages: [forge, quench, appraise]
always-human-appraise: false
deadlock-human-appraise: true
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

test.skip('runOrchestrate first call: runs setup, commits, returns dispatch for forge', async () => {
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
  assert.match(result.prompt, /File patterns \(forge only\): \["haikus\/\*\.md"\]/);

  const work = io.readFile('WORK.md');
  assert.match(work, /stages:/);
  assert.match(work, /forge:create-haiku/);

  assert.ok(commits.some(m => m.includes('[create-haiku] setup')),
    `expected a setup commit, got: ${commits.join(', ')}`);
});

// --- Git-bridge policy: unexpected_files translates to violations ----------
//
// runOrchestrate's two commit sites must NOT swallow stray repository
// changes. The bridge throws an UnexpectedFilesError-shaped error when the
// worktree contains files outside the phase's allowed set; runOrchestrate
// must turn that into a `violation` action with `affected_files` and refuse
// to dispatch.

test.skip('runOrchestrate setup: returns violation when bridge reports unexpected_files', async () => {
  const io = makeBootstrapFixture();
  const git = {
    commit: (_msg, opts) => {
      // Simulate the real bridge: any file outside allowedPatterns trips.
      assert.deepStrictEqual(opts.allowedPatterns, [],
        'setup commit must allow only tool-managed files');
      const err = new Error('unexpected_files');
      err.code = 'unexpected_files';
      err.files = ['secret.env', 'src/unrelated.js'];
      throw err;
    },
    status: () => ({ clean: false, dirty: ['secret.env', 'src/unrelated.js'] }),
  };
  const result = await runOrchestrate({
    cwd: '/tmp/project',
    git,
    mint: () => 'T',
    now: () => 1,
  }, io);
  assert.strictEqual(result.action, 'violation');
  assert.match(result.details, /clean worktree/i);
  assert.match(result.details, /secret\.env/);
  assert.deepStrictEqual(result.affected_files, ['secret.env', 'src/unrelated.js']);
});

test.skip('runOrchestrate stage commit: forge passes artefact file-patterns to bridge', async () => {
  const io = makeIo({
    'WORK.md': `---
flow: creative-flow
cycle: create-haiku
stages:
  - forge:create-haiku
  - appraise:create-haiku
max-iterations: 3
always-human-appraise: false
deadlock-human-appraise: true
models:
  forge: github-copilot/claude-sonnet-4.6
  appraise: github-copilot/claude-sonnet-4.6
---
# Goal

haiku
`,
    'WORK.history.yaml': '',
    '.foundry/last-stage.json': JSON.stringify({
      cycle: 'create-haiku',
      stage: 'forge:create-haiku',
      baseSha: 'abc',
      summary: 'wrote',
    }),
    'foundry/cycles/create-haiku.md': `---
id: create-haiku
output-type: haiku
stages: [forge, appraise]
always-human-appraise: false
deadlock-human-appraise: true
---
`,
    'foundry/artefacts/haiku/definition.md': `---
id: haiku
file-patterns: ["haikus/*.md"]
---
`,
    '.opencode/agents/foundry-github-copilot-claude-sonnet-4-6.md': '# agent',
  });
  const observed = [];
  const git = {
    commit: (msg, opts) => { observed.push({ msg, opts }); return 'sha'; },
    status: () => ({ clean: true, dirty: [] }),
  };
  await runOrchestrate({
    cwd: '/tmp/project',
    git,
    mint: () => 'T',
    now: () => 1,
    lastResult: { ok: true },
    finalize: async () => ({ ok: true, artefacts: [] }),
  }, io);
  // The forge stage commit must pass haikus/*.md as the allowed pattern.
  const forgeCommit = observed.find(o => o.msg.includes('forge:create-haiku'));
  assert.ok(forgeCommit, `expected a forge commit, got: ${JSON.stringify(observed)}`);
  assert.deepStrictEqual(forgeCommit.opts.allowedPatterns, ['haikus/*.md']);
});

test.skip('runOrchestrate stage commit: quench passes empty allowedPatterns', async () => {
  const io = makeIo({
    'WORK.md': `---
flow: creative-flow
cycle: create-haiku
stages:
  - forge:create-haiku
  - quench:create-haiku
  - appraise:create-haiku
max-iterations: 3
always-human-appraise: false
deadlock-human-appraise: true
models:
  forge: github-copilot/claude-sonnet-4.6
  quench: github-copilot/claude-sonnet-4.6
  appraise: github-copilot/claude-sonnet-4.6
---
# Goal

haiku
`,
    'WORK.history.yaml': '',
    '.foundry/last-stage.json': JSON.stringify({
      cycle: 'create-haiku',
      stage: 'quench:create-haiku',
      baseSha: 'abc',
      summary: 'ok',
    }),
    'foundry/cycles/create-haiku.md': `---
id: create-haiku
output-type: haiku
---
`,
    'foundry/artefacts/haiku/definition.md': `---
id: haiku
file-patterns: ["haikus/*.md"]
---
`,
    '.opencode/agents/foundry-github-copilot-claude-sonnet-4-6.md': '# agent',
  });
  const observed = [];
  const git = {
    commit: (msg, opts) => { observed.push({ msg, opts }); return 'sha'; },
    status: () => ({ clean: true, dirty: [] }),
  };
  await runOrchestrate({
    cwd: '/tmp/project',
    git,
    mint: () => 'T',
    now: () => 1,
    lastResult: { ok: true },
    finalize: async () => ({ ok: true, artefacts: [] }),
  }, io);
  const quenchCommit = observed.find(o => o.msg.includes('quench:create-haiku'));
  assert.ok(quenchCommit);
  assert.deepStrictEqual(quenchCommit.opts.allowedPatterns, []);
});

test.skip('runOrchestrate stage commit: bridge rejection becomes violation with files', async () => {
  const io = makeIo({
    'WORK.md': `---
flow: creative-flow
cycle: create-haiku
stages:
  - forge:create-haiku
  - appraise:create-haiku
max-iterations: 3
always-human-appraise: false
deadlock-human-appraise: true
models:
  forge: github-copilot/claude-sonnet-4.6
  appraise: github-copilot/claude-sonnet-4.6
---
# Goal

haiku
`,
    'WORK.history.yaml': '',
    '.foundry/last-stage.json': JSON.stringify({
      cycle: 'create-haiku',
      stage: 'forge:create-haiku',
      baseSha: 'abc',
      summary: 'ok',
    }),
    'foundry/cycles/create-haiku.md': `---
id: create-haiku
output-type: haiku
---
`,
    'foundry/artefacts/haiku/definition.md': `---
id: haiku
file-patterns: ["haikus/*.md"]
---
`,
    '.opencode/agents/foundry-github-copilot-claude-sonnet-4-6.md': '# agent',
  });
  const git = {
    commit: () => {
      const err = new Error('unexpected_files');
      err.code = 'unexpected_files';
      err.files = ['stray.bin'];
      throw err;
    },
    status: () => ({ clean: false, dirty: ['stray.bin'] }),
  };
  const result = await runOrchestrate({
    cwd: '/tmp/project',
    git,
    mint: () => 'T',
    now: () => 1,
    lastResult: { ok: true },
    finalize: async () => ({ ok: true, artefacts: [] }),
  }, io);
  assert.strictEqual(result.action, 'violation');
  assert.match(result.details, /forge:create-haiku/);
  assert.match(result.details, /stray\.bin/);
  assert.deepStrictEqual(result.affected_files, ['stray.bin']);
});

test.skip('needsSetup: false when stages populated', () => {
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

test('readForgeFilePatterns: reads via cycle.output-type → artefact-type', async () => {
  const io = makeIo({
    'foundry/cycles/create-haiku.md': `---
id: create-haiku
output-type: haiku
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
    { patterns: ['haikus/*.md', 'haikus/**/*.md'], outputType: 'haiku' }
  );
});

test.skip('runOrchestrate subsequent call: finalizes, writes history, commits, routes next', async () => {
  const io = makeIo({
    'WORK.md': `---
flow: creative-flow
cycle: create-haiku
stages:
  - forge:create-haiku
  - quench:create-haiku
  - appraise:create-haiku
max-iterations: 3
always-human-appraise: false
deadlock-human-appraise: true
models:
  forge: github-copilot/claude-sonnet-4.6
  quench: github-copilot/claude-sonnet-4.6
  appraise: github-copilot/gpt-5.4
---
# Goal

haiku
`,
    'WORK.history.yaml': `- cycle: create-haiku
  stage: sort
  iteration: 0
  route: forge:create-haiku
  comment: initial sort
  timestamp: 2026-01-01T00:00:00.000Z
`,
    '.foundry/last-stage.json': JSON.stringify({
      cycle: 'create-haiku',
      stage: 'forge:create-haiku',
      baseSha: 'abc',
      summary: 'wrote haiku'
    }),
    'haikus/a.md': 'cup of coffee / terminal delay / the rain returns',
    'foundry/cycles/create-haiku.md': `---
id: create-haiku
output-type: haiku
stages: [forge, quench, appraise]
always-human-appraise: false
deadlock-human-appraise: true
models:
  forge: github-copilot/claude-sonnet-4.6
  quench: github-copilot/claude-sonnet-4.6
  appraise: github-copilot/gpt-5.4
---
`,
    'foundry/artefacts/haiku/definition.md': `---
id: haiku
file-patterns: ["haikus/*.md"]
---
`,
    '.opencode/agents/foundry-github-copilot-claude-sonnet-4-6.md': '# agent',
    '.opencode/agents/foundry-github-copilot-gpt-5-4.md': '# agent',
  });
  const commits = [];
  const git = {
    commit: (msg) => { commits.push(msg); return 'def5678'; },
    status: () => ({ clean: true, dirty: [] }),
  };
  const result = await runOrchestrate({
    cwd: '/tmp/project',
    git,
    mint: () => 'TOKEN_2',
    now: () => 2000000,
    lastResult: { kind: 'dispatch', ok: true },
    finalize: async () => ({ ok: true, artefacts: [] }),
  }, io);

  assert.ok(commits.some(m => m.includes('[create-haiku] forge')),
    `expected forge commit, got: ${commits.join(', ')}`);

  // Quench and appraise run internally — result advances to done
  assert.strictEqual(result.action, 'done');

  const history = io.readFile('WORK.history.yaml');
  assert.match(history, /stage: forge:create-haiku/);
  assert.match(history, /stage: quench:create-haiku/);
  assert.match(history, /stage: appraise:create-haiku/);
});

test.skip('runOrchestrate subsequent call with lastResult.ok=false returns violation', async () => {
  const io = makeIo({
    'WORK.md': `---
flow: creative-flow
cycle: create-haiku
stages: [forge:create-haiku]
max-iterations: 3
---
# Goal

haiku
`,
    '.foundry/active-stage.json': JSON.stringify({
      cycle: 'create-haiku', stage: 'forge:create-haiku', token: 'T', baseSha: 'abc'
    }),
  });
  const git = { commit: () => 'x', status: () => ({ clean: true }) };
  const result = await runOrchestrate({
    git, mint: () => 'T', now: () => 1,
    lastResult: { kind: 'dispatch', ok: false, error: 'subagent crashed' },
    finalize: async () => ({ ok: true, artefacts: [] }),
  }, io);
  assert.strictEqual(result.action, 'violation');
});

test.skip('runOrchestrate subagent-failure clears both activeStage AND lastStage', async () => {
  // Regression test for G5: stale lastStage corruption bug.
  // Setup: prior stage succeeded and wrote lastStage, then new dispatch created activeStage.
  const io = makeIo({
    'WORK.md': `---
flow: creative-flow
cycle: create-haiku
stages: [forge:create-haiku, appraise:create-haiku]
max-iterations: 3
---
# Goal

haiku
`,
    '.foundry/active-stage.json': JSON.stringify({
      cycle: 'create-haiku', stage: 'forge:create-haiku', token: 'T', baseSha: 'xyz123'
    }),
    '.foundry/last-stage.json': JSON.stringify({
      cycle: 'create-haiku', stage: 'quench:old-cycle', baseSha: 'stale_sha', summary: 'old work'
    }),
  });
  const git = { commit: () => 'x', status: () => ({ clean: true }) };
  
  // Subagent fails.
  const result = await runOrchestrate({
    git, mint: () => 'T', now: () => 1,
    lastResult: { kind: 'dispatch', ok: false, error: 'subagent crashed' },
    finalize: async () => ({ ok: true, artefacts: [] }),
  }, io);
  
  assert.strictEqual(result.action, 'violation');
  
  // BOTH state files must be cleared.
  assert.strictEqual(io.exists('.foundry/active-stage.json'), false, 
    'activeStage should be cleared on failure');
  assert.strictEqual(io.exists('.foundry/last-stage.json'), false, 
    'lastStage should be cleared on failure to prevent corruption');
});

test.skip('runOrchestrate: active stage with no lastResult returns violation (orphaned)', async () => {
  const io = makeIo({
    'WORK.md': `---
cycle: create-haiku
stages: [forge:create-haiku]
max-iterations: 3
---
# Goal

haiku
`,
    '.foundry/active-stage.json': JSON.stringify({
      cycle: 'create-haiku', stage: 'forge:create-haiku', token: 'T', baseSha: 'abc'
    }),
  });
  const git = { commit: () => 'x', status: () => ({ clean: true }) };
  const result = await runOrchestrate({
    git, mint: () => 'T', now: () => 1,
    // no lastResult
  }, io);
  assert.strictEqual(result.action, 'violation');
  assert.match(result.details, /is active but you called foundry_orchestrate\(\) without lastResult/i);
});

test.skip('runOrchestrate dispatch: tokens include timestamp nonce for uniqueness (TF8)', async () => {
  // Regression test: dispatch tokens must include exp (timestamp-based nonce)
  // to prevent token reuse across successive dispatches of the same route.
  // Without a varying component like exp, identical route+cycle would produce
  // identical tokens, enabling replay attacks.
  const io = makeBootstrapFixture();
  const git = {
    commit: () => 'abc123',
    status: () => ({ clean: true, dirty: [] }),
  };
  
  const mintedPayloads = [];
  const mint = (payload) => {
    mintedPayloads.push(payload);
    return `TOKEN_${mintedPayloads.length}`;
  };
  
  // First dispatch
  await runOrchestrate({
    cwd: '/tmp/project',
    git,
    mint,
    now: () => 1000000,
  }, io);
  
  assert.strictEqual(mintedPayloads.length, 1);
  assert.strictEqual(mintedPayloads[0].route, 'forge:create-haiku');
  assert.strictEqual(mintedPayloads[0].cycle, 'create-haiku');
  assert.strictEqual(mintedPayloads[0].exp, 1000000 + 10 * 60 * 1000);
  
  // Second dispatch with different timestamp
  await runOrchestrate({
    cwd: '/tmp/project',
    git,
    mint,
    now: () => 2000000,
  }, io);
  
  assert.strictEqual(mintedPayloads.length, 2);
  assert.strictEqual(mintedPayloads[1].route, 'forge:create-haiku');
  assert.strictEqual(mintedPayloads[1].cycle, 'create-haiku');
  assert.strictEqual(mintedPayloads[1].exp, 2000000 + 10 * 60 * 1000);
  
  // Critical: exp must vary to ensure unique tokens
  assert.notStrictEqual(mintedPayloads[0].exp, mintedPayloads[1].exp,
    'Token exp must vary with now() to prevent token reuse (nonce leak)');
});

test.skip('runOrchestrate dispatch: tokens include ULID nonce to prevent same-millisecond collisions', async () => {
  // Regression test: relying solely on timestamp for nonce creates collision
  // risk in fast-executing environments. Two dispatches within the same
  // millisecond with identical route/cycle would produce identical tokens.
  // Adding a ULID guarantees uniqueness via cryptographic randomness and
  // monotonicity within the same timestamp.
  const io = makeBootstrapFixture();
  const git = {
    commit: () => 'abc123',
    status: () => ({ clean: true, dirty: [] }),
  };
  
  const mintedPayloads = [];
  const mint = (payload) => {
    mintedPayloads.push(payload);
    return `TOKEN_${mintedPayloads.length}`;
  };
  
  const SAME_TIMESTAMP = 1000000;
  
  // Import createUlidGenerator for isolated test state
  const { createUlidGenerator } = await import('../src/scripts/lib/ulid.js');
  const testUlid = createUlidGenerator();
  
  // First dispatch at timestamp T
  await runOrchestrate({
    cwd: '/tmp/project',
    git,
    mint,
    now: () => SAME_TIMESTAMP,
    ulid: testUlid,
  }, io);
  
  // Second dispatch at SAME timestamp T (simulating fast execution)
  await runOrchestrate({
    cwd: '/tmp/project',
    git,
    mint,
    now: () => SAME_TIMESTAMP,
    ulid: testUlid,
  }, io);
  
  assert.strictEqual(mintedPayloads.length, 2);
  
  // Both dispatches have same route, cycle, and exp
  assert.strictEqual(mintedPayloads[0].route, mintedPayloads[1].route);
  assert.strictEqual(mintedPayloads[0].cycle, mintedPayloads[1].cycle);
  assert.strictEqual(mintedPayloads[0].exp, mintedPayloads[1].exp);
  
  // Critical: tokens MUST still be unique due to different ULID nonces
  assert.ok(mintedPayloads[0].nonce, 'First token must have a nonce field');
  assert.ok(mintedPayloads[1].nonce, 'Second token must have a nonce field');
  assert.notStrictEqual(mintedPayloads[0].nonce, mintedPayloads[1].nonce,
    'Token nonces must differ even when timestamp is identical (prevents collision)');
  
  // ULID format verification: 26 chars, alphanumeric Crockford base32
  assert.strictEqual(mintedPayloads[0].nonce.length, 26, 'ULID must be 26 chars');
  assert.match(mintedPayloads[0].nonce, /^[0-9A-HJKMNP-TV-Z]{26}$/,
    'ULID must use Crockford base32 alphabet');
});

// Replaced import * as orchestrate from orchestrate.js (deleted in Phase 4)
const orchestrate = {};
import { loadHistory } from '../src/scripts/lib/history.js';

test.skip('handleSortResult: done route returns done action with next_cycles', async () => {
  const io = makeIo({
    'WORK.md': `---
flow: cf
cycle: create-haiku
---
# Goal

haiku
`,
    'foundry/cycles/create-haiku.md': `---
id: create-haiku
output-type: haiku
targets: [create-short-story]
---
`,
    'foundry/artefacts/haiku/definition.md': `---
id: haiku
file-patterns: ["out/*.md"]
---
`,
  });
  const result = await orchestrate.__handleSortResultForTest(
    { route: 'done' },
    { cycleId: 'create-haiku', cwd: '/tmp', io, foundryDir: 'foundry' }
  );
  assert.strictEqual(result.action, 'done');
  // artefact_file is null because no git diff changes detected
  assert.strictEqual(result.artefact_file, null);
  assert.deepStrictEqual(result.next_cycles, ['create-short-story']);
});

test.skip('handleSortResult: blocked route returns blocked action', async () => {
  const io2 = makeIo({
    'WORK.md': `---
cycle: create-haiku
---
# Goal

haiku
`,
    'foundry/cycles/create-haiku.md': `---
id: create-haiku
output-type: haiku
---
`,
    'foundry/artefacts/haiku/definition.md': `---
id: haiku
file-patterns: ["out/*.md"]
---
`,
  });
  const result = await orchestrate.__handleSortResultForTest(
    { route: 'blocked', details: 'iteration limit' },
    { cycleId: 'create-haiku', cwd: '/tmp', io: io2 }
  );
  assert.strictEqual(result.action, 'blocked');
  assert.match(result.reason, /iteration limit/);
});

test.skip('handleSortResult: human-appraise route returns human_appraise action', async () => {
  const io2 = makeIo({
    'WORK.md': `---
cycle: create-haiku
---
# Goal

haiku
`,
    'foundry/cycles/create-haiku.md': `---
id: create-haiku
output-type: haiku
---
`,
    'foundry/artefacts/haiku/definition.md': `---
id: haiku
file-patterns: ["out/*.md"]
---
`,
  });
  const result = await orchestrate.__handleSortResultForTest(
    { route: 'human-appraise:create-haiku', token: 'HA_TOKEN' },
    { cycleId: 'create-haiku', cwd: '/tmp', io: io2 }
  );
  assert.strictEqual(result.action, 'human_appraise');
  assert.strictEqual(result.stage, 'human-appraise:create-haiku');
  assert.strictEqual(result.context.cycle, 'create-haiku');
  // artefact_file is null because no git diff changes detected
  assert.strictEqual(result.context.artefact_file, null);
});

test.skip('handleSortResult: recent feedback is sorted most-recent first and keeps equal timestamps stable', async () => {
  const io2 = makeIo({
    'WORK.md': `---
cycle: create-haiku
---
# Goal

haiku
`,
    'foundry/cycles/create-haiku.md': `---
id: create-haiku
output-type: haiku
---
`,
    'foundry/artefacts/haiku/definition.md': `---
id: haiku
file-patterns: ["out/*.md"]
---
`,
    'WORK.feedback.yaml': `items:
  - id: older
    file: haikus/a.md
    tag: human
    text: older
    source: appraise:create-haiku
    history:
      - state: rejected
        stage: appraise:create-haiku
        cycle: create-haiku
        timestamp: '2026-04-24T10:00:00.000Z'
        reason: still bad
  - id: equal-a
    file: haikus/a.md
    tag: human
    text: equal a
    source: appraise:create-haiku
    history:
      - state: rejected
        stage: appraise:create-haiku
        cycle: create-haiku
        timestamp: '2026-04-24T10:05:00.000Z'
        reason: still bad
  - id: equal-b
    file: haikus/a.md
    tag: human
    text: equal b
    source: appraise:create-haiku
    history:
      - state: wont-fix
        stage: appraise:create-haiku
        cycle: create-haiku
        timestamp: '2026-04-24T10:05:00.000Z'
        reason: acceptable tradeoff
  - id: newest
    file: haikus/a.md
    tag: human
    text: newest
    source: appraise:create-haiku
    history:
      - state: rejected
        stage: appraise:create-haiku
        cycle: create-haiku
        timestamp: '2026-04-24T10:10:00.000Z'
        reason: still bad
`,
  });

  const result = await orchestrate.__handleSortResultForTest(
    { route: 'human-appraise:create-haiku', token: 'HA_TOKEN' },
    { cycleId: 'create-haiku', cwd: '/tmp', io: io2 }
  );

  assert.deepStrictEqual(
    result.context.recent_feedback.map(item => item.id),
    ['newest', 'equal-a', 'equal-b', 'older']
  );
});

test.skip('runOrchestrate finalize: commit failure does not wedge workflow (G6 regression)', async () => {
  // Regression test for G6: non-atomic stage finalisation.
  // Setup: forge stage completed successfully, finalize should:
  // 1. Write new artefact rows to WORK.md
  // 2. Append two history entries to WORK.history.yaml
  // 3. Attempt git commit
  // 
  // If commit fails (e.g., unexpected files), WORK.md and WORK.history.yaml must NOT be dirty.
  // Otherwise the next orchestrate call sees dirty tool-managed files and refuses to run - wedged.
  
  const initialWorkMd = `---
flow: creative-flow
cycle: create-haiku
stages:
  - forge:create-haiku
  - appraise:create-haiku
max-iterations: 3
always-human-appraise: false
deadlock-human-appraise: true
models:
  forge: github-copilot/claude-sonnet-4.6
  appraise: github-copilot/claude-sonnet-4.6
---
# Goal

haiku
`;

  const initialHistory = `- cycle: create-haiku
  stage: sort
  iteration: 0
  route: forge:create-haiku
  comment: initial sort
  timestamp: 2026-01-01T00:00:00.000Z
  seq: 0
  open_feedback: 0
`;

  const io = makeIo({
    'WORK.md': initialWorkMd,
    'WORK.history.yaml': initialHistory,
    '.foundry/last-stage.json': JSON.stringify({
      cycle: 'create-haiku',
      stage: 'forge:create-haiku',
      baseSha: 'abc',
      summary: 'wrote haiku',
    }),
    'haikus/a.md': 'airport haiku / delayed flights and coffee / rain on the tarmac',
    'foundry/cycles/create-haiku.md': `---
id: create-haiku
output-type: haiku
stages: [forge, appraise]
always-human-appraise: false
deadlock-human-appraise: true
---
`,
    'foundry/artefacts/haiku/definition.md': `---
id: haiku
file-patterns: ["haikus/*.md"]
---
`,
    '.opencode/agents/foundry-github-copilot-claude-sonnet-4-6.md': '# agent',
  });

  const git = {
    commit: () => {
      // Simulate commit failure due to unexpected files
      const err = new Error('unexpected_files');
      err.code = 'unexpected_files';
      err.files = ['stray.bin'];
      throw err;
    },
    status: () => ({ clean: false, dirty: ['stray.bin'] }),
  };

  const result = await runOrchestrate({
    cwd: '/tmp/project',
    git,
    mint: () => 'TOKEN_2',
    now: () => 2000000,
    lastResult: { kind: 'dispatch', ok: true },
    finalize: async () => ({ ok: true, artefacts: [], changedFiles: ['haikus/a.md'] }),
  }, io);

  // Should return violation due to commit failure
  assert.strictEqual(result.action, 'violation');
  assert.match(result.details, /stray\.bin/);

  // CRITICAL: WORK.md and WORK.history.yaml must be UNCHANGED (rollback happened)
  const workAfter = io.readFile('WORK.md');
  const historyAfter = io.readFile('WORK.history.yaml');
  
  assert.strictEqual(workAfter, initialWorkMd, 
    'WORK.md should be rolled back to original state after commit failure');
  assert.strictEqual(historyAfter, initialHistory, 
    'WORK.history.yaml should be rolled back to original state after commit failure');

  // Verify that the next orchestrate call can proceed (not wedged)
  // This would fail in the buggy version because sort would see dirty tool-managed files
  const result2 = await runOrchestrate({
    cwd: '/tmp/project',
    git: {
      commit: (msg) => 'sha123',
      status: () => ({ clean: true, dirty: [] }),
    },
    mint: () => 'TOKEN_3',
    now: () => 3000000,
    finalize: async () => ({ ok: true, artefacts: [], changedFiles: [] }),
  }, io);

  // Should be able to dispatch to the next stage, not wedged
  assert.strictEqual(result2.action, 'dispatch', 
    'Next orchestrate should proceed normally after rollback, not be wedged');
});

test.skip('runOrchestrate: successful finalization clears lastStage state', async () => {
  // Regression test: lastStage is not cleared after successful finalization.
  // If a later orchestrate call has lastResult.ok === false, it can pick up
  // stale lastStage state from a previous cycle.
  
  const io = makeIo({
    'WORK.md': `---
flow: creative-flow
cycle: create-haiku
stages:
  - forge:create-haiku
  - appraise:create-haiku
max-iterations: 3
always-human-appraise: false
deadlock-human-appraise: true
models:
  forge: github-copilot/claude-sonnet-4.6
  appraise: github-copilot/claude-sonnet-4.6
---
# Goal

haiku
`,
    'WORK.history.yaml': '',
    'WORK.feedback.yaml': `items:
  - id: fb1
    file: haikus/a.md
    tag: human
    text: needs work
    source: appraise:create-haiku
    history:
      - state: open
        stage: appraise:create-haiku
        cycle: create-haiku
        timestamp: '2026-01-01T00:00:00.000Z'
  - id: fb2
    file: haikus/a.md
    tag: human
    text: also needs work
    source: appraise:create-haiku
    history:
      - state: open
        stage: appraise:create-haiku
        cycle: create-haiku
        timestamp: '2026-01-01T00:01:00.000Z'
`,
    '.foundry/last-stage.json': JSON.stringify({
      cycle: 'create-haiku',
      stage: 'forge:create-haiku',
      baseSha: 'abc',
      summary: 'wrote haiku'
    }),
    'foundry/cycles/create-haiku.md': `---
id: create-haiku
output-type: haiku
---
`,
    'foundry/artefacts/haiku/definition.md': `---
id: haiku
file-patterns: ["haikus/*.md"]
---
`,
    '.opencode/agents/foundry-github-copilot-claude-sonnet-4-6.md': '# agent',
  });

  const git = {
    commit: (msg) => 'sha123',
    status: () => ({ clean: true, dirty: [] }),
  };

  await runOrchestrate({
    cwd: '/tmp/project',
    git,
    mint: () => 'TOKEN',
    now: () => 1000000,
    lastResult: { ok: true },
    finalize: async () => ({ ok: true, artefacts: [] }),
  }, io);

  const history = loadHistory('WORK.history.yaml', 'create-haiku', io);
  const sortEntry = history.find(e => e.stage === 'sort');
  assert.ok(sortEntry, 'should have a sort history entry');
  assert.strictEqual(sortEntry.open_feedback, 2, 'sort entry must persist actual feedback count (2), not 0');
});

test.skip('runOrchestrate: commit failure rollback restores pre-finalize WORK.md state', async () => {
  // Regression test: orchestrate snapshots WORK.md after finalize() has already
  // run. If commit fails, the rollback restores the post-finalize state instead
  // of the clean pre-finalize state.
  
  const initialWorkMd = `---
flow: creative-flow
cycle: create-haiku
stages:
  - forge:create-haiku
  - appraise:create-haiku
max-iterations: 3
always-human-appraise: false
deadlock-human-appraise: true
models:
  forge: github-copilot/claude-sonnet-4.6
  appraise: github-copilot/claude-sonnet-4.6
---
# Goal

haiku
`;

  const initialHistory = '';

  const io = makeIo({
    'WORK.md': initialWorkMd,
    'WORK.history.yaml': initialHistory,
    '.foundry/last-stage.json': JSON.stringify({
      cycle: 'create-haiku',
      stage: 'forge:create-haiku',
      baseSha: 'abc',
      summary: 'wrote haiku',
    }),
    'haikus/a.md': 'haiku content',
    'foundry/cycles/create-haiku.md': `---
id: create-haiku
output-type: haiku
stages: [forge, appraise]
---
`,
    'foundry/artefacts/haiku/definition.md': `---
id: haiku
file-patterns: ["haikus/*.md"]
---
`,
    '.opencode/agents/foundry-github-copilot-claude-sonnet-4-6.md': '# agent',
  });

  const git = {
    commit: () => {
      const err = new Error('unexpected_files');
      err.code = 'unexpected_files';
      err.files = ['stray.bin'];
      throw err;
    },
    status: () => ({ clean: false, dirty: ['stray.bin'] }),
  };

  const result = await runOrchestrate({
    cwd: '/tmp/project',
    git,
    mint: () => 'TOKEN',
    now: () => 1000000,
    lastResult: { ok: true },
    finalize: async () => ({ ok: true, artefacts: [], changedFiles: ['haikus/a.md'] }),
  }, io);

  assert.strictEqual(result.action, 'violation');
  assert.match(result.details, /stray\.bin/);

  // CRITICAL: WORK.md and WORK.history.yaml must be rolled back
  const workAfter = io.readFile('WORK.md');
  const historyAfter = io.exists('WORK.history.yaml') ? io.readFile('WORK.history.yaml') : '';
  assert.strictEqual(workAfter, initialWorkMd, 
    'WORK.md should be rolled back after commit failure');
  assert.strictEqual(historyAfter, initialHistory, 
    'WORK.history.yaml should be rolled back after commit failure');
});

test.skip('runOrchestrate: successful finalization clears lastStage state', async () => {
  // Regression test: lastStage is not cleared after successful finalization.
  // If a later orchestrate call has lastResult.ok === false, it can pick up
  // stale lastStage state from a previous cycle.
  
  const io = makeIo({
    'WORK.md': `---
flow: creative-flow
cycle: create-haiku
stages:
  - forge:create-haiku
  - appraise:create-haiku
max-iterations: 3
always-human-appraise: false
deadlock-human-appraise: true
models:
  forge: github-copilot/claude-sonnet-4.6
  appraise: github-copilot/claude-sonnet-4.6
---
# Goal

haiku
`,
    'WORK.history.yaml': '',
    '.foundry/last-stage.json': JSON.stringify({
      cycle: 'create-haiku',
      stage: 'forge:create-haiku',
      baseSha: 'abc',
      summary: 'wrote haiku',
    }),
    'foundry/cycles/create-haiku.md': `---
id: create-haiku
output-type: haiku
stages: [forge, appraise]
---
`,
    'foundry/artefacts/haiku/definition.md': `---
id: haiku
file-patterns: ["haikus/*.md"]
---
`,
    '.opencode/agents/foundry-github-copilot-claude-sonnet-4-6.md': '# agent',
  });

  const git = {
    commit: () => 'sha123',
    status: () => ({ clean: true, dirty: [] }),
  };

  const result = await runOrchestrate({
    cwd: '/tmp/project',
    git,
    mint: () => 'TOKEN',
    now: () => 1000000,
    lastResult: { ok: true },
    finalize: async () => ({ ok: true, artefacts: [], changedFiles: [] }),
  }, io);

  // Appraise is internal — cycle completes (forge → appraise → done)
  assert.strictEqual(result.action, 'done', 'expected done (appraise runs internally, no lastResult needed)');

  // CRITICAL: lastStage must be cleared after successful finalization
  assert.strictEqual(io.exists('.foundry/last-stage.json'), false, 
    'lastStage should be cleared after successful finalization to prevent stale state corruption');
});

// ---------------------------------------------------------------------------
// enforceForgeStage — single-item contract enforcement
// ---------------------------------------------------------------------------

describe.skip('enforceForgeStage', () => {
  const EMPTY_SHA = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

  function makeForgeIo(files = {}) {
    const defaults = {
      'foundry/artefacts/haiku/definition.md': `---
id: haiku
---`,
    };
    return makeIo({ ...defaults, ...files });
  }

  function addForgeOutput(files, output) {
    return { ...files, '.foundry/stage-outputs/forge-out.jsonl': JSON.stringify(output) };
  }

  // #1 — No forgeItem -> no-op, passes
  test('no forgeItem — no-op, passes', async () => {
    const io = makeForgeIo(addForgeOutput({
      '.foundry/last-stage.json': JSON.stringify({
        cycle: 'test-cycle', stage: 'forge:test-cycle', baseSha: 'abc', summary: 'did work',
      }),
    }, { status: 'done' }));
    const forgeCtx = { forgeItem: null, forgePreVersion: EMPTY_SHA };
    const fgResult = { outputType: 'haiku' };
    const result = await orchestrate.__enforceForgeStageForTest(forgeCtx, fgResult, 'test-cycle', io, '/tmp');
    assert.equal(result.contractPassed, true);
    assert.equal(result.postVersion, EMPTY_SHA);
  });

  // #2 — Version changed -> passes, item actioned
  test('version changed — passes, item actioned', async () => {
    const io = makeForgeIo(addForgeOutput({
      '.foundry/last-stage.json': JSON.stringify({
        cycle: 'test-cycle', stage: 'forge:test-cycle', baseSha: 'abc', summary: 'fixed it',
      }),
      'WORK.feedback.yaml': `items:
  - id: item-1
    file: test.md
    tag: law:test
    text: test feedback
    source: quench:test-cycle
    history:
      - state: open
        stage: quench:test-cycle
        cycle: test-cycle
        timestamp: '2026-01-01T00:00:00.000Z'
`,
    }, { status: 'actioned' }));
    const forgeCtx = {
      forgeItem: { id: 'item-1', file: 'test.md', tag: 'law:test', text: 'test feedback', source: 'quench', sourceAlias: 'quench:test-cycle' },
      forgePreVersion: 'v1-old',
    };
    const fgResult = { outputType: 'haiku' };
    const result = await orchestrate.__enforceForgeStageForTest(forgeCtx, fgResult, 'test-cycle', io, '/tmp');
    assert.equal(result.contractPassed, true);
    assert.equal(typeof result.postVersion, 'string');
    assert.equal(result.postVersion.length, 64);
    // Manually check item was actioned via raw YAML
    const raw = yaml.load(io.readFile('WORK.feedback.yaml'));
    const item = raw.items.find(i => i.id === 'item-1');
    assert.equal(item.history[0].state, 'actioned');
    assert.equal(item.history[0].stage, 'forge:test-cycle');
  });

  // #3 — Version unchanged + WONT-FIX appraise -> passes
  test('version unchanged + WONT-FIX appraise — passes, item wont-fix', async () => {
    const io = makeForgeIo(addForgeOutput({
      '.foundry/last-stage.json': JSON.stringify({
        cycle: 'test-cycle', stage: 'forge:test-cycle', baseSha: 'abc', summary: 'WONT-FIX: subjective preference',
      }),
      'WORK.feedback.yaml': `items:
  - id: item-1
    file: test.md
    tag: law:test
    text: test feedback
    source: appraise:test-cycle
    history:
      - state: open
        stage: appraise:test-cycle
        cycle: test-cycle
        timestamp: '2026-01-01T00:00:00.000Z'
`,
    }, { status: 'wont-fix', reason: 'subjective preference' }));
    const forgeCtx = {
      forgeItem: { id: 'item-1', file: 'test.md', tag: 'law:test', text: 'test feedback', source: 'appraise:test-cycle' },
      forgePreVersion: EMPTY_SHA,
    };
    const fgResult = { outputType: 'haiku' };
    const result = await orchestrate.__enforceForgeStageForTest(forgeCtx, fgResult, 'test-cycle', io, '/tmp');
    assert.equal(result.contractPassed, true);
    const raw = yaml.load(io.readFile('WORK.feedback.yaml'));
    const item = raw.items.find(i => i.id === 'item-1');
    assert.equal(item.history[0].state, 'wont-fix');
    assert.equal(item.history[0].reason, 'subjective preference');
  });

  // #4 — Version unchanged + WONT-FIX quench -> passes
  test('version unchanged + WONT-FIX quench — passes', async () => {
    const io = makeForgeIo(addForgeOutput({
      '.foundry/last-stage.json': JSON.stringify({
        cycle: 'test-cycle', stage: 'forge:test-cycle', baseSha: 'abc', summary: 'WONT-FIX: not a bug',
      }),
      'WORK.feedback.yaml': `items:
  - id: item-1
    file: test.md
    tag: law:test
    text: test feedback
    source: quench:test-cycle
    history:
      - state: open
        stage: quench:test-cycle
        cycle: test-cycle
        timestamp: '2026-01-01T00:00:00.000Z'
`,
    }, { status: 'wont-fix', reason: 'not a bug' }));
    const forgeCtx = {
      forgeItem: { id: 'item-1', file: 'test.md', tag: 'law:test', text: 'test feedback', source: 'quench', sourceAlias: 'quench:test-cycle' },
      forgePreVersion: EMPTY_SHA,
    };
    const fgResult = { outputType: 'haiku' };
    const result = await orchestrate.__enforceForgeStageForTest(forgeCtx, fgResult, 'test-cycle', io, '/tmp');
    assert.equal(result.contractPassed, true);
  });

  // #5 — Version unchanged + no WONT-FIX -> violation
  test('version unchanged + no WONT-FIX — violation', async () => {
    const io = makeForgeIo(addForgeOutput({
      '.foundry/last-stage.json': JSON.stringify({
        cycle: 'test-cycle', stage: 'forge:test-cycle', baseSha: 'abc', summary: 'did some work',
      }),
      'WORK.feedback.yaml': `items:
  - id: item-1
    file: test.md
    tag: law:test
    text: test feedback
    source: quench:test-cycle
    history:
      - state: open
        stage: quench:test-cycle
        cycle: test-cycle
        timestamp: '2026-01-01T00:00:00.000Z'
`,
    }, { status: 'done' }));
    const forgeCtx = {
      forgeItem: { id: 'item-1', file: 'test.md', tag: 'law:test', text: 'test feedback', source: 'quench', sourceAlias: 'quench:test-cycle' },
      forgePreVersion: EMPTY_SHA,
    };
    const fgResult = { outputType: 'haiku' };
    const result = await orchestrate.__enforceForgeStageForTest(forgeCtx, fgResult, 'test-cycle', io, '/tmp');
    assert.equal(result.contractPassed, false);
  });

  // #6 — 3 consecutive failures -> cycle violation
  test('3 consecutive failures — cycle violation', async () => {
    const io = makeForgeIo(addForgeOutput({
      '.foundry/last-stage.json': JSON.stringify({
        cycle: 'test-cycle', stage: 'forge:test-cycle', baseSha: 'abc', summary: 'did some work',
      }),
      'WORK.history.yaml': `- cycle: test-cycle
  stage: forge:test-cycle
  contract_passed: false
  timestamp: '2026-01-01T00:00:00.000Z'
- cycle: test-cycle
  stage: forge:test-cycle
  contract_passed: false
  timestamp: '2026-01-01T00:01:00.000Z'
`,
      'WORK.feedback.yaml': `items:
  - id: item-1
    file: test.md
    tag: law:test
    text: test feedback
    source: quench:test-cycle
    history:
      - state: open
        stage: quench:test-cycle
        cycle: test-cycle
        timestamp: '2026-01-01T00:00:00.000Z'
`,
    }, { status: 'done' }));
    const forgeCtx = {
      forgeItem: { id: 'item-1', file: 'test.md', tag: 'law:test', text: 'test feedback', source: 'quench', sourceAlias: 'quench:test-cycle' },
      forgePreVersion: EMPTY_SHA,
    };
    const fgResult = { outputType: 'haiku' };
    const result = await orchestrate.__enforceForgeStageForTest(forgeCtx, fgResult, 'test-cycle', io, '/tmp');
    assert.ok(result.violation, 'expected cycle violation after 3 consecutive forge failures');
    assert.match(result.violation, /forge contract failed 3 consecutive times/);
  });
});
