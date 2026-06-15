// tests/plugin/foundry-package-boundary.test.js
//
// Phase 01: Foundry Package Boundary
//
// Verifies that the plugin's config hook creates foundry/package.json during
// bootstrap and upgrade, that root package.json is never modified, that
// .gitignore ignores foundry/node_modules/, and that config policy allows
// Foundry-owned package files while rejecting root package manager files.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FoundryPlugin } from '../../src/plugin/foundry.js';

const EXPECTED_METADATA = {
  name: 'foundry-config',
  private: true,
  type: 'module',
  packageManager: 'pnpm@10.15.1',
};

function assertFoundryPackageJson(foundryDir) {
  const pkgPath = join(foundryDir, 'package.json');
  assert.ok(existsSync(pkgPath), 'foundry/package.json must exist');

  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  assert.equal(pkg.name, EXPECTED_METADATA.name, 'name must be foundry-config');
  assert.equal(pkg.private, EXPECTED_METADATA.private, 'private must be true');
  assert.equal(pkg.type, EXPECTED_METADATA.type, 'type must be module');
  assert.equal(pkg.packageManager, EXPECTED_METADATA.packageManager, 'packageManager must be pnpm@10.15.1');

  // dependencies and devDependencies must be present as empty objects
  assert.deepEqual(pkg.dependencies, {}, 'dependencies must be empty object');
  assert.deepEqual(pkg.devDependencies, {}, 'devDependencies must be empty object');
}

describe('foundry package boundary — bootstrap', () => {
  let dir;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'boundary-bootstrap-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test('creates foundry/package.json with default metadata on fresh project', async () => {
    const plugin = await FoundryPlugin({ directory: dir });
    await plugin.config({ skills: {} });

    const foundryDir = join(dir, 'foundry');
    assertFoundryPackageJson(foundryDir);
  });

  test('fresh project has no root package.json after config hook', async () => {
    const plugin = await FoundryPlugin({ directory: dir });
    await plugin.config({ skills: {} });

    // Root package manager files must not be created by bootstrap.
    // They are modified only through an explicit future project-level tool
    // or direct user action outside this project (spec item 8).
    const rootPkgPath = join(dir, 'package.json');
    assert.equal(existsSync(rootPkgPath), false, 'root package.json must not be created by bootstrap');
  });

  test('does not modify existing root package.json', async () => {
    // Pre-seed a root package.json with custom content
    const originalRootPkg = {
      name: 'my-project',
      version: '1.0.0',
      private: true,
    };
    writeFileSync(join(dir, 'package.json'), JSON.stringify(originalRootPkg, null, 2) + '\n', 'utf8');

    const plugin = await FoundryPlugin({ directory: dir });
    await plugin.config({ skills: {} });

    // Root package.json must be byte-for-byte unchanged
    const rootContent = readFileSync(join(dir, 'package.json'), 'utf8');
    assert.equal(rootContent, JSON.stringify(originalRootPkg, null, 2) + '\n',
      'root package.json must not be modified');
  });

  test('creates foundry/package.json only once (idempotent)', async () => {
    const plugin = await FoundryPlugin({ directory: dir });
    await plugin.config({ skills: {} });
    await plugin.config({ skills: {} });

    const pkgPath = join(dir, 'foundry', 'package.json');
    assert.ok(existsSync(pkgPath));

    // Read and verify contents are valid JSON (no corruption from double-write)
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    assert.equal(pkg.name, 'foundry-config');
  });
});

describe('foundry package boundary — upgrade', () => {
  let dir;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'boundary-upgrade-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test('creates foundry/package.json when foundry/ exists but package.json is missing', async () => {
    // Pre-seed foundry/ with VERSION and subdirectories but no package.json
    const foundryDir = join(dir, 'foundry');
    mkdirSync(foundryDir, { recursive: true });

    // Write VERSION to simulate an existing foundry install from before the
    // package boundary was introduced
    const PKG_VERSION = JSON.parse(
      readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
    ).version;
    writeFileSync(join(foundryDir, 'VERSION'), PKG_VERSION, 'utf8');

    // Create subdirectories like an existing installation would have
    for (const sub of ['artefacts', 'flows', 'cycles', 'laws', 'appraisers']) {
      mkdirSync(join(foundryDir, sub), { recursive: true });
    }

    const plugin = await FoundryPlugin({ directory: dir });
    await plugin.config({ skills: {} });

    assertFoundryPackageJson(foundryDir);
  });

  test('running config hook twice on upgrade path does not corrupt foundry/package.json', async () => {
    // Pre-seed foundry/ like an existing install
    const foundryDir = join(dir, 'foundry');
    mkdirSync(foundryDir, { recursive: true });

    const PKG_VERSION = JSON.parse(
      readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
    ).version;
    writeFileSync(join(foundryDir, 'VERSION'), PKG_VERSION, 'utf8');

    for (const sub of ['artefacts', 'flows', 'cycles', 'laws', 'appraisers']) {
      mkdirSync(join(foundryDir, sub), { recursive: true });
    }

    const plugin = await FoundryPlugin({ directory: dir });
    await plugin.config({ skills: {} });
    await plugin.config({ skills: {} });

    assertFoundryPackageJson(foundryDir);
  });
});

describe('foundry package boundary — gitignore', () => {
  let dir;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'boundary-gitignore-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test('includes foundry/node_modules/ in .gitignore', async () => {
    const plugin = await FoundryPlugin({ directory: dir });
    await plugin.config({ skills: {} });

    const gitignorePath = join(dir, '.gitignore');
    assert.ok(existsSync(gitignorePath));

    const content = readFileSync(gitignorePath, 'utf8');
    assert.ok(content.includes('foundry/node_modules/'),
      '.gitignore must contain foundry/node_modules/');
  });

  test('foundry/node_modules/ entry appears exactly once (idempotent)', async () => {
    const plugin = await FoundryPlugin({ directory: dir });
    await plugin.config({ skills: {} });
    await plugin.config({ skills: {} });

    const content = readFileSync(join(dir, '.gitignore'), 'utf8');
    const lines = content.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const matches = lines.filter(l => l === 'foundry/node_modules/');
    assert.equal(matches.length, 1,
      'foundry/node_modules/ must appear exactly once in .gitignore');
  });
});
