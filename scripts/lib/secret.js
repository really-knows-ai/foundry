import { existsSync, readFileSync, writeFileSync, mkdirSync, openSync, writeSync, closeSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

// Lines that are considered equivalent to a `.foundry/` ignore rule.
// Git treats `.foundry` and `.foundry/` slightly differently (the former matches
// files too), but for our purpose any of these means the user is already
// ignoring the runtime directory.
const FOUNDRY_GITIGNORE_VARIANTS = new Set([
  '.foundry',
  '.foundry/',
  '/.foundry',
  '/.foundry/',
]);

/**
 * Idempotently ensure `.foundry/` is listed in the project's `.gitignore`.
 * Creates the file if absent. Comments (`#`-prefixed lines) are ignored when
 * checking for an existing entry.
 *
 * @param {string} directory  Project root.
 * @returns {boolean}  true if a line was appended, false if no change.
 */
export function ensureFoundryGitignored(directory) {
  const path = join(directory, '.gitignore');
  const exists = existsSync(path);
  const current = exists ? readFileSync(path, 'utf-8') : '';
  const present = current
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));
  if (present.some((l) => FOUNDRY_GITIGNORE_VARIANTS.has(l))) return false;
  const tail = current.length === 0 || current.endsWith('\n') ? '' : '\n';
  writeFileSync(path, current + tail + '.foundry/\n', 'utf-8');
  return true;
}

export function readOrCreateSecret(directory) {
  const dir = join(directory, '.foundry');
  const file = join(dir, '.secret');
  // Ensure `.gitignore` lists `.foundry/` *before* the secret hits disk so the
  // stage-token key is never momentarily visible as an untracked file.
  ensureFoundryGitignored(directory);
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
