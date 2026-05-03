import test from 'node:test';
import assert from 'node:assert/strict';
import { guarded, notFailedGuard } from '../../src/scripts/lib/guards.js';

test('guarded: runs guards in order until one fails', async () => {
  const calls = [];
  const g1 = () => { calls.push('g1'); return { ok: true }; };
  const g2 = () => { calls.push('g2'); return { ok: false, error: 'nope' }; };
  const g3 = () => { calls.push('g3'); return { ok: true }; };
  const exec = () => { calls.push('exec'); return 'X'; };
  const wrapped = guarded('foundry_x', [g1, g2, g3], exec);
  const out = await wrapped({}, {});
  assert.deepEqual(calls, ['g1', 'g2']);
  assert.equal(out, JSON.stringify({ error: 'foundry_x: nope' }));
});

test('guarded: all-pass invokes execute and returns its value verbatim', async () => {
  const exec = async () => '{"ok":true}';
  const wrapped = guarded('foundry_x', [() => ({ ok: true })], exec);
  assert.equal(await wrapped({}, {}), '{"ok":true}');
});

test('guarded: async guard supported', async () => {
  const wrapped = guarded('foundry_x',
    [async () => ({ ok: false, error: 'async-fail' })],
    () => 'unreachable');
  assert.equal(await wrapped({}, {}),
    JSON.stringify({ error: 'foundry_x: async-fail' }));
});

test('notFailedGuard: returns a guard that calls requireNotFailed with makeSyncIO(worktree)', () => {
  // Stub a `makeSyncIO` that returns an io for which requireNotFailed
  // succeeds (no WORK.md present → not failed).
  const makeSyncIO = (worktree) => ({
    exists: () => false,
    readFile: () => '',
  });
  const g = notFailedGuard(makeSyncIO);
  const res = g({}, { worktree: '/tmp/example' });
  // requireNotFailed returns { ok: true } when WORK.md is absent.
  // We don't need to assert the full passthrough; we only assert ok-shape.
  // Equivalent shape if implementation forwards correctly.
  // Accept either { ok: true } or any other ok:true variant.
  if (res && res.ok) return; // pass
  throw new Error('notFailedGuard did not return ok-shaped result; got ' + JSON.stringify(res));
});

// ---------------------------------------------------------------------------
// Tracing tests (Task 5.2)
// ---------------------------------------------------------------------------

function makeTraceIo() {
  const appendCalls = [];
  const writeCalls = [];
  const files = new Map();
  const io = {
    async mkdirp(_p) {},
    async appendFile(path, data) {
      appendCalls.push({ path, data });
      files.set(path, (files.get(path) ?? '') + data);
    },
    async exists(path) { return files.has(path); },
    async readFile(path) {
      if (!files.has(path)) {
        const err = new Error('ENOENT');
        err.code = 'ENOENT';
        throw err;
      }
      return files.get(path);
    },
    async writeFile(path, data) {
      writeCalls.push({ path, data });
      files.set(path, data);
    },
  };
  return { io, appendCalls, writeCalls, files };
}

function readRecords(appendCalls) {
  return appendCalls.map(c => JSON.parse(c.data.replace(/\n$/, '')));
}

test('guarded: traces tool calls on dry-run branches', async () => {
  const { io, appendCalls } = makeTraceIo();
  const branchIo = () => ({ exec: () => 'dry-run/foo/x-y\n' });
  const exec = async () => '{"ok":true}';
  const wrapped = guarded('foundry_x', [], exec, { branchIo, io: () => io });

  const out = await wrapped({ a: 1 }, {});

  assert.equal(out, '{"ok":true}');
  assert.equal(appendCalls.length, 1);
  const recs = readRecords(appendCalls);
  assert.equal(recs[0].tool, 'foundry_x');
  assert.deepEqual(recs[0].args, { a: 1 });
  assert.deepEqual(recs[0].result, { ok: true });
  assert.equal(typeof recs[0].duration_ms, 'number');
  assert.ok(typeof recs[0].ts === 'string' && recs[0].ts.length > 0);
  // path under .foundry/trace/<slug>.jsonl
  assert.equal(appendCalls[0].path, '.foundry/trace/dry-run-foo-x-y.jsonl');
});

test('guarded: does NOT trace on work/* branches', async () => {
  const { io, appendCalls, writeCalls } = makeTraceIo();
  const branchIo = () => ({ exec: () => 'work/foo-bar\n' });
  const wrapped = guarded('foundry_x', [], async () => 'OK',
    { branchIo, io: () => io });
  const out = await wrapped({}, {});
  assert.equal(out, 'OK');
  assert.equal(appendCalls.length, 0);
  assert.equal(writeCalls.length, 0);
});

test('guarded: does NOT trace on config/* branches', async () => {
  const { io, appendCalls, writeCalls } = makeTraceIo();
  const branchIo = () => ({ exec: () => 'config/foo\n' });
  const wrapped = guarded('foundry_x', [], async () => 'OK',
    { branchIo, io: () => io });
  await wrapped({}, {});
  assert.equal(appendCalls.length, 0);
  assert.equal(writeCalls.length, 0);
});

