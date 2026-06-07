// tests/plugin/agent-deployment.test.js
// Tests for resolveAgentSources and writeAllFoundryAgents.

import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync,
  readFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveAgentSources, writeAllFoundryAgents } from '../../src/plugin/foundry.js';

const AGENT_NAMES = [
  'foundry-guide',
  'foundry-admin',
  'foundry-forge',
  'foundry-appraise',
  'foundry-assay',
];

function createAgentSourceFiles(baseDir, agentNames) {
  const agentsDir = join(baseDir, 'agents');
  mkdirSync(agentsDir, { recursive: true });
  for (const name of agentNames) {
    writeFileSync(join(agentsDir, `${name}.md`), `content for ${name}\n`, 'utf8');
  }
}

describe('deployment — T3.1: resolveAgentSources returns correct paths', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'deploy-sources-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test('returns dist path when dist/agents/ has the file', () => {
    const distDir = join(tmpDir, 'dist', 'agents');
    mkdirSync(distDir, { recursive: true });
    writeFileSync(join(distDir, 'foundry-guide.md'), 'dist content', 'utf8');

    const sources = resolveAgentSources(tmpDir);
    assert.ok(sources.has('foundry-guide'));
    assert.equal(sources.get('foundry-guide'), join(distDir, 'foundry-guide.md'));
  });

  test('falls back to src/agents/ when dist is absent', () => {
    const srcDir = join(tmpDir, 'src', 'agents');
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(join(srcDir, 'foundry-guide.md'), 'src content', 'utf8');

    const sources = resolveAgentSources(tmpDir);
    assert.equal(sources.get('foundry-guide'), join(srcDir, 'foundry-guide.md'));
  });

  test('returns null for agent when neither dist nor src has the file', () => {
    // No agent files created
    const sources = resolveAgentSources(tmpDir);
    assert.equal(sources.get('foundry-guide'), null);
  });

  test('all five agent entries are present in the returned Map', () => {
    // Create all agents in dist
    const distDir = join(tmpDir, 'dist', 'agents');
    mkdirSync(distDir, { recursive: true });
    for (const name of AGENT_NAMES) {
      writeFileSync(join(distDir, `${name}.md`), `content for ${name}`, 'utf8');
    }

    const sources = resolveAgentSources(tmpDir);
    assert.equal(sources.size, 5);
    for (const name of AGENT_NAMES) {
      assert.ok(sources.has(name), `Map must have entry for ${name}`);
      assert.ok(sources.get(name) !== null, `Path for ${name} must not be null`);
    }
  });
});

describe('deployment — T3.2: writeAllFoundryAgents deploys all five files', () => {
  let tmpDir;
  let worktree;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'deploy-all-'));
    worktree = mkdtempSync(join(tmpdir(), 'deploy-all-worktree-'));
    // Create source files in dist/agents under tmpDir (acts as pkgRoot)
    const distDir = join(tmpDir, 'dist', 'agents');
    mkdirSync(distDir, { recursive: true });
    for (const name of AGENT_NAMES) {
      writeFileSync(join(distDir, `${name}.md`), `content for ${name}\n`, 'utf8');
    }
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    rmSync(worktree, { recursive: true, force: true });
  });

  test('deploys all five agents to .opencode/agents/', () => {
    const result = writeAllFoundryAgents(worktree, tmpDir);

    assert.deepEqual(result, { ok: true, written: 5 });

    for (const name of AGENT_NAMES) {
      const deployedPath = join(worktree, '.opencode', 'agents', `${name}.md`);
      assert.ok(existsSync(deployedPath), `${name} must exist at ${deployedPath}`);
      const content = readFileSync(deployedPath, 'utf8');
      assert.equal(content, `content for ${name}\n`);
    }
  });
});

