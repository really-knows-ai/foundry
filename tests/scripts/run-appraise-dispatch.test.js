// tests/scripts/run-appraise-dispatch.test.js
//
// Phase 3 — Appraise executor migration: unit tests for
// dispatchAppraisePrompt and batchAppraiseDispatch.
//
// Written before implementation (TDD). The static import below will
// fail with ERR_MODULE_NOT_FOUND until the exports exist in run-appraise.js.

import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// Static import — this is the TDD gate. Before Phase 3 implementation, the
// test file fails to load with a module-resolution error.
import {
  dispatchAppraisePrompt,
  batchAppraiseDispatch,
} from '../../src/scripts/run-appraise.js';

import { writePromptFile, withCleanup } from '../../src/scripts/lib/dispatch-cli.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockIO(files = {}) {
  const store = { ...files };
  const dirs = new Set();
  const writes = [];
  return {
    exists: (p) => Object.hasOwn(store, p) || dirs.has(p),
    writeFile: (p, c) => { store[p] = c; writes.push({ path: p, content: c }); },
    unlink: (p) => { delete store[p]; dirs.delete(p); },
    mkdir: (p) => { dirs.add(p); },
    readDir: (p) => {
      const prefix = p.endsWith('/') ? p : p + '/';
      return Object.keys(store)
        .filter(k => k.startsWith(prefix))
        .map(k => k.slice(prefix.length));
    },
    readFile: (p) => {
      if (!Object.hasOwn(store, p)) throw new Error('ENOENT: ' + p);
      return store[p];
    },
    _get: (p) => store[p],
    _dirs: dirs,
    _writes: writes,
  };
}

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

// ---------------------------------------------------------------------------
// Shared test data
// ---------------------------------------------------------------------------

const lawGroups = new Map();
lawGroups.set('default', [
  { id: 'law-a', text: 'All code must be secure.' },
  { id: 'law-b', text: 'No secrets in source.' },
]);

const bundleEntry = {
  group: 'default',
  unit: {
    unitId: 'default::bundle::0',
    mode: 'bundle',
    group: 'default',
    lawIds: ['law-a', 'law-b'],
  },
  appraiser: {
    id: 'alice',
    personality: 'You are strict but fair.',
  },
  pass: 1,
};

function makeDefaultOpts(innerIo, overrides) {
  return Object.assign({
    io: innerIo,
    worktree: '/w',
    lawGroups,
    outputType: 'code',
    timeoutMs: 300_000,
    writePromptFile: mock.fn(() => '.foundry/dispatch-prompts/test-' + Date.now() + '.txt'),
    spawnDispatch: mock.fn(() => makeChildProcess({ exitCode: 0 })),
    awaitProcess: mock.fn(async () => {}),
    withCleanup: mock.fn(async (_io, fn) => { const p = []; return await fn(p); }),
  }, overrides);
}

// ---------------------------------------------------------------------------
// T1 — XML wrapping
// ---------------------------------------------------------------------------

test('T1 - dispatchAppraisePrompt wraps persona in <appraiser_instructions> XML tags', async () => {
  const io = makeMockIO();
  const writeMock = mock.fn((_io, content) => {
    return '.foundry/dispatch-prompts/test-' + Date.now() + '.txt';
  });

  await dispatchAppraisePrompt(bundleEntry, makeDefaultOpts(io, {
    writePromptFile: writeMock,
  }));

  assert.equal(writeMock.mock.callCount(), 1);
  const writtenContent = writeMock.mock.calls[0].arguments[1];

  assert.ok(writtenContent.includes('<appraiser_instructions>'),
    'should contain opening appraiser_instructions tag');
  assert.ok(writtenContent.includes('</appraiser_instructions>'),
    'should contain closing appraiser_instructions tag');
  assert.ok(writtenContent.includes('<persona>'),
    'should contain opening persona tag');
  assert.ok(writtenContent.includes('</persona>'),
    'should contain closing persona tag');
  assert.ok(writtenContent.includes('Your task is to evaluate the artefact according to your persona below.'),
    'should contain the evaluation instruction');
  assert.ok(writtenContent.includes('Call foundry_stage_output for each finding, then foundry_stage_end.'),
    'should contain the output instruction');

  // The persona from buildAppraiserPrompt should be inside <persona> tags
  const personaStart = writtenContent.indexOf('<persona>');
  const personaEnd = writtenContent.indexOf('</persona>');
  const personaContent = writtenContent.slice(personaStart + '<persona>'.length, personaEnd);
  assert.ok(personaContent.includes('You are strict but fair.'),
    'persona content should include the appraiser personality');
});

