// scripts/lib/ulid.js
import { randomBytes } from 'node:crypto';

// Crockford's base32 alphabet (excludes I, L, O, U).
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

// ULID spec: 10 chars of timestamp (48-bit ms since epoch) + 16 chars of randomness (80 bits).
// We make the randomness monotonic within the same millisecond by incrementing the previous
// random component by 1 whenever the timestamp hasn't advanced.

function encodeTime(ms) {
  let out = '';
  let remaining = ms;
  for (let i = 9; i >= 0; i--) {
    out = ALPHABET[remaining % 32] + out;
    remaining = Math.floor(remaining / 32);
  }
  return out;
}

function randomIndexes() {
  const bytes = randomBytes(10); // 80 bits
  const out = new Array(16);
  // Pack 80 bits into 16 5-bit groups.
  let bitBuffer = 0;
  let bits = 0;
  let j = 0;
  for (let i = 0; i < bytes.length; i++) {
    bitBuffer = bitBuffer * 256 + bytes[i];
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out[j++] = Math.floor(bitBuffer / Math.pow(2, bits)) % 32;
    }
  }
  return out;
}

function incrementRandom(arr) {
  // Increment as a base-32 little-endian-ish counter from the right.
  const next = arr.slice();
  for (let i = next.length - 1; i >= 0; i--) {
    if (next[i] < 31) { next[i] += 1; return next; }
    next[i] = 0;
  }
  // Overflow across all 80 bits: re-seed. Extraordinarily unlikely.
  return randomIndexes();
}

/**
 * Creates an independent ULID generator with its own monotonicity state.
 *
 * Monotonicity state (lastTime, lastRandom) is kept in closure, not module
 * scope, so tests can instantiate isolated generators and production code
 * can import a single shared instance without cross-test contamination.
 *
 * @returns {(now?: number) => string} generator function
 */
export function createUlidGenerator() {
  let lastTime = 0;
  let lastRandom = null; // array of 16 base32 char indexes

  return function ulid(now = Date.now()) {
    let randArr;
    if (now === lastTime && lastRandom) {
      randArr = incrementRandom(lastRandom);
    } else {
      randArr = randomIndexes();
    }
    lastTime = now;
    lastRandom = randArr;
    const rand = randArr.map(i => ALPHABET[i]).join('');
    return encodeTime(now) + rand;
  };
}

// Default shared generator — preserves ergonomic `import { ulid }` usage.
// Tests that need deterministic, isolated state should call createUlidGenerator().
export const ulid = createUlidGenerator();

/**
 * Reverses encodeTime — first 10 chars of a ULID encode 48-bit ms since epoch.
 * Returns the integer ms. Throws if any of the first 10 chars is not in the
 * Crockford alphabet.
 *
 * @param {string} id ULID string (only first 10 chars are inspected).
 * @returns {number} milliseconds since epoch.
 */
export function decodeUlidTime(id) {
  let time = 0;
  for (let i = 0; i < 10; i++) {
    const ch = id[i];
    const idx = ALPHABET.indexOf(ch);
    if (idx === -1) {
      throw new Error(`decodeUlidTime: invalid Crockford base32 char '${ch}' at position ${i}`);
    }
    time = time * 32 + idx;
  }
  return time;
}
