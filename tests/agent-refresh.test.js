import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  refreshAgents,
  detectChanges,
  writeFoundryGuideAgent,
} from '../src/plugin/tools/agent-refresh.js';

describe('refreshAgents', () => {
  let dir;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'agent-refresh-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test('returns { ok: true, count: 0 } and writes no agent files', () => {
    const result = refreshAgents(dir);

    assert.equal(result.ok, true);
    assert.equal(result.count, 0);

    const agentsDir = join(dir, '.opencode', 'agents');
    assert.ok(existsSync(agentsDir));
  });

  test('deletes stale foundry-*.md agents, preserves non-stage files', () => {
    const agentsDir = join(dir, '.opencode', 'agents');
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(join(agentsDir, 'foundry-stale-model.md'), 'stale', 'utf8');
    writeFileSync(join(agentsDir, 'foundry.md'), 'guide', 'utf8');
    writeFileSync(join(agentsDir, 'other-agent.md'), 'other', 'utf8');

    const result = refreshAgents(dir);

    assert.equal(result.ok, true);
    assert.equal(result.count, 0);

    // Stale foundry-* agent deleted
    assert.equal(existsSync(join(agentsDir, 'foundry-stale-model.md')), false);
    // Guide agent preserved
    assert.equal(existsSync(join(agentsDir, 'foundry.md')), true);
    // Non-foundry files untouched
    assert.equal(existsSync(join(agentsDir, 'other-agent.md')), true);
  });
});

describe('detectChanges', () => {
  let dir;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'detect-changes-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test('returns changed: false when no stale agent files exist', () => {
    // Empty directory — nothing to change
    const result = detectChanges(dir);

    assert.equal(result.ok, true);
    assert.equal(result.changed, false);
    assert.equal(result.count, 0);
  });

  test('returns changed: true when stale agent files are cleaned up', () => {
    const agentsDir = join(dir, '.opencode', 'agents');
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(join(agentsDir, 'foundry-stale-model.md'), 'stale', 'utf8');

    const result = detectChanges(dir);

    assert.equal(result.ok, true);
    assert.equal(result.changed, true);
    assert.equal(result.count, 0);
  });

  test('guide agent changes are not detected as stale agent changes', () => {
    const agentsDir = join(dir, '.opencode', 'agents');
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(join(agentsDir, 'foundry.md'), 'guide', 'utf8');

    // Only foundry.md exists (not a stale model agent) — no change
    const result = detectChanges(dir);

    assert.equal(result.ok, true);
    assert.equal(result.changed, false);
    assert.equal(result.count, 0);
  });
});

describe('writeFoundryGuideAgent', () => {
  let dir;
  let packageRoot;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'write-guide-'));
    packageRoot = join(dir, 'package');
    mkdirSync(packageRoot, { recursive: true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test('writes the guide agent file when target is absent', () => {
    // Set up dist source
    const distDir = join(packageRoot, 'dist', 'agents');
    mkdirSync(distDir, { recursive: true });
    writeFileSync(join(distDir, 'foundry.md'), 'guide content from dist', 'utf8');

    const result = writeFoundryGuideAgent(dir, packageRoot);

    assert.equal(result.ok, true);
    assert.equal(result.written, true);

    const targetPath = join(dir, '.opencode', 'agents', 'foundry.md');
    assert.ok(existsSync(targetPath));
    assert.equal(readFileSync(targetPath, 'utf8'), 'guide content from dist');
  });

  test('returns written: false when target already exists', () => {
    // Create target file first
    const agentsDir = join(dir, '.opencode', 'agents');
    mkdirSync(agentsDir, { recursive: true });
    const targetPath = join(agentsDir, 'foundry.md');
    writeFileSync(targetPath, 'existing guide content', 'utf8');

    // Set up dist source (should not be used)
    const distDir = join(packageRoot, 'dist', 'agents');
    mkdirSync(distDir, { recursive: true });
    writeFileSync(join(distDir, 'foundry.md'), 'new guide content', 'utf8');

    const result = writeFoundryGuideAgent(dir, packageRoot);

    assert.equal(result.ok, true);
    assert.equal(result.written, false);

    // Verify target content was not overwritten
    assert.equal(readFileSync(targetPath, 'utf8'), 'existing guide content');
  });

  test('falls back to src/agents/foundry.md when dist/ is absent', () => {
    // Only set up src source, no dist
    const srcDir = join(packageRoot, 'src', 'agents');
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(join(srcDir, 'foundry.md'), 'guide content from src', 'utf8');

    const result = writeFoundryGuideAgent(dir, packageRoot);

    assert.equal(result.ok, true);
    assert.equal(result.written, true);

    const targetPath = join(dir, '.opencode', 'agents', 'foundry.md');
    assert.ok(existsSync(targetPath));
    assert.equal(readFileSync(targetPath, 'utf8'), 'guide content from src');
  });

  test('returns error when neither dist nor src source exists', () => {
    // No source files at all
    const result = writeFoundryGuideAgent(dir, packageRoot);

    assert.equal(result.ok, false);
    assert.ok(result.error.includes('Failed to write guide agent'));
  });
});
