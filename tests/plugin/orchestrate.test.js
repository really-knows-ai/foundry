import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';

const PLUGIN = readFileSync('.opencode/plugins/foundry.js', 'utf8');

test('plugin registers foundry_orchestrate', () => {
  assert.match(PLUGIN, /foundry_orchestrate:\s*tool/);
});

test('plugin does NOT register foundry_sort', () => {
  assert.doesNotMatch(PLUGIN, /foundry_sort:\s*tool/);
});

test('plugin does NOT register foundry_history_append', () => {
  assert.doesNotMatch(PLUGIN, /foundry_history_append:\s*tool/);
});

test('plugin does NOT register foundry_stage_finalize', () => {
  assert.doesNotMatch(PLUGIN, /foundry_stage_finalize:\s*tool/);
});

test('plugin does NOT register foundry_git_commit', () => {
  assert.doesNotMatch(PLUGIN, /foundry_git_commit:\s*tool/);
});

test('plugin does NOT register foundry_workfile_configure_from_cycle', () => {
  assert.doesNotMatch(PLUGIN, /foundry_workfile_configure_from_cycle:\s*tool/);
});

test('plugin does NOT register foundry_workfile_set', () => {
  assert.doesNotMatch(PLUGIN, /foundry_workfile_set:\s*tool/);
});
