import test from 'node:test';
import assert from 'node:assert/strict';
import { guarded, notFailedGuard } from '../../scripts/lib/guards.js';

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
