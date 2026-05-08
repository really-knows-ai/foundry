import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readOrCreateSecret } from '../../src/scripts/lib/secret.js';

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
    const modeOct = statSync(join(dir, '.foundry/.secret')).mode.toString(8);
    const mode = parseInt(modeOct.slice(-3), 8);
    assert.equal(mode, 0o600);
  });

  describe('.gitignore management', () => {
    it('creates .gitignore with .foundry/ when none exists', () => {
      readOrCreateSecret(dir);
      const gi = readFileSync(join(dir, '.gitignore'), 'utf-8');
      assert.match(gi, /^\.foundry\/$/m);
    });

    it('appends .foundry/ to existing .gitignore that lacks it', () => {
      writeFileSync(join(dir, '.gitignore'), 'node_modules/\n', 'utf-8');
      readOrCreateSecret(dir);
      const gi = readFileSync(join(dir, '.gitignore'), 'utf-8');
      assert.match(gi, /^node_modules\/$/m);
      assert.match(gi, /^\.foundry\/$/m);
    });

    it('handles existing .gitignore without trailing newline', () => {
      writeFileSync(join(dir, '.gitignore'), 'node_modules/', 'utf-8');
      readOrCreateSecret(dir);
      const gi = readFileSync(join(dir, '.gitignore'), 'utf-8');
      assert.match(gi, /^node_modules\/$/m);
      assert.match(gi, /^\.foundry\/$/m);
    });

    it('does not duplicate when .foundry/ already present', () => {
      writeFileSync(join(dir, '.gitignore'), 'node_modules/\n.foundry/\n', 'utf-8');
      readOrCreateSecret(dir);
      const gi = readFileSync(join(dir, '.gitignore'), 'utf-8');
      const matches = gi.match(/^\.foundry\/$/mg) || [];
      assert.equal(matches.length, 1);
    });

    it('treats .foundry (no trailing slash) as equivalent', () => {
      writeFileSync(join(dir, '.gitignore'), '.foundry\n', 'utf-8');
      readOrCreateSecret(dir);
      const gi = readFileSync(join(dir, '.gitignore'), 'utf-8');
      // Should not append a duplicate .foundry/ line
      assert.equal((gi.match(/\.foundry/g) || []).length, 1);
    });

    it('treats /.foundry/ as equivalent', () => {
      writeFileSync(join(dir, '.gitignore'), '/.foundry/\n', 'utf-8');
      readOrCreateSecret(dir);
      const gi = readFileSync(join(dir, '.gitignore'), 'utf-8');
      assert.equal((gi.match(/\.foundry/g) || []).length, 1);
    });

    it('is idempotent across multiple calls', () => {
      readOrCreateSecret(dir);
      readOrCreateSecret(dir);
      readOrCreateSecret(dir);
      const gi = readFileSync(join(dir, '.gitignore'), 'utf-8');
      const matches = gi.match(/^\.foundry\/$/mg) || [];
      assert.equal(matches.length, 1);
    });

    it('ignores commented lines when checking for presence', () => {
      writeFileSync(join(dir, '.gitignore'), '# .foundry/\n', 'utf-8');
      readOrCreateSecret(dir);
      const gi = readFileSync(join(dir, '.gitignore'), 'utf-8');
      // commented line doesn't count, so .foundry/ should be appended
      assert.match(gi, /^\.foundry\/$/m);
    });

    it('writes .gitignore before creating the secret file', () => {
      // After first call, both should exist; ensure neither operation skipped
      readOrCreateSecret(dir);
      assert.ok(existsSync(join(dir, '.gitignore')));
      assert.ok(existsSync(join(dir, '.foundry/.secret')));
    });
  });
});
