// Phase 3, Task 3.3: foundry_git_finish dispatch on config/* and dry-run/*/*.
// The work/* path is exercised in tests/plugin/git-tools.test.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FoundryPlugin } from '../../.opencode/plugins/foundry.js';

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t',
  GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
};

function makeCtx(worktree) { return { worktree }; }

function initRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'foundry-git-finish-'));
  execSync('git init -q', { cwd: dir, env: GIT_ENV });
  execSync('git checkout -B main -q', { cwd: dir, env: GIT_ENV });
  writeFileSync(join(dir, 'README.md'), 'baseline\n');
  execSync('git add . && git commit -m init -q', { cwd: dir, env: GIT_ENV });
  return dir;
}

function cleanup(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

async function callFinish(dir, args) {
  const plugin = await FoundryPlugin({ directory: dir });
  return JSON.parse(await plugin.tool.foundry_git_finish.execute(args, makeCtx(dir)));
}

test('foundry_git_finish on config/foo: squash-merges to main and deletes branch', async () => {
  const dir = initRepo();
  try {
    execSync('git checkout -b config/add-rule -q', { cwd: dir, env: GIT_ENV });
    writeFileSync(join(dir, 'rules.md'), '# rules\n');
    execSync('git add . && git commit -m "config: add rule" -q', { cwd: dir, env: GIT_ENV });

    // Preview without confirm.
    const preview = await callFinish(dir, { message: 'add rule' });
    assert.equal(preview.ok, false);
    assert.match(preview.error, /requires \{confirm: true\}/);
    assert.equal(preview.planned.workBranch, 'config/add-rule');

    // Apply.
    const r = await callFinish(dir, { message: 'add rule', confirm: true });
    assert.equal(r.ok, true, r.error);
    assert.equal(r.branch, 'main');
    assert.ok(r.hash);

    const branches = execSync('git branch', { cwd: dir, env: GIT_ENV }).toString();
    assert.ok(!branches.includes('config/add-rule'),
      `expected config branch deleted, got: ${branches}`);

    const log = execSync('git log -1 --pretty=%s main', { cwd: dir, env: GIT_ENV }).toString().trim();
    assert.match(log, /add rule/);

    // The rule file should be on main.
    assert.equal(existsSync(join(dir, 'rules.md')), true);
  } finally {
    cleanup(dir);
  }
});

test('foundry_git_finish on config/foo: refuses dirty tree even with confirm', async () => {
  const dir = initRepo();
  try {
    execSync('git checkout -b config/x -q', { cwd: dir, env: GIT_ENV });
    writeFileSync(join(dir, 'rules.md'), '# r\n');
    execSync('git add . && git commit -m "config: add r" -q', { cwd: dir, env: GIT_ENV });
    // Dirty a tracked file.
    writeFileSync(join(dir, 'rules.md'), '# r\nmore\n');

    const r = await callFinish(dir, { message: 'x', confirm: true });
    assert.equal(r.ok, false);
    assert.match(r.error, /dirty|uncommitted/i);
    // Branch preserved.
    const branch = execSync('git branch --show-current', { cwd: dir, env: GIT_ENV }).toString().trim();
    assert.equal(branch, 'config/x');
  } finally {
    cleanup(dir);
  }
});

test('foundry_git_finish on dry-run/foo/bar-baz: stubbed (Phase 5)', async () => {
  const dir = initRepo();
  try {
    execSync('git checkout -b config/foo -q', { cwd: dir, env: GIT_ENV });
    execSync('git commit --allow-empty -m noop -q', { cwd: dir, env: GIT_ENV });
    execSync('git checkout -b dry-run/foo/bar-baz -q', { cwd: dir, env: GIT_ENV });

    const r = await callFinish(dir, { message: 'try', confirm: true });
    assert.equal(r.ok, false);
    assert.match(r.error, /dry-run finish not yet implemented/);
  } finally {
    cleanup(dir);
  }
});

test('foundry_git_finish on dry-run/foo/bar-baz: rejects baseBranch', async () => {
  const dir = initRepo();
  try {
    execSync('git checkout -b config/foo -q', { cwd: dir, env: GIT_ENV });
    execSync('git commit --allow-empty -m noop -q', { cwd: dir, env: GIT_ENV });
    execSync('git checkout -b dry-run/foo/bar-baz -q', { cwd: dir, env: GIT_ENV });

    const r = await callFinish(dir, { message: 'try', baseBranch: 'main', confirm: true });
    assert.equal(r.ok, undefined);
    assert.match(r.error, /baseBranch is not valid for a dry-run finish/);
  } finally {
    cleanup(dir);
  }
});

test('foundry_git_finish on a feature branch (not config/work/dry-run): refused', async () => {
  const dir = initRepo();
  try {
    execSync('git checkout -b feature/random -q', { cwd: dir, env: GIT_ENV });
    execSync('git commit --allow-empty -m noop -q', { cwd: dir, env: GIT_ENV });

    const r = await callFinish(dir, { message: 'x', confirm: true });
    assert.equal(r.ok, undefined);
    assert.match(r.error, /nothing to finish/);
  } finally {
    cleanup(dir);
  }
});

test('foundry_git_finish on config/foo: squash-merge conflict preserves branch', async () => {
  const dir = initRepo();
  try {
    // Create conflicting change on main.
    writeFileSync(join(dir, 'shared.txt'), 'main version\n');
    execSync('git add . && git commit -m main-change -q', { cwd: dir, env: GIT_ENV });
    // Branch from earlier and add a conflicting change.
    execSync('git checkout -b config/x HEAD~1 -q', { cwd: dir, env: GIT_ENV });
    writeFileSync(join(dir, 'shared.txt'), 'config version\n');
    execSync('git add . && git commit -m config-change -q', { cwd: dir, env: GIT_ENV });

    const r = await callFinish(dir, { message: 'finish config', confirm: true });
    assert.equal(r.ok, false);
    assert.match(r.error, /conflict|squash merge failed/i);

    const branches = execSync('git branch', { cwd: dir, env: GIT_ENV }).toString();
    assert.ok(branches.includes('config/x'),
      `expected config branch preserved, got: ${branches}`);
  } finally {
    cleanup(dir);
  }
});
