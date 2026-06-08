// Bootstrap logic tests — verifies the config hook decision tree and
// the getBootstrapContent restart/ready message variants.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FoundryPlugin } from '../src/plugin/foundry.js';
import { getBootstrapContent } from '../src/plugin/tools/helpers.js';

const PKG_VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

const AGENT_NAMES = [
  'foundry-guide',
  'foundry-admin',
  'foundry-forge',
  'foundry-appraise',
  'foundry-assay',
];

function assertAllFiveAgentsExist(agentsDir) {
  for (const name of AGENT_NAMES) {
    const exists = existsSync(join(agentsDir, `${name}.md`));
    assert.ok(exists, `${name}.md must exist under ${agentsDir}`);
  }
}

function assertOldAgentDeleted(agentsDir) {
  assert.equal(existsSync(join(agentsDir, 'foundry.md')), false, 'old foundry.md must be deleted');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('bootstrap — config hook', () => {
  let dir;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bootstrap-config-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test('new project: creates directories, writes VERSION, sets restartNeeded', async () => {
    const plugin = await FoundryPlugin({ directory: dir });
    await plugin.config({ skills: {} });

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
    assert.equal(version, PKG_VERSION);

    // All five agent files written
    const agentsDir = join(dir, '.opencode', 'agents');
    assertOldAgentDeleted(agentsDir);
    assertAllFiveAgentsExist(agentsDir);

    // restartNeeded flag set
    const restartNeeded = plugin[Symbol.for('foundry.test.restartNeeded')];
    assert.equal(restartNeeded, true);
  });

  test('existing project with correct VERSION: no full bootstrap but agents deployed', async () => {
    // Pre-seed foundry/ with correct VERSION
    const foundryDir = join(dir, 'foundry');
    mkdirSync(foundryDir, { recursive: true });
    writeFileSync(join(foundryDir, 'VERSION'), PKG_VERSION, 'utf8');

    // Pre-seed old guide agent
    const agentsDir = join(dir, '.opencode', 'agents');
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(join(agentsDir, 'foundry.md'), 'guide', 'utf8');

    const plugin = await FoundryPlugin({ directory: dir });
    await plugin.config({ skills: {} });

    // foundry/ should NOT have been re-created (no subdirectories from bootstrap)
    assert.equal(existsSync(join(dir, 'foundry', 'artefacts')), false);
    assert.equal(existsSync(join(dir, 'foundry', 'flows')), false);

    // VERSION unchanged
    assert.equal(readFileSync(join(foundryDir, 'VERSION'), 'utf8').trim(), PKG_VERSION);

    // Old foundry.md deleted and five new agents deployed unconditionally
    assertOldAgentDeleted(agentsDir);
    assertAllFiveAgentsExist(agentsDir);

    // restartNeeded stays false
    const restartNeeded = plugin[Symbol.for('foundry.test.restartNeeded')];
    assert.equal(restartNeeded, false);
  });

  test('existing project with wrong VERSION: re-bootstrap', async () => {
    // Pre-seed foundry/ with an old VERSION
    const foundryDir = join(dir, 'foundry');
    mkdirSync(foundryDir, { recursive: true });
    writeFileSync(join(foundryDir, 'VERSION'), '0.0.1', 'utf8');

    const plugin = await FoundryPlugin({ directory: dir });
    await plugin.config({ skills: {} });

    // Bootstrap ran: subdirectories and .gitignore created
    assert.ok(existsSync(join(dir, 'foundry', 'artefacts')));
    assert.ok(existsSync(join(dir, 'foundry', 'flows')));

    // VERSION overwritten
    assert.equal(readFileSync(join(foundryDir, 'VERSION'), 'utf8').trim(), PKG_VERSION);

    // Old agent deleted and five new agents written
    assertOldAgentDeleted(join(dir, '.opencode', 'agents'));
    assertAllFiveAgentsExist(join(dir, '.opencode', 'agents'));

    // restartNeeded set
    const restartNeeded = plugin[Symbol.for('foundry.test.restartNeeded')];
    assert.equal(restartNeeded, true);
  });

  test('existing project with correct VERSION: migration deletes old agent, writes all five', async () => {
    // Pre-seed foundry/ with correct VERSION (needed to pass version check)
    const foundryDir = join(dir, 'foundry');
    mkdirSync(foundryDir, { recursive: true });
    writeFileSync(join(foundryDir, 'VERSION'), PKG_VERSION, 'utf8');

    // Pre-seed stale agent files (stale file unrelated to the five new agents)
    const agentsDir = join(dir, '.opencode', 'agents');
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(join(agentsDir, 'foundry-stale-model.md'), 'stale content', 'utf8');
    // Pre-seed old foundry.md — migration should delete it
    writeFileSync(join(agentsDir, 'foundry.md'), 'old guide content', 'utf8');

    const plugin = await FoundryPlugin({ directory: dir });
    await plugin.config({ skills: {} });

    // Bootstrap subdirectories should NOT exist (full bootstrap did not run)
    assert.equal(existsSync(join(dir, 'foundry', 'artefacts')), false);
    assert.equal(existsSync(join(dir, 'foundry', 'flows')), false);

    // VERSION unchanged (full bootstrap did not run)
    assert.equal(readFileSync(join(foundryDir, 'VERSION'), 'utf8').trim(), PKG_VERSION);

    // Pre-existing stale file remains (unrelated to migration)
    assert.equal(existsSync(join(agentsDir, 'foundry-stale-model.md')), true);

    // Old foundry.md deleted by migration
    assertOldAgentDeleted(agentsDir);

    // All five new agent files written unconditionally
    assertAllFiveAgentsExist(agentsDir);

    // restartNeeded not set (no version match, no full bootstrap)
    const restartNeeded = plugin[Symbol.for('foundry.test.restartNeeded')];
    assert.equal(restartNeeded, false);
  });

  test('plugin loads even in empty project with no opencode binary', async () => {
    // No foundry/ exists, no opencode binary needed anymore
    const plugin = await FoundryPlugin({ directory: dir });
    await plugin.config({ skills: {} });

    // Plugin loaded without throwing
    const restartNeeded = plugin[Symbol.for('foundry.test.restartNeeded')];

    // Bootstrap ran — directories created
    assert.ok(existsSync(join(dir, 'foundry')));
    assert.ok(existsSync(join(dir, 'foundry', 'artefacts')));

    // restartNeeded should be true because bootstrap ran
    assert.equal(restartNeeded, true);
  });
});

describe('bootstrap — .gitignore idempotent', () => {
  let dir;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bootstrap-gitignore-'));
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
    assert.ok(msg.includes('restart OpenCode'));
    assert.ok(msg.includes('initialised'));
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
    assert.equal(msg.includes('restart OpenCode'), false);
  });

  test('restartNeeded = true with existing foundry/ returns restart message (bootstrap just ran)', () => {
    const foundryDir = join(dir, 'foundry');
    mkdirSync(foundryDir, { recursive: true });

    const msg = getBootstrapContent(dir, dir, true);
    assert.ok(msg.includes('restart OpenCode'));
    assert.ok(msg.includes('initialised'));
  });
});