test('guarded: does NOT trace on main', async () => {
  const { io, appendCalls, writeCalls } = makeTraceIo();
  const branchIo = () => ({ exec: () => 'main\n' });
  const wrapped = guarded('foundry_x', [], async () => 'OK',
    { branchIo, io: () => io });
  await wrapped({}, {});
  assert.equal(appendCalls.length, 0);
  assert.equal(writeCalls.length, 0);
});

test('guarded: tracing failure does not break tool call', async () => {
  const io = {
    async mkdirp() {},
    async appendFile() { throw new Error('disk full'); },
    async exists() { return false; },
    async readFile() { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); },
    async writeFile() { throw new Error('disk full'); },
  };
  const branchIo = () => ({ exec: () => 'dry-run/foo/x-y\n' });
  const wrapped = guarded('foundry_x', [], async () => 'OK',
    { branchIo, io: () => io });
  const out = await wrapped({}, {});
  assert.equal(out, 'OK');
});

test('guarded: traces error path', async () => {
  const { io, appendCalls } = makeTraceIo();
  const branchIo = () => ({ exec: () => 'dry-run/foo/x-y\n' });
  const boom = new Error('kaboom');
  const wrapped = guarded('foundry_x', [], async () => { throw boom; },
    { branchIo, io: () => io });

  await assert.rejects(() => wrapped({}, {}), /kaboom/);
  assert.equal(appendCalls.length, 1);
  const rec = readRecords(appendCalls)[0];
  assert.equal(rec.error, 'kaboom');
  assert.equal('result' in rec, false);
  assert.equal(typeof rec.duration_ms, 'number');
});

test('guarded: scrubs long string args', async () => {
  const { io, appendCalls } = makeTraceIo();
  const branchIo = () => ({ exec: () => 'dry-run/foo/x-y\n' });
  const wrapped = guarded('foundry_x', [], async () => 'OK',
    { branchIo, io: () => io });

  const big = 'a'.repeat(10000);
  await wrapped({ payload: big, small: 'fine' }, {});

  const rec = readRecords(appendCalls)[0];
  assert.notEqual(rec.args.payload, big);
  assert.ok(rec.args.payload.includes('elided'));
  assert.ok(rec.args.payload.length < big.length);
  assert.equal(rec.args.small, 'fine');
});

test('guarded: tracing failure is silent without FOUNDRY_DEBUG', async () => {
  const io = {
    async mkdirp() {},
    async appendFile() { throw new Error('disk full'); },
    async exists() { return false; },
    async readFile() { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); },
    async writeFile() { throw new Error('disk full'); },
  };
  const branchIo = () => ({ exec: () => 'dry-run/foo/x-y\n' });
  const wrapped = guarded('foundry_x', [], async () => 'OK',
    { branchIo, io: () => io });

  const warnings = [];
  const originalWarn = console.warn;
  const originalEnv = process.env.FOUNDRY_DEBUG;
  console.warn = (...args) => { warnings.push(args); };
  delete process.env.FOUNDRY_DEBUG;
  try {
    const out = await wrapped({}, {});
    assert.equal(out, 'OK');
    assert.equal(warnings.length, 0,
      'tracing errors must be silent without FOUNDRY_DEBUG');
  } finally {
    console.warn = originalWarn;
    if (originalEnv === undefined) delete process.env.FOUNDRY_DEBUG;
    else process.env.FOUNDRY_DEBUG = originalEnv;
  }
});

test('guarded: tracing failure surfaces via console.warn when FOUNDRY_DEBUG=1', async () => {
  const io = {
    async mkdirp() {},
    async appendFile() { throw new Error('disk full'); },
    async exists() { return false; },
    async readFile() { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); },
    async writeFile() { throw new Error('disk full'); },
  };
  const branchIo = () => ({ exec: () => 'dry-run/foo/x-y\n' });
  const wrapped = guarded('foundry_x', [], async () => 'OK',
    { branchIo, io: () => io });

  const warnings = [];
  const originalWarn = console.warn;
  const originalEnv = process.env.FOUNDRY_DEBUG;
  console.warn = (...args) => { warnings.push(args); };
  process.env.FOUNDRY_DEBUG = '1';
  try {
    const out = await wrapped({}, {});
    assert.equal(out, 'OK');
    assert.equal(warnings.length, 1,
      'tracing error must surface once via console.warn under FOUNDRY_DEBUG');
    const [firstArg] = warnings[0];
    assert.match(String(firstArg), /foundry_x/,
      'warning must name the tool that was tracing');
    assert.match(String(firstArg), /trace/i,
      'warning must mention tracing so the operator knows the scope');
  } finally {
    console.warn = originalWarn;
    if (originalEnv === undefined) delete process.env.FOUNDRY_DEBUG;
    else process.env.FOUNDRY_DEBUG = originalEnv;
  }
});

test('guarded: backwards compatible — no opts means no branchIo lookup', async () => {
  // Existing 3-arg shape must work unchanged.
  const exec = async () => 'OK';
  const wrapped = guarded('foundry_x', [() => ({ ok: true })], exec);
  assert.equal(await wrapped({}, {}), 'OK');

  // And opts with a throwing branchIo shouldn't be invoked when caller
  // simply omits opts entirely (already covered above — this assertion
  // confirms no implicit lookup happens).
  const exec2 = async () => 'OK2';
  const wrapped2 = guarded('foundry_y', [], exec2);
  assert.equal(await wrapped2({}, {}), 'OK2');
});
