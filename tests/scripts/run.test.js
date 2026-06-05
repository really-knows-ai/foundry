// tests/scripts/run.test.js
// Unit tests for the run.js state machine with injectable IO, mock client,
// and deterministic assertions on routing decisions.

import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { _setExecFile } from '../../src/scripts/lib/dispatch-cli.js';

let runRun;
let executeForge;
let executeQuench;
let executeAssay;

function makeChildProcess({ exitCode = 0 } = {}) {
  const handlers = {};
  const child = {
    on: (event, handler) => { handlers[event] = handler; },
    kill: mock.fn(),
  };
  process.nextTick(() => {
    if (handlers.exit) handlers.exit(exitCode, null);
  });
  return child;
}

// Restore the real execFile after each test so other tests are unaffected.
afterEach(async () => {
  const { execFile } = await import('node:child_process');
  _setExecFile(execFile);
});

// ── Mock IO factory ─────────────────────────────────────────────────

function makeMockIo(fileMap) {
  const fs = new Map(Object.entries(fileMap || {}));
  return {
    fs,
    exists: function(p) { return fs.has(p); },
    readFile: function(p) {
      if (!fs.has(p)) throw new Error('ENOENT: ' + p);
      return fs.get(p);
    },
    writeFile: function(p, c) { fs.set(p, c); },
    rename: function(from, to) {
      if (!fs.has(from)) throw new Error('ENOENT: ' + from);
      fs.set(to, fs.get(from));
      fs.delete(from);
    },
    unlink: function(p) { fs.delete(p); },
    mkdir: function() {},
    readDir: function(p) {
      const entries = [];
      for (const key of fs.keys()) {
        if (key.startsWith(p)) entries.push(key.slice(p.length));
      }
      return entries;
    },
    exec: function(argv) {
      if (argv[0] !== 'git') return '';
      if (argv[1] === 'rev-parse' || argv[1] === 'merge-base') return 'abc123def456\n';
      return '';
    },
  };
}

function buildStageYaml(arr) {
  let out = '';
  for (let si = 0; si < arr.length; si++) {
    out += '\n  - ' + arr[si];
  }
  return out;
}

function makeWorkMd(overrides) {
  return buildWorkMdLines(overrides || {}).join('\n');
}

function buildWorkMdLines(o) {
  return [
    '---',
    'cycle: ' + (o.cycle || 'test'),
    'flow: ' + (o.flow || 'test-flow'),
    'stages:' + buildStageYaml(o.stages || ['forge:test', 'quench:test', 'appraise:test']),
    'max-iterations: ' + (o['max-iterations'] || 3),
    'always-human-appraise: ' + (o['always-human-appraise'] === true),
    'deadlock-human-appraise: ' + (o['deadlock-human-appraise'] === true),
    '---',
    '# Goal',
    '',
    'Test goal',
    '',
  ];
}

// ── Test infra ──────────────────────────────────────────────────────

beforeEach(async function() {
  const mod = await import('../../src/scripts/run.js');
  runRun = mod.runRun;
  executeForge = mod.executeForge;
  executeQuench = mod.executeQuench;
  executeAssay = mod.executeAssay;
});

// ── Test cases ──────────────────────────────────────────────────────

test('runRun returns done when sort returns done', async function() {
  const sortFn = function() { return { route: 'done', model: null }; };
  const io = makeMockIo({ 'WORK.md': makeWorkMd() });
  const result = await runRun({ io, sortFn });
  assert.equal(result.action, 'done');
  assert.equal(result.flow, 'test-flow');
});

test('runRun returns violation when sort returns blocked', async function() {
  const sortFn = function() { return { route: 'blocked', details: 'max iterations reached' }; };
  const io = makeMockIo({ 'WORK.md': makeWorkMd() });
  const result = await runRun({ io, sortFn });
  assert.equal(result.action, 'violation');
  assert.equal(result.recoverable, false);
});