describe('deployment — T3.3: writeAllFoundryAgents skips missing source with warning', () => {
  let tmpDir;
  let worktree;
  const warnings = [];

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'deploy-skip-'));
    worktree = mkdtempSync(join(tmpdir(), 'deploy-skip-worktree-'));
    // Create source files for all but foundry-assay
    const distDir = join(tmpDir, 'dist', 'agents');
    mkdirSync(distDir, { recursive: true });
    for (const name of AGENT_NAMES) {
      if (name === 'foundry-assay') continue;
      writeFileSync(join(distDir, `${name}.md`), `content for ${name}\n`, 'utf8');
    }
    // Capture console.warn calls
    warnings.length = 0;
    mock.method(console, 'warn', (msg) => { warnings.push(msg); });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    rmSync(worktree, { recursive: true, force: true });
    mock.reset();
  });

  test('missing agent is skipped, others deployed, warning emitted', () => {
    const result = writeAllFoundryAgents(worktree, tmpDir);

    assert.deepEqual(result, { ok: true, written: 4 });

    // Check deployed files
    for (const name of AGENT_NAMES) {
      const deployedPath = join(worktree, '.opencode', 'agents', `${name}.md`);
      if (name === 'foundry-assay') {
        assert.equal(existsSync(deployedPath), false, `${name} must not be deployed`);
      } else {
        assert.ok(existsSync(deployedPath), `${name} must be deployed`);
      }
    }

    // Warning should be emitted for the missing agent
    assert.ok(warnings.length >= 1, 'console.warn must have been called');
    assert.ok(warnings.some(w => w.includes('foundry-assay')), 'warning must mention the missing agent');
  });
});

describe('deployment — T3.4: writeAllFoundryAgents writes unconditionally', () => {
  let tmpDir;
  let worktree;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'deploy-overwrite-'));
    worktree = mkdtempSync(join(tmpdir(), 'deploy-overwrite-worktree-'));
    // Create source files
    const distDir = join(tmpDir, 'dist', 'agents');
    mkdirSync(distDir, { recursive: true });
    for (const name of AGENT_NAMES) {
      writeFileSync(join(distDir, `${name}.md`), `original content for ${name}\n`, 'utf8');
    }
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    rmSync(worktree, { recursive: true, force: true });
  });

  test('overwrites existing deployed files with source content', () => {
    // First deployment
    writeAllFoundryAgents(worktree, tmpDir);

    // Modify one deployed file
    const guidePath = join(worktree, '.opencode', 'agents', 'foundry-guide.md');
    writeFileSync(guidePath, 'modified user content\n', 'utf8');

    // Deploy again — should overwrite
    writeAllFoundryAgents(worktree, tmpDir);

    // Verify content restored
    const content = readFileSync(guidePath, 'utf8');
    assert.equal(content, 'original content for foundry-guide\n');
  });
});

describe('deployment — T3.5: writeAllFoundryAgents returns error on write failure', () => {
  let tmpDir;
  let worktree;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'deploy-error-'));
    // Create a file in place of the target directory to cause write failures
    worktree = mkdtempSync(join(tmpdir(), 'deploy-error-worktree-'));
    // Put a file where .opencode/agents should be a directory
    mkdirSync(join(worktree, '.opencode'), { recursive: true });
    writeFileSync(join(worktree, '.opencode', 'agents'), 'this is a file, not a dir', 'utf8');

    // Create source files
    const distDir = join(tmpDir, 'dist', 'agents');
    mkdirSync(distDir, { recursive: true });
    for (const name of AGENT_NAMES) {
      writeFileSync(join(distDir, `${name}.md`), `content for ${name}\n`, 'utf8');
    }
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    rmSync(worktree, { recursive: true, force: true });
  });

  test('returns error object when write fails', () => {
    const result = writeAllFoundryAgents(worktree, tmpDir);

    assert.equal(result.ok, false);
    assert.ok(typeof result.error === 'string', 'error must be a string');
    assert.ok(result.error.length > 0, 'error must not be empty');
  });
});