// ---------------------------------------------------------------------------
// T2 — Unique naming via writePromptFile
// ---------------------------------------------------------------------------

test('T2 - dispatchAppraisePrompt delegates unique naming to writePromptFile', async () => {
  const io = makeMockIO();
  const writeMock = mock.fn((_io, content) => {
    return '.foundry/dispatch-prompts/test-' + Date.now() + '-' + Math.random() + '.txt';
  });

  const pathA = writeMock(io, 'content-a');
  const pathB = writeMock(io, 'content-b');
  assert.notEqual(pathA, pathB, 'writePromptFile should produce unique paths');

  await dispatchAppraisePrompt(bundleEntry, makeDefaultOpts(io, {
    writePromptFile: writeMock,
  }));

  // writeMock was called once via dispatch, plus twice above
  assert.equal(writeMock.mock.callCount(), 3);
  // The third call was from dispatchAppraisePrompt
  const thirdCallPath = writeMock.mock.calls[2].result;
  assert.notEqual(thirdCallPath, pathA);
  assert.notEqual(thirdCallPath, pathB);
});

// ---------------------------------------------------------------------------
// T3 — writePromptFile called with (io, wrappedContent)
// ---------------------------------------------------------------------------

test('T3 - dispatchAppraisePrompt calls writePromptFile with (io, wrappedContent)', async () => {
  const io = makeMockIO();
  const writeMock = mock.fn((_io, content) => '.foundry/dispatch-prompts/test.txt');

  await dispatchAppraisePrompt(bundleEntry, makeDefaultOpts(io, {
    writePromptFile: writeMock,
  }));

  assert.equal(writeMock.mock.callCount(), 1);
  const firstCall = writeMock.mock.calls[0];
  // First argument: io
  assert.equal(firstCall.arguments[0], io, 'first arg should be the io object');
  // Second argument: string content (the wrapped prompt)
  assert.equal(typeof firstCall.arguments[1], 'string', 'second arg should be a string');
  assert.ok(firstCall.arguments[1].length > 0, 'content should not be empty');
});

// ---------------------------------------------------------------------------
// T4 — spawnDispatch called with (worktree, promptPath)
// ---------------------------------------------------------------------------

test('T4 - dispatchAppraisePrompt calls spawnDispatch(worktree, promptPath)', async () => {
  const io = makeMockIO();
  const expectedPath = '.foundry/dispatch-prompts/unique-path.txt';
  const spawnMock = mock.fn(() => makeChildProcess({ exitCode: 0 }));

  await dispatchAppraisePrompt(bundleEntry, makeDefaultOpts(io, {
    writePromptFile: mock.fn(() => expectedPath),
    spawnDispatch: spawnMock,
  }));

  assert.equal(spawnMock.mock.callCount(), 1);
  const [worktreeArg, pathArg] = spawnMock.mock.calls[0].arguments;
  assert.equal(worktreeArg, '/w', 'should pass worktree as first arg');
  assert.equal(pathArg, expectedPath, 'should pass promptPath as second arg');
});

// ---------------------------------------------------------------------------
// T5 — awaitProcess called with (child, timeoutMs) default 5 min
// ---------------------------------------------------------------------------

test('T5 - dispatchAppraisePrompt awaits via awaitProcess with default 5 min timeout', async () => {
  const io = makeMockIO();
  const fakeChild = makeChildProcess({ exitCode: 0 });
  const spawnMock = mock.fn(() => fakeChild);
  const awaitMock = mock.fn(async () => {});

  await dispatchAppraisePrompt(bundleEntry, makeDefaultOpts(io, {
    timeoutMs: 300_000,
    writePromptFile: mock.fn(() => '.foundry/dispatch-prompts/test.txt'),
    spawnDispatch: spawnMock,
    awaitProcess: awaitMock,
  }));

  assert.equal(awaitMock.mock.callCount(), 1);
  const [childArg, timeoutArg] = awaitMock.mock.calls[0].arguments;
  assert.equal(childArg, fakeChild, 'should pass the child process');
  // 5 minutes in milliseconds = 300000
  assert.equal(timeoutArg, 300_000, 'should default to 5 minute timeout');
});

