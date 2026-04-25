import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
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

test('foundry_git_finish removes WORK.feedback.yaml from the worktree', async () => {
  const dir = initRepo();
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
    { message: 'finish flow' }, makeCtx(dir),
  ));

  assert.equal(res.ok, true, res.error);
  assert.equal(existsSync(join(dir, 'WORK.md')), false);
  assert.equal(existsSync(join(dir, 'WORK.history.yaml')), false);
  assert.equal(existsSync(join(dir, 'WORK.feedback.yaml')), false);
});
