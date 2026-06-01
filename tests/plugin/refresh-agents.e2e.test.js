// tests/plugin/refresh-agents.e2e.test.js
// The agent-refresh module was simplified in Phase 1: it no longer generates
// per-model agent files or shells out to `opencode models`. It only deletes
// stale foundry-*.md files and returns { ok: true, count: 0 }.

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FoundryPlugin } from '../../src/plugin/foundry.js';

function makeCtx(worktree) { return { worktree }; }

describe('foundry_refresh_agents (simplified)', () => {
  let dir;

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test('returns ok with count 0 (no agent files generated)', async () => {
    dir = mkdtempSync(join(tmpdir(), 'foundry-refresh-'));
    const plugin = await FoundryPlugin({ directory: dir });
    const res = JSON.parse(await plugin.tool.foundry_refresh_agents.execute({}, makeCtx(dir)));

    assert.equal(res.ok, true);
    assert.equal(res.count, 0);
  });

  test('deletes stale foundry-*.md stage agent files', async () => {
    dir = mkdtempSync(join(tmpdir(), 'foundry-refresh-'));
    const agentsDir = join(dir, '.opencode', 'agents');
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(join(agentsDir, 'foundry-stale-provider-model.md'), 'old', 'utf8');
    writeFileSync(join(agentsDir, 'foundry-forge.md'), 'old forge', 'utf8');
    writeFileSync(join(agentsDir, 'foundry.md'), 'guide', 'utf8');
    writeFileSync(join(agentsDir, 'other-agent.md'), 'keep', 'utf8');

    const plugin = await FoundryPlugin({ directory: dir });
    const res = JSON.parse(await plugin.tool.foundry_refresh_agents.execute({}, makeCtx(dir)));

    assert.equal(res.ok, true);

    // Stale foundry-*.md files (not foundry.md) should be deleted
    assert.ok(!existsSync(join(agentsDir, 'foundry-stale-provider-model.md')));
    assert.ok(!existsSync(join(agentsDir, 'foundry-forge.md')));

    // Guide agent is preserved
    assert.ok(existsSync(join(agentsDir, 'foundry.md')));
    assert.equal(readFileSync(join(agentsDir, 'foundry.md'), 'utf8'), 'guide');

    // Non-foundry files are untouched
    assert.ok(existsSync(join(agentsDir, 'other-agent.md')));
  });

  test('preserves guide agent when no stale files exist', async () => {
    dir = mkdtempSync(join(tmpdir(), 'foundry-refresh-'));
    const agentsDir = join(dir, '.opencode', 'agents');
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(join(agentsDir, 'foundry.md'), 'guide', 'utf8');

    const plugin = await FoundryPlugin({ directory: dir });
    const res = JSON.parse(await plugin.tool.foundry_refresh_agents.execute({}, makeCtx(dir)));

    assert.equal(res.ok, true);
    assert.ok(existsSync(join(agentsDir, 'foundry.md')));
    assert.equal(readFileSync(join(agentsDir, 'foundry.md'), 'utf8'), 'guide');
  });
});
