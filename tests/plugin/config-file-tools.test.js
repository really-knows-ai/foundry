// tests/plugin/config-file-tools.test.js
//
// Phase 03: Config File Writer — foundry_config_write_file
//
// T3 — Config file writer: path rejection tests
// T4 — Config file writer: commit success test
// T5 — Config file writer: rollback test

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FoundryPlugin } from '../../src/plugin/foundry.js';

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t',
  GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
};

function makeCtx(worktree) { return { worktree }; }

function setupRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'cfg-file-tools-'));
  execSync('git init -q -b main', { cwd: dir, env: GIT_ENV });
  try { execSync('git checkout -B main -q', { cwd: dir, env: GIT_ENV }); } catch { /* ignore */ }
  mkdirSync(join(dir, 'foundry', 'artefacts'), { recursive: true });
  writeFileSync(join(dir, 'foundry', '.gitkeep'), '');
  writeFileSync(join(dir, 'README.md'), 'baseline\n');
  execSync('git add . && git commit -qm init', { cwd: dir, env: GIT_ENV });
  return dir;
}

function setupRepoWithFoundryPkg() {
  const dir = setupRepo();
  // Add foundry/package.json like Phase 01 bootstrap would
  const pkg = {
    name: 'foundry-config',
    private: true,
    type: 'module',
    packageManager: 'pnpm@10.15.1',
    dependencies: {},
    devDependencies: {},
  };
  writeFileSync(join(dir, 'foundry', 'package.json'), JSON.stringify(pkg, null, 2) + '\n', 'utf8');
  execSync('git add . && git commit -qm "add foundry package.json"', { cwd: dir, env: GIT_ENV });
  return dir;
}

