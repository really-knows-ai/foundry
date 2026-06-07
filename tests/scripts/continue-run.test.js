/**
 * Tests for continueRun in the run state machine.
 *
 * Uses injectable IO (mock filesystem) to test resume behavior without
 * real filesystem or SDK dependencies.
 */

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

let continueRun;

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

function makeWorkMd(overrides) {
  const o = overrides || {};
  const stages = (o.stages || ['forge:test', 'quench:test', 'appraise:test']).join('\n  - ');
  const extras = [];
  if (o.status) extras.push('status: ' + o.status);
  if (o['always-human-appraise']) extras.push('always-human-appraise: true');
  if (o['deadlock-human-appraise']) extras.push('deadlock-human-appraise: true');
  return [
    '---',
    'cycle: ' + (o.cycle || 'test'),
    'flow: ' + (o.flow || 'test-flow'),
    'stages:', '  - ' + stages,
    'max-iterations: 3',
    ...extras,
    '---', '# Goal', '', 'Test goal', '',
  ].join('\n');
}

function makeMockClient() {
  return {
    session: {
      create: async function() { throw new Error('SDK session.create should not be called — CLI spawn replaces it'); },
      prompt: async function() { throw new Error('SDK session.prompt should not be called — CLI spawn replaces it'); },
      messages: async function() {
        return [
          { info: { id: 'msg_1', role: 'user' }, parts: [{ type: 'text', text: 'hello' }] },
          { info: { id: 'msg_5', role: 'user' }, parts: [{ type: 'text', text: 'the artefact has a bug' }] },
        ];
      },
    },
  };
}

beforeEach(async function() {
  const mod = await import('../../src/scripts/run.js');
  continueRun = mod.continueRun;
});

// ── Test cases ──

test('1. Returns violation when WORK.md does not exist', async function() {
  const io = makeMockIo({});
  const result = await continueRun({ io, sortFn: function() { return { route: 'done', model: null }; } });
  assert.equal(result.action, 'violation');
  assert.ok(result.details.includes('WORK.md not found'));
});

test('2. Returns violation when WORK.md has status failed', async function() {
  const io = makeMockIo({ 'WORK.md': makeWorkMd({ status: 'failed' }) });
  const result = await continueRun({ io, sortFn: function() { return { route: 'done', model: null }; } });
  assert.equal(result.action, 'violation');
});

test('3. Returns done when sort returns done', async function() {
  const io = makeMockIo({ 'WORK.md': makeWorkMd() });
  const result = await continueRun({ io, sortFn: function() { return { route: 'done', model: null }; } });
  assert.equal(result.action, 'done');
  assert.equal(result.flow, 'test-flow');
});

test('4. Returns violation when sort returns blocked', async function() {
  const io = makeMockIo({ 'WORK.md': makeWorkMd() });
  const result = await continueRun({
    io,
    sortFn: function() { return { route: 'blocked', details: 'max iterations reached' }; },
  });
  assert.equal(result.action, 'violation');
});

test('5. Executes appraise when sort routes to appraise (no appraisers = passes)', async function() {
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
  const client = makeMockClient();
  const context = { sessionID: 'main-session', worktree: '/tmp' };

  const result = await continueRun({ io, client, context, sortFn });
  assert.equal(result.action, 'done');
  assert.ok(callCount >= 1);
});

test('6. Returns prompt_user for human-appraise sort', async function() {
  const sortFn = function() { return { route: 'human-appraise:test', model: null, cycleId: 'test' }; };
  const io = makeMockIo({
    'WORK.md': makeWorkMd({ stages: ['forge:test', 'human-appraise:test'] }),
    'WORK.feedback.yaml': '',
    'WORK.history.yaml': '',
    'foundry/cycles/test.md': '---\nid: test\noutput-type: test-artefact\n---\nCycle body\n',
  });
  const client = makeMockClient();
  const context = { sessionID: 'main-session', worktree: '/tmp' };

  const result = await continueRun({ io, client, context, sortFn });
  assert.equal(result.action, 'prompt_user');
  assert.ok(result.stage.startsWith('human-appraise'));
});

test('7. Returns done when cycle is complete with no targets', async function() {
  const io = makeMockIo({
    'WORK.md': makeWorkMd({ cycle: 'final-cycle' }),
    'WORK.history.yaml': '',
    'WORK.feedback.yaml': '',
    'foundry/cycles/final-cycle.md': '---\nid: final-cycle\noutput-type: test-artefact\n---\nCycle body\n',
    'foundry/artefacts/test-artefact/definition.md': '---\nid: test-artefact\nfile-patterns:\n  - "*.md"\n---\n',
  });
  const result = await continueRun({ io, sortFn: function() { return { route: 'done', model: null }; } });
  assert.equal(result.action, 'done');
});

test('8. Returns violation on unknown route', async function() {
  const io = makeMockIo({ 'WORK.md': makeWorkMd() });
  const result = await continueRun({
    io,
    sortFn: function() { return { route: 'unknown:test', model: null, cycleId: 'test' }; },
  });
  assert.equal(result.action, 'violation');
});
