// tests/scripts/forge-dispatch.test.js
// Unit tests for forgeDispatch — the forge executor dispatch function
// that replaces makeForgeSession + dispatchForgePrompt with CLI spawn.
// Written before implementation (TDD).

import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { _setExecFile } from '../../src/scripts/lib/dispatch-cli.js';

let forgeDispatch;

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
      if (!Object.hasOwn(store, p)) throw new Error(`ENOENT: ${p}`);
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

test.before(async () => {
  const mod = await import('../../src/scripts/run-executors.js');
  forgeDispatch = mod.forgeDispatch;
});

// ---------------------------------------------------------------------------
// D1.1 — Token file written to .foundry/tokens/<cycleId>.token
// ---------------------------------------------------------------------------

test('D1.1 - forgeDispatch writes token file before child starts', async () => {
  const io = makeMockIO();
  const execFileMock = mock.fn();
  _setExecFile(execFileMock);
  execFileMock.mock.mockImplementation(() => makeChildProcess({ exitCode: 0 }));

  const dispatch = await forgeDispatch({
    sort: { token: 'tok-123', route: 'forge:test-cycle', cycleId: 'test-cycle' },
    io,
    worktree: '/w',
    cycleId: 'test-cycle',
    dispatchPrompt: {
      stage: 'forge:test-cycle', cycle: 'test-cycle', token: 'tok-123',
      cwd: '/w', filePatterns: [], outputType: null, forgeItem: null,
    },
  });

  // Token was written (tracked by _writes) then cleaned up after spawn
  const tokenWrite = io._writes.find(w => w.path === '.foundry/tokens/test-cycle.token');
  assert.ok(tokenWrite, 'token file must have been written');
  assert.equal(tokenWrite.content, 'tok-123');
  // Token dir was created
  assert.ok(io._dirs.has('.foundry/tokens'));
  // Token file is cleaned up
  assert.equal(io.exists('.foundry/tokens/test-cycle.token'), false);
  // Dispatch proceeded (execFile called)
  assert.equal(execFileMock.mock.callCount(), 1);
  assert.ok(Array.isArray(dispatch.stageOutputLines));
});

// ---------------------------------------------------------------------------
// D1.2 — Dispatch prompt written with {tokenFile}
// ---------------------------------------------------------------------------

test('D1.2 - forgeDispatch writes prompt with {tokenFile} set', async () => {
  const io = makeMockIO();
  const execFileMock = mock.fn();
  _setExecFile(execFileMock);
  execFileMock.mock.mockImplementation(() => makeChildProcess({ exitCode: 0 }));

  await forgeDispatch({
    sort: { token: 't', route: 'forge:test-cycle', cycleId: 'test-cycle' },
    io,
    worktree: '/w',
    cycleId: 'test-cycle',
    dispatchPrompt: {
      stage: 'forge:test-cycle', cycle: 'test-cycle', token: 't',
      cwd: '/w', filePatterns: [], outputType: null, forgeItem: null,
    },
  });

  // Prompt was written (tracked by _writes) then cleaned up
  const promptWrite = io._writes.find(w => w.path.startsWith('.foundry/dispatch-prompts/'));
  assert.ok(promptWrite, 'prompt file must have been written');
  assert.ok(promptWrite.content.includes('{tokenFile}: test-cycle.token'));
  assert.ok(promptWrite.content.includes('tokenFile: "test-cycle.token"'));
  // Prompt dir was created
  assert.ok(io._dirs.has('.foundry/dispatch-prompts'));
  // Prompt files are cleaned up
  assert.equal(io.readDir('.foundry/dispatch-prompts/').length, 0);
});

// ---------------------------------------------------------------------------
// D1.3 — execFile called with correct arguments
// ---------------------------------------------------------------------------

test('D1.3 - forgeDispatch calls execFile with correct args', async () => {
  const io = makeMockIO();
  const execFileMock = mock.fn();
  _setExecFile(execFileMock);
  execFileMock.mock.mockImplementation(() => makeChildProcess({ exitCode: 0 }));

  await forgeDispatch({
    sort: { token: 't', route: 'forge:test', cycleId: 'test' },
    io,
    worktree: '/w',
    cycleId: 'test',
    dispatchPrompt: {
      stage: 'forge:test', cycle: 'test', token: 't',
      cwd: '/w', filePatterns: [], outputType: null, forgeItem: null,
    },
  });

  assert.equal(execFileMock.mock.callCount(), 1);
  const [cmd, args, opts] = execFileMock.mock.calls[0].arguments;
  assert.equal(cmd, 'opencode');
  assert.equal(args[0], 'run');
  assert.equal(args[1], '--attach');
  assert.equal(args[2], '--agent');
  assert.equal(args[3], 'foundry');
  assert.equal(args[4], '--dir');
  assert.equal(args[5], '/w');
  assert.equal(args[6], '--file');
  assert.ok(args[7].startsWith('.foundry/dispatch-prompts/'));
  assert.equal(opts.cwd, '/w');
  assert.equal(opts.stdio, 'pipe');
});

// ---------------------------------------------------------------------------
// D1.4 — Stage output collected from .jsonl files
// ---------------------------------------------------------------------------

