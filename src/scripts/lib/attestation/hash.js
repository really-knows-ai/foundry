import { createHash } from 'node:crypto';
import { canonicalJson } from './canonical-json.js';
import { ulid } from '../ulid.js';

export function sha256Text(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function sha256Buffer(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

export function sortPaths(paths) {
  return [...paths].sort((a, b) => {
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  });
}

export function hashAttestation(obj) {
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
    throw new TypeError('hashAttestation expects a plain object');
  }
  const copy = { ...obj };
  delete copy._hash;
  return sha256Text(canonicalJson(copy));
}

export function generateRunId() {
  return ulid();
}
