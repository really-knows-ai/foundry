import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync,
  existsSync, chmodSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  refreshAgents,
  detectChanges,
  writeFoundryGuideAgent,
} from '../src/plugin/tools/agent-refresh.js';

/**
 * Install a fake `opencode` CLI into a bin directory that is prepended to PATH.
 * @param {string} binDir
 * @param {string[]} models — list of model IDs the fake should output, or null to simulate failure
 */
function installFakeOpencode(binDir, models) {
  mkdirSync(binDir, { recursive: true });

  let script;
  if (models === null) {
    // Simulate a failing opencode CLI
    script = '#!/usr/bin/env node\nprocess.stderr.write("connection error");\nprocess.exit(1);\n';
  } else if (models.length === 0) {
    // Simulate empty output (no models)
    script = '#!/usr/bin/env node\nconsole.log("");\n';
  } else {
    const lines = models.map(m => "console.log('" + m + "');").join('\n');
    script = '#!/usr/bin/env node\n' + lines + '\n';
  }

  const opencodePath = join(binDir, 'opencode');
  writeFileSync(opencodePath, script, 'utf8');
  chmodSync(opencodePath, 0o755);
}

describe('refreshAgents', () => {
  let dir;
  let binDir;
  let originalPath;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'agent-refresh-'));
    binDir = join(dir, 'bin');
    originalPath = process.env.PATH;
  });

  afterEach(() => {
    process.env.PATH = originalPath;
    rmSync(dir, { recursive: true, force: true });
  });

  function withFakePath() {
    process.env.PATH = `${binDir}${originalPath.includes(':') ? ':' : ';'}${originalPath}`;
  }

  test('returns { ok: true, count } when models are found', () => {
    installFakeOpencode(binDir, [
      'opencode/claude-sonnet-4',
      'github-copilot/gpt-5.4',
      'ollama-cloud/kimi-k2:1t',
    ]);
    withFakePath();

    const result = refreshAgents(dir);

    assert.equal(result.ok, true);
    assert.equal(result.count, 3);

    const agentsDir = join(dir, '.opencode', 'agents');
    assert.ok(existsSync(join(agentsDir, 'foundry-opencode-claude-sonnet-4.md')));
    assert.ok(existsSync(join(agentsDir, 'foundry-github-copilot-gpt-5-4.md')));
    assert.ok(existsSync(join(agentsDir, 'foundry-ollama-cloud-kimi-k2:1t.md')));
  });

  test('returns { ok: false, error } when opencode models returns no models', () => {
    installFakeOpencode(binDir, []);
    withFakePath();

    const result = refreshAgents(dir);

    assert.equal(result.ok, false);
    assert.ok(result.error.includes('No models returned'));
  });

  test('returns { ok: false, error } when opencode CLI fails', () => {
    installFakeOpencode(binDir, null);
    withFakePath();

    const result = refreshAgents(dir);

    assert.equal(result.ok, false);
    assert.ok(result.error.length > 0);
  });
});

describe('detectChanges', () => {
  let dir;
  let binDir;
  let originalPath;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'detect-changes-'));
    binDir = join(dir, 'bin');
    originalPath = process.env.PATH;
  });

  afterEach(() => {
    process.env.PATH = originalPath;
    rmSync(dir, { recursive: true, force: true });
  });

  function withFakePath() {
    process.env.PATH = `${binDir}${originalPath.includes(':') ? ':' : ';'}${originalPath}`;
  }

  test('returns changed: false when no models change', () => {
    // Pre-create agent files that match what opencode models would produce
    const agentsDir = join(dir, '.opencode', 'agents');
    mkdirSync(agentsDir, { recursive: true });

    const models = ['opencode/claude-sonnet-4'];
    const slug = 'opencode-claude-sonnet-4';
    const content = `---
description: "Foundry stage agent using opencode/claude-sonnet-4"
mode: subagent
model: "opencode/claude-sonnet-4"
hidden: true
---
You are a Foundry stage agent. Follow the skill instructions provided in your task prompt exactly.
`;
    writeFileSync(join(agentsDir, `foundry-${slug}.md`), content, 'utf8');

    // Pre-seed default stage agents
    const defaultAgent = `---
description: "Default Foundry forge stage agent"
mode: subagent
hidden: true
---
You are a Foundry stage agent. Follow the skill instructions provided in your task prompt exactly.
`;
    writeFileSync(join(agentsDir, 'foundry-forge.md'), defaultAgent, 'utf8');
    writeFileSync(join(agentsDir, 'foundry-appraise.md'), defaultAgent.replace('forge', 'appraise'), 'utf8');

    installFakeOpencode(binDir, models);
    withFakePath();

    const result = detectChanges(dir);

    assert.equal(result.ok, true);
    assert.equal(result.changed, false);
    assert.equal(result.count, 1);
  });

  test('returns changed: true when a new model appears', () => {
    // Pre-create agent files for the first model only
    const agentsDir = join(dir, '.opencode', 'agents');
    mkdirSync(agentsDir, { recursive: true });

    const slug = 'opencode-claude-sonnet-4';
    const content = `---
description: "Foundry stage agent using opencode/claude-sonnet-4"
mode: subagent
model: "opencode/claude-sonnet-4"
hidden: true
---
You are a Foundry stage agent. Follow the skill instructions provided in your task prompt exactly.
`;
    writeFileSync(join(agentsDir, `foundry-${slug}.md`), content, 'utf8');

    // Now opencode returns TWO models (one new)
    installFakeOpencode(binDir, [
      'opencode/claude-sonnet-4',
      'github-copilot/gpt-5.4',
    ]);
    withFakePath();

    const result = detectChanges(dir);

    assert.equal(result.ok, true);
    assert.equal(result.changed, true);
    assert.equal(result.count, 2);
  });

  test('propagates { ok: false, error } when refreshAgents fails', () => {
    installFakeOpencode(binDir, []);
    withFakePath();

    const result = detectChanges(dir);

    assert.equal(result.ok, false);
    assert.ok(result.error.includes('No models returned'));
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
