// tests/lib/ulid.test.js
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ulid, createUlidGenerator, decodeUlidTime } from '../../src/scripts/lib/ulid.js';

describe('ulid', () => {
  test('returns a 26-character string', () => {
    const id = ulid();
    assert.equal(typeof id, 'string');
    assert.equal(id.length, 26);
  });

  test('uses Crockford base32 alphabet', () => {
    // Crockford base32: 0123456789ABCDEFGHJKMNPQRSTVWXYZ (no I L O U)
    const id = ulid();
    assert.match(id, /^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  test('is monotonic when called repeatedly from a fresh generator', () => {
    // Use a fresh generator so this test does not interact with state
    // accumulated by the shared default `ulid` instance in other tests.
    const gen = createUlidGenerator();
    const ids = [];
    for (let i = 0; i < 50; i++) ids.push(gen());
    const sorted = [...ids].sort();
    assert.deepEqual(ids, sorted, 'ids should be monotonically sorted');
  });

  test('produces unique ids across rapid calls', () => {
    const gen = createUlidGenerator();
    const set = new Set();
    for (let i = 0; i < 1000; i++) set.add(gen());
    assert.equal(set.size, 1000);
  });

  test('accepts a custom timestamp for deterministic testing', () => {
    const gen = createUlidGenerator();
    const id = gen(1700000000000);
    // First 10 chars = timestamp component; should match across calls with same ts.
    const id2 = gen(1700000000000);
    assert.equal(id.slice(0, 10), id2.slice(0, 10));
  });

  test('decodeUlidTime round-trips with ulid(now)', () => {
    const gen = createUlidGenerator();
    for (const t of [0, 1, 1000, 1700000000000]) {
      const id = gen(t);
      assert.equal(decodeUlidTime(id), t);
    }
  });

  test('decodeUlidTime throws on invalid character', () => {
    // 'I' is not in the Crockford alphabet.
    assert.throws(() => decodeUlidTime('IIIIIIIIIIXXXXXXXXXXXXXXXX'), /invalid Crockford/);
  });

  test('createUlidGenerator instances are independent (no shared state)', () => {
    const genA = createUlidGenerator();
    const genB = createUlidGenerator();
    // Same timestamp to both; different generators should still produce valid
    // 26-char IDs without monotonicity contaminating each other.
    const a = genA(1700000000000);
    const b = genB(1700000000000);
    assert.equal(a.length, 26);
    assert.equal(b.length, 26);
    assert.equal(a.slice(0, 10), b.slice(0, 10), 'timestamp prefix matches');
  });
});