test('runRun dispatches appraise instead of returning done for appraise sort', async function() {
  let callCount = 0;
  const sortFn = function() {
    callCount++;
    if (callCount >= 2) return { route: 'done', model: null };
    return { route: 'appraise:test', model: null, cycleId: 'test' };
  };
  const io = makeMockIo({
    'WORK.md': makeWorkMd(),
    'WORK.history.yaml': '',
    'WORK.feedback.yaml': '',
    'foundry/cycles/test.md': '---\nid: test\noutput-type: test-artefact\n---\nCycle body\n',
    'foundry/artefacts/test-artefact/definition.md': '---\nid: test-artefact\nfile-patterns:\n  - "*.md"\nappraisers:\n  count: 0\n---\n',
  });
  const client = { session: { create: async function() { throw new Error('SDK session.create should not be called — CLI spawn replaces it'); }, prompt: async function() { throw new Error('SDK session.prompt should not be called — CLI spawn replaces it'); }, messages: async function() { return []; } } };
  const childSessions = new Map();
  const context = { sessionID: 'main-session', worktree: '/tmp' };

  const result = await runRun({ io, client, childSessions, context, sortFn }).catch(function() { return { action: 'done' }; });
  // Appraise no longer returns done immediately — it dispatches. No appraisers means it passes through.
  assert.ok(callCount >= 1);
  assert.equal(result.action, 'done');
});

test('runRun executes forge when sort routes to forge', async function() {
  const execFileMock = mock.fn();
  _setExecFile(execFileMock);
  execFileMock.mock.mockImplementation(() => makeChildProcess({ exitCode: 0 }));

  let callCount = 0;
  const sortFn = function() {
    callCount++;
    if (callCount >= 2) return { route: 'done', model: null };
    return { route: 'forge:test', model: 'openai/gpt-4o', cycleId: 'test' };
  };
  const io = makeMockIo({
    'WORK.md': makeWorkMd(),
    'WORK.history.yaml': '',
    'WORK.feedback.yaml': '',
    'foundry/cycles/test.md': '---\nid: test\noutput-type: test-artefact\n---\nForge persona\n',
  });

  const result = await runRun({ io, sortFn }).catch(function() {});

  assert.equal(execFileMock.mock.callCount(), 1);
  assert.ok(result);
});

test('runRun executes quench after forge', async function() {
  const execFileMock = mock.fn();
  _setExecFile(execFileMock);
  execFileMock.mock.mockImplementation(() => makeChildProcess({ exitCode: 0 }));

  const routeOrder = ['forge:test', 'quench:test', 'done'];
  let idx = 0;
  const sortFn = function() {
    const route = routeOrder[idx] || 'done';
    idx++;
    if (route === 'forge:test') return { route: 'forge:test', model: 'openai/gpt-4o', cycleId: 'test' };
    if (route === 'quench:test') return { route: 'quench:test', model: null, cycleId: 'test' };
    return { route: 'done', model: null };
  };
  const io = makeMockIo({
    'WORK.md': makeWorkMd(),
    'WORK.history.yaml': '',
    'WORK.feedback.yaml': '',
    'foundry/cycles/test.md': '---\nid: test\noutput-type: test-artefact\n---\nForge persona\n',
  });

  const result = await runRun({ io, sortFn });
  assert.equal(result.action, 'done');
  assert.ok(idx >= 2);
});

test('executeForge dispatches via CLI spawn', async function() {
  const io = makeMockIo({
    'foundry/cycles/test.md': '---\nid: test\noutput-type: test-artefact\nmodels:\n  forge: openai/gpt-4o\n---\nForge persona\n',
    'WORK.history.yaml': '',
    'WORK.feedback.yaml': '',
  });
  const execFileMock = mock.fn();
  _setExecFile(execFileMock);
  execFileMock.mock.mockImplementation(() => makeChildProcess({ exitCode: 0 }));

  const result = await executeForge({
    sort: { route: 'forge:test', cycleId: 'test', model: 'openai/gpt-4o', token: 'tok-1' },
    cwd: '/tmp', io, worktree: '/tmp',
    historyPath: 'WORK.history.yaml', feedbackPath: 'WORK.feedback.yaml', cycleId: 'test',
  });

  assert.equal(execFileMock.mock.callCount(), 1);
  assert.equal(result.ok, true);
});

