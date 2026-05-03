import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  readFailedStatus,
  markWorkfileFailed,
  requireNotFailed,
} from '../../src/scripts/lib/failed-flow.js';

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

    it('is idempotent when already failed (preserves first reason)', () => {
      const io = makeIO({
        'WORK.md': '---\ncycle: c\nstatus: failed\nreason: original diagnostic reason\n---\n',
      });
      markWorkfileFailed(io, 'cascading failure');
      // First failure reason is the diagnostic one - preserve it
      assert.match(io._store['WORK.md'], /reason: original diagnostic reason/);
      assert.doesNotMatch(io._store['WORK.md'], /reason: cascading failure/);
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

    it('escapes reason with newline characters', () => {
      const io = makeIO({ 'WORK.md': '---\ncycle: c\n---\n' });
      const reason = 'line one\nline two\nline three';
      markWorkfileFailed(io, reason);
      // Verify it was written
      assert.match(io._store['WORK.md'], /status: failed/);
      // Verify it round-trips correctly
      const status = readFailedStatus(io);
      assert.deepEqual(status, { reason: 'line one\nline two\nline three' });
    });

    it('escapes reason with colons', () => {
      const io = makeIO({ 'WORK.md': '---\ncycle: c\n---\n' });
      const reason = 'error: failed to connect: timeout';
      markWorkfileFailed(io, reason);
      assert.match(io._store['WORK.md'], /status: failed/);
      const status = readFailedStatus(io);
      assert.deepEqual(status, { reason: 'error: failed to connect: timeout' });
    });

    it('escapes reason with leading double quote', () => {
      const io = makeIO({ 'WORK.md': '---\ncycle: c\n---\n' });
      const reason = '"quoted error message"';
      markWorkfileFailed(io, reason);
      assert.match(io._store['WORK.md'], /status: failed/);
      const status = readFailedStatus(io);
      assert.deepEqual(status, { reason: '"quoted error message"' });
    });

    it('escapes reason with leading single quote', () => {
      const io = makeIO({ 'WORK.md': '---\ncycle: c\n---\n' });
      const reason = "'single quoted error'";
      markWorkfileFailed(io, reason);
      assert.match(io._store['WORK.md'], /status: failed/);
      const status = readFailedStatus(io);
      assert.deepEqual(status, { reason: "'single quoted error'" });
    });

    it('escapes reason with multiple YAML-sensitive characters', () => {
      const io = makeIO({ 'WORK.md': '---\ncycle: c\n---\n' });
      const reason = 'error: "connection failed"\nmessage: timeout at 30s';
      markWorkfileFailed(io, reason);
      assert.match(io._store['WORK.md'], /status: failed/);
      const status = readFailedStatus(io);
      assert.deepEqual(status, { reason: 'error: "connection failed"\nmessage: timeout at 30s' });
    });

    it('escapes reason with YAML special indicators', () => {
      const io = makeIO({ 'WORK.md': '---\ncycle: c\n---\n' });
      const reason = '- list item\n# comment\n> block';
      markWorkfileFailed(io, reason);
      assert.match(io._store['WORK.md'], /status: failed/);
      const status = readFailedStatus(io);
      assert.deepEqual(status, { reason: '- list item\n# comment\n> block' });
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

    it('ok when WORK.md has no frontmatter (treated as clean)', () => {
      const io = makeIO({ 'WORK.md': '# Goal\n\nSome goal\n' });
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

    it('errors when WORK.md has malformed YAML', () => {
      const io = makeIO({
        'WORK.md': '---\ncycle: c\nstatus: [broken yaml without closing\n---\n',
      });
      const r = requireNotFailed(io);
      assert.equal(r.ok, false);
      assert.match(r.error, /WORK\.md is corrupted or unreadable/);
      assert.match(r.error, /foundry_workfile_delete/);
    });

    it('errors when WORK.md read throws IO error', () => {
      const io = {
        exists: () => true,
        readFile: () => { throw new Error('EACCES: permission denied'); },
      };
      const r = requireNotFailed(io);
      assert.equal(r.ok, false);
      assert.match(r.error, /WORK\.md is corrupted or unreadable/);
      assert.match(r.error, /foundry_workfile_delete/);
    });
  });
});
