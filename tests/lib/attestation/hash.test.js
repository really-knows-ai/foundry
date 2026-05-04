import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sha256Buffer } from '../../../src/scripts/lib/attestation/hash.js';

describe('sha256Buffer', () => {
  it('returns a 64-char lowercase hex string for a Buffer', () => {
    const buf = Buffer.from('hello world', 'utf8');
    const result = sha256Buffer(buf);
    assert.equal(typeof result, 'string');
    assert.equal(result.length, 64);
    assert.match(result, /^[0-9a-f]{64}$/);
  });

  it('returns the same hash for identical content', () => {
    const buf1 = Buffer.from('abc', 'utf8');
    const buf2 = Buffer.from('abc', 'utf8');
    assert.equal(sha256Buffer(buf1), sha256Buffer(buf2));
  });

  it('returns different hashes for different content', () => {
    const buf1 = Buffer.from('abc', 'utf8');
    const buf2 = Buffer.from('xyz', 'utf8');
    assert.notEqual(sha256Buffer(buf1), sha256Buffer(buf2));
  });

  it('accepts an empty buffer', () => {
    const result = sha256Buffer(Buffer.alloc(0));
    // SHA-256 of empty input is known
    assert.equal(result, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
});
