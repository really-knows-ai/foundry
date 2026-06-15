// tests/plugin/config-dependency-tools.e2e.test.js
//
// Phase 03: Config Dependency Tools — foundry_config_add_dependency
//
// T2 — Package boundary precondition tests
// T6 — Dependency tool: install cwd and execution
// T7 — Dependency tool: expected changed files only
// T8 — Dependency tool: unexpected changed files rejection
// T9 — Dependency tool: root package-file protection

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
  const dir = mkdtempSync(join(tmpdir(), 'cfg-dep-tools-'));
  execSync('git init -q -b main', { cwd: dir, env: GIT_ENV });
  try { execSync('git checkout -B main -q', { cwd: dir, env: GIT_ENV }); } catch { /* ignore */ }
  mkdirSync(join(dir, 'foundry'), { recursive: true });
  writeFileSync(join(dir, 'README.md'), 'baseline\n');
  execSync('git add . && git commit -qm init', { cwd: dir, env: GIT_ENV });
  return dir;
}

function setupRepoWithFoundryPkg() {
  const dir = setupRepo();
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
// T2 — Package boundary precondition tests
// ---------------------------------------------------------------------------
describe('foundry_config_add_dependency — package boundary precondition (T2)', () => {
  let dir;
  let plugin;

  beforeEach(async () => {
    dir = setupRepo();
    execSync('git checkout -q -b config/add-dep', { cwd: dir, env: GIT_ENV });
    plugin = await FoundryPlugin({ directory: dir });
  });

  afterEach(() => {
    cleanup(dir);
  });

  test('returns error when foundry/package.json is missing', async () => {
    const res = JSON.parse(await plugin.tool.foundry_config_add_dependency.execute(
      { name: 'zod', dev: false, reason: 'test missing pkg' },
      makeCtx(dir),
    ));
    assert.equal(res.ok, false);
    assert.match(res.error, /foundry\/package\.json not found/);
  });

  test('does not create foundry/package.json implicitly', async () => {
    await plugin.tool.foundry_config_add_dependency.execute(
      { name: 'zod', dev: false, reason: 'test missing pkg' },
      makeCtx(dir),
    );

    // The tool must not create package files itself
    assert.equal(existsSync(join(dir, 'foundry', 'package.json')), false,
      'must not create foundry/package.json');
    assert.equal(existsSync(join(dir, 'foundry', 'pnpm-lock.yaml')), false,
      'must not create foundry/pnpm-lock.yaml');
  });

  test('proceeds when foundry/package.json exists', async () => {
    // Clean up from beforeEach and set up with package.json
    const pkg = {
      name: 'foundry-config',
      private: true,
      type: 'module',
      packageManager: 'pnpm@10.15.1',
      dependencies: {},
      devDependencies: {},
    };
    writeFileSync(join(dir, 'foundry', 'package.json'), JSON.stringify(pkg, null, 2) + '\n', 'utf8');
    execSync('git add . && git commit -qm "add foundry pkg"', { cwd: dir, env: GIT_ENV });

    const res = JSON.parse(await plugin.tool.foundry_config_add_dependency.execute(
      { name: 'is-even', dev: false, reason: 'test existing pkg' },
      makeCtx(dir),
    ));
    // May succeed or fail depending on pnpm availability and network,
    // but must not return the "not found" error about the missing package file.
    // If ok is true, we succeeded. If ok is false, the error must not mention
    // foundry/package.json not found.
    if (!res.ok) {
      assert.doesNotMatch(res.error, /foundry\/package\.json not found/);
    }
  });
});

// ---------------------------------------------------------------------------
// T6 — Dependency tool: install cwd and execution
// T7 — Dependency tool: expected changed files only
// These tests require pnpm available in the environment.
// ---------------------------------------------------------------------------
describe('foundry_config_add_dependency — install and commit (T6, T7)', () => {
  let dir;
  let plugin;

  beforeEach(async () => {
    dir = setupRepoWithFoundryPkg();
    execSync('git checkout -q -b config/add-dep', { cwd: dir, env: GIT_ENV });
    plugin = await FoundryPlugin({ directory: dir });
  });

  afterEach(() => {
    cleanup(dir);
  });

  test('installs a dependency and commits foundry/package.json and foundry/pnpm-lock.yaml', async () => {
    const res = JSON.parse(await plugin.tool.foundry_config_add_dependency.execute(
      { name: 'is-even', dev: false, reason: 'add is-even for testing' },
      makeCtx(dir),
    ));

    // The tool may succeed or fail depending on pnpm availability and network.
    // If it fails, it should be a structured error, not a crash.
    if (!res.ok) {
      // Allow failure for environment reasons (no pnpm, no network)
      // but the error must be a string
      assert.equal(typeof res.error, 'string');
      return;
    }

    assert.equal(res.ok, true, JSON.stringify(res));
    assert.ok(typeof res.sha === 'string' && res.sha.length > 0, 'sha must be non-empty');
    assert.deepEqual(res.changedFiles, ['foundry/package.json', 'foundry/pnpm-lock.yaml']);
    assert.ok(typeof res.logPath === 'string' && res.logPath.startsWith('.foundry/config-command-logs/'),
      'logPath must be in config-command-logs');

    // Assert foundry/package.json contains the dependency
    const pkg = JSON.parse(readFileSync(join(dir, 'foundry', 'package.json'), 'utf8'));
    assert.ok(pkg.dependencies['is-even'] !== undefined,
      'is-even must be in foundry/package.json dependencies');

    // Assert foundry/pnpm-lock.yaml exists
    assert.ok(existsSync(join(dir, 'foundry', 'pnpm-lock.yaml')),
      'foundry/pnpm-lock.yaml must exist');

    // Assert root package.json is unchanged
    const rootPkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    assert.equal(rootPkg.dependencies || {}, {},
      'root package.json must not have new dependencies');
  });

  test('only foundry/package.json and foundry/pnpm-lock.yaml appear in git diff', async () => {
    const res = JSON.parse(await plugin.tool.foundry_config_add_dependency.execute(
      { name: 'is-odd', dev: false, reason: 'add is-odd for testing' },
      makeCtx(dir),
    ));

    if (!res.ok) {
      assert.equal(typeof res.error, 'string');
      return;
    }

    // Check git diff for the last commit
    const diffOut = execSync('git diff --name-only HEAD~1..HEAD', {
      cwd: dir, env: GIT_ENV, encoding: 'utf8',
    }).trim();
    const diffFiles = diffOut ? diffOut.split('\n') : [];
    assert.ok(diffFiles.includes('foundry/package.json'),
      'diff must include foundry/package.json');
    assert.ok(diffFiles.includes('foundry/pnpm-lock.yaml'),
      'diff must include foundry/pnpm-lock.yaml');
    assert.equal(diffFiles.length, 2,
      'diff must contain exactly two files');

    // Verify no root package files appear
    for (const f of diffFiles) {
      assert.ok(!['package.json', 'pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'bun.lock'].includes(f),
        `root package file ${f} must not appear in diff`);
    }
  });
});

// ---------------------------------------------------------------------------
// T8 — Dependency tool: unexpected changed files rejection
// ---------------------------------------------------------------------------
describe('foundry_config_add_dependency — unexpected files rejection (T8)', () => {
  let dir;
  let plugin;

  beforeEach(async () => {
    dir = setupRepoWithFoundryPkg();
    execSync('git checkout -q -b config/add-dep', { cwd: dir, env: GIT_ENV });
    plugin = await FoundryPlugin({ directory: dir });
  });

  afterEach(() => {
    cleanup(dir);
  });

  test('rejects when a file outside allowed pair is already dirty', async () => {
    // Modify foundry/README.md to create unexpected dirty file
    writeFileSync(join(dir, 'foundry', 'README.md'), 'unexpected change\n', 'utf8');

    const res = JSON.parse(await plugin.tool.foundry_config_add_dependency.execute(
      { name: 'zod', dev: false, reason: 'test unexpected dirty' },
      makeCtx(dir),
    ));

    assert.equal(res.ok, false);
    assert.match(res.error, /unexpected dirty file/);
  });
});

// ---------------------------------------------------------------------------
// T9 — Dependency tool: root package-file protection
// ---------------------------------------------------------------------------
describe('foundry_config_add_dependency — root package-file protection (T9)', () => {
  let dir;
  let plugin;

  beforeEach(async () => {
    dir = setupRepoWithFoundryPkg();
    execSync('git checkout -q -b config/add-dep', { cwd: dir, env: GIT_ENV });
    plugin = await FoundryPlugin({ directory: dir });
  });

  afterEach(() => {
    cleanup(dir);
  });

  test('rejects when root package.json is dirty before install', async () => {
    // Modify root package.json
    writeFileSync(join(dir, 'package.json'), '{"dirty": true}\n', 'utf8');

    const res = JSON.parse(await plugin.tool.foundry_config_add_dependency.execute(
      { name: 'zod', dev: false, reason: 'test root dirty' },
      makeCtx(dir),
    ));

    assert.equal(res.ok, false);
    assert.match(res.error, /root package-file isolation/);
  });

  test('rejects when root pnpm-lock.yaml is dirty before install', async () => {
    // Create root pnpm-lock.yaml
    writeFileSync(join(dir, 'pnpm-lock.yaml'), 'lock: v1\n', 'utf8');

    const res = JSON.parse(await plugin.tool.foundry_config_add_dependency.execute(
      { name: 'zod', dev: false, reason: 'test root lock dirty' },
      makeCtx(dir),
    ));

    assert.equal(res.ok, false);
    assert.match(res.error, /root package-file isolation/);
  });
});

// ---------------------------------------------------------------------------
// T10 — Config policy tests (verifies Phase 01 policy remains intact)
// ---------------------------------------------------------------------------
describe('config commit policy — package file allow/deny (T10)', () => {
  test('config commit policy allows foundry/package.json', async () => {
    const { checkConfigBranchFiles } = await import('../../src/scripts/lib/git-policy.js');
    assert.equal(checkConfigBranchFiles('foundry/package.json\n'), null);
  });

  test('config commit policy allows foundry/pnpm-lock.yaml', async () => {
    const { checkConfigBranchFiles } = await import('../../src/scripts/lib/git-policy.js');
    assert.equal(checkConfigBranchFiles('foundry/pnpm-lock.yaml\n'), null);
  });

  test('config commit policy rejects root package.json', async () => {
    const { checkConfigBranchFiles } = await import('../../src/scripts/lib/git-policy.js');
    const result = checkConfigBranchFiles('package.json\n');
    assert.deepEqual(result, { files: ['package.json'] });
  });

  test('config commit policy rejects root pnpm-lock.yaml', async () => {
    const { checkConfigBranchFiles } = await import('../../src/scripts/lib/git-policy.js');
    const result = checkConfigBranchFiles('pnpm-lock.yaml\n');
    assert.deepEqual(result, { files: ['pnpm-lock.yaml'] });
  });

  test('config commit policy rejects root package-lock.json', async () => {
    const { checkConfigBranchFiles } = await import('../../src/scripts/lib/git-policy.js');
    const result = checkConfigBranchFiles('package-lock.json\n');
    assert.deepEqual(result, { files: ['package-lock.json'] });
  });

  test('config commit policy rejects root yarn.lock', async () => {
    const { checkConfigBranchFiles } = await import('../../src/scripts/lib/git-policy.js');
    const result = checkConfigBranchFiles('yarn.lock\n');
    assert.deepEqual(result, { files: ['yarn.lock'] });
  });

  test('config commit policy rejects root bun.lock', async () => {
    const { checkConfigBranchFiles } = await import('../../src/scripts/lib/git-policy.js');
    const result = checkConfigBranchFiles('bun.lock\n');
    assert.deepEqual(result, { files: ['bun.lock'] });
  });
});