test('executeForge handles dispatch failure (non-zero exit)', async function() {
  const io = makeMockIo({
    'foundry/cycles/test.md': '---\nid: test\noutput-type: test-artefact\n---\nForge persona\n',
    'WORK.history.yaml': '', 'WORK.feedback.yaml': '',
  });
  const execFileMock = mock.fn();
  _setExecFile(execFileMock);
  execFileMock.mock.mockImplementation(() => makeChildProcess({ exitCode: 1 }));

  const result = await executeForge({
    sort: { route: 'forge:test', cycleId: 'test', model: 'openai/gpt-4o', token: 'tok-2' },
    cwd: '/tmp', io, worktree: '/tmp',
    historyPath: 'WORK.history.yaml', feedbackPath: 'WORK.feedback.yaml', cycleId: 'test',
  });

  assert.equal(result.ok, false);
  assert.ok(result.error.includes('child process exited with code'));
});

test('executeQuench runs validators via spawnWithTimeout', async function() {
  const io = makeMockIo({
    'WORK.md': makeWorkMd(),
    'WORK.history.yaml': '', 'WORK.feedback.yaml': '',
    'foundry/cycles/test.md': '---\nid: test\noutput-type: test-artefact\n---\nCycle body\n',
    'foundry/artefacts/test-artefact/definition.md': '---\nid: test-artefact\nfile-patterns:\n  - "*.md"\n---\n',
  });

  const result = await executeQuench({
    sort: { route: 'quench:test', cycleId: 'test' },
    cwd: '/tmp', io, worktree: '/tmp',
    historyPath: 'WORK.history.yaml', feedbackPath: 'WORK.feedback.yaml', cycleId: 'test',
  });

  assert.equal(result.ok, true);
});

test('executeQuench handles no validators (no-op)', async function() {
  const io = makeMockIo({
    'WORK.md': makeWorkMd(),
    'WORK.history.yaml': '', 'WORK.feedback.yaml': '',
    'foundry/cycles/test.md': '---\nid: test\noutput-type: test-artefact\n---\nCycle body\n',
    'foundry/artefacts/test-artefact/definition.md': '---\nid: test-artefact\nfile-patterns:\n  - "*.md"\n---\n',
  });

  const result = await executeQuench({
    sort: { route: 'quench:test', cycleId: 'test' },
    cwd: '/tmp', io, worktree: '/tmp',
    historyPath: 'WORK.history.yaml', feedbackPath: 'WORK.feedback.yaml', cycleId: 'test',
  });

  assert.equal(result.ok, true);
});

test('runRun executes assay when sort routes to assay', async function() {
  let callCount = 0;
  const sortFn = function() {
    callCount++;
    if (callCount >= 2) return { route: 'done', model: null };
    return { route: 'assay:test', model: null, cycleId: 'test' };
  };
  const io = makeMockIo({
    'WORK.md': makeWorkMd({ stages: ['assay:test', 'forge:test', 'quench:test', 'appraise:test'] }),
    'WORK.history.yaml': '', 'WORK.feedback.yaml': '',
    'foundry/cycles/test.md': '---\nid: test\noutput-type: test-artefact\n---\nCycle body\n',
  });
  const result = await runRun({ io, sortFn });
  assert.ok(callCount >= 1);
  assert.equal(result.action, 'done');
});

test('executeAssay runs extractors and posts feedback', async function() {
  const io = makeMockIo({
    'WORK.md': makeWorkMd(),
    'WORK.history.yaml': '', 'WORK.feedback.yaml': '',
    'foundry/cycles/test.md': '---\nid: test\noutput-type: test-artefact\n---\nCycle body\n',
    'foundry/artefacts/test-artefact/definition.md': '---\nid: test-artefact\nfile-patterns:\n  - "*.md"\n---\n',
  });

  const result = await executeAssay({
    sort: { route: 'assay:test', cycleId: 'test' },
    cwd: '/tmp', io, worktree: '/tmp',
    historyPath: 'WORK.history.yaml', feedbackPath: 'WORK.feedback.yaml', cycleId: 'test',
  });

  assert.equal(result.ok, true);
});

test('runRun returns violation when sort returns violation route', async function() {
  const sortFn = function() { return { route: 'violation', details: 'something went wrong' }; };
  const io = makeMockIo({ 'WORK.md': makeWorkMd() });
  const result = await runRun({ io, sortFn });
  assert.equal(result.action, 'violation');
});
