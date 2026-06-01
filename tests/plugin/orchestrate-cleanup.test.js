// tests/plugin/orchestrate-cleanup.test.js
// Verify that all remnants of the old LLM-driven orchestration system are removed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = join(fileURLToPath(import.meta.url), '..');
const ROOT = join(__dirname, '..', '..');

test('orchestrate skill file is removed', () => {
  const skillPath = join(ROOT, 'src', 'skills', 'orchestrate', 'SKILL.md');
  assert.ok(!existsSync(skillPath), 'orchestrate SKILL.md should be deleted');
});

test('orchestrate-tool.js is deleted', () => {
  const toolPath = join(ROOT, 'src', 'plugin', 'tools', 'orchestrate-tool.js');
  assert.ok(!existsSync(toolPath), 'orchestrate-tool.js should be deleted');
});

test('orchestrate.js is deleted', () => {
  const scriptPath = join(ROOT, 'src', 'scripts', 'orchestrate.js');
  assert.ok(!existsSync(scriptPath), 'orchestrate.js should be deleted');
});

test('orchestrate-dispatch.js is deleted', () => {
  const scriptPath = join(ROOT, 'src', 'scripts', 'orchestrate-dispatch.js');
  assert.ok(!existsSync(scriptPath), 'orchestrate-dispatch.js should be deleted');
});

test('orchestrate-phases.js is deleted', () => {
  const scriptPath = join(ROOT, 'src', 'scripts', 'orchestrate-phases.js');
  assert.ok(!existsSync(scriptPath), 'orchestrate-phases.js should be deleted');
});

test('FOUNDRY_SKIP_BOOTSTRAP guard is removed from foundry.js', () => {
  const foundryPath = join(ROOT, 'src', 'plugin', 'foundry.js');
  const content = readFileSync(foundryPath, 'utf8');
  assert.ok(!content.includes('FOUNDRY_SKIP_BOOTSTRAP'),
    'FOUNDRY_SKIP_BOOTSTRAP should not appear in foundry.js');
  assert.ok(!content.includes('runPluginBootstrap'),
    'runPluginBootstrap should not appear in foundry.js');
});
