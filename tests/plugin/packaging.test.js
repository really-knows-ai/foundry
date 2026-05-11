import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function readJSON(filename) {
  const raw = readFileSync(join(REPO_ROOT, filename), 'utf8');
  return JSON.parse(raw);
}

test('package.json files includes dist/agents/', () => {
  const pkg = readJSON('package.json');
  assert.ok(
    pkg.files && Array.isArray(pkg.files),
    'package.json must have a files array'
  );
  assert.ok(
    pkg.files.includes('dist/agents/'),
    'package.json files must include dist/agents/ to ship the guide agent template'
  );
});

test('build produces dist/agents/foundry.md', () => {
  let found;
  try {
    readFileSync(join(REPO_ROOT, 'dist', 'agents', 'foundry.md'), 'utf8');
    found = true;
  } catch {
    found = false;
  }
  assert.ok(found, 'dist/agents/foundry.md must exist after build — run pnpm run build first');
});
