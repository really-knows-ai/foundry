import { existsSync, readFileSync, mkdirSync, openSync, writeSync, closeSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

export function readOrCreateSecret(directory) {
  const dir = join(directory, '.foundry');
  const file = join(dir, '.secret');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const bytes = randomBytes(32);
  let fd;
  try {
    fd = openSync(file, 'wx', 0o600);
  } catch (err) {
    if (err.code === 'EEXIST') return readFileSync(file);
    throw err;
  }
  try {
    writeSync(fd, bytes);
  } finally {
    closeSync(fd);
  }
  return bytes;
}
