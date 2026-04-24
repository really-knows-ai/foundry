import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { makeIO } from '../../.opencode/plugins/foundry-tools/helpers.js';

describe('makeIO.rename', () => {
  test('moves a file atomically within the worktree', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'fdy-rename-'));
    try {
      const io = makeIO(dir);
      writeFileSync(path.join(dir, 'src.txt'), 'hello', 'utf-8');
      io.rename('src.txt', 'dst.txt');
      assert.equal(existsSync(path.join(dir, 'src.txt')), false);
      assert.equal(readFileSync(path.join(dir, 'dst.txt'), 'utf-8'), 'hello');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('throws when source does not exist', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'fdy-rename-'));
    try {
      const io = makeIO(dir);
      assert.throws(() => io.rename('missing.txt', 'dst.txt'), { code: 'ENOENT' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('resolves both paths relative to the worktree', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'fdy-rename-'));
    try {
      const io = makeIO(dir);
      writeFileSync(path.join(dir, 'a.txt'), 'x', 'utf-8');
      io.rename('a.txt', 'b.txt');
      assert.equal(readFileSync(path.join(dir, 'b.txt'), 'utf-8'), 'x');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
