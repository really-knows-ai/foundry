// tests/plugin/lockdown-hook.test.js
// Tests for the tool.execute.before lockdown hook with mocked child sessions.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { FoundryPlugin } from '../../src/plugin/foundry.js';

const SESSION_ID = 'test-session-1';
const FORGE_SESSION = 'forge-session-1';

/** @type {import('../../src/plugin/foundry.js').FoundryPlugin} */
let plugin;
let childSessions;

beforeEach(async () => {
  plugin = await FoundryPlugin({ directory: process.cwd(), client: null });
  childSessions = plugin[Symbol.for('foundry.test.childSessions')];
  childSessions.clear();
  childSessions.set(FORGE_SESSION, 'forge');
});

afterEach(() => {
  childSessions.clear();
});

// ── Allows forge subagent to call allowed tools ──────────────────────

test('allows forge subagent to call foundry_stage_output', async () => {
  // Should not throw
  await plugin['tool.execute.before'](
    { name: 'foundry_stage_output' },
    { sessionID: FORGE_SESSION },
  );
});

test('allows forge subagent to call read', async () => {
  await plugin['tool.execute.before'](
    { name: 'read' },
    { sessionID: FORGE_SESSION },
  );
});

// ── Denies forge subagent denied tools ───────────────────────────────

test('denies forge subagent foundry_orchestrate', async () => {
  await assert.rejects(
    () => plugin['tool.execute.before'](
      { name: 'foundry_orchestrate' },
      { sessionID: FORGE_SESSION },
    ),
    { message: /not available to forge subagents/ },
  );
});

test('denies forge subagent foundry_feedback_add', async () => {
  await assert.rejects(
    () => plugin['tool.execute.before'](
      { name: 'foundry_feedback_add' },
      { sessionID: FORGE_SESSION },
    ),
    { message: /not available to forge subagents/ },
  );
});

test('denies forge subagent foundry_stage_begin', async () => {
  await assert.rejects(
    () => plugin['tool.execute.before'](
      { name: 'foundry_stage_begin' },
      { sessionID: FORGE_SESSION },
    ),
    { message: /not available to forge subagents/ },
  );
});

test('denies forge subagent foundry_stage_end', async () => {
  await assert.rejects(
    () => plugin['tool.execute.before'](
      { name: 'foundry_stage_end' },
      { sessionID: FORGE_SESSION },
    ),
    { message: /not available to forge subagents/ },
  );
});

// ── Non-child sessions are unaffected ────────────────────────────────

test('allows non-child session unrestricted access', async () => {
  // Session not in childSessions — should not throw
  await plugin['tool.execute.before'](
    { name: 'foundry_orchestrate' },
    { sessionID: 'unknown-session' },
  );
});

// ── forgeDenied symbol export ────────────────────────────────────────

test('forgeDenied symbol is defined and contains expected tools', () => {
  const forgeDenied = plugin[Symbol.for('foundry.test.forgeDenied')];
  assert.ok(Array.isArray(forgeDenied));
  assert.ok(forgeDenied.includes('foundry_orchestrate'));
  assert.ok(forgeDenied.includes('foundry_feedback_*'));
  assert.ok(forgeDenied.includes('foundry_stage_begin'));
  assert.ok(forgeDenied.includes('foundry_stage_end'));
});
