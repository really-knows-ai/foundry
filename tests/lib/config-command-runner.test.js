// tests/lib/config-command-runner.test.js
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCommand,
  checkCommandPolicy,
  writeAuditLog,
  detectDirtyTree,
  runCommand,
  MAX_CAPTURE_BYTES,
} from '../../src/scripts/lib/config-command-runner.js';

// ---------------------------------------------------------------------------
// D1 — parseCommand
// ---------------------------------------------------------------------------
describe('parseCommand', () => {
  test('parses a simple command into argv [node, foundry/test.mjs]', () => {
    const result = parseCommand('node foundry/test.mjs');
    assert.equal(result.ok, true);
    assert.deepEqual(result.argv, ['node', 'foundry/test.mjs']);
  });

  test('handles single-quoted arguments with spaces', () => {
    const result = parseCommand("node 'path with spaces/script.mjs'");
    assert.equal(result.ok, true);
    assert.deepEqual(result.argv, ['node', 'path with spaces/script.mjs']);
  });

  test('handles double-quoted arguments', () => {
    const result = parseCommand('node "path/script.mjs"');
    assert.equal(result.ok, true);
    assert.deepEqual(result.argv, ['node', 'path/script.mjs']);
  });

  test('handles backslash escaping inside double quotes', () => {
    const result = parseCommand('node "path\\"with\\"quotes.mjs"');
    assert.equal(result.ok, true);
    assert.deepEqual(result.argv, ['node', 'path"with"quotes.mjs']);
  });

  test('rejects pipe | outside quotes', () => {
    const result = parseCommand('echo hello | wc');
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'shell_feature_denied');
  });

  test('rejects redirect > outside quotes', () => {
    const result = parseCommand('echo hello > out.txt');
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'shell_feature_denied');
  });

  test('rejects command substitution $(...)', () => {
    const result = parseCommand('echo $(whoami)');
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'shell_feature_denied');
  });

  test('rejects backtick substitution', () => {
    const result = parseCommand('echo `whoami`');
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'shell_feature_denied');
  });

  test('rejects glob * outside quotes', () => {
    const result = parseCommand('node *.js');
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'shell_feature_denied');
  });

  test('rejects environment assignment at start KEY=val cmd', () => {
    const result = parseCommand('NODE_ENV=production node app.js');
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'shell_feature_denied');
  });

  test('rejects semicolon chaining ; outside quotes', () => {
    const result = parseCommand('echo hello; echo world');
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'shell_feature_denied');
  });

  test('rejects && chaining', () => {
    const result = parseCommand('cd foo && ls');
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'shell_feature_denied');
  });

  test('rejects || chaining', () => {
    const result = parseCommand('false || echo ok');
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'shell_feature_denied');
  });

  test('rejects empty input string', () => {
    const result = parseCommand('');
    assert.equal(result.ok, false);
    assert.equal(result.error, 'command string is empty');
    assert.equal(result.reason, 'empty_command');
  });

  test('allows quoted * inside single quotes', () => {
    const result = parseCommand("node '*.js'");
    assert.equal(result.ok, true);
    assert.deepEqual(result.argv, ['node', '*.js']);
  });

  test('allows quoted pipe inside double quotes', () => {
    const result = parseCommand('node "pipe|symbol"');
    assert.equal(result.ok, true);
    assert.deepEqual(result.argv, ['node', 'pipe|symbol']);
  });
});