function cleanup(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// T3 — Config file writer: path rejection tests
// ---------------------------------------------------------------------------
describe('foundry_config_write_file — path rejection (T3)', () => {
  let dir;
  let plugin;

  beforeEach(async () => {
    dir = setupRepo();
    execSync('git checkout -q -b config/test-branch', { cwd: dir, env: GIT_ENV });
    plugin = await FoundryPlugin({ directory: dir });
  });

  afterEach(() => {
    cleanup(dir);
  });

  test('rejects path outside foundry/ (lib/my-file.js)', async () => {
    const res = JSON.parse(await plugin.tool.foundry_config_write_file.execute(
      { path: 'lib/my-file.js', content: 'test', reason: 'outside foundry' },
      makeCtx(dir),
    ));
    assert.equal(res.ok, false);
    assert.match(res.error, /path must be under foundry/);
  });

  test('rejects directory traversal (foundry/../outside/file.js)', async () => {
    const res = JSON.parse(await plugin.tool.foundry_config_write_file.execute(
      { path: 'foundry/../outside/file.js', content: 'test', reason: 'traversal' },
      makeCtx(dir),
    ));
    assert.equal(res.ok, false);
    assert.match(res.error, /path must be under foundry/);
  });

  test('rejects absolute path outside (/etc/passwd)', async () => {
    const res = JSON.parse(await plugin.tool.foundry_config_write_file.execute(
      { path: '/etc/passwd', content: 'test', reason: 'absolute outside' },
      makeCtx(dir),
    ));
    assert.equal(res.ok, false);
    assert.match(res.error, /path must be under foundry/);
  });

  test('rejects path that resolves to the foundry directory itself (foundry)', async () => {
    const res = JSON.parse(await plugin.tool.foundry_config_write_file.execute(
      { path: 'foundry', content: 'test', reason: 'is directory itself' },
      makeCtx(dir),
    ));
    assert.equal(res.ok, false);
    assert.match(res.error, /path must be under foundry/);
  });

  test('rejects path that resolves to a directory under foundry/ (foundry/artefacts)', async () => {
    const res = JSON.parse(await plugin.tool.foundry_config_write_file.execute(
      { path: 'foundry/artefacts', content: 'test', reason: 'is directory' },
      makeCtx(dir),
    ));
    assert.equal(res.ok, false);
    assert.match(res.error, /path must be under foundry/);
  });

  test('rejects empty content', async () => {
    const res = JSON.parse(await plugin.tool.foundry_config_write_file.execute(
      { path: 'foundry/test.js', content: '', reason: 'empty content' },
      makeCtx(dir),
    ));
    assert.equal(res.ok, false);
    assert.equal(res.error, 'content is required');
  });

  test('rejects when both reason and message are missing', async () => {
    const res = JSON.parse(await plugin.tool.foundry_config_write_file.execute(
      { path: 'foundry/test.js', content: 'hello', reason: '', message: '' },
      makeCtx(dir),
    ));
    assert.equal(res.ok, false);
    assert.equal(res.error, 'reason or message is required');
  });

  test('rejects on non-config branch (main)', async () => {
    execSync('git checkout -q main', { cwd: dir, env: GIT_ENV });
    const res = JSON.parse(await plugin.tool.foundry_config_write_file.execute(
      { path: 'foundry/test.js', content: 'hello', reason: 'on main' },
      makeCtx(dir),
    ));
    assert.equal(res.ok, false);
    assert.match(res.error, /config/);
  });

  test('rejects .json under foundry/artefacts/ (overlap with config tools)', async () => {
    const res = JSON.parse(await plugin.tool.foundry_config_write_file.execute(
      { path: 'foundry/artefacts/some-config.json', content: '{}', reason: 'overlap test' },
      makeCtx(dir),
    ));
    assert.equal(res.ok, false);
    assert.match(res.error, /overlaps with specialised config tool/);
  });

  test('rejects .json under foundry/flows/ (overlap with config tools)', async () => {
    const res = JSON.parse(await plugin.tool.foundry_config_write_file.execute(
      { path: 'foundry/flows/my-flow.json', content: '{}', reason: 'overlap test' },
      makeCtx(dir),
    ));
    assert.equal(res.ok, false);
    assert.match(res.error, /overlaps with specialised config tool/);
  });

  test('rejects .json under foundry/cycles/ (overlap with config tools)', async () => {
    const res = JSON.parse(await plugin.tool.foundry_config_write_file.execute(
      { path: 'foundry/cycles/my-cycle.json', content: '{}', reason: 'overlap test' },
      makeCtx(dir),
    ));
    assert.equal(res.ok, false);
    assert.match(res.error, /overlaps with specialised config tool/);
  });

  test('rejects .json under foundry/appraisers/ (overlap with config tools)', async () => {
    const res = JSON.parse(await plugin.tool.foundry_config_write_file.execute(
      { path: 'foundry/appraisers/my-appraiser.json', content: '{}', reason: 'overlap test' },
      makeCtx(dir),
    ));
    assert.equal(res.ok, false);
    assert.match(res.error, /overlaps with specialised config tool/);
  });

  test('rejects .json under foundry/laws/ (overlap with config tools)', async () => {
    const res = JSON.parse(await plugin.tool.foundry_config_write_file.execute(
      { path: 'foundry/laws/rules.json', content: '{}', reason: 'overlap test' },
      makeCtx(dir),
    ));
    assert.equal(res.ok, false);
    assert.match(res.error, /overlaps with specialised config tool/);
  });

  test('allows .json outside config tool directories', async () => {
    const res = JSON.parse(await plugin.tool.foundry_config_write_file.execute(
      { path: 'foundry/support/config.json', content: '{}', reason: 'non-overlap json' },
      makeCtx(dir),
    ));
    assert.equal(res.ok, true, JSON.stringify(res));
  });

  test('allows .js support file under foundry/artefacts/', async () => {
    const res = JSON.parse(await plugin.tool.foundry_config_write_file.execute(
      { path: 'foundry/artefacts/validator.js', content: 'export const v = 1;\n', reason: 'support file' },
      makeCtx(dir),
    ));
    assert.equal(res.ok, true, JSON.stringify(res));
  });

  test('bypasses overlap rejection when update=true', async () => {
    const res = JSON.parse(await plugin.tool.foundry_config_write_file.execute(
      { path: 'foundry/artefacts/some-config.json', content: '{}', reason: 'update mode', update: true },
      makeCtx(dir),
    ));
    assert.equal(res.ok, true, JSON.stringify(res));
  });
});

// ---------------------------------------------------------------------------
// T4 — Config file writer: commit success test
// ---------------------------------------------------------------------------
describe('foundry_config_write_file — commit success (T4)', () => {
  let dir;

  function setup() {
    dir = setupRepo();
    execSync('git checkout -q -b config/write-test', { cwd: dir, env: GIT_ENV });
    return dir;
  }

  afterEach(() => {
    cleanup(dir);
  });

  test('writes and commits a file under foundry/ and returns { ok, path, sha }', async () => {
    const worktree = setup();
    const plugin = await FoundryPlugin({ directory: worktree });
    const targetPath = 'foundry/artefacts/test.js';
    const content = 'export const version = 1;\n';

    const res = JSON.parse(await plugin.tool.foundry_config_write_file.execute(
      { path: targetPath, content, reason: 'add test helper' },
      makeCtx(worktree),
    ));
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.equal(res.path, targetPath);
    assert.ok(typeof res.sha === 'string' && res.sha.length > 0, 'sha must be a non-empty string');

    // Assert the committed file exists on disk
    assert.ok(existsSync(join(worktree, targetPath)), 'committed file must exist on disk');
    assert.equal(readFileSync(join(worktree, targetPath), 'utf8'), content);

    // Assert the commit is reachable in the git log
    const logMsg = execSync('git log -1 --format=%B', { cwd: worktree, env: GIT_ENV, encoding: 'utf8' }).trim();
    assert.match(logMsg, /add test helper/);

    // Assert an audit log is written
    const logDir = join(worktree, '.foundry', 'config-command-logs');
    assert.ok(existsSync(logDir), 'audit log directory must exist');
    const logFiles = execSync('ls', { cwd: logDir, encoding: 'utf8' }).trim().split('\n');
    assert.ok(logFiles.length > 0, 'audit log files must exist');
    const lastLog = logFiles[logFiles.length - 1];
    const logContent = JSON.parse(readFileSync(join(logDir, lastLog), 'utf8'));
    assert.equal(logContent.command, 'foundry_config_write_file');
    assert.equal(logContent.reason, 'add test helper');
    assert.equal(logContent.sha, res.sha);
    assert.deepEqual(logContent.changedFiles, [targetPath]);
  });

  test('uses message parameter as the full commit message', async () => {
    const worktree = setup();
    const plugin = await FoundryPlugin({ directory: worktree });
    const targetPath = 'foundry/artefacts/message-test.js';
    const content = 'export const v = 2;\n';
    const commitMsg = 'feat(foundry): add message test helper';

    const res = JSON.parse(await plugin.tool.foundry_config_write_file.execute(
      { path: targetPath, content, message: commitMsg },
      makeCtx(worktree),
    ));
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.equal(res.path, targetPath);
    assert.ok(typeof res.sha === 'string' && res.sha.length > 0, 'sha must be a non-empty string');

    // Assert the commit message is the provided message, not config: prefixed
    const logMsg = execSync('git log -1 --format=%B', { cwd: worktree, env: GIT_ENV, encoding: 'utf8' }).trim();
    assert.equal(logMsg, commitMsg);

    // Assert the audit log reason matches the provided message
    const logDir = join(worktree, '.foundry', 'config-command-logs');
    const logFiles = execSync('ls', { cwd: logDir, encoding: 'utf8' }).trim().split('\n');
    const lastLog = logFiles[logFiles.length - 1];
    const logContent = JSON.parse(readFileSync(join(logDir, lastLog), 'utf8'));
    assert.equal(logContent.reason, commitMsg);
  });
});

// ---------------------------------------------------------------------------
// T5 — Config file writer: rollback tests
// ---------------------------------------------------------------------------
describe('foundry_config_write_file — rollback (T5)', () => {
  let dir;

  function setup() {
    dir = setupRepoWithFoundryPkg();
    execSync('git checkout -q -b config/rollback-test', { cwd: dir, env: GIT_ENV });
    return dir;
  }

  afterEach(() => {
    cleanup(dir);
  });

  // T5a — Rollback deletes newly-created file
  test('rollback deletes newly-created file when commit policy rejects', async () => {
    const worktree = setup();

    // Introduce a dirty non-allowed file in the repository root
    writeFileSync(join(worktree, 'root-stray.txt'), 'dirty', 'utf8');

    const plugin = await FoundryPlugin({ directory: worktree });
    const targetPath = 'foundry/artefacts/new-file.js';
    const res = JSON.parse(await plugin.tool.foundry_config_write_file.execute(
      { path: targetPath, content: '// new file', reason: 'should rollback' },
      makeCtx(worktree),
    ));

    assert.equal(res.ok, false, 'must fail due to dirty root file');
    // Assert the newly-created file does NOT exist on disk
    assert.equal(existsSync(join(worktree, targetPath)), false,
      'rollback must delete the newly-created file');
  });

  // T5b — Rollback restores overwritten existing file
  test('rollback restores overwritten existing file when commit policy rejects', async () => {
    const worktree = setup();

    // Commit an existing support file at foundry/artefacts/config.js
    const existingPath = 'foundry/artefacts/config.js';
    const originalContent = 'export const version = 1;\n';
    writeFileSync(join(worktree, existingPath), originalContent, 'utf8');
    execSync('git add . && git commit -qm "add config.js"', { cwd: worktree, env: GIT_ENV });

    // Introduce a dirty non-allowed file in the repository root
    writeFileSync(join(worktree, 'root-stray.txt'), 'dirty', 'utf8');

    const plugin = await FoundryPlugin({ directory: worktree });
    const newContent = 'export const version = 2;\n';
    const res = JSON.parse(await plugin.tool.foundry_config_write_file.execute(
      { path: existingPath, content: newContent, reason: 'should rollback overwrite' },
      makeCtx(worktree),
    ));

    assert.equal(res.ok, false, 'must fail due to dirty root file');
    // Assert the file still exists on disk with original content
    assert.ok(existsSync(join(worktree, existingPath)),
      'rollback must preserve the existing file');
    assert.equal(readFileSync(join(worktree, existingPath), 'utf8'), originalContent,
      'rollback must restore original content');
  });
});
