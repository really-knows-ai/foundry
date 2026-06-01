// tests/plugin/agent-refresh-stage-files.test.js
// Verify that after a simplified refreshAgents call, no per-model or
// role-based stage agent files exist in .opencode/agents/.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { refreshAgents, isModelledAgent } from '../../src/plugin/tools/agent-refresh.js';

function tmpDir() {
  return mkdtempSync(join(tmpdir(), 'agent-refresh-'));
}

function makeAgentsDir(root) {
  const dir = join(root, '.opencode', 'agents');
  mkdirSync(dir, { recursive: true });
  return dir;
}

test('no stage agent files written after refresh', async () => {
  const root = tmpDir();
  try {
    makeAgentsDir(root);
    const result = await refreshAgents(root);
    assert.ok(result.ok);
    assert.equal(result.count, 0);
    // No foundry-*.md files except possibly foundry.md
    const agentsDir = join(root, '.opencode', 'agents');
    const files = readdirSync(agentsDir).filter(f => f.startsWith('foundry-') && f.endsWith('.md'));
    assert.equal(files.length, 0, 'should not write any foundry-*.md files');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('stale per-model agent files are deleted', async () => {
  const root = tmpDir();
  try {
    const agentsDir = makeAgentsDir(root);
    writeFileSync(join(agentsDir, 'foundry-opencode-go-deepseek-v4-flash.md'), '# agent\n', 'utf8');
    writeFileSync(join(agentsDir, 'foundry-github-copilot-claude-sonnet-4-6.md'), '# agent\n', 'utf8');
    const result = await refreshAgents(root);
    assert.ok(result.ok);
    // Old files should be deleted
    assert.ok(!existsSync(join(agentsDir, 'foundry-opencode-go-deepseek-v4-flash.md')));
    assert.ok(!existsSync(join(agentsDir, 'foundry-github-copilot-claude-sonnet-4-6.md')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('stale role-based agent files are deleted', async () => {
  const root = tmpDir();
  try {
    const agentsDir = makeAgentsDir(root);
    writeFileSync(join(agentsDir, 'foundry-forge.md'), '# agent\n', 'utf8');
    writeFileSync(join(agentsDir, 'foundry-appraise.md'), '# agent\n', 'utf8');
    const result = await refreshAgents(root);
    assert.ok(result.ok);
    assert.ok(!existsSync(join(agentsDir, 'foundry-forge.md')));
    assert.ok(!existsSync(join(agentsDir, 'foundry-appraise.md')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('guide agent is preserved', async () => {
  const root = tmpDir();
  try {
    const agentsDir = makeAgentsDir(root);
    writeFileSync(join(agentsDir, 'foundry.md'), '# Guide agent\n', 'utf8');
    writeFileSync(join(agentsDir, 'foundry-forge.md'), '# agent\n', 'utf8');
    writeFileSync(join(agentsDir, 'foundry-appraise.md'), '# agent\n', 'utf8');
    const result = await refreshAgents(root);
    assert.ok(result.ok);
    // Guide agent should survive
    assert.ok(existsSync(join(agentsDir, 'foundry.md')), 'guide agent should be preserved');
    // Stale files should be deleted
    assert.ok(!existsSync(join(agentsDir, 'foundry-forge.md')));
    assert.ok(!existsSync(join(agentsDir, 'foundry-appraise.md')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('isModelledAgent excludes only the guide agent', () => {
  assert.equal(isModelledAgent('foundry.md'), false);
  assert.equal(isModelledAgent('foundry-forge.md'), true);
  assert.equal(isModelledAgent('foundry-appraise.md'), true);
  assert.equal(isModelledAgent('foundry-opencode-go-deepseek-v4-flash.md'), true);
});
