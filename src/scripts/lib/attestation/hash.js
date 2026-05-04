import { createHash } from 'node:crypto';

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