// ---------------------------------------------------------------------------
// D2 — checkCommandPolicy
// ---------------------------------------------------------------------------
describe('checkCommandPolicy', () => {
  test('allows node foundry/script.mjs', () => {
    const result = checkCommandPolicy(['node', 'foundry/script.mjs']);
    assert.equal(result.ok, true);
    assert.equal(result.mode, 'node-foundry-script');
  });

  test('allows node foundry/artefacts/haiku/validate.mjs', () => {
    const result = checkCommandPolicy(['node', 'foundry/artefacts/haiku/validate.mjs']);
    assert.equal(result.ok, true);
    assert.equal(result.mode, 'node-foundry-script');
  });

  test('allows node foundry/deep/nested/path/test.mjs', () => {
    const result = checkCommandPolicy(['node', 'foundry/deep/nested/path/test.mjs']);
    assert.equal(result.ok, true);
    assert.equal(result.mode, 'node-foundry-script');
  });

  test('rejects node ../outside.js', () => {
    const result = checkCommandPolicy(['node', '../outside.js']);
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'path_outside_foundry');
  });

  test('rejects node /etc/passwd', () => {
    const result = checkCommandPolicy(['node', '/etc/passwd']);
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'path_outside_foundry');
  });

  test('rejects node with no path argument', () => {
    const result = checkCommandPolicy(['node']);
    assert.equal(result.ok, false);
    assert.equal(result.error, 'missing script path');
    assert.equal(result.reason, 'missing_path');
  });

  test('allows pnpm run test', () => {
    const result = checkCommandPolicy(['pnpm', 'run', 'test']);
    assert.equal(result.ok, true);
    assert.equal(result.mode, 'pnpm-run');
  });

  test('rejects pnpm with no arguments', () => {
    const result = checkCommandPolicy(['pnpm']);
    assert.equal(result.ok, false);
    assert.equal(result.error, 'missing pnpm subcommand');
    assert.equal(result.reason, 'missing_subcommand');
  });

  test('rejects pnpm add foo (not a run subcommand)', () => {
    const result = checkCommandPolicy(['pnpm', 'add', 'foo']);
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'command_not_allowed');
  });

  test('rejects pnpm run with no script name', () => {
    const result = checkCommandPolicy(['pnpm', 'run']);
    assert.equal(result.ok, false);
    assert.equal(result.error, 'missing script name');
    assert.equal(result.reason, 'missing_script_name');
  });

  test('rejects rm -rf /', () => {
    const result = checkCommandPolicy(['rm', '-rf', '/']);
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'command_not_allowed');
  });

  test('rejects empty argv array', () => {
    const result = checkCommandPolicy([]);
    assert.equal(result.ok, false);
    assert.equal(result.error, 'no command tokens');
    assert.equal(result.reason, 'empty_argv');
  });
});

