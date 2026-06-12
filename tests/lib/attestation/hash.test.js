import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sha256Buffer, hashAttestation, generateRunId } from '../../../src/scripts/lib/attestation/hash.js';

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

describe('hashAttestation', () => {
  it('returns a 64-character hex string for any object', () => {
    const result = hashAttestation({ a: 1 });
    assert.equal(typeof result, 'string');
    assert.equal(result.length, 64);
    assert.match(result, /^[0-9a-f]{64}$/);
  });

  it('is deterministic — same input produces the same hash', () => {
    const obj = { a: 1, b: 2 };
    assert.equal(hashAttestation(obj), hashAttestation(obj));
  });

  it('produces different hashes for different inputs', () => {
    assert.notEqual(hashAttestation({ a: 1 }), hashAttestation({ a: 2 }));
  });

  it('is independent of key ordering (canonical sort)', () => {
    assert.equal(
      hashAttestation({ b: 2, a: 1 }),
      hashAttestation({ a: 1, b: 2 })
    );
  });

  it('produces a known hash for empty object', () => {
    // SHA-256 of canonical JSON '{}'
    assert.equal(hashAttestation({}), '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a');
  });

  it('does not mutate the input object', () => {
    const obj = { z: 1, a: 2 };
    const copy = { z: 1, a: 2 };
    hashAttestation(obj);
    assert.deepEqual(obj, copy);
  });

  it('throws on circular references', () => {
    const obj = { a: 1 };
    obj.self = obj;
    assert.throws(() => hashAttestation(obj), { name: 'TypeError' });
  });

  it('throws on BigInt values', () => {
    assert.throws(() => hashAttestation({ x: 1n }), { name: 'TypeError' });
  });

  it('strips _hash field before computing hash', () => {
    assert.equal(
      hashAttestation({ a: 1, _hash: 'bogus' }),
      hashAttestation({ a: 1 })
    );
  });

  it('throws on non-object input', () => {
    assert.throws(() => hashAttestation(null), { name: 'TypeError' });
    assert.throws(() => hashAttestation('string'), { name: 'TypeError' });
    assert.throws(() => hashAttestation(42), { name: 'TypeError' });
    assert.throws(() => hashAttestation([1, 2, 3]), { name: 'TypeError' });
  });
});

describe('generateRunId', () => {
  it('returns a 26-character string', () => {
    const id = generateRunId();
    assert.equal(typeof id, 'string');
    assert.equal(id.length, 26);
  });

  it('uses Crockford base32 alphabet (uppercase, no I L O U)', () => {
    const id = generateRunId();
    assert.match(id, /^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it('produces unique values across successive calls', () => {
    const ids = new Set();
    for (let i = 0; i < 100; i++) ids.add(generateRunId());
    assert.equal(ids.size, 100);
  });

  it('produces time-sortable values (each successive ID is lexicographically greater than the last)', () => {
    const ids = [];
    for (let i = 0; i < 10; i++) ids.push(generateRunId());
    const sorted = [...ids].sort();
    assert.deepEqual(ids, sorted);
  });
});
