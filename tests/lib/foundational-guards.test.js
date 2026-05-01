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

test('requireFoundryRoot: ok when foundry exists', () => {
  // Probe path mirrors requireGitRepo's '.git' (no trailing slash).
  assert.deepEqual(requireFoundryRoot(ioWith(new Set(['foundry']))), { ok: true });
});

test('requireFoundryRoot: fails when foundry missing, names init-foundry', () => {
  const r = requireFoundryRoot(ioWith(new Set()));
  assert.equal(r.ok, false);
  assert.match(r.error, /init-foundry/);
});

test('requireFoundryRoot: probe path matches requireGitRepo style (no trailing slash)', () => {
  // Trailing-slash form must NOT be the probe key — pairs the trailing-slash
  // inconsistency from REVIEW.md C3.
  const r = requireFoundryRoot(ioWith(new Set(['foundry/'])));
  assert.equal(r.ok, false,
    'foundry/ (with slash) must not satisfy the probe — only foundry does');
});
