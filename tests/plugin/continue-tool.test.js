// tests/plugin/continue-tool.test.js
// Tests for foundry_continue tool.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { createContinueTool } from '../../src/plugin/tools/continue-tool.js';

// ── Mock tool factory ───────────────────────────────────────────────

function createMockTool() {
  const schema = {};
  schema.string = () => ({ describe: () => schema.string, optional: () => schema.string() });
  schema.object = () => ({ describe: () => schema.object, optional: () => schema.object() });
  schema.array = () => ({ describe: () => schema.array, optional: () => schema.array() });
  schema.boolean = () => ({ describe: () => schema.boolean, optional: () => schema.boolean() });
  const fn = (opts) => opts;
  fn.schema = schema;
  return fn;
}

function tmpDir() {
  return mkdtempSync(join(tmpdir(), 'continue-tool-'));
}

function initGitRepo(dir, branch = 'dry-run/test/x') {
  execSync('git init', { cwd: dir, stdio: 'pipe' });
  writeFileSync(join(dir, 'init.txt'), '', 'utf8');
  execSync('git add -A', { cwd: dir, stdio: 'pipe' });
  execSync('git commit -m "init"', {
    cwd: dir,
    stdio: 'pipe',
    env: { ...process.env, GIT_COMMITTER_NAME: 'test', GIT_COMMITTER_EMAIL: 'test@test.com', GIT_AUTHOR_NAME: 'test', GIT_AUTHOR_EMAIL: 'test@test.com' },
  });
  execSync(`git checkout -b ${branch}`, { cwd: dir, stdio: 'pipe' });
}

const mockTool = createMockTool();
const mockClient = { 
  session: { 
    create: async () => { throw new Error('SDK session.create should not be called'); }, 
    prompt: async () => { throw new Error('SDK session.prompt should not be called'); },
    messages: async () => [],
  },
  config: { providers: async () => [] },
  provider: { list: () => ({ connected: [] }) },
};
const childSessions = new Map();
/** @type {{ execute: Function }} */
const handler = createContinueTool({ tool: mockTool, client: mockClient, childSessions }).foundry_continue;

test('foundry_continue returns violation when no WORK.md exists', async () => {
  const dir = tmpDir();
  try {
    initGitRepo(dir);
    const result = await handler.execute({}, { worktree: dir, sessionID: 'main-session' });
    const parsed = JSON.parse(result);
    assert.equal(parsed.action, 'violation');
    assert.ok(parsed.details.includes('WORK.md not found'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('foundry_continue returns violation when human-appraise stage is active (capture fails without client)', async () => {
  const dir = tmpDir();
  try {
    initGitRepo(dir);
    writeFileSync(join(dir, 'WORK.md'), '---\ncycle: test\nflow: test\n---\n');
    const foundryDir = join(dir, '.foundry');
    mkdirSync(foundryDir, { recursive: true });
    writeFileSync(join(foundryDir, 'active-stage.json'), JSON.stringify({ stage: 'human-appraise:review', cycle: 'test', boundaryMarker: 'msg_1' }));
    const result = await handler.execute({}, { worktree: dir, sessionID: 'main-session' });
    const parsed = JSON.parse(result);
    assert.equal(parsed.action, 'violation');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