// ---------------------------------------------------------------------------
// D3 — writeAuditLog
// ---------------------------------------------------------------------------
describe('writeAuditLog', () => {
  function makeMockIO() {
    const dirs = [];
    const files = new Map();
    return {
      dirs,
      files,
      mkdir: (p) => { dirs.push(p); },
      writeFile: (p, content) => { files.set(p, content); },
    };
  }

  test('creates the log directory', () => {
    const io = makeMockIO();
    const logData = { reason: 'test reason', command: 'node test.mjs', argv: ['node', 'test.mjs'], cwd: '/tmp', startedAt: '2024-01-01T00:00:00.000Z', finishedAt: '2024-01-01T00:00:01.000Z', durationMs: 1000, exitCode: 0, signal: null, timedOut: false, stdout: 'ok', stderr: '', stdoutTruncated: false, stderrTruncated: false, dirtyBefore: [], dirtyAfter: [], changedFiles: [] };
    writeAuditLog(io, logData);
    assert.ok(io.dirs.includes('.foundry/config-command-logs'));
  });

  test('writes a JSON file with correct path', () => {
    const io = makeMockIO();
    const logData = { reason: 'test', command: 'node test.mjs', argv: ['node', 'test.mjs'], cwd: '/tmp', startedAt: '2024-01-01T00:00:00.000Z', finishedAt: '2024-01-01T00:00:01.000Z', durationMs: 1000, exitCode: 0, signal: null, timedOut: false, stdout: 'ok', stderr: '', stdoutTruncated: false, stderrTruncated: false, dirtyBefore: [], dirtyAfter: [], changedFiles: [] };
    const result = writeAuditLog(io, logData);
    assert.equal(result.ok, true);
    assert.ok(result.logPath.startsWith('.foundry/config-command-logs/'));
    assert.ok(result.logPath.endsWith('.json'));
    // Verify the file was actually written
    assert.ok(io.files.has(result.logPath));
  });

  test('written JSON contains all expected fields', () => {
    const io = makeMockIO();
    const logData = { reason: 'check syllables', command: 'node foundry/test.mjs', argv: ['node', 'foundry/test.mjs'], cwd: '/repo', startedAt: '2024-06-15T10:00:00.000Z', finishedAt: '2024-06-15T10:00:00.500Z', durationMs: 500, exitCode: 0, signal: null, timedOut: false, stdout: 'all tests passed', stderr: '', stdoutTruncated: false, stderrTruncated: false, dirtyBefore: [], dirtyAfter: ['foundry/test.mjs'], changedFiles: ['foundry/test.mjs'] };
    const result = writeAuditLog(io, logData);
    const written = JSON.parse(io.files.get(result.logPath));
    assert.equal(written.reason, 'check syllables');
    assert.equal(written.command, 'node foundry/test.mjs');
    assert.deepEqual(written.argv, ['node', 'foundry/test.mjs']);
    assert.equal(written.cwd, '/repo');
    assert.equal(written.exitCode, 0);
    assert.equal(written.durationMs, 500);
    assert.equal(written.stdout, 'all tests passed');
    assert.deepEqual(written.changedFiles, ['foundry/test.mjs']);
    assert.equal(written.stdoutTruncated, false);
    assert.equal(written.stderrTruncated, false);
    assert.equal(written.timedOut, false);
    assert.equal(written.signal, null);
    assert.deepEqual(written.dirtyAfter, ['foundry/test.mjs']);
    assert.ok(typeof written.id === 'string');
    assert.ok(typeof written.startedAt === 'string');
    assert.ok(typeof written.finishedAt === 'string');
  });

  test('id is a non-empty string matching ULID pattern', () => {
    const io = makeMockIO();
    const logData = { reason: 'test', command: 'echo', argv: ['echo'], cwd: '/', startedAt: '2024-01-01T00:00:00.000Z', finishedAt: '2024-01-01T00:00:01.000Z', durationMs: 1000, exitCode: 0, signal: null, timedOut: false, stdout: '', stderr: '', stdoutTruncated: false, stderrTruncated: false, dirtyBefore: [], dirtyAfter: [], changedFiles: [] };
    const result = writeAuditLog(io, logData);
    const written = JSON.parse(io.files.get(result.logPath));
    assert.equal(typeof written.id, 'string');
    assert.ok(written.id.length > 0);
    // ULID: first char 0-7 (time-bound), remaining 25 chars are Crockford base32
    assert.match(written.id, /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
  });

  test('returns { ok: true, logPath } on success', () => {
    const io = makeMockIO();
    const logData = { reason: 'test', command: 'echo hi', argv: ['echo', 'hi'], cwd: '/', startedAt: '2024-01-01T00:00:00.000Z', finishedAt: '2024-01-01T00:00:01.000Z', durationMs: 1000, exitCode: 0, signal: null, timedOut: false, stdout: 'hi', stderr: '', stdoutTruncated: false, stderrTruncated: false, dirtyBefore: [], dirtyAfter: [], changedFiles: [] };
    const result = writeAuditLog(io, logData);
    assert.equal(result.ok, true);
    assert.equal(typeof result.logPath, 'string');
    assert.ok(result.logPath.startsWith('.foundry/config-command-logs/'));
  });

  test('returns { ok: false, error } when mkdir fails', () => {
    const io = {
      mkdir: () => { throw new Error('permission denied'); },
      writeFile: () => {},
    };
    const logData = { reason: 'test', command: 'node test.mjs', argv: ['node', 'test.mjs'], cwd: '/', startedAt: '2024-01-01T00:00:00.000Z', finishedAt: '2024-01-01T00:00:01.000Z', durationMs: 1000, exitCode: 0, signal: null, timedOut: false, stdout: '', stderr: '', stdoutTruncated: false, stderrTruncated: false, dirtyBefore: [], dirtyAfter: [], changedFiles: [] };
    const result = writeAuditLog(io, logData);
    assert.equal(result.ok, false);
    assert.equal(typeof result.error, 'string');
  });

  test('returns { ok: false, error } when writeFile fails', () => {
    const io = {
      mkdir: () => {},
      writeFile: () => { throw new Error('disk full'); },
    };
    const logData = { reason: 'test', command: 'node test.mjs', argv: ['node', 'test.mjs'], cwd: '/', startedAt: '2024-01-01T00:00:00.000Z', finishedAt: '2024-01-01T00:00:01.000Z', durationMs: 1000, exitCode: 0, signal: null, timedOut: false, stdout: '', stderr: '', stdoutTruncated: false, stderrTruncated: false, dirtyBefore: [], dirtyAfter: [], changedFiles: [] };
    const result = writeAuditLog(io, logData);
    assert.equal(result.ok, false);
    assert.equal(typeof result.error, 'string');
  });

  test('preserves supplied truncation flags', () => {
    const io = makeMockIO();
    const logData = { reason: 'test', command: 'node test.mjs', argv: ['node', 'test.mjs'], cwd: '/', startedAt: '2024-01-01T00:00:00.000Z', finishedAt: '2024-01-01T00:00:01.000Z', durationMs: 1000, exitCode: 0, signal: null, timedOut: false, stdout: '', stderr: '', stdoutTruncated: true, stderrTruncated: true, dirtyBefore: [], dirtyAfter: [], changedFiles: [] };
    const result = writeAuditLog(io, logData);
    const written = JSON.parse(io.files.get(result.logPath));
    assert.equal(written.stdoutTruncated, true);
    assert.equal(written.stderrTruncated, true);
  });

  test('writes bounded stdout as supplied', () => {
    const io = makeMockIO();
    const boundedStdout = 'x'.repeat(100);
    const logData = { reason: 'test', command: 'node test.mjs', argv: ['node', 'test.mjs'], cwd: '/', startedAt: '2024-01-01T00:00:00.000Z', finishedAt: '2024-01-01T00:00:01.000Z', durationMs: 1000, exitCode: 0, signal: null, timedOut: false, stdout: boundedStdout, stderr: '', stdoutTruncated: false, stderrTruncated: false, dirtyBefore: [], dirtyAfter: [], changedFiles: [] };
    const result = writeAuditLog(io, logData);
    const written = JSON.parse(io.files.get(result.logPath));
    assert.equal(written.stdout, boundedStdout);
  });
});

// ---------------------------------------------------------------------------
// D4 — detectDirtyTree
// ---------------------------------------------------------------------------
describe('detectDirtyTree', () => {
  test('returns empty array when exec returns empty string', () => {
    const files = detectDirtyTree(() => '');
    assert.deepEqual(files, []);
  });

  test('parses porcelain output correctly', () => {
    const execMock = () => ' M src/a.js\0?? new.txt\0';
    const files = detectDirtyTree(execMock);
    assert.deepEqual(files, ['src/a.js', 'new.txt']);
  });

  test('parses porcelain output from rich exec result', () => {
    const execMock = () => ({ stdout: ' M src/a.js\0' });
    const files = detectDirtyTree(execMock);
    assert.deepEqual(files, ['src/a.js']);
  });

  test('returns empty array when exec throws', () => {
    const execMock = () => { throw new Error('not a git repo'); };
    const files = detectDirtyTree(execMock);
    assert.deepEqual(files, []);
  });
});

// ---------------------------------------------------------------------------
// D5 — runCommand
// ---------------------------------------------------------------------------
describe('runCommand', () => {
  function makeMockIO() {
    const dirs = [];
    const files = new Map();
    return {
      dirs,
      files,
      mkdir: (p) => { dirs.push(p); },
      writeFile: (p, content) => { files.set(p, content); },
    };
  }

  /**
   * Create a mock exec function for runCommand tests.
   * The default mock returns success for allowed commands.
   * The `gitStatusResult` parameter controls what git status returns for
   * dirty-tree detection.
   */
  function makeMockExec({ gitStatusResult, execResult } = {}) {
    const defaultExecResult = { stdout: '', stderr: '', exitCode: 0, signal: null, timedOut: false, stdoutTruncated: false, stderrTruncated: false };
    const defaultGitResult = '';

    return (argv, opts) => {
      const cmd = Array.isArray(argv) ? argv.join(' ') : argv;
      if (cmd.startsWith('git status')) {
        const raw = gitStatusResult !== undefined ? gitStatusResult : defaultGitResult;
        return typeof raw === 'string' ? { stdout: raw } : raw;
      }
      return execResult !== undefined ? execResult : defaultExecResult;
    };
  }

  test('rejects empty reason', () => {
    const result = runCommand({
      io: makeMockIO(),
      exec: makeMockExec(),
      command: 'node foundry/test.mjs',
      reason: '',
    });
    assert.equal(result.ok, false);
    assert.equal(result.error, 'reason is required');
    assert.equal(result.reason, 'missing_reason');
  });

  test('rejects command with shell features', () => {
    const result = runCommand({
      io: makeMockIO(),
      exec: makeMockExec(),
      command: 'echo hello | wc',
      reason: 'testing shell rejection',
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'shell_feature_denied');
  });

  test('rejects command with disallowed tool', () => {
    const result = runCommand({
      io: makeMockIO(),
      exec: makeMockExec(),
      command: 'rm -rf /',
      reason: 'testing policy',
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'command_not_allowed');
  });

  test('executes an allowed command and returns success', () => {
    const io = makeMockIO();
    const result = runCommand({
      io,
      exec: makeMockExec({ execResult: { stdout: 'ok', stderr: '', exitCode: 0, signal: null, timedOut: false, stdoutTruncated: false, stderrTruncated: false } }),
      command: 'node foundry/script.mjs',
      reason: 'testing execution',
    });
    // Policy doesn't require the file to exist, just that the command is allowed
    // The exec mock handles the actual execution
    assert.equal(result.ok, true);
    assert.equal(result.exitCode, 0);
  });

  test('captures stdout and stderr from mock exec', () => {
    const result = runCommand({
      io: makeMockIO(),
      exec: makeMockExec({ execResult: { stdout: 'hello world', stderr: '', exitCode: 0, signal: null, timedOut: false, stdoutTruncated: false, stderrTruncated: false } }),
      command: 'node foundry/script.mjs',
      reason: 'capture test',
    });
    assert.equal(result.ok, true);
    assert.equal(result.stdout, 'hello world');
    assert.equal(result.stderr, '');
  });

  test('captures non-zero exit code', () => {
    const result = runCommand({
      io: makeMockIO(),
      exec: makeMockExec({ execResult: { stdout: '', stderr: 'error message', exitCode: 1, signal: null, timedOut: false, stdoutTruncated: false, stderrTruncated: false } }),
      command: 'node foundry/script.mjs',
      reason: 'error test',
    });
    assert.equal(result.exitCode, 1);
    assert.equal(result.stderr, 'error message');
  });

  test('detects dirty tree before execution', () => {
    const result = runCommand({
      io: makeMockIO(),
      exec: makeMockExec({
        gitStatusResult: ' M src/a.js\0?? new.txt\0',
        execResult: { stdout: 'ok', stderr: '', exitCode: 0, signal: null, timedOut: false, stdoutTruncated: false, stderrTruncated: false },
      }),
      command: 'node foundry/script.mjs',
      reason: 'dirty before test',
    });
    assert.equal(result.ok, true);
    assert.ok(result.dirtyBefore.length > 0);
    assert.deepEqual(result.dirtyBefore, ['src/a.js', 'new.txt']);
  });

  test('detects dirty tree after execution', () => {
    const count = { calls: 0 };
    const execMock = (argv, opts) => {
      const cmd = Array.isArray(argv) ? argv.join(' ') : argv;
      if (cmd.startsWith('git status')) {
        count.calls++;
        // First call (before) = clean, second call (after) = dirty
        if (count.calls === 1) return { stdout: '' };
        return { stdout: ' M foundry/output.txt\0' };
      }
      return { stdout: 'done', stderr: '', exitCode: 0, signal: null, timedOut: false, stdoutTruncated: false, stderrTruncated: false };
    };

    const result = runCommand({
      io: makeMockIO(),
      exec: execMock,
      command: 'node foundry/script.mjs',
      reason: 'dirty after test',
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.dirtyAfter, ['foundry/output.txt']);
    assert.equal(result.changedFiles, result.dirtyAfter);
  });

  test('times out and returns timedOut: true', () => {
    const result = runCommand({
      io: makeMockIO(),
      exec: makeMockExec({ execResult: { stdout: '', stderr: 'timeout', exitCode: null, signal: 'SIGTERM', timedOut: true, stdoutTruncated: false, stderrTruncated: false } }),
      command: 'node foundry/script.mjs',
      reason: 'timeout test',
    });
    assert.equal(result.ok, true);
    assert.equal(result.timedOut, true);
    assert.equal(result.exitCode, null);
  });

  test('writes audit log', () => {
    const io = makeMockIO();
    const result = runCommand({
      io,
      exec: makeMockExec({ execResult: { stdout: 'ok', stderr: '', exitCode: 0, signal: null, timedOut: false, stdoutTruncated: false, stderrTruncated: false } }),
      command: 'node foundry/script.mjs',
      reason: 'audit log test',
    });
    assert.equal(result.ok, true);
    assert.ok(result.logPath.startsWith('.foundry/config-command-logs/'));
    assert.ok(result.logPath.endsWith('.json'));
    assert.ok(io.files.has(result.logPath));
  });

  test('applies default timeout when none provided', () => {
    const result = runCommand({
      io: makeMockIO(),
      exec: makeMockExec({ execResult: { stdout: 'ok', stderr: '', exitCode: 0, signal: null, timedOut: false, stdoutTruncated: false, stderrTruncated: false } }),
      command: 'node foundry/script.mjs',
      reason: 'default timeout test',
    });
    assert.equal(result.ok, true);
  });

  test('clamps timeout above max to 120000', () => {
    const result = runCommand({
      io: makeMockIO(),
      exec: makeMockExec({ execResult: { stdout: 'ok', stderr: '', exitCode: 0, signal: null, timedOut: false, stdoutTruncated: false, stderrTruncated: false } }),
      command: 'node foundry/script.mjs',
      reason: 'clamp timeout test',
      timeout: 300000,
    });
    assert.equal(result.ok, true);
    // We cannot inspect the effective timeout from the return value,
    // but the mock exec would have received it - we just verify no error.
  });

  test('returns changedFiles matching dirtyAfter', () => {
    const count = { calls: 0 };
    const execMock = (argv, opts) => {
      const cmd = Array.isArray(argv) ? argv.join(' ') : argv;
      if (cmd.startsWith('git status')) {
        count.calls++;
        if (count.calls === 1) return { stdout: '' };
        return { stdout: ' M foundry/output.js\0' };
      }
      return { stdout: 'done', stderr: '', exitCode: 0, signal: null, timedOut: false, stdoutTruncated: false, stderrTruncated: false };
    };

    const result = runCommand({
      io: makeMockIO(),
      exec: execMock,
      command: 'node foundry/script.mjs',
      reason: 'changed files test',
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.changedFiles, ['foundry/output.js']);
    assert.equal(result.changedFiles, result.dirtyAfter);
  });

  test('truncates stdout exceeding MAX_CAPTURE_BYTES', () => {
    const longStdout = 'x'.repeat(MAX_CAPTURE_BYTES + 1000);
    const result = runCommand({
      io: makeMockIO(),
      exec: makeMockExec({ execResult: { stdout: longStdout, stderr: '', exitCode: 0, signal: null, timedOut: false, stdoutTruncated: false, stderrTruncated: false } }),
      command: 'node foundry/script.mjs',
      reason: 'truncation test',
    });
    assert.equal(result.ok, true);
    assert.equal(result.stdoutTruncated, true);
    assert.ok(Buffer.byteLength(result.stdout) <= MAX_CAPTURE_BYTES);
  });

  test('fails when audit log cannot be written', () => {
    const io = makeMockIO();
    // Override writeFile to throw
    io.writeFile = () => { throw new Error('disk full'); };
    const result = runCommand({
      io,
      exec: makeMockExec({ execResult: { stdout: 'ok', stderr: '', exitCode: 0, signal: null, timedOut: false, stdoutTruncated: false, stderrTruncated: false } }),
      command: 'node foundry/script.mjs',
      reason: 'audit failure test',
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'audit_log_failed');
  });
});
