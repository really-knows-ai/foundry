import { test } from 'node:test';
import assert from 'node:assert';
import { FoundryPlugin } from '../../.opencode/plugins/foundry.js';

// These tests exercise the plugin's public surface: instantiate it and
// check which tools are registered. After the v2.5.x plugin-file split,
// tool registrations live in `.opencode/plugins/foundry-tools/*` modules
// rather than inline in `foundry.js`, so grepping the entry file text no
// longer reflects what's registered.
const plugin = await FoundryPlugin({ directory: process.cwd() });
const toolNames = new Set(Object.keys(plugin.tool));

test('plugin registers foundry_orchestrate', () => {
  assert.ok(toolNames.has('foundry_orchestrate'));
});

test('plugin does NOT register foundry_sort', () => {
  assert.ok(!toolNames.has('foundry_sort'));
});

test('plugin does NOT register foundry_history_append', () => {
  assert.ok(!toolNames.has('foundry_history_append'));
});

test('plugin does NOT register foundry_stage_finalize', () => {
  assert.ok(!toolNames.has('foundry_stage_finalize'));
});

test('plugin does NOT register foundry_git_commit', () => {
  assert.ok(!toolNames.has('foundry_git_commit'));
});

test('plugin does NOT register foundry_workfile_configure_from_cycle', () => {
  assert.ok(!toolNames.has('foundry_workfile_configure_from_cycle'));
});

test('plugin does NOT register foundry_workfile_set', () => {
  assert.ok(!toolNames.has('foundry_workfile_set'));
});
