// Bootstrap logic tests — verifies the config hook decision tree and
// the getBootstrapContent restart/ready message variants.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync,
  existsSync, chmodSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FoundryPlugin } from '../src/plugin/foundry.js';
import { getBootstrapContent } from '../src/plugin/tools/helpers.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function installFakeOpencode(binDir, models) {
  mkdirSync(binDir, { recursive: true });

  let script;
  if (models === null) {
    // Simulate a failing opencode CLI
    script = '#!/usr/bin/env node\nprocess.stderr.write("connection error");\nprocess.exit(1);\n';
  } else if (models.length === 0) {
    script = '#!/usr/bin/env node\nconsole.log("");\n';
  } else {
    const lines = models.map(m => "console.log('" + m + "');").join('\n');
    script = '#!/usr/bin/env node\n' + lines + '\n';
  }

  const opencodePath = join(binDir, 'opencode');
  writeFileSync(opencodePath, script, 'utf8');
  chmodSync(opencodePath, 0o755);
}

/**
 * Bootstrap the given directory by running the plugin config hook with
 * a fake opencode that returns the given models.
 */
async function runConfigHook(dir, binDir, models) {
  const originalPath = process.env.PATH;
  try {
    process.env.PATH = `${binDir}:${originalPath}`;
    installFakeOpencode(binDir, models);

    const plugin = await FoundryPlugin({ directory: dir });
    await plugin.config({ skills: {} });
    return plugin;
  } finally {
    process.env.PATH = originalPath;
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('bootstrap — config hook', () => {
  let dir;
  let binDir;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bootstrap-config-'));
    binDir = join(dir, 'bin');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test('new project: creates directories, writes VERSION, sets restartNeeded', async () => {
    const plugin = await runConfigHook(dir, binDir, ['opencode/claude-sonnet-4']);

    // Directory structure created
    assert.ok(existsSync(join(dir, 'foundry')));
    assert.ok(existsSync(join(dir, 'foundry', 'artefacts')));
    assert.ok(existsSync(join(dir, 'foundry', 'flows')));
    assert.ok(existsSync(join(dir, 'foundry', 'cycles')));
    assert.ok(existsSync(join(dir, 'foundry', 'laws')));
    assert.ok(existsSync(join(dir, 'foundry', 'appraisers')));

    // VERSION written with the correct plugin version
    const versionPath = join(dir, 'foundry', 'VERSION');
    assert.ok(existsSync(versionPath));
    const version = readFileSync(versionPath, 'utf8').trim();
    assert.equal(version, '3.1.0');

    // Agent files created in .opencode/agents/
    const agentsDir = join(dir, '.opencode', 'agents');
    assert.ok(existsSync(join(agentsDir, 'foundry-opencode-claude-sonnet-4.md')));

    // Guide agent written
    assert.ok(existsSync(join(agentsDir, 'foundry.md')));

    // restartNeeded flag set
    const restartNeeded = plugin[Symbol.for('foundry.test.restartNeeded')];
    assert.equal(restartNeeded, true);
  });

  test('existing project with correct VERSION and no agent changes: no bootstrap', async () => {
    // Pre-seed foundry/ with correct VERSION
    const foundryDir = join(dir, 'foundry');
    mkdirSync(foundryDir, { recursive: true });
    writeFileSync(join(foundryDir, 'VERSION'), '3.1.0', 'utf8');

    // Pre-seed .opencode/agents/ to match what opencode produces
    const agentsDir = join(dir, '.opencode', 'agents');
    mkdirSync(agentsDir, { recursive: true });
    const modelId = 'opencode/claude-sonnet-4';
    const slug = 'opencode-claude-sonnet-4';
    const agentContent = `---
description: "Foundry stage agent using ${modelId}"
mode: subagent
model: "${modelId}"
hidden: true
---
You are a Foundry stage agent. Follow the skill instructions provided in your task prompt exactly.
`;
    writeFileSync(join(agentsDir, `foundry-${slug}.md`), agentContent, 'utf8');

    const plugin = await runConfigHook(dir, binDir, [modelId]);

    // foundry/ should NOT have been re-created (no subdirectories from bootstrap)
    assert.equal(existsSync(join(dir, 'foundry', 'artefacts')), false);
    assert.equal(existsSync(join(dir, 'foundry', 'flows')), false);

    // VERSION unchanged
    assert.equal(readFileSync(join(foundryDir, 'VERSION'), 'utf8').trim(), '3.1.0');

    // Agent files intact
    assert.ok(existsSync(join(agentsDir, `foundry-${slug}.md`)));

    // restartNeeded stays false
    const restartNeeded = plugin[Symbol.for('foundry.test.restartNeeded')];
    assert.equal(restartNeeded, false);
  });

  test('existing project with wrong VERSION: re-bootstrap', async () => {
    // Pre-seed foundry/ with an old VERSION
    const foundryDir = join(dir, 'foundry');
    mkdirSync(foundryDir, { recursive: true });
    writeFileSync(join(foundryDir, 'VERSION'), '0.0.1', 'utf8');

    const plugin = await runConfigHook(dir, binDir, ['opencode/claude-sonnet-4']);

    // Bootstrap ran: subdirectories and .gitignore created
    assert.ok(existsSync(join(dir, 'foundry', 'artefacts')));
    assert.ok(existsSync(join(dir, 'foundry', 'flows')));

    // VERSION overwritten
    assert.equal(readFileSync(join(foundryDir, 'VERSION'), 'utf8').trim(), '3.1.0');

    // Agent files created
    assert.ok(existsSync(join(dir, '.opencode', 'agents', 'foundry-opencode-claude-sonnet-4.md')));

    // restartNeeded set
    const restartNeeded = plugin[Symbol.for('foundry.test.restartNeeded')];
    assert.equal(restartNeeded, true);
  });

  test('existing project with correct VERSION but agent set changed: agents refreshed, not full bootstrap', async () => {
    // Pre-seed foundry/ with correct VERSION (needed to pass version check)
    const foundryDir = join(dir, 'foundry');
    mkdirSync(foundryDir, { recursive: true });
    writeFileSync(join(foundryDir, 'VERSION'), '3.1.0', 'utf8');

    // Pre-seed agent files that are STALE (different model than opencode returns)
    const agentsDir = join(dir, '.opencode', 'agents');
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(join(agentsDir, 'foundry-stale-model.md'), 'stale content', 'utf8');

    // opencode returns a different model
    const plugin = await runConfigHook(dir, binDir, ['opencode/claude-sonnet-4']);

    // Bootstrap subdirectories should NOT exist (full bootstrap did not run)
    assert.equal(existsSync(join(dir, 'foundry', 'artefacts')), false);
    assert.equal(existsSync(join(dir, 'foundry', 'flows')), false);

    // VERSION unchanged (full bootstrap did not run)
    assert.equal(readFileSync(join(foundryDir, 'VERSION'), 'utf8').trim(), '3.1.0');

    // Old agent gone, new agent written
    assert.equal(existsSync(join(agentsDir, 'foundry-stale-model.md')), false);
    assert.ok(existsSync(join(agentsDir, 'foundry-opencode-claude-sonnet-4.md')));

    // restartNeeded set because agents changed
    const restartNeeded = plugin[Symbol.for('foundry.test.restartNeeded')];
    assert.equal(restartNeeded, true);
  });

  test('bootstrap wrapped in try/catch — plugin loads even if opencode models fails', async () => {
    // No foundry/ exists, opencode fails
    const plugin = await runConfigHook(dir, binDir, null);

    // Plugin loaded without throwing — config hook caught the error
    // Bootstrap should have attempted but opencode failure was caught
    const restartNeeded = plugin[Symbol.for('foundry.test.restartNeeded')];

    // Note: when opencode fails, refreshAgents returns { ok: false, error }
    // but runBootstrapSequence doesn't check the return, so it continues.
    // Directories may have been created, VERSION may have been written.
    // The key assertion is that the plugin loaded and the test did not throw.

    // restartNeeded should be true because bootstrap ran (even if agents failed)
    assert.equal(restartNeeded, true);

    // Directories should be created (non-agent bootstrap steps succeed)
    assert.ok(existsSync(join(dir, 'foundry')));
    assert.ok(existsSync(join(dir, 'foundry', 'artefacts')));
  });
});

describe('bootstrap — .gitignore idempotent', () => {
  let dir;
  let binDir;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bootstrap-gitignore-'));
    binDir = join(dir, 'bin');
    const originalPath = process.env.PATH;
    process.env.PATH = `${binDir}:${originalPath}`;
    installFakeOpencode(binDir, ['opencode/claude-sonnet-4']);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test('creates .gitignore when absent and appends expected lines', async () => {
    const plugin = await FoundryPlugin({ directory: dir });
    await plugin.config({ skills: {} });

    const gitignorePath = join(dir, '.gitignore');
    assert.ok(existsSync(gitignorePath));

    const content = readFileSync(gitignorePath, 'utf8');
    assert.ok(content.includes('.snapshots/'));
    assert.ok(content.includes('node_modules/'));
    assert.ok(content.includes('.DS_Store'));
  });

  test('appends lines only when missing (idempotent)', async () => {
    // Pre-create .gitignore with some lines already present
    const gitignorePath = join(dir, '.gitignore');
    writeFileSync(gitignorePath, '.snapshots/\nnode_modules/\n', 'utf8');

    // Run config hook twice
    const plugin = await FoundryPlugin({ directory: dir });
    await plugin.config({ skills: {} });
    await plugin.config({ skills: {} });

    // Read and check content has .DS_Store appended once, others unchanged
    const content = readFileSync(gitignorePath, 'utf8');
    const lines = content.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    assert.equal(lines.filter(l => l === '.snapshots/').length, 1);
    assert.equal(lines.filter(l => l === 'node_modules/').length, 1);
    assert.equal(lines.filter(l => l === '.DS_Store').length, 1);
  });
});

describe('getBootstrapContent — message variants', () => {
  let dir;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bootstrap-msg-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test('restartNeeded with no foundry/ returns restart message', () => {
    const msg = getBootstrapContent(dir, dir, true);
    assert.ok(msg.includes('Restart OpenCode'));
    assert.ok(msg.includes('Foundry initialised'));
    assert.ok(msg.includes('FOUNDRY_CONTEXT'));
  });

  test('restartNeeded = false with existing foundry/ returns ready message', () => {
    const foundryDir = join(dir, 'foundry');
    mkdirSync(foundryDir, { recursive: true });
    mkdirSync(join(foundryDir, 'flows'), { recursive: true });

    const msg = getBootstrapContent(dir, dir, false);
    assert.ok(msg.includes('Foundry is active'));
    assert.ok(msg.includes('FOUNDRY_CONTEXT'));

    // Restart message should NOT appear
    assert.equal(msg.includes('Restart OpenCode'), false);
  });

  test('restartNeeded = true with existing foundry/ returns restart message (bootstrap just ran)', () => {
    const foundryDir = join(dir, 'foundry');
    mkdirSync(foundryDir, { recursive: true });

    const msg = getBootstrapContent(dir, dir, true);
    assert.ok(msg.includes('Restart OpenCode'));
    assert.ok(msg.includes('Foundry initialised'));
  });
});