test('D1.4 - forgeDispatch collects stage output from .jsonl files', async () => {
  const io = makeMockIO();
  const execFileMock = mock.fn();
  _setExecFile(execFileMock);
  // Write stage output files inside the execFile mock — this simulates
  // the child process writing output after cleanStageOutputDir runs but
  // before collectStageOutputLines scans the directory.
  execFileMock.mock.mockImplementation(() => {
    io.writeFile('.foundry/stage-outputs/out1.jsonl', '{"status":"done"}\n{"status":"ok"}');
    io.writeFile('.foundry/stage-outputs/out2.jsonl', '{"status":"complete"}');
    return makeChildProcess({ exitCode: 0 });
  });

  const dispatch = await forgeDispatch({
    sort: { token: 't', route: 'forge:test', cycleId: 'test' },
    io,
    worktree: '/w',
    cycleId: 'test',
    dispatchPrompt: {
      stage: 'forge:test', cycle: 'test', token: 't',
      cwd: '/w', filePatterns: [], outputType: null, forgeItem: null,
    },
  });

  assert.equal(dispatch.stageOutputLines.length, 3);
  assert.deepEqual(dispatch.stageOutputLines[0], { status: 'done' });
  assert.deepEqual(dispatch.stageOutputLines[1], { status: 'ok' });
  assert.deepEqual(dispatch.stageOutputLines[2], { status: 'complete' });
});

// ---------------------------------------------------------------------------
// D1.5 — Temp files cleaned up after success, non-zero exit, spawn error
// ---------------------------------------------------------------------------

test('D1.5a - forgeDispatch cleans up temp files on successful exit', async () => {
  const io = makeMockIO();
  const execFileMock = mock.fn();
  _setExecFile(execFileMock);
  execFileMock.mock.mockImplementation(() => makeChildProcess({ exitCode: 0 }));

  await forgeDispatch({
    sort: { token: 'tok', route: 'forge:test', cycleId: 'test' },
    io,
    worktree: '/w',
    cycleId: 'test',
    dispatchPrompt: {
      stage: 'forge:test', cycle: 'test', token: 'tok',
      cwd: '/w', filePatterns: [], outputType: null, forgeItem: null,
    },
  });

  assert.equal(io.exists('.foundry/tokens/test.token'), false);
  assert.equal(io.readDir('.foundry/dispatch-prompts/').length, 0);
});

test('D1.5b - forgeDispatch cleans up temp files on non-zero exit', async () => {
  const io = makeMockIO();
  const execFileMock = mock.fn();
  _setExecFile(execFileMock);
  execFileMock.mock.mockImplementation(() => makeChildProcess({ exitCode: 1 }));

  const dispatch = await forgeDispatch({
    sort: { token: 'tok', route: 'forge:test', cycleId: 'test' },
    io,
    worktree: '/w',
    cycleId: 'test',
    dispatchPrompt: {
      stage: 'forge:test', cycle: 'test', token: 'tok',
      cwd: '/w', filePatterns: [], outputType: null, forgeItem: null,
    },
  });

  assert.equal(dispatch.error, 'child process exited with code 1');
  assert.equal(io.exists('.foundry/tokens/test.token'), false);
  assert.equal(io.readDir('.foundry/dispatch-prompts/').length, 0);
});

test('D1.5c - forgeDispatch cleans up temp files on spawn error', async () => {
  const io = makeMockIO();
  const execFileMock = mock.fn();
  _setExecFile(execFileMock);
  execFileMock.mock.mockImplementation(() => {
    const handlers = {};
    const child = {
      on: (event, handler) => { handlers[event] = handler; },
      kill: mock.fn(),
    };
    process.nextTick(() => {
      if (handlers.error) handlers.error(new Error('spawn failed'));
    });
    return child;
  });

  const dispatch = await forgeDispatch({
    sort: { token: 'tok', route: 'forge:test', cycleId: 'test' },
    io,
    worktree: '/w',
    cycleId: 'test',
    dispatchPrompt: {
      stage: 'forge:test', cycle: 'test', token: 'tok',
      cwd: '/w', filePatterns: [], outputType: null, forgeItem: null,
    },
  });

  assert.equal(dispatch.error, 'spawn failed');
  assert.equal(io.exists('.foundry/tokens/test.token'), false);
  assert.equal(io.readDir('.foundry/dispatch-prompts/').length, 0);
});

// ---------------------------------------------------------------------------
// D1.6 — Timeout kills with SIGKILL and cleanup still runs
// ---------------------------------------------------------------------------

test('D1.6 - forgeDispatch kills child with SIGKILL on timeout and cleans up', async () => {
  const io = makeMockIO();
  const child = {
    on: mock.fn(),
    kill: mock.fn(),
  };
  const execFileMock = mock.fn(() => child);
  _setExecFile(execFileMock);

  const dispatch = await forgeDispatch({
    sort: { token: 'tok', route: 'forge:test', cycleId: 'test' },
    io,
    worktree: '/w',
    cycleId: 'test',
    dispatchPrompt: {
      stage: 'forge:test', cycle: 'test', token: 'tok',
      cwd: '/w', filePatterns: [], outputType: null, forgeItem: null,
    },
    timeoutMs: 5,
  });

  assert.equal(dispatch.error, 'child process timed out');
  assert.equal(child.kill.mock.callCount(), 1);
  assert.equal(child.kill.mock.calls[0].arguments[0], 'SIGKILL');
  assert.equal(io.exists('.foundry/tokens/test.token'), false);
  assert.equal(io.readDir('.foundry/dispatch-prompts/').length, 0);
});
