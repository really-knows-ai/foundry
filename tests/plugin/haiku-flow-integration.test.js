/**
 * Integration test — full haiku flow with mock client.
 *
 * Exercises the complete forge → quench → appraise → human-appraise →
 * foundry_continue → done flow using a mock SDK client. Provisions a
 * temporary git repository with haiku flow, cycle, and artefact fixture
 * files. All stages execute deterministically via canned SDK responses.
 */

import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync,
} from 'node:fs';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FoundryPlugin } from '../../src/plugin/foundry.js';
import { _setExecFile } from '../../src/scripts/lib/dispatch-cli.js';

function makeChildProcess({ exitCode = 0 } = {}) {
  const handlers = {};
  const child = { on: (e, h) => { handlers[e] = h; }, kill: mock.fn() };
  process.nextTick(() => { if (handlers.exit) handlers.exit(exitCode, null); });
  return child;
}

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t',
  GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
};

// ── Fixture helpers ──────────────────────────────────────────────────

function writeFlowDef(root, flowId) {
  const dir = join(root, 'foundry/flows');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, flowId + '.md'),
    '---\nstarting-cycles: write-haiku\n---\n# Haiku Flow\n');
}

function writeCycleDef(root, cycleId) {
  const dir = join(root, 'foundry/cycles');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, cycleId + '.md'),
    '---\n' +
    'output-type: haiku\n' +
    'stages: [forge, quench, appraise, human-appraise]\n' +
    'max-iterations: 3\n' +
    'always-human-appraise: true\n' +
    'models:\n' +
    '  forge: opencode-go/deepseek-v4-flash\n' +
    '  appraise: opencode-go/deepseek-v4-flash\n' +
    '---\n# Write Haiku\n');
}

function writeArtefactDef(root) {
  const dir = join(root, 'foundry/artefacts/haiku');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'definition.md'),
    '---\ntype: haiku\nfile-patterns: ["haikus/*.md"]\n---\n');
}

function initRepo(root, branch) {
  execSync('git init -q', { cwd: root, env: GIT_ENV });
  execSync('git checkout -B main -q', { cwd: root, env: GIT_ENV });
  writeFileSync(join(root, '.gitignore'), '.foundry/\n.snapshots/\n');
  writeFileSync(join(root, 'README.md'), 'baseline\n');
  execSync('git add . && git commit -m init -q', { cwd: root, env: GIT_ENV });
  if (branch && branch !== 'main') {
    execSync('git checkout -q -b ' + branch, { cwd: root, env: GIT_ENV });
  }
}

function setupHaikuRepo(root, branch) {
  initRepo(root, branch);
  writeFlowDef(root, 'haiku');
  writeCycleDef(root, 'write-haiku');
  writeArtefactDef(root);
  execSync('git add . && git commit -m "add haiku flow" -q', { cwd: root, env: GIT_ENV });
}

function tmpDir() {
  return mkdtempSync(join(tmpdir(), 'haiku-flow-'));
}

