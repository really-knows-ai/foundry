import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  unlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ensureFoundryDir,
  readActiveStage,
  writeActiveStage,
  clearActiveStage,
  readLastStage,
  writeLastStage,
} from '../../scripts/lib/state.js';

function makeRealIO(dir) {
  const r = (p) => join(dir, p);
  return {
    exists: (p) => existsSync(r(p)),
    readFile: (p) => readFileSync(r(p), 'utf-8'),
    writeFile: (p, c) => {
      mkdirSync(join(dir, p, '..'), { recursive: true });
      writeFileSync(r(p), c, 'utf-8');
    },
    readDir: (p) => readdirSync(r(p)),
    mkdir: (p) => mkdirSync(r(p), { recursive: true }),
    unlink: (p) => { if (existsSync(r(p))) unlinkSync(r(p)); },
  };
}

describe('state.js', () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'foundry-state-')); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('ensureFoundryDir is idempotent', () => {
    const io = makeRealIO(dir);
    ensureFoundryDir(io);
    ensureFoundryDir(io);
    assert.ok(io.exists('.foundry'));
  });

  it('readActiveStage returns null when absent', () => {
    const io = makeRealIO(dir);
    assert.equal(readActiveStage(io), null);
  });

  it('writeActiveStage then readActiveStage round-trips', () => {
    const io = makeRealIO(dir);
    const payload = { cycle: 'c', stage: 'forge:c', tokenHash: 'abc', baseSha: 'deadbeef', startedAt: '2026-04-19T00:00:00Z' };
    writeActiveStage(io, payload);
    assert.deepEqual(readActiveStage(io), payload);
  });

  it('clearActiveStage makes readActiveStage null', () => {
    const io = makeRealIO(dir);
    writeActiveStage(io, { cycle: 'c', stage: 's', tokenHash: 't', baseSha: 'b', startedAt: 'x' });
    clearActiveStage(io);
    assert.equal(readActiveStage(io), null);
  });

  it('last-stage round-trip independent of active-stage', () => {
    const io = makeRealIO(dir);
    writeLastStage(io, { cycle: 'c', stage: 'forge:c', baseSha: 'bb' });
    assert.equal(readLastStage(io).baseSha, 'bb');
  });
});