// ---------------------------------------------------------------------------
// T6 — Cleanup via withCleanup
// ---------------------------------------------------------------------------

test('T6 - dispatchAppraisePrompt cleans up prompt file after spawn via withCleanup', async () => {
  // Use real writePromptFile (writes to IO) and real withCleanup (deletes from IO)
  const io = makeMockIO();
  const spawnMock = mock.fn(() => makeChildProcess({ exitCode: 0 }));
  const awaitMock = mock.fn(async () => {});

  await dispatchAppraisePrompt(bundleEntry, {
    io,
    worktree: '/w',
    lawGroups,
    outputType: 'code',
    timeoutMs: 300_000,
    writePromptFile: writePromptFile,
    spawnDispatch: spawnMock,
    awaitProcess: awaitMock,
    withCleanup: withCleanup,
  });

  // The prompt file should have been created and then cleaned up via withCleanup.
  // After cleanup, no files remain in .foundry/dispatch-prompts/
  const remaining = io.readDir('.foundry/dispatch-prompts/');
  assert.equal(remaining.length, 0, 'no prompt files should remain after cleanup');
  // Verify spawnDispatch was still called
  assert.equal(spawnMock.mock.callCount(), 1);
});

// ---------------------------------------------------------------------------
// T7 — No token file written
// ---------------------------------------------------------------------------

test('T7 - dispatchAppraisePrompt does not write any token file', async () => {
  const io = makeMockIO();
  const writeMock = mock.fn((_io, content) => '.foundry/dispatch-prompts/test.txt');

  await dispatchAppraisePrompt(bundleEntry, makeDefaultOpts(io, {
    writePromptFile: writeMock,
  }));

  // None of the writes should be to .foundry/tokens/
  const writes = io._writes;
  for (const w of writes) {
    assert.ok(!w.path.includes('.foundry/tokens'),
      'should not write to .foundry/tokens/: ' + w.path);
  }
  assert.ok(writes.length === 0 || writes.every(function(w) {
    return w.path.startsWith('.foundry/dispatch-prompts/');
  }), 'all writes should be to dispatch-prompts');
});

// ---------------------------------------------------------------------------
// T8 — At most 4 concurrent dispatches
// ---------------------------------------------------------------------------

test('T8 - batchAppraiseDispatch dispatches at most 4 entries concurrently', async () => {
  const entries = Array.from({ length: 6 }, function(_, i) {
    return {
      group: 'default',
      unit: {
        unitId: 'u' + i,
        mode: 'bundle',
        group: 'default',
        lawIds: ['law-a'],
      },
      appraiser: { id: 'a' + i, personality: 'Test.' },
      pass: 1,
    };
  });

  let inFlight = 0;
  let maxInFlight = 0;
  const io = makeMockIO();
  const groups = new Map();
  groups.set('default', [{ id: 'law-a', text: 'Test law' }]);

  const resolveQueue = [];

  const opts = {
    io,
    worktree: '/w',
    lawGroups: groups,
    outputType: 'code',
    timeoutMs: 300_000,
    writePromptFile: mock.fn(() => '.foundry/dispatch-prompts/p.txt'),
    spawnDispatch: mock.fn(() => ({ on: mock.fn(), kill: mock.fn() })),
    awaitProcess: mock.fn(async function() {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise(function(r) { resolveQueue.push(r); });
      inFlight--;
    }),
    withCleanup: mock.fn(async function(innerIo, fn) {
      const p = [];
      return await fn(p);
    }),
  };

  const promise = batchAppraiseDispatch(entries, opts);

  // Wait for first batch to start (4 entries should be in-flight)
  await new Promise(function(r) { setTimeout(r, 50); });

  assert.ok(maxInFlight <= 4, 'maxInFlight should be <= 4, got ' + maxInFlight);

  // Drain all pending promises from both batches
  while (resolveQueue.length > 0) {
    const batch = resolveQueue.splice(0);
    for (const resolve of batch) { resolve(); }
    // Yield to let the next batch start
    await new Promise(function(r) { setTimeout(r, 10); });
  }

  const results = await promise;
  assert.equal(results.length, 6);
  for (const r of results) {
    assert.ok(r.status === 'fulfilled' || r.status === 'rejected');
  }
});

