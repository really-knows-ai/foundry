// tests/plugin/config-file-tools.test.js
//
// Config File Write Tools — foundry_config_write_validator,
// foundry_config_write_test, foundry_config_write_fixture.

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
  const dir = mkdtempSync(join(tmpdir(), 'cfg-file-'));
  execSync('git init -q -b main', { cwd: dir, env: GIT_ENV });
  try { execSync('git checkout -B main -q', { cwd: dir, env: GIT_ENV }); } catch { /* ignore */ }
  mkdirSync(join(dir, 'foundry', 'artefacts', 'test-type'), { recursive: true });
  writeFileSync(join(dir, 'foundry', 'artefacts', 'test-type', 'definition.md'),
    '---\nname: test-type\nfile-patterns:\n  - test/*.md\n---\n\n## Definition\n\nTest artefact type.\n');
  writeFileSync(join(dir, 'foundry', '.gitkeep'), '');
  execSync('git add . && git commit -qm init', { cwd: dir, env: GIT_ENV });
  return dir;
}

function cleanup(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function assertWriteOk(res, expectedPathDir) {
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.ok(res.path.startsWith(expectedPathDir));
  assert.ok(typeof res.sha === 'string' && res.sha.length > 0);
}

// ---------------------------------------------------------------------------
// write_validator
// ---------------------------------------------------------------------------
describe('foundry_config_write_validator', () => {
  let dir, plugin;

  beforeEach(async () => {
    dir = setupRepo();
    execSync('git checkout -q -b config/test-branch', { cwd: dir, env: GIT_ENV });
    plugin = await FoundryPlugin({ directory: dir });
  });

  afterEach(() => { cleanup(dir); });

  test('writes and commits a .mjs validator under the artefact type dir', async () => {
    const res = JSON.parse(await plugin.tool.foundry_config_write_validator.execute(
      { typeId: 'test-type', name: 'check-something', content: 'export const v = 1;\n', reason: 'test' },
      makeCtx(dir),
    ));
    assertWriteOk(res, 'foundry/artefacts/test-type/');
    assert.ok(res.path.endsWith('check-something.mjs'));
    assert.ok(existsSync(join(dir, res.path)));
  });

  test('rejects when artefact type does not exist', async () => {
    const res = JSON.parse(await plugin.tool.foundry_config_write_validator.execute(
      { typeId: 'nonexistent', name: 'check', content: 'ok', reason: 'test' },
      makeCtx(dir),
    ));
    assert.equal(res.ok, false);
    assert.match(res.error, /artefact type not found/);
  });

  test('rejects empty name', async () => {
    const res = JSON.parse(await plugin.tool.foundry_config_write_validator.execute(
      { typeId: 'test-type', name: '', content: 'ok', reason: 'test' },
      makeCtx(dir),
    ));
    assert.equal(res.ok, false);
    assert.equal(res.error, 'name is required');
  });

  test('rejects empty content', async () => {
    const res = JSON.parse(await plugin.tool.foundry_config_write_validator.execute(
      { typeId: 'test-type', name: 'check', content: '', reason: 'test' },
      makeCtx(dir),
    ));
    assert.equal(res.ok, false);
    assert.equal(res.error, 'content is required');
  });
});

// ---------------------------------------------------------------------------
// write_test
// ---------------------------------------------------------------------------
describe('foundry_config_write_test', () => {
  let dir, plugin;

  beforeEach(async () => {
    dir = setupRepo();
    execSync('git checkout -q -b config/test-branch', { cwd: dir, env: GIT_ENV });
    plugin = await FoundryPlugin({ directory: dir });
  });

  afterEach(() => { cleanup(dir); });

  test('writes and commits a .test.js companion test', async () => {
    const res = JSON.parse(await plugin.tool.foundry_config_write_test.execute(
      { typeId: 'test-type', name: 'check-something', content: 'import { test } from "node:test";\n', reason: 'test' },
      makeCtx(dir),
    ));
    assertWriteOk(res, 'foundry/artefacts/test-type/');
    assert.ok(res.path.endsWith('check-something.test.js'));
    assert.ok(existsSync(join(dir, res.path)));
  });

  test('rejects when artefact type does not exist', async () => {
    const res = JSON.parse(await plugin.tool.foundry_config_write_test.execute(
      { typeId: 'nonexistent', name: 'check', content: 'ok', reason: 'test' },
      makeCtx(dir),
    ));
    assert.equal(res.ok, false);
    assert.match(res.error, /artefact type not found/);
  });

  test('accepts message as full commit message', async () => {
    const res = JSON.parse(await plugin.tool.foundry_config_write_test.execute(
      { typeId: 'test-type', name: 'helper', content: 'test("t", () => {});\n', message: 'feat(test): add helper' },
      makeCtx(dir),
    ));
    assertWriteOk(res, 'foundry/artefacts/test-type/');
    const msg = execSync('git log -1 --format=%B', { cwd: dir, env: GIT_ENV, encoding: 'utf8' }).trim();
    assert.equal(msg, 'feat(test): add helper');
  });
});

// ---------------------------------------------------------------------------
// write_fixture
// ---------------------------------------------------------------------------
describe('foundry_config_write_fixture', () => {
  let dir, plugin;

  beforeEach(async () => {
    dir = setupRepo();
    execSync('git checkout -q -b config/test-branch', { cwd: dir, env: GIT_ENV });
    plugin = await FoundryPlugin({ directory: dir });
  });

  afterEach(() => { cleanup(dir); });

  test('writes and commits a .md fixture under test/fixtures/', async () => {
    const res = JSON.parse(await plugin.tool.foundry_config_write_fixture.execute(
      { typeId: 'test-type', name: 'valid-input', content: '# valid\n', reason: 'test' },
      makeCtx(dir),
    ));
    assertWriteOk(res, 'foundry/artefacts/test-type/test/fixtures/');
    assert.ok(res.path.endsWith('valid-input.md'));
    assert.ok(existsSync(join(dir, res.path)));
  });

  test('rejects when artefact type does not exist', async () => {
    const res = JSON.parse(await plugin.tool.foundry_config_write_fixture.execute(
      { typeId: 'nonexistent', name: 'valid', content: 'ok', reason: 'test' },
      makeCtx(dir),
    ));
    assert.equal(res.ok, false);
    assert.match(res.error, /artefact type not found/);
  });
});

// ---------------------------------------------------------------------------
// Branch guard
// ---------------------------------------------------------------------------
describe('config write tools — branch guard', () => {
  test('rejects on non-config branch for all three tools', async () => {
    const dir = setupRepo();
    execSync('git checkout main -q', { cwd: dir, env: GIT_ENV });

    const plugin = await FoundryPlugin({ directory: dir });
    const args = { typeId: 'test-type', name: 'x', content: 'ok', reason: 'test' };

    const vRes = JSON.parse(await plugin.tool.foundry_config_write_validator.execute(args, makeCtx(dir)));
    assert.equal(vRes.ok, false);
    assert.match(vRes.error, /config/);

    const tRes = JSON.parse(await plugin.tool.foundry_config_write_test.execute(args, makeCtx(dir)));
    assert.equal(tRes.ok, false);
    assert.match(tRes.error, /config/);

    const fRes = JSON.parse(await plugin.tool.foundry_config_write_fixture.execute(args, makeCtx(dir)));
    assert.equal(fRes.ok, false);
    assert.match(fRes.error, /config/);

    cleanup(dir);
  });
});

// ---------------------------------------------------------------------------
// Rollback
// ---------------------------------------------------------------------------
describe('config write tools — rollback', () => {
  let dir;

  function setupDir() {
    dir = setupRepo();
    const pkg = {
      name: 'foundry-config', private: true, type: 'module',
      packageManager: 'pnpm@10.15.1', dependencies: {}, devDependencies: {},
    };
    writeFileSync(join(dir, 'foundry', 'package.json'), JSON.stringify(pkg, null, 2) + '\n', 'utf8');
    execSync('git add . && git commit -qm "add foundry package.json"', { cwd: dir, env: GIT_ENV });
    execSync('git checkout -q -b config/rollback', { cwd: dir, env: GIT_ENV });
    return dir;
  }

  afterEach(() => { cleanup(dir); });

  test('rollback deletes newly-created file when commit policy rejects', async () => {
    const worktree = setupDir();
    writeFileSync(join(worktree, 'root-stray.txt'), 'dirty', 'utf8');

    const plugin = await FoundryPlugin({ directory: worktree });
    const res = JSON.parse(await plugin.tool.foundry_config_write_validator.execute(
      { typeId: 'test-type', name: 'rollback-test', content: '// test', reason: 'should rollback' },
      makeCtx(worktree),
    ));
    assert.equal(res.ok, false);
    assert.equal(existsSync(join(worktree, 'foundry', 'artefacts', 'test-type', 'rollback-test.mjs')), false);
  });

  test('rollback restores overwritten existing file when commit policy rejects', async () => {
    const worktree = setupDir();
    const existingPath = join(worktree, 'foundry', 'artefacts', 'test-type', 'existing.mjs');
    mkdirSync(join(worktree, 'foundry', 'artefacts', 'test-type'), { recursive: true });
    writeFileSync(existingPath, 'export const v = 1;\n', 'utf8');
    execSync('git add . && git commit -qm "add existing"', { cwd: worktree, env: GIT_ENV });

    writeFileSync(join(worktree, 'root-stray.txt'), 'dirty', 'utf8');

    const plugin = await FoundryPlugin({ directory: worktree });
    const res = JSON.parse(await plugin.tool.foundry_config_write_validator.execute(
      { typeId: 'test-type', name: 'existing', content: 'export const v = 2;\n', reason: 'should rollback' },
      makeCtx(worktree),
    ));
    assert.equal(res.ok, false);
    assert.equal(readFileSync(existingPath, 'utf8'), 'export const v = 1;\n');
  });
});
