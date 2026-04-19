import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readOrCreateSecret } from '../../scripts/lib/secret.js';

describe('secret.js', () => {
  let dir;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'foundry-secret-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates a 32-byte secret on first call', () => {
    const s = readOrCreateSecret(dir);
    assert.equal(s.length, 32);
  });

  it('is idempotent — second call returns same bytes', () => {
    const a = readOrCreateSecret(dir);
    const b = readOrCreateSecret(dir);
    assert.deepEqual(a, b);
  });

  it('file is mode 0600', () => {
    readOrCreateSecret(dir);
    const mode = statSync(join(dir, '.foundry/.secret')).mode & 0o777;
    assert.equal(mode, 0o600);
  });
});