// ---------------------------------------------------------------------------
// T9 — Sequential fallback on batch failure
// ---------------------------------------------------------------------------

test('T9 - batchAppraiseDispatch falls back to sequential dispatch on batch failure', async () => {
  const entries = Array.from({ length: 6 }, function(_, i) {
    return {
      group: 'default',
      unit: {
        unitId: 'u' + i,
        mode: 'bundle',
        group: 'default',
        lawIds: ['law-a'],
      },
      appraiser: { id: 'a' + i, personality: 'Test.' },
      pass: 1,
    };
  });

  let awaitCallCount = 0;
  const io = makeMockIO();
  const groups = new Map();
  groups.set('default', [{ id: 'law-a', text: 'Test law' }]);

  const opts = {
    io,
    worktree: '/w',
    lawGroups: groups,
    outputType: 'code',
    timeoutMs: 300_000,
    writePromptFile: mock.fn(() => '.foundry/dispatch-prompts/p.txt'),
    spawnDispatch: mock.fn(() => ({ on: mock.fn(), kill: mock.fn() })),
    // First 4 calls (batch 1) throw; remaining 2 calls (sequential) succeed
    awaitProcess: mock.fn(async function() {
      awaitCallCount++;
      if (awaitCallCount <= 4) {
        throw new Error('batch failure');
      }
    }),
    withCleanup: mock.fn(async function(innerIo, fn) {
      const p = [];
      return await fn(p);
    }),
  };

  const results = await batchAppraiseDispatch(entries, opts);
  assert.equal(results.length, 6);

  // First 4 entries should be rejected, remaining 2 should be fulfilled
  for (let i = 0; i < 4; i++) {
    assert.equal(results[i].status, 'rejected', 'entry ' + i + ' should be rejected');
  }
  for (let i = 4; i < 6; i++) {
    assert.equal(results[i].status, 'fulfilled', 'entry ' + i + ' should be fulfilled');
  }
});

// ---------------------------------------------------------------------------
// T10 — Returns PromiseSettledResult[] per matrix row
// ---------------------------------------------------------------------------

test('T10 - batchAppraiseDispatch returns PromiseSettledResult[] with one entry per matrix row', async () => {
  const entries = Array.from({ length: 3 }, function(_, i) {
    return {
      group: 'default',
      unit: {
        unitId: 'u' + i,
        mode: 'bundle',
        group: 'default',
        lawIds: ['law-a'],
      },
      appraiser: { id: 'a' + i, personality: 'Test.' },
      pass: 1,
    };
  });

  const io = makeMockIO();
  const groups = new Map();
  groups.set('default', [{ id: 'law-a', text: 'Test law' }]);

  const opts = {
    io,
    worktree: '/w',
    lawGroups: groups,
    outputType: 'code',
    timeoutMs: 300_000,
    writePromptFile: mock.fn(() => '.foundry/dispatch-prompts/p.txt'),
    spawnDispatch: mock.fn(() => ({ on: mock.fn(), kill: mock.fn() })),
    awaitProcess: mock.fn(async () => {}),
    withCleanup: mock.fn(async (innerIo, fn) => { const p = []; return await fn(p); }),
  };

  const results = await batchAppraiseDispatch(entries, opts);

  assert.equal(results.length, entries.length,
    'result length should equal dispatchMatrix length');
  for (const r of results) {
    assert.ok(r.status === 'fulfilled' || r.status === 'rejected',
      'each result should have status fulfilled or rejected');
  }
});

// ---------------------------------------------------------------------------
// T11 + T12 — executeAppraise no longer uses client.session
// ---------------------------------------------------------------------------