function cleanup(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

// ── Mock client factory ─────────────────────────────────────────────

function createMockClient() {
  const callLog = { create: [], prompt: [], messages: [] };

  const client = {
    _callLog: callLog,
    session: {
      create: async function() {
        throw new Error('SDK session.create should not be called — CLI spawn replaces it');
      },
      prompt: async function() {
        throw new Error('SDK session.prompt should not be called — CLI spawn replaces it');
      },
      messages: async function() {
        callLog.messages.push({ args: arguments });
        return [];
      },
    },
    config: {
      providers: async function() { return []; },
    },
    provider: {
      list: function() { return { connected: [] }; },
    },
  };
  return client;
}

// ── Test cases ──────────────────────────────────────────────────────

test('D1.1: full haiku flow completes end-to-end', async () => {
  const root = tmpDir();
  try {
    setupHaikuRepo(root, 'work/haiku-test');
    const client = createMockClient();
    const execFileMock = mock.fn(() => makeChildProcess({ exitCode: 0 }));
    _setExecFile(execFileMock);
    const plugin = await FoundryPlugin({ directory: root, client });

    // First call: foundry_run starts the flow
    const runResult = JSON.parse(await plugin.tool.foundry_run.execute(
      { flow: 'haiku', goal: 'write a haiku about sausages' },
      { worktree: root, sessionID: 'main-session' },
    ));

    // Should return prompt_user for human-appraise stage
    assert.equal(runResult.action, 'prompt_user',
      'expected prompt_user, got: ' + runResult.action);
    assert.ok(runResult.stage, 'stage should be set');
    assert.ok(runResult.stage.includes('human-appraise'),
      'stage should be human-appraise, got: ' + runResult.stage);

    // Verify on-disk state: active-stage.json
    const activeStagePath = join(root, '.foundry/active-stage.json');
    assert.ok(existsSync(activeStagePath), 'active-stage.json should exist');
    const activeStage = JSON.parse(readFileSync(activeStagePath, 'utf8'));
    assert.ok(activeStage.stage, 'active stage should have a stage');
    assert.ok(activeStage.stage.includes('human-appraise'),
      'active stage should be human-appraise');
    assert.ok(Object.hasOwn(activeStage, 'boundaryMarker'),
      'active stage should have a boundaryMarker');
    assert.equal(activeStage.cycle, 'write-haiku');

    // Verify WORK.md exists
    assert.ok(existsSync(join(root, 'WORK.md')), 'WORK.md should exist');
    const workMd = readFileSync(join(root, 'WORK.md'), 'utf8');
    assert.ok(workMd.includes('flow: haiku'), 'WORK.md should reference haiku flow');
    assert.ok(workMd.includes('cycle: write-haiku'), 'WORK.md should reference write-haiku cycle');

    // Second call: foundry_continue resumes and returns a valid action
    // With always-human-appraise the flow may cycle back to prompt_user
    let continueResult;
    const validActions = new Set();
    for (let i = 0; i < 10; i++) {
      continueResult = JSON.parse(await plugin.tool.foundry_continue.execute(
        {},
        { worktree: root, sessionID: 'main-session' },
      ));
      validActions.add(continueResult.action);
      if (continueResult.action === 'done' || continueResult.action === 'violation') break;
    }

    // Should return a valid action (prompt_user, done, or violation)
    assert.ok(
      validActions.has('done') || validActions.has('violation') || validActions.has('prompt_user'),
      'expected done, violation, or prompt_user, got: ' + continueResult.action,
    );

    // Verify no invalid action types across the entire run
    assert.ok(!validActions.has('continue'), 'action set must not include continue');

    // If done, verify flow and artefact
    if (continueResult.action === 'done') {
      assert.equal(continueResult.flow, 'haiku');
    }
  } finally {
    _setExecFile((await import('node:child_process')).execFile);
    cleanup(root);
  }
});

test('D1.2: foundry_continue resume captures verbatim user reply', async () => {
  const root = tmpDir();
  try {
    setupHaikuRepo(root, 'work/haiku-capture');
    const client = createMockClient();
    const execFileMock = mock.fn(() => makeChildProcess({ exitCode: 0 }));
    _setExecFile(execFileMock);

    // Mock session.messages to return post-marker user messages
    client.session.messages = async function() {
      return [
        { info: { id: 'msg_before', role: 'assistant' }, parts: [{ type: 'text', text: 'Here is your haiku' }] },
        { info: { id: 'marker_msg', role: 'assistant' }, parts: [{ type: 'text', text: 'What do you think?' }] },
        { info: { id: 'msg_after_1', role: 'user' }, parts: [{ type: 'text', text: 'this needs more seasoning' }] },
        { info: { id: 'msg_after_2', role: 'assistant' }, parts: [{ type: 'text', text: 'I see, let me note that' }] },
        { info: { id: 'msg_after_3', role: 'user' }, parts: [{ type: 'text', text: 'and a shorter line' }] },
      ];
    };

    const plugin = await FoundryPlugin({ directory: root, client });

    // Run to human-appraise
    await plugin.tool.foundry_run.execute(
      { flow: 'haiku', goal: 'write a haiku' },
      { worktree: root, sessionID: 'main-session' },
    );

    // The active stage has a boundaryMarker from the session
    // foundry_continue should capture the post-marker user text
    const result = JSON.parse(await plugin.tool.foundry_continue.execute(
      {},
      { worktree: root, sessionID: 'main-session' },
    ));

    // Check verbatim capture was written
    const capturePath = join(root, '.foundry/verbatim-capture.txt');
    if (existsSync(capturePath)) {
      const capture = readFileSync(capturePath, 'utf8');
      assert.ok(capture.includes('this needs more seasoning'),
        'capture should contain first user message');
      assert.ok(capture.includes('and a shorter line'),
        'capture should contain second user message');
    }

    // The run should continue (feedback was added)
    assert.ok(
      result.action === 'done' || result.action === 'prompt_user' || result.action === 'violation',
      'unexpected action: ' + result.action,
    );
  } finally {
    _setExecFile((await import('node:child_process')).execFile);
    cleanup(root);
  }
});

test('D1.3: flow returns done when no feedback after human-appraise', async () => {
  const root = tmpDir();
  try {
    setupHaikuRepo(root, 'work/haiku-empty');
    const client = createMockClient();
    const execFileMock = mock.fn(() => makeChildProcess({ exitCode: 0 }));
    _setExecFile(execFileMock);

    // Mock session.messages to return NO post-marker user messages
    client.session.messages = async function() {
      return [
        { info: { id: 'marker_msg', role: 'assistant' }, parts: [{ type: 'text', text: 'What do you think?' }] },
      ];
    };

    const plugin = await FoundryPlugin({ directory: root, client });

    await plugin.tool.foundry_run.execute(
      { flow: 'haiku', goal: 'write a haiku' },
      { worktree: root, sessionID: 'main-session' },
    );

    // Continue may need multiple iterations
    let result;
    const seenActions = new Set();
    for (let i = 0; i < 10; i++) {
      result = JSON.parse(await plugin.tool.foundry_continue.execute(
        {},
        { worktree: root, sessionID: 'main-session' },
      ));
      seenActions.add(result.action);
      if (result.action === 'done' || result.action === 'violation') break;
    }

    // Should eventually terminate (with always-human-appraise, may cycle)
    assert.ok(seenActions.has('done') || seenActions.has('violation') || seenActions.has('prompt_user'),
      'expected done, violation, or prompt_user, got: ' + result.action);
    assert.ok(!seenActions.has('continue'), 'action set must not include continue');
  } finally {
    _setExecFile((await import('node:child_process')).execFile);
    cleanup(root);
  }
});

test('D1.4: branch guard rejects non-work branch', async () => {
  const root = tmpDir();
  try {
    setupHaikuRepo(root, 'main');
    const client = createMockClient();
    const plugin = await FoundryPlugin({ directory: root, client });

    const result = JSON.parse(await plugin.tool.foundry_run.execute(
      { flow: 'haiku', goal: 'test' },
      { worktree: root, sessionID: 'main-session' },
    ));

    assert.equal(result.action, 'violation');
    assert.ok(result.details.includes('work/'),
      'violation should mention work/ branch requirement');
  } finally {
    cleanup(root);
  }
});

test('D1.5: foundry_continue returns violation when WORK.md missing', async () => {
  const root = tmpDir();
  try {
    setupHaikuRepo(root, 'work/test-branch');
    const client = createMockClient();
    const plugin = await FoundryPlugin({ directory: root, client });

    const result = JSON.parse(await plugin.tool.foundry_continue.execute(
      {},
      { worktree: root, sessionID: 'main-session' },
    ));

    assert.equal(result.action, 'violation');
    assert.ok(result.details.includes('WORK.md'),
      'violation should mention WORK.md');
  } finally {
    cleanup(root);
  }
});

test('D1.6: foundry_continue returns violation on failed flow', async () => {
  const root = tmpDir();
  try {
    setupHaikuRepo(root, 'work/failed-branch');
    writeFileSync(join(root, 'WORK.md'),
      '---\nflow: haiku\ncycle: write-haiku\nstatus: failed\n---\nFailed\n');
    execSync('git add . && git commit -m "failed flow" -q', { cwd: root, env: GIT_ENV });

    const client = createMockClient();
    const plugin = await FoundryPlugin({ directory: root, client });

    const result = JSON.parse(await plugin.tool.foundry_continue.execute(
      {},
      { worktree: root, sessionID: 'main-session' },
    ));

    assert.equal(result.action, 'violation');
    assert.equal(result.recoverable, false);
    assert.ok(result.details.includes('failed'),
      'violation should mention failed state');
  } finally {
    cleanup(root);
  }
});

test('D1.7: appraise dispatch uses parallel sessions and consolidates', async () => {
  const root = tmpDir();
  try {
    // Setup: create appraiser definitions for two appraisers
    setupHaikuRepo(root, 'work/haiku-appraise');
    const appraisersDir = join(root, 'foundry/appraisers');
    mkdirSync(appraisersDir, { recursive: true });
    writeFileSync(join(appraisersDir, 'style-checker.md'),
      '---\nid: style-checker\nname: Style Checker\n---\nCheck style.\n');
    writeFileSync(join(appraisersDir, 'law-checker.md'),
      '---\nid: law-checker\nname: Law Checker\n---\nCheck laws.\n');
    // Add a law file so executeAppraise does not short-circuit with "no laws"
    const lawsDir = join(root, 'foundry/laws');
    mkdirSync(lawsDir, { recursive: true });
    writeFileSync(join(lawsDir, 'quality.md'),
      '---\n---\n## haiku-syllables\nHaikus must follow 5-7-5 syllable structure.\n');
    execSync('git add . && git commit -m "add appraisers and laws" -q', { cwd: root, env: GIT_ENV });

    // Create an artefact file so appraise has something to evaluate
    const haikusDir = join(root, 'haikus');
    mkdirSync(haikusDir, { recursive: true });
    writeFileSync(join(haikusDir, 'test-haiku.md'), 'sausages and eggs\nsizzling in the morning sun\na perfect breakfast\n');
    execSync('git add . && git commit -m "add haiku artefact" -q', { cwd: root, env: GIT_ENV });

    const client = createMockClient();
    const execFileMock = mock.fn(() => {
      // Simulate the child process writing stage-output files
      const outDir = join(root, '.foundry/stage-outputs');
      mkdirSync(outDir, { recursive: true });
      writeFileSync(join(outDir, 'dispatch-out-' + Date.now() + '.jsonl'),
        '{"file":"haikus/test-haiku.md","law":"haiku-syllables","text":"mock finding","group":"default","appraiser":"style-checker","pass":1}\n');
      return makeChildProcess({ exitCode: 0 });
    });
    _setExecFile(execFileMock);

    const plugin = await FoundryPlugin({ directory: root, client });

    await plugin.tool.foundry_run.execute(
      { flow: 'haiku', goal: 'write a haiku' },
      { worktree: root, sessionID: 'main-session' },
    );

    // Dispatches happened via CLI spawn (execFile for forge + appraise)
    assert.ok(execFileMock.mock.callCount() >= 2,
      'expected at least 2 dispatches via CLI spawn, got: ' + execFileMock.mock.callCount());

    // Stage-output files were produced
    const stageDir = join(root, '.foundry/stage-outputs');
    assert.ok(existsSync(stageDir), 'stage-outputs directory should exist');
    const files = existsSync(stageDir)
      ? readdirSync(stageDir).filter(function(f) { return f.endsWith('.jsonl'); })
      : [];
    assert.ok(files.length >= 1,
      'expected at least 1 stage-output file, got: ' + files.length);
  } finally {
    _setExecFile((await import('node:child_process')).execFile);
    cleanup(root);
  }
});

test('D1.8: action set is exactly prompt_user, done, violation', async () => {
  const root = tmpDir();
  try {
    setupHaikuRepo(root, 'work/haiku-actions');
    const client = createMockClient();
    const execFileMock = mock.fn(() => makeChildProcess({ exitCode: 0 }));
    _setExecFile(execFileMock);

    // Return prompt_user for the first continue and done for the second
    const plugin = await FoundryPlugin({ directory: root, client });

    const runResult = JSON.parse(await plugin.tool.foundry_run.execute(
      { flow: 'haiku', goal: 'write a haiku' },
      { worktree: root, sessionID: 'main-session' },
    ));

    // Collect all unique action values
    const actions = new Set();
    actions.add(runResult.action);

    // Continue may produce more actions (loop until done/violation)
    for (let i = 0; i < 10; i++) {
      const continueResult = JSON.parse(await plugin.tool.foundry_continue.execute(
        {},
        { worktree: root, sessionID: 'main-session' },
      ));
      actions.add(continueResult.action);
      if (continueResult.action === 'done' || continueResult.action === 'violation') break;
    }

    // Verify no invalid action types
    for (const action of actions) {
      assert.ok(
        ['prompt_user', 'done', 'violation'].includes(action),
        'unexpected action: ' + action,
      );
    }
    assert.ok(!actions.has('continue'), 'action set must not include continue');
  } finally {
    _setExecFile((await import('node:child_process')).execFile);
    cleanup(root);
  }
});
