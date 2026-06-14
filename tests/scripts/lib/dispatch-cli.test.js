import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

import { spawnDispatch, awaitProcess, writePromptFile, cleanupFiles, withCleanup, _setExecFile } from '../../../src/scripts/lib/dispatch-cli.js';

function makeMockIO(files = {}) {
  const store = { ...files };
  const dirs = new Set();
  return {
    exists: (p) => Object.hasOwn(store, p) || dirs.has(p),
    writeFile: (p, c) => { store[p] = c; },
    unlink: (p) => { delete store[p]; dirs.delete(p); },
    mkdir: (p) => { dirs.add(p); },
    readDir: (p) => {
      const prefix = p.endsWith('/') ? p : p + '/';
      return Object.keys(store)
        .filter(k => k.startsWith(prefix))
        .map(k => k.slice(prefix.length));
    },
    _get: (p) => store[p],
    _dirs: dirs,
  };
}

test('T1 - writePromptFile writes the prompt to a .txt file under .foundry/dispatch-prompts/ and returns the file path', () => {
  const io = makeMockIO();
  const result = writePromptFile(io, 'hello world');
  assert.ok(result.startsWith('.foundry/dispatch-prompts/'));
  assert.ok(result.endsWith('.txt'));
  assert.equal(io._get(result), 'hello world');
});

test('T2 - writePromptFile creates the directory if it does not exist', () => {
  const io = makeMockIO();
  writePromptFile(io, 'test');
  assert.ok(io._dirs.has('.foundry/dispatch-prompts'));
});

test('T3 - writePromptFile generates unique filenames across calls', () => {
  const io = makeMockIO();
  const a = writePromptFile(io, 'a');
  const b = writePromptFile(io, 'b');
  assert.notEqual(a, b);
});

test('T4 - spawnDispatch calls execFile with correct args including agent name', () => {
  const execFileMock = mock.fn();
  _setExecFile(execFileMock);
  const fakeChild = { on: () => {} };
  execFileMock.mock.mockImplementation(() => fakeChild);

  const worktree = '/path/to/worktree';
  const promptPath = '.foundry/dispatch-prompts/abc.txt';
  const result = spawnDispatch(worktree, promptPath, 'test-agent');

  assert.equal(execFileMock.mock.callCount(), 1);
  const [cmd, args, opts] = execFileMock.mock.calls[0].arguments;
  assert.equal(cmd, 'opencode');
  assert.deepEqual(args, [
    'run', 'Follow the attached prompt file.',
    '--attach', '--agent', 'test-agent', '--dir', worktree, '--file', promptPath,
  ]);
  assert.equal(opts.cwd, worktree);
  assert.equal(result, fakeChild);
});

test('T4b - spawnDispatch passes model when provided', () => {
  const execFileMock = mock.fn();
  _setExecFile(execFileMock);
  const fakeChild = { on: () => {} };
  execFileMock.mock.mockImplementation(() => fakeChild);

  spawnDispatch('/w', '/p', 'test-agent', { providerID: 'opencode-go', modelID: 'deepseek-v4-flash' });

  const [, args] = execFileMock.mock.calls[0].arguments;
  assert.deepEqual(args, [
    'run', 'Follow the attached prompt file.', '--attach', '--agent', 'test-agent',
    '--model', 'opencode-go/deepseek-v4-flash',
    '--dir', '/w', '--file', '/p',
  ]);
});

test('T4c - spawnDispatch passes providerless model when provided', () => {
  const execFileMock = mock.fn();
  _setExecFile(execFileMock);
  const fakeChild = { on: () => {} };
  execFileMock.mock.mockImplementation(() => fakeChild);

  spawnDispatch('/w', '/p', 'test-agent', { providerID: '', modelID: 'forge' });

  const [, args] = execFileMock.mock.calls[0].arguments;
  assert.deepEqual(args, [
    'run', 'Follow the attached prompt file.', '--attach', '--agent', 'test-agent',
    '--model', 'forge',
    '--dir', '/w', '--file', '/p',
  ]);
});

test('T5 - spawnDispatch returns a ChildProcess object', () => {
  const execFileMock = mock.fn();
  _setExecFile(execFileMock);
  const fakeChild = { on: () => {}, kill: () => {} };
  execFileMock.mock.mockImplementation(() => fakeChild);

  const result = spawnDispatch('/w', '/p', 'test-agent');
  assert.equal(result, fakeChild);
  assert.equal(typeof result.on, 'function');
});

test('T6 - awaitProcess resolves when child exits with code 0', async () => {
  const child = {
    on: (event, handler) => {
      if (event === 'exit') setImmediate(() => handler(0, null));
    },
    kill: () => {},
  };
  await assert.doesNotReject(awaitProcess(child, 5000));
});

test('T7 - awaitProcess rejects when child exits with non-zero code', async () => {
  const child = {
    on: (event, handler) => {
      if (event === 'exit') setImmediate(() => handler(1, null));
    },
    kill: () => {},
  };
  await assert.rejects(awaitProcess(child, 5000), /child process exited with code 1/);
});

test('T8 - awaitProcess kills with SIGKILL and rejects on timeout', async () => {
  const killMock = mock.fn();
  const child = {
    on: () => {},
    kill: killMock,
  };
  await assert.rejects(awaitProcess(child, 5), /timed out/i);
  assert.equal(killMock.mock.callCount(), 1);
  assert.equal(killMock.mock.calls[0].arguments[0], 'SIGKILL');
});

test('T9 - cleanupFiles deletes each file if it exists, silently skips missing files', () => {
  const io = makeMockIO({
    '.foundry/dispatch-prompts/a.txt': 'a',
    '.foundry/dispatch-prompts/b.txt': 'b',
  });
  io._dirs.add('.foundry/dispatch-prompts');

  cleanupFiles(io, '.foundry/dispatch-prompts/a.txt', '.foundry/dispatch-prompts/b.txt', '.foundry/dispatch-prompts/missing.txt');

  assert.equal(io.exists('.foundry/dispatch-prompts/a.txt'), false);
  assert.equal(io.exists('.foundry/dispatch-prompts/b.txt'), false);
  assert.doesNotThrow(() => cleanupFiles(io, '.foundry/dispatch-prompts/missing.txt'));
});

test('T11 - withCleanup passes a mutable paths array to fn, then calls cleanupFiles in a finally block', async () => {
  const io = makeMockIO();
  let capturedPaths = null;

  await withCleanup(io, (paths) => {
    capturedPaths = paths;
    paths.push('.foundry/dispatch-prompts/a.txt');
    io.writeFile('.foundry/dispatch-prompts/a.txt', 'data');
  });

  assert.ok(capturedPaths !== null);
  assert.equal(io.exists('.foundry/dispatch-prompts/a.txt'), false);
});

test('T12 - withCleanup calls cleanupFiles with paths pushed before a thrown error', async () => {
  const io = makeMockIO();
  io.writeFile('.foundry/dispatch-prompts/a.txt', 'data');

  await assert.rejects(
    withCleanup(io, (paths) => {
      paths.push('.foundry/dispatch-prompts/a.txt');
      throw new Error('boom');
    }),
    /boom/
  );

  assert.equal(io.exists('.foundry/dispatch-prompts/a.txt'), false);
});

test('T13 - withCleanup returns the result of fn when it succeeds', async () => {
  const io = makeMockIO();
  const result = await withCleanup(io, (paths) => {
    return 'success';
  });
  assert.equal(result, 'success');
});