test('T11 + T12 - executeAppraise no longer calls client.session.create/prompt', async () => {
  const { executeAppraise } = await import('../../src/scripts/run-appraise.js');

  // Build a minimal foundry fixture in a temp directory
  const { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, readdirSync, existsSync, unlinkSync, renameSync } = await import('node:fs');
  const { execFileSync } = await import('node:child_process');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');

  const GIT_ENV = {
    ...process.env,
    GIT_AUTHOR_NAME: 'foundry', GIT_AUTHOR_EMAIL: 'foundry@test',
    GIT_COMMITTER_NAME: 'foundry', GIT_COMMITTER_EMAIL: 'foundry@test',
  };

  const root = mkdtempSync(path.join(tmpdir(), 'appr-dispatch-'));

  try {
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root, env: GIT_ENV });

    mkdirSync(path.join(root, 'foundry/laws'), { recursive: true });
    mkdirSync(path.join(root, 'foundry/appraisers'), { recursive: true });
    mkdirSync(path.join(root, 'foundry/flows'), { recursive: true });
    mkdirSync(path.join(root, 'foundry/cycles'), { recursive: true });
    mkdirSync(path.join(root, 'foundry/artefacts/code'), { recursive: true });
    mkdirSync(path.join(root, '.foundry/stage-outputs'), { recursive: true });
    mkdirSync(path.join(root, 'foundry/.stage'), { recursive: true });

    writeFileSync(path.join(root, 'foundry/cycles/test-cycle.md'),
      '---\noutput-type: code\nflow-id: test-flow\n---\n\nCycle body.\n');
    writeFileSync(path.join(root, 'foundry/flows/test-flow.md'),
      '---\n---\n\nFlow body.\n');
    writeFileSync(path.join(root, 'foundry/appraisers/alice.md'),
      '---\nid: alice\n---\nStrict appraiser.');
    writeFileSync(path.join(root, 'foundry/laws/law-a.md'),
      '## law-a\n\nLaw A text.\n');
    writeFileSync(path.join(root, 'foundry/laws/law-b.md'),
      '## law-b\n\nLaw B text.\n');
    writeFileSync(path.join(root, 'foundry/artefacts/code/definition.md'),
      '---\nname: Code\nfile-patterns:\n  - "**/*.js"\n---\nCode artefact.\n');
    writeFileSync(path.join(root, 'app.js'), 'const x = 1;\n');

    execFileSync('git', ['add', '-A'], { cwd: root, env: GIT_ENV });
    execFileSync('git', ['commit', '-q', '-m', 'initialise'], { cwd: root, env: GIT_ENV });

    const abs = (p) => path.isAbsolute(p) ? p : path.resolve(root, p);
    const realIo = {
      readFile: (p) => readFileSync(abs(p), 'utf8'),
      readDir: (p) => {
        const entries = readdirSync(abs(p));
        return entries.filter(f => f !== '.gitkeep');
      },
      exists: (p) => existsSync(abs(p)),
      writeFile: (p, c) => writeFileSync(abs(p), c, 'utf8'),
      rename: (from, to) => { try { rmSync(abs(to), { force: true }); renameSync(abs(from), abs(to)); } catch {} },
      unlink: (p) => { try { unlinkSync(abs(p)); } catch {} },
      mkdir: (p) => mkdirSync(abs(p), { recursive: true }),
      exec: (args) => execFileSync(args[0], args.slice(1), { cwd: root, encoding: 'utf8' }).toString().trim(),
    };

    const client = {
      session: {
        create: mock.fn(function() {
          throw new Error('session.create should not be called');
        }),
        prompt: mock.fn(function() {
          throw new Error('session.prompt should not be called');
        }),
      },
    };
    const childSessions = new Map();
    const context = { sessionID: 'parent-test' };

    const result = await executeAppraise({
      client,
      childSessions,
      context,
      io: realIo,
      worktree: root,
      historyPath: path.join(root, 'history.jsonl'),
      feedbackPath: path.join(root, 'feedback'),
      sort: { route: 'appraise:test-cycle' },
      writePromptFile: mock.fn(() => '.foundry/dispatch-prompts/test.txt'),
      spawnDispatch: mock.fn(() => ({ on: mock.fn(), kill: mock.fn() })),
      awaitProcess: mock.fn(async () => {}),
      withCleanup,
    });

    // If we got here without session.create/prompt being called, T11+T12 pass
    assert.equal(client.session.create.mock.callCount(), 0,
      'session.create should not be called');
    assert.equal(client.session.prompt.mock.callCount(), 0,
      'session.prompt should not be called');
    assert.ok(result.ok !== undefined, 'executeAppraise should return a result');
  } finally {
    try { rmSync(root, { recursive: true, force: true }); } catch {}
  }
});