describe('bootstrap — v1 plugin loading path', () => {
  let dir;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bootstrap-v1-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test('dist module exports default { server: FoundryPlugin } matching v1 format', async () => {
    const distPath = new URL('../dist/.opencode/plugins/foundry.js', import.meta.url).pathname;
    const mod = await import(distPath);

    // v1 format: default export is an object with server function
    assert.equal(typeof mod.default, 'object', 'mod.default must be an object');
    assert.equal(typeof mod.default.server, 'function', 'mod.default.server must be a function');
    assert.equal(mod.default.server, mod.FoundryPlugin, 'server must be FoundryPlugin');
  });

  test('mod.default.server(input) returns hooks matching opencode v1 path', async () => {
    const distPath = new URL('../dist/.opencode/plugins/foundry.js', import.meta.url).pathname;
    const mod = await import(distPath);

    // Mimicking opencode's applyPlugin: readV1Plugin → plugin.server(input)
    const plugin = await mod.default.server({ directory: dir, client: null });

    assert.ok(plugin.config, 'hooks must include config');
    assert.ok(plugin['experimental.chat.messages.transform'], 'hooks must include messages.transform');
    assert.ok(plugin.tool, 'hooks must include tool');
  });

  test('config hook via v1 path deploys agents and bootstraps foundry/', async () => {
    const distPath = new URL('../dist/.opencode/plugins/foundry.js', import.meta.url).pathname;
    const mod = await import(distPath);
    const plugin = await mod.default.server({ directory: dir, client: null });

    await plugin.config({ skills: {} });

    // Agents deployed
    const agentsDir = join(dir, '.opencode', 'agents');
    assert.ok(existsSync(agentsDir), '.opencode/agents must exist');
    assertAllFiveAgentsExist(agentsDir);

    // Foundry bootstrapped
    assert.ok(existsSync(join(dir, 'foundry', 'artefacts')), 'foundry/ must be bootstrapped');

    // restartNeeded set
    assert.equal(plugin[Symbol.for('foundry.test.restartNeeded')], true);
  });

  test('messages.transform via v1 path injects FOUNDRY_CONTEXT', async () => {
    const distPath = new URL('../dist/.opencode/plugins/foundry.js', import.meta.url).pathname;
    const mod = await import(distPath);
    const plugin = await mod.default.server({ directory: dir, client: null });

    await plugin.config({ skills: {} });

    const output = {
      messages: [
        { info: { role: 'user' }, parts: [{ type: 'text', text: 'hello' }] },
      ],
    };
    await plugin['experimental.chat.messages.transform']({}, output);
    const parts = output.messages[0].parts;
    assert.ok(parts[0].text.includes('FOUNDRY_CONTEXT'), 'must inject FOUNDRY_CONTEXT');
    assert.ok(parts.length >= 2, 'must prepend to existing parts');
  });
});
