import test from 'node:test';
import assert from 'node:assert/strict';
import { requireGitRepo, requireFoundryRoot } from '../../scripts/lib/foundational-guards.js';

function ioWith(paths) {
  return { exists: (p) => paths.has(p) };
}

test('requireGitRepo: ok when .git exists', () => {
  assert.deepEqual(requireGitRepo(ioWith(new Set(['.git']))), { ok: true });
});

test('requireGitRepo: fails when .git missing', () => {
  const r = requireGitRepo(ioWith(new Set()));
  assert.equal(r.ok, false);
  assert.match(r.error, /not a git repository/);
});

test('requireFoundryRoot: ok when foundry/ exists', () => {
  assert.deepEqual(requireFoundryRoot(ioWith(new Set(['foundry/']))), { ok: true });
});

test('requireFoundryRoot: fails when foundry/ missing, names init-foundry', () => {
  const r = requireFoundryRoot(ioWith(new Set()));
  assert.equal(r.ok, false);
  assert.match(r.error, /init-foundry/);
});
