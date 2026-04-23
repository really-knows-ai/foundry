import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnWithTimeout } from '../../../scripts/lib/assay/spawn-with-timeout.js';

function scriptDir() {
  return mkdtempSync(join(tmpdir(), 'swt-'));
}

function writeScript(dir, name, body) {
  const p = join(dir, name);
  writeFileSync(p, body);
  chmodSync(p, 0o755);
  return p;
}

describe('spawnWithTimeout', () => {
  it('captures stdout on zero-exit success', async () => {
    const d = scriptDir();
    const p = writeScript(d, 'hi.sh', '#!/bin/sh\necho hello\n');
    const r = await spawnWithTimeout({ command: p, cwd: d, timeoutMs: 5000 });
    assert.equal(r.ok, true);
    assert.equal(r.exitCode, 0);
    assert.equal(r.timedOut, false);
    assert.match(r.stdout, /hello/);
    rmSync(d, { recursive: true, force: true });
  });

  it('captures stderr and reports non-zero exit', async () => {
    const d = scriptDir();
    const p = writeScript(d, 'err.sh', '#!/bin/sh\necho oops >&2\nexit 7\n');
    const r = await spawnWithTimeout({ command: p, cwd: d, timeoutMs: 5000 });
    assert.equal(r.ok, false);
    assert.equal(r.exitCode, 7);
    assert.equal(r.timedOut, false);
    assert.match(r.stderr, /oops/);
    rmSync(d, { recursive: true, force: true });
  });

  it('kills a process that exceeds the timeout', async () => {
    const d = scriptDir();
    const p = writeScript(d, 'sleep.sh', '#!/bin/sh\nsleep 10\n');
    const start = Date.now();
    const r = await spawnWithTimeout({ command: p, cwd: d, timeoutMs: 150 });
    const elapsed = Date.now() - start;
    assert.equal(r.ok, false);
    assert.equal(r.timedOut, true);
    assert.ok(elapsed < 3000, `took too long: ${elapsed}ms`);
    rmSync(d, { recursive: true, force: true });
  });

  it('accepts shell syntax in the command string', async () => {
    const d = scriptDir();
    const r = await spawnWithTimeout({ command: 'echo one && echo two', cwd: d, timeoutMs: 5000 });
    assert.equal(r.ok, true);
    assert.match(r.stdout, /one/);
    assert.match(r.stdout, /two/);
    rmSync(d, { recursive: true, force: true });
  });
});
