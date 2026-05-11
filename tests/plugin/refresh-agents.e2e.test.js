import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FoundryPlugin } from '../../src/plugin/foundry.js';

function makeCtx(worktree) { return { worktree }; }

describe('foundry_refresh_agents', () => {
  let dir;
  let originalPath;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'foundry-refresh-'));
    originalPath = process.env.PATH;
  });

  afterEach(() => {
    process.env.PATH = originalPath;
    rmSync(dir, { recursive: true, force: true });
  });

  function installFakeOpencode(models) {
    const binDir = join(dir, 'bin');
    mkdirSync(binDir, { recursive: true });

    // Write a fake `opencode` executable that prints model IDs
    const lines = models.map(m => "console.log('" + m + "');").join('\n');
    const script = '#!/usr/bin/env node\n' + lines + '\n';
    const opencodePath = join(binDir, 'opencode');
    writeFileSync(opencodePath, script, 'utf8');
    chmodSync(opencodePath, 0o755);

    // Prepend to PATH so execFileSync finds our fake
    process.env.PATH = `${binDir}${originalPath.includes(':') ? ':' : ';'}${originalPath}`;
  }

  test('creates agent files for each model', async () => {
    installFakeOpencode([
      'opencode/claude-sonnet-4',
      'github-copilot/gpt-5.4',
      'ollama-cloud/kimi-k2:1t',
    ]);

    const plugin = await FoundryPlugin({ directory: dir });
    const res = JSON.parse(await plugin.tool.foundry_refresh_agents.execute({}, makeCtx(dir)));

    assert.equal(res.ok, true);
    assert.equal(res.count, 3);

    const agentsDir = join(dir, '.opencode', 'agents');
    assert.ok(existsSync(join(agentsDir, 'foundry-opencode-claude-sonnet-4.md')));
    assert.ok(existsSync(join(agentsDir, 'foundry-github-copilot-gpt-5-4.md')));
    assert.ok(existsSync(join(agentsDir, 'foundry-ollama-cloud-kimi-k2:1t.md')));

    // Verify frontmatter content
    const content = readFileSync(join(agentsDir, 'foundry-opencode-claude-sonnet-4.md'), 'utf8');
    assert.ok(content.includes('model: "opencode/claude-sonnet-4"'));
    assert.ok(content.includes('mode: subagent'));

    // Verify guide agent is installed
    const guideContent = readFileSync(join(agentsDir, 'foundry.md'), 'utf8');
    assert.ok(guideContent.includes('You are the Foundry agent.'));
    assert.equal(res.guideAgent, true);
  });

  test('deletes stale agent files before creating new ones', async () => {
    const agentsDir = join(dir, '.opencode', 'agents');
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(join(agentsDir, 'foundry-stale-provider-model.md'), 'old', 'utf8');
    writeFileSync(join(agentsDir, 'other-agent.md'), 'keep', 'utf8');

    installFakeOpencode(['opencode/claude-sonnet-4']);

    const plugin = await FoundryPlugin({ directory: dir });
    const res = JSON.parse(await plugin.tool.foundry_refresh_agents.execute({}, makeCtx(dir)));

    assert.equal(res.ok, true);
    assert.equal(res.count, 1);

    assert.ok(!existsSync(join(agentsDir, 'foundry-stale-provider-model.md')));
    assert.ok(existsSync(join(agentsDir, 'other-agent.md')));

    // Verify guide agent is preserved and non-stage agents are untouched
    assert.ok(existsSync(join(agentsDir, 'foundry.md')));
    assert.ok(existsSync(join(agentsDir, 'other-agent.md')));
  });

  test('returns error when opencode models fails', async () => {
    const binDir = join(dir, 'bin');
    mkdirSync(binDir, { recursive: true });
    const script = `#!/usr/bin/env node\nprocess.stderr.write('no connection');\nprocess.exit(1);\n`;
    const opencodePath = join(binDir, 'opencode');
    writeFileSync(opencodePath, script, 'utf8');
    chmodSync(opencodePath, 0o755);
    process.env.PATH = `${binDir}${originalPath.includes(':') ? ':' : ';'}${originalPath}`;

    const plugin = await FoundryPlugin({ directory: dir });
    const res = JSON.parse(await plugin.tool.foundry_refresh_agents.execute({}, makeCtx(dir)));

    assert.equal(res.ok, false);
    assert.ok(res.error.includes('foundry_refresh_agents:'));
  });

  test('preserves and refreshes the user-facing Foundry guide agent', async () => {
    const agentsDir = join(dir, '.opencode', 'agents');
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(join(agentsDir, 'foundry.md'), 'old guide', 'utf8');
    writeFileSync(join(agentsDir, 'foundry-old-stage.md'), 'old stage', 'utf8');

    installFakeOpencode(['opencode/claude-sonnet-4']);

    const plugin = await FoundryPlugin({ directory: dir });
    const res = JSON.parse(await plugin.tool.foundry_refresh_agents.execute({}, makeCtx(dir)));

    assert.equal(res.ok, true);
    assert.equal(res.guideAgent, true);
    assert.ok(!existsSync(join(agentsDir, 'foundry-old-stage.md')));

    const guideContent = readFileSync(join(agentsDir, 'foundry.md'), 'utf8');
    assert.ok(guideContent.includes('You are the Foundry agent.'));
  });
});
