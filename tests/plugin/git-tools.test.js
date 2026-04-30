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
  const dir = mkdtempSync(join(tmpdir(), 'foundry-git-'));
  execSync('git init -q', { cwd: dir, env: GIT_ENV });
  execSync('git checkout -B main -q', { cwd: dir, env: GIT_ENV });
  writeFileSync(join(dir, 'README.md'), 'baseline\n');
  execSync('git add . && git commit -m init -q', { cwd: dir, env: GIT_ENV });
  return dir;
}

function cleanup(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

test('foundry_git_finish removes WORK.feedback.yaml from the worktree', async () => {
  const dir = initRepo();
  const envSnapshot = {
    GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME,
    GIT_AUTHOR_EMAIL: process.env.GIT_AUTHOR_EMAIL,
    GIT_COMMITTER_NAME: process.env.GIT_COMMITTER_NAME,
    GIT_COMMITTER_EMAIL: process.env.GIT_COMMITTER_EMAIL,
  };
  try {
    Object.assign(process.env, {
      GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t',
      GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
    });
    execSync('git checkout -b work/f-flow -q', { cwd: dir, env: GIT_ENV });
    writeFileSync(join(dir, 'WORK.md'), '# Goal\n\ntest\n');
    writeFileSync(join(dir, 'WORK.history.yaml'), '[]\n');
    writeFileSync(join(dir, 'WORK.feedback.yaml'), 'items: []\n');
    execSync('git add . && git commit -m workfiles -q', { cwd: dir, env: GIT_ENV });

    const plugin = await FoundryPlugin({ directory: dir });
    const res = JSON.parse(await plugin.tool.foundry_git_finish.execute(
      { message: 'finish flow', confirm: true }, makeCtx(dir),
    ));

    assert.equal(res.ok, true, res.error);
    assert.equal(existsSync(join(dir, 'WORK.md')), false);
    assert.equal(existsSync(join(dir, 'WORK.history.yaml')), false);
    assert.equal(existsSync(join(dir, 'WORK.feedback.yaml')), false);
  } finally {
    for (const [k, v] of Object.entries(envSnapshot)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    cleanup(dir);
  }
});

test('foundry_git_finish without confirm returns planned side effects without acting', async () => {
  const dir = initRepo();
  try {
    execSync('git checkout -b work/f-flow -q', { cwd: dir, env: GIT_ENV });
    writeFileSync(join(dir, 'WORK.md'), '# Goal\n');
    writeFileSync(join(dir, 'WORK.history.yaml'), '[]\n');
    execSync('git add . && git commit -m workfiles -q', { cwd: dir, env: GIT_ENV });

    const plugin = await FoundryPlugin({ directory: dir });
    const res = JSON.parse(await plugin.tool.foundry_git_finish.execute(
      { message: 'finish flow' }, makeCtx(dir),
    ));

    assert.equal(res.ok, false);
    assert.ok(res.planned, 'expected planned object');
    assert.equal(res.planned.workBranch, 'work/f-flow');
    assert.equal(res.planned.baseBranch, 'main');
    assert.ok(Array.isArray(res.planned.filesToDelete));
    assert.ok(res.planned.filesToDelete.includes('WORK.md'));
    assert.ok(res.planned.filesToDelete.includes('WORK.history.yaml'));
    // Side effects should NOT have happened.
    assert.equal(existsSync(join(dir, 'WORK.md')), true);
    const branch = execSync('git branch --show-current', { cwd: dir, env: GIT_ENV }).toString().trim();
    assert.equal(branch, 'work/f-flow');
  } finally {
    cleanup(dir);
  }
});

test('foundry_git_finish with confirm:false also returns planned without acting', async () => {
  const dir = initRepo();
  try {
    execSync('git checkout -b work/f-flow -q', { cwd: dir, env: GIT_ENV });
    writeFileSync(join(dir, 'WORK.md'), '# Goal\n');
    execSync('git add . && git commit -m workfiles -q', { cwd: dir, env: GIT_ENV });

    const plugin = await FoundryPlugin({ directory: dir });
    const res = JSON.parse(await plugin.tool.foundry_git_finish.execute(
      { message: 'finish flow', confirm: false }, makeCtx(dir),
    ));

    assert.equal(res.ok, false);
    assert.ok(res.planned);
    const branch = execSync('git branch --show-current', { cwd: dir, env: GIT_ENV }).toString().trim();
    assert.equal(branch, 'work/f-flow');
  } finally {
    cleanup(dir);
  }
});

test('foundry_git_finish refuses dirty worktree even with confirm:true', async () => {
  const dir = initRepo();
  try {
    execSync('git checkout -b work/f-flow -q', { cwd: dir, env: GIT_ENV });
    writeFileSync(join(dir, 'WORK.md'), '# Goal\n');
    execSync('git add . && git commit -m workfiles -q', { cwd: dir, env: GIT_ENV });
    // Modify a tracked file without committing.
    writeFileSync(join(dir, 'README.md'), 'modified baseline\n');

    const plugin = await FoundryPlugin({ directory: dir });
    const res = JSON.parse(await plugin.tool.foundry_git_finish.execute(
      { message: 'finish flow', confirm: true }, makeCtx(dir),
    ));

    assert.ok(res.error, 'expected error for dirty worktree');
    assert.match(res.error, /dirty|uncommitted/i);
    // Branch should still be the work branch.
    const branch = execSync('git branch --show-current', { cwd: dir, env: GIT_ENV }).toString().trim();
    assert.equal(branch, 'work/f-flow');
    // README modification should be preserved (not reverted).
    assert.match(execSync('cat README.md', { cwd: dir }).toString(), /modified/);
  } finally {
    cleanup(dir);
  }
});

test('foundry_git_finish on base branch is a graceful no-op', async () => {
  const dir = initRepo();
  try {
    // Already on main from initRepo.
    const plugin = await FoundryPlugin({ directory: dir });
    const res = JSON.parse(await plugin.tool.foundry_git_finish.execute(
      { message: 'finish flow', confirm: true }, makeCtx(dir),
    ));

    // Should not error; just indicate nothing to do.
    assert.equal(res.ok, true, `expected ok, got ${JSON.stringify(res)}`);
    assert.equal(res.noop, true);
  } finally {
    cleanup(dir);
  }
});

test('foundry_git_finish aborts on merge conflict and preserves work branch', async () => {
  const dir = initRepo();
  try {
    // Create conflicting change on main.
    writeFileSync(join(dir, 'conflict.txt'), 'main version\n');
    execSync('git add . && git commit -m main-change -q', { cwd: dir, env: GIT_ENV });
    // Branch off an earlier commit and add conflicting content.
    execSync('git checkout -b work/f-flow HEAD~1 -q', { cwd: dir, env: GIT_ENV });
    writeFileSync(join(dir, 'conflict.txt'), 'work version\n');
    execSync('git add . && git commit -m work-change -q', { cwd: dir, env: GIT_ENV });

    const plugin = await FoundryPlugin({ directory: dir });
    const res = JSON.parse(await plugin.tool.foundry_git_finish.execute(
      { message: 'finish flow', confirm: true }, makeCtx(dir),
    ));

    assert.ok(res.error, 'expected error for merge conflict');
    // Work branch must still exist (not force-deleted).
    const branches = execSync('git branch', { cwd: dir, env: GIT_ENV }).toString();
    assert.ok(branches.includes('work/f-flow'), `expected work branch to remain, got: ${branches}`);
  } finally {
    cleanup(dir);
  }
});

test('foundry_git_finish successful path returns ok with hash and base branch', async () => {
  const dir = initRepo();
  try {
    execSync('git checkout -b work/f-flow -q', { cwd: dir, env: GIT_ENV });
    writeFileSync(join(dir, 'feature.txt'), 'feature work\n');
    writeFileSync(join(dir, 'WORK.md'), '# Goal\n');
    execSync('git add . && git commit -m work -q', { cwd: dir, env: GIT_ENV });

    const plugin = await FoundryPlugin({ directory: dir });
    const res = JSON.parse(await plugin.tool.foundry_git_finish.execute(
      { message: 'finish flow', confirm: true }, makeCtx(dir),
    ));

    assert.equal(res.ok, true, res.error);
    assert.ok(res.hash);
    assert.equal(res.branch, 'main');
    // Work branch should be deleted.
    const branches = execSync('git branch', { cwd: dir, env: GIT_ENV }).toString();
    assert.ok(!branches.includes('work/f-flow'), `expected work branch deleted, got: ${branches}`);
    // Feature should be merged.
    assert.equal(existsSync(join(dir, 'feature.txt')), true);
    assert.equal(existsSync(join(dir, 'WORK.md')), false);
  } finally {
    cleanup(dir);
  }
});

test('foundry_git_branch returns wrapped error when branch already exists', async () => {
  const dir = initRepo();
  try {
    // Pre-create the branch we are about to ask for.
    execSync('git checkout -b work/myflow-some-desc -q', { cwd: dir, env: GIT_ENV });
    execSync('git checkout main -q', { cwd: dir, env: GIT_ENV });

    const plugin = await FoundryPlugin({ directory: dir });
    const res = JSON.parse(await plugin.tool.foundry_git_branch.execute(
      { kind: 'work', flowId: 'myflow', description: 'some desc' }, makeCtx(dir),
    ));

    assert.ok(res.error, `expected error JSON, got ${JSON.stringify(res)}`);
    assert.match(res.error, /foundry_git_branch/);
    assert.equal(res.ok, undefined);
    // Caller should remain on main; checkout should not have switched branches.
    const branch = execSync('git branch --show-current', { cwd: dir, env: GIT_ENV }).toString().trim();
    assert.equal(branch, 'main');
  } finally {
    cleanup(dir);
  }
});

test('foundry_git_branch returns ok and branch name on success', async () => {
  const dir = initRepo();
  try {
    const plugin = await FoundryPlugin({ directory: dir });
    const res = JSON.parse(await plugin.tool.foundry_git_branch.execute(
      { kind: 'work', flowId: 'myflow', description: 'fresh desc' }, makeCtx(dir),
    ));

    assert.equal(res.ok, true, res.error);
    assert.equal(res.branch, 'work/myflow-fresh-desc');
    const branch = execSync('git branch --show-current', { cwd: dir, env: GIT_ENV }).toString().trim();
    assert.equal(branch, 'work/myflow-fresh-desc');
  } finally {
    cleanup(dir);
  }
});

// ---------------------------------------------------------------------------
// Per-kind matrix (Phase 3, spec §8.1)
// ---------------------------------------------------------------------------

async function callBranch(dir, args) {
  const plugin = await FoundryPlugin({ directory: dir });
  return JSON.parse(await plugin.tool.foundry_git_branch.execute(args, makeCtx(dir)));
}

test('foundry_git_branch: missing kind is refused', async () => {
  const dir = initRepo();
  try {
    const r = await callBranch(dir, { description: 'x' });
    assert.ok(r.error);
    assert.match(r.error, /kind is required/);
  } finally { cleanup(dir); }
});

test('foundry_git_branch: unknown kind is refused', async () => {
  const dir = initRepo();
  try {
    const r = await callBranch(dir, { kind: 'bogus', description: 'x' });
    assert.match(r.error, /unknown kind/);
  } finally { cleanup(dir); }
});

test('foundry_git_branch: kind="config" with flowId is refused', async () => {
  const dir = initRepo();
  try {
    const r = await callBranch(dir, { kind: 'config', flowId: 'f', description: 'x' });
    assert.match(r.error, /flowId is not valid for kind="config"/);
  } finally { cleanup(dir); }
});

test('foundry_git_branch: kind="config" missing description is refused', async () => {
  const dir = initRepo();
  try {
    const r = await callBranch(dir, { kind: 'config' });
    assert.match(r.error, /description is required/);
  } finally { cleanup(dir); }
});

test('foundry_git_branch: kind="config" on main creates config/<slug>', async () => {
  const dir = initRepo();
  try {
    const r = await callBranch(dir, { kind: 'config', description: 'add law' });
    assert.equal(r.ok, true, r.error);
    assert.equal(r.branch, 'config/add-law');
    const branch = execSync('git branch --show-current', { cwd: dir, env: GIT_ENV }).toString().trim();
    assert.equal(branch, 'config/add-law');
  } finally { cleanup(dir); }
});

test('foundry_git_branch: kind="config" refused while on config/x', async () => {
  const dir = initRepo();
  try {
    execSync('git checkout -b config/foo -q', { cwd: dir, env: GIT_ENV });
    const r = await callBranch(dir, { kind: 'config', description: 'y' });
    assert.match(r.error, /already on a config\//);
  } finally { cleanup(dir); }
});

test('foundry_git_branch: kind="config" refused from a work branch', async () => {
  const dir = initRepo();
  try {
    execSync('git checkout -b work/f-x -q', { cwd: dir, env: GIT_ENV });
    const r = await callBranch(dir, { kind: 'config', description: 'y' });
    assert.match(r.error, /from a work branch/);
  } finally { cleanup(dir); }
});

test('foundry_git_branch: kind="work" missing flowId is refused', async () => {
  const dir = initRepo();
  try {
    const r = await callBranch(dir, { kind: 'work', description: 'x' });
    assert.match(r.error, /flowId is required for kind="work"/);
  } finally { cleanup(dir); }
});

test('foundry_git_branch: kind="work" missing description is refused', async () => {
  const dir = initRepo();
  try {
    const r = await callBranch(dir, { kind: 'work', flowId: 'f' });
    assert.match(r.error, /description is required for kind="work"/);
  } finally { cleanup(dir); }
});

test('foundry_git_branch: kind="work" refused while on config/x', async () => {
  const dir = initRepo();
  try {
    execSync('git checkout -b config/foo -q', { cwd: dir, env: GIT_ENV });
    const r = await callBranch(dir, { kind: 'work', flowId: 'f', description: 'g' });
    assert.match(r.error, /cannot start a work branch from a config branch/);
  } finally { cleanup(dir); }
});

test('foundry_git_branch: kind="work" refused while on work/x', async () => {
  const dir = initRepo();
  try {
    execSync('git checkout -b work/a-b -q', { cwd: dir, env: GIT_ENV });
    const r = await callBranch(dir, { kind: 'work', flowId: 'f', description: 'g' });
    assert.match(r.error, /already on a work branch/);
  } finally { cleanup(dir); }
});

test('foundry_git_branch: kind="dry-run" requires being on config/<x>', async () => {
  const dir = initRepo();
  try {
    const r = await callBranch(dir, { kind: 'dry-run', flowId: 'f', description: 'x' });
    assert.match(r.error, /requires a config\//);
  } finally { cleanup(dir); }
});

test('foundry_git_branch: kind="dry-run" refused on work branch', async () => {
  const dir = initRepo();
  try {
    execSync('git checkout -b work/f-x -q', { cwd: dir, env: GIT_ENV });
    const r = await callBranch(dir, { kind: 'dry-run', flowId: 'f', description: 'x' });
    assert.match(r.error, /requires a config\//);
  } finally { cleanup(dir); }
});

test('foundry_git_branch: kind="dry-run" on config/foo creates the flat sibling branch', async () => {
  const dir = initRepo();
  try {
    execSync('git checkout -b config/foo -q', { cwd: dir, env: GIT_ENV });
    const r = await callBranch(dir, {
      kind: 'dry-run', flowId: 'creative-flow', description: 'goal x',
    });
    assert.equal(r.ok, true, r.error);
    assert.equal(r.branch, 'dry-run/foo/creative-flow-goal-x');
    const branch = execSync('git branch --show-current', { cwd: dir, env: GIT_ENV }).toString().trim();
    assert.equal(branch, 'dry-run/foo/creative-flow-goal-x');
  } finally { cleanup(dir); }
});

test('foundry_git_branch: refuses any kind while on a dry-run branch', async () => {
  const dir = initRepo();
  try {
    execSync('git checkout -b config/foo -q', { cwd: dir, env: GIT_ENV });
    execSync('git checkout -b dry-run/foo/x-y -q', { cwd: dir, env: GIT_ENV });
    const r = await callBranch(dir, { kind: 'dry-run', flowId: 'f', description: 'z' });
    assert.match(r.error, /cannot nest deeper/);
  } finally { cleanup(dir); }
});

test('foundry_git_branch: refuses kind="config" while on a dry-run branch', async () => {
  const dir = initRepo();
  try {
    execSync('git checkout -b config/foo -q', { cwd: dir, env: GIT_ENV });
    execSync('git checkout -b dry-run/foo/x-y -q', { cwd: dir, env: GIT_ENV });
    const r = await callBranch(dir, { kind: 'config', description: 'z' });
    assert.match(r.error, /cannot nest deeper/);
  } finally { cleanup(dir); }
});
