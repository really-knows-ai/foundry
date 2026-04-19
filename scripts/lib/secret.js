import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

export function readOrCreateSecret(directory) {
  const dir = join(directory, '.foundry');
  const file = join(dir, '.secret');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  if (existsSync(file)) return readFileSync(file);
  const bytes = randomBytes(32);
  writeFileSync(file, bytes);
  chmodSync(file, 0o600);
  return bytes;
}
