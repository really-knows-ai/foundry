import test from 'node:test';
import assert from 'node:assert/strict';
import {
  currentBranch,
  requireOnConfigBranch,
  requireOnFlowBranch,
  requireOnConfigOrFlowBranch,
} from '../../scripts/lib/branch-guard.js';

function ioWithBranch(name) {
  return {
    exec: (argv) => {
      // Only mock `git rev-parse --abbrev-ref HEAD`.
      if (argv.join(' ') === 'git rev-parse --abbrev-ref HEAD') {
        return name === null ? 'HEAD\n' : `${name}\n`;
      }
      throw new Error('unexpected git call: ' + argv.join(' '));
    },
  };
}

test('currentBranch: returns trimmed branch name', () => {
  assert.equal(currentBranch(ioWithBranch('config/foo')), 'config/foo');
});

test('currentBranch: detached HEAD → null', () => {
  assert.equal(currentBranch(ioWithBranch(null)), null);
});

test('requireOnConfigBranch: matches config/foo', () => {
  assert.deepEqual(
    requireOnConfigBranch(ioWithBranch('config/foo')),
    { ok: true },
  );
});

test('requireOnConfigBranch: rejects dry-run/foo/bar (strict)', () => {
  const r = requireOnConfigBranch(ioWithBranch('dry-run/foo/bar'));
  assert.equal(r.ok, false);
  assert.match(r.error, /requires a config\/.* branch/);
  assert.match(r.error, /currently on 'dry-run\/foo\/bar'/);
});

for (const bad of ['main', 'work/x-y', 'feature/x', 'HEAD']) {
  test(`requireOnConfigBranch: rejects '${bad}'`, () => {
    const r = bad === 'HEAD'
      ? requireOnConfigBranch(ioWithBranch(null))
      : requireOnConfigBranch(ioWithBranch(bad));
    assert.equal(r.ok, false);
  });
}

test('requireOnFlowBranch: matches work/foo-bar', () => {
  assert.deepEqual(
    requireOnFlowBranch(ioWithBranch('work/foo-bar')),
    { ok: true },
  );
});

test('requireOnFlowBranch: matches dry-run/foo/bar-baz', () => {
  assert.deepEqual(
    requireOnFlowBranch(ioWithBranch('dry-run/foo/bar-baz')),
    { ok: true },
  );
});

test('requireOnFlowBranch: rejects deeper nesting', () => {
  const r = requireOnFlowBranch(
    ioWithBranch('dry-run/foo/bar/baz')
  );
  assert.equal(r.ok, false);
});

test('requireOnFlowBranch: rejects config/foo', () => {
  const r = requireOnFlowBranch(ioWithBranch('config/foo'));
  assert.equal(r.ok, false);
});

test('requireOnConfigOrFlowBranch: matches both config/foo and work/foo', () => {
  assert.deepEqual(
    requireOnConfigOrFlowBranch(ioWithBranch('config/foo')),
    { ok: true },
  );
  assert.deepEqual(
    requireOnConfigOrFlowBranch(ioWithBranch('work/foo-bar')),
    { ok: true },
  );
});
