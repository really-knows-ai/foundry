import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { refreshAgents } from '../../src/plugin/tools/agent-refresh.js';

function makeDir() {
  return mkdtempSync(join(tmpdir(), 'fdy-agent-simplified-'));
}

function cleanup(dir) {
  rmSync(dir, { recursive: true, force: true });
}

test('refreshAgents writes no agent files in empty directory', async () => {
  const dir = makeDir();
  try {
    mkdirSync(join(dir, '.opencode', 'agents'), { recursive: true });

    const result = refreshAgents(dir);
    assert.deepStrictEqual(result, { ok: true, count: 0 });

    const agentsDir = join(dir, '.opencode', 'agents');
    const entries = readdirSync(agentsDir).filter(e => e.startsWith('foundry-') && e.endsWith('.md'));
    assert.equal(entries.length, 0);
  } finally {
    cleanup(dir);
  }
});

test('refreshAgents deletes stale foundry-*.md agent files', async () => {
  const dir = makeDir();
  try {
    const agentsDir = join(dir, '.opencode', 'agents');
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(join(agentsDir, 'foundry-opencode-go-deepseek-v4-flash.md'), 'stale', 'utf8');
    writeFileSync(join(agentsDir, 'foundry-stale-provider-model.md'), 'stale', 'utf8');

    const result = refreshAgents(dir);
    assert.deepStrictEqual(result, { ok: true, count: 0 });

    assert.ok(!existsSync(join(agentsDir, 'foundry-opencode-go-deepseek-v4-flash.md')));
    assert.ok(!existsSync(join(agentsDir, 'foundry-stale-provider-model.md')));
  } finally {
    cleanup(dir);
  }
});

test('refreshAgents preserves the guide agent foundry.md', async () => {
  const dir = makeDir();
  try {
    const agentsDir = join(dir, '.opencode', 'agents');
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(join(agentsDir, 'foundry.md'), 'guide agent content', 'utf8');
    writeFileSync(join(agentsDir, 'foundry-opencode-go-deepseek-v4-flash.md'), 'stale', 'utf8');

    const result = refreshAgents(dir);
    assert.deepStrictEqual(result, { ok: true, count: 0 });

    // Guide agent must still exist
    assert.ok(existsSync(join(agentsDir, 'foundry.md')));

    // Stale file must be deleted
    assert.ok(!existsSync(join(agentsDir, 'foundry-opencode-go-deepseek-v4-flash.md')));
  } finally {
    cleanup(dir);
  }
});

test('refreshAgents does not shell out — returns count 0 without external process', async () => {
  const dir = makeDir();
  try {
    mkdirSync(join(dir, '.opencode', 'agents'), { recursive: true });

    // This call must complete without needing an `opencode` binary on PATH
    const result = refreshAgents(dir);
    assert.deepStrictEqual(result, { ok: true, count: 0 });
  } finally {
    cleanup(dir);
  }
});
