import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  readFailedStatus,
  markWorkfileFailed,
  requireNotFailed,
} from '../../scripts/lib/failed-flow.js';

function makeIO(files = {}) {
  const store = { ...files };
  return {
    exists: (p) => p in store,
    readFile: (p) => {
      if (!(p in store)) throw new Error(`ENOENT: ${p}`);
      return store[p];
    },
    writeFile: (p, content) => { store[p] = content; },
    _store: store,
  };
}

describe('failed-flow', () => {
  describe('readFailedStatus', () => {
    it('returns null when WORK.md is missing', () => {
      const io = makeIO();
      assert.equal(readFailedStatus(io), null);
    });

    it('returns null when status is unset', () => {
      const io = makeIO({ 'WORK.md': '---\ncycle: c\n---\n' });
      assert.equal(readFailedStatus(io), null);
    });

    it('returns null when status is anything other than failed', () => {
      const io = makeIO({ 'WORK.md': '---\ncycle: c\nstatus: active\n---\n' });
      assert.equal(readFailedStatus(io), null);
    });

    it('returns {reason} when status is failed', () => {
      const io = makeIO({
        'WORK.md': '---\ncycle: c\nstatus: failed\nreason: sync broke\n---\n',
      });
      assert.deepEqual(readFailedStatus(io), { reason: 'sync broke' });
    });

    it('returns {reason: ""} when failed with no reason field', () => {
      const io = makeIO({ 'WORK.md': '---\ncycle: c\nstatus: failed\n---\n' });
      assert.deepEqual(readFailedStatus(io), { reason: '' });
    });
  });

  describe('markWorkfileFailed', () => {
    it('sets status: failed and reason', () => {
      const io = makeIO({ 'WORK.md': '---\ncycle: c\n---\n\n# Goal\n\ngo\n' });
      markWorkfileFailed(io, 'sync broke');
      const out = io._store['WORK.md'];
      assert.match(out, /status: failed/);
      assert.match(out, /reason: sync broke/);
      assert.match(out, /# Goal/);
      assert.match(out, /\ngo\n/);
    });

    it('is idempotent when already failed (overwrites reason)', () => {
      const io = makeIO({
        'WORK.md': '---\ncycle: c\nstatus: failed\nreason: old\n---\n',
      });
      markWorkfileFailed(io, 'new');
      assert.match(io._store['WORK.md'], /reason: new/);
      assert.doesNotMatch(io._store['WORK.md'], /reason: old/);
    });

    it('throws if WORK.md is missing', () => {
      const io = makeIO();
      assert.throws(() => markWorkfileFailed(io, 'x'), /WORK\.md not found/);
    });

    it('truncates very long reasons to 500 chars + ellipsis', () => {
      const io = makeIO({ 'WORK.md': '---\ncycle: c\n---\n' });
      const huge = 'x'.repeat(2000);
      markWorkfileFailed(io, huge);
      const out = io._store['WORK.md'];
      const m = out.match(/reason: (.+)/);
      assert.ok(m);
      assert.ok(m[1].length <= 510, `reason length ${m[1].length} should be <=510`);
      assert.ok(m[1].endsWith('...'), 'truncated reason should end with ...');
    });
  });

  describe('requireNotFailed', () => {
    it('ok when WORK.md is missing', () => {
      const io = makeIO();
      assert.deepEqual(requireNotFailed(io), { ok: true });
    });

    it('ok when status is not failed', () => {
      const io = makeIO({ 'WORK.md': '---\ncycle: c\n---\n' });
      assert.deepEqual(requireNotFailed(io), { ok: true });
    });

    it('errors when status is failed', () => {
      const io = makeIO({
        'WORK.md': '---\ncycle: c\nstatus: failed\nreason: sync broke\n---\n',
      });
      const r = requireNotFailed(io);
      assert.equal(r.ok, false);
      assert.match(r.error, /flow is in failed state/);
      assert.match(r.error, /sync broke/);
      assert.match(r.error, /foundry_workfile_delete/);
    });
  });
});
