// tests/plugin/run-tool.test.js
// Integration tests for the foundry_run tool.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { createRunTool } from '../../src/plugin/tools/run-tool.js';

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
  return mkdtempSync(join(tmpdir(), 'run-tool-'));
}

function initGitRepoAndCheckout(dir, branch = 'work/test-flow-desc') {
  execSync('git init', { cwd: dir, stdio: 'pipe' });
  writeFileSync(join(dir, 'init.txt'), '', 'utf8');
  execSync('git add -A', { cwd: dir, stdio: 'pipe' });
  execSync('git commit -m "init"', {
    cwd: dir,
    stdio: 'pipe',
    env: { ...process.env, GIT_COMMITTER_NAME: 'test', GIT_COMMITTER_EMAIL: 'test@test.com', GIT_AUTHOR_NAME: 'test', GIT_AUTHOR_EMAIL: 'test@test.com' },
  });
  if (branch !== 'main') {
    execSync(`git checkout -b ${branch}`, { cwd: dir, stdio: 'pipe' });
  }
}

function writeFlowDef(dir, flowId, overrides = {}) {
  const flowsDir = join(dir, 'foundry', 'flows');
  mkdirSync(flowsDir, { recursive: true });
  const start = overrides.start || 'test-cycle';
  const startYaml = Array.isArray(start) ? '\nstart:\n' + start.map(function(s) { return '  - ' + s; }).join('\n') : '\nstart: ' + start;
  writeFileSync(
    join(flowsDir, `${flowId}.md`),
    `---\nid: ${flowId}\nname: ${overrides.name || 'Test Flow'}${startYaml}\n---\n`,
    'utf8',
  );
}

function writeCycleDef(dir, cycleId) {
  const cyclesDir = join(dir, 'foundry', 'cycles');
  mkdirSync(cyclesDir, { recursive: true });
  writeFileSync(
    join(cyclesDir, `${cycleId}.md`),
    `---\nid: ${cycleId}\noutput-type: test-artefact\nmax-iterations: 3\n---\nWrite a test artefact.\n`,
    'utf8',
  );
}

function writeArtefactDef(dir) {
  const artefactDir = join(dir, 'foundry', 'artefacts', 'test-artefact');
  mkdirSync(artefactDir, { recursive: true });
  writeFileSync(
    join(artefactDir, 'definition.md'),
    `---\nid: test-artefact\nfile-patterns:\n  - '*.md'\n---\n`,
    'utf8',
  );
}

const mockTool = createMockTool();
const mockClient = { session: { create: async () => ({ id: 'mock-session-1' }), prompt: async () => {} } };
const childSessions = new Map();
/** @type {{ execute: Function }} */
const handler = createRunTool({ tool: mockTool, client: mockClient, childSessions }).foundry_run;

test('foundry_run requires flow and goal', async () => {
  const dir = tmpDir();
  try {
    initGitRepoAndCheckout(dir, 'main');
    const result = await handler.execute({ flow: '', goal: '' }, { worktree: dir, sessionID: 'main-session' });
    const parsed = JSON.parse(result);
    assert.equal(parsed.action, 'violation');
    assert.ok(parsed.details.includes('flow and goal are required'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('foundry_run rejects non-flow branches', async () => {
  const dir = tmpDir();
  try {
    initGitRepoAndCheckout(dir, 'main');
    const result = await handler.execute({ flow: 'test', goal: 'test goal' }, { worktree: dir, sessionID: 'main-session' });
    const parsed = JSON.parse(result);
    assert.equal(parsed.action, 'violation');
    assert.ok(parsed.details.includes('requires a work/'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('foundry_run rejects when WORK.md already exists', async () => {
  const dir = tmpDir();
  try {
    initGitRepoAndCheckout(dir, 'work/test-flow-desc');
    writeFileSync(join(dir, 'WORK.md'), '---\ncycle: test\n---\n');
    const result = await handler.execute({ flow: 'test', goal: 'test goal' }, { worktree: dir, sessionID: 'main-session' });
    const parsed = JSON.parse(result);
    assert.equal(parsed.action, 'violation');
    assert.ok(parsed.details.includes('WORK.md already exists'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('foundry_run rejects unknown flow', async () => {
  const dir = tmpDir();
  try {
    initGitRepoAndCheckout(dir, 'work/test-flow-desc');
    const result = await handler.execute({ flow: 'nonexistent', goal: 'test goal' }, { worktree: dir, sessionID: 'main-session' });
    const parsed = JSON.parse(result);
    assert.ok(parsed.error);
    assert.ok(parsed.error.includes('not found'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('foundry_run with multiple start cycles requires explicit cycle', async () => {
  const dir = tmpDir();
  try {
    initGitRepoAndCheckout(dir, 'work/test-flow-desc');
    writeFlowDef(dir, 'multi-flow', { start: ['cycle-a', 'cycle-b'] });
    const result = await handler.execute({ flow: 'multi-flow', goal: 'test goal' }, { worktree: dir, sessionID: 'main-session' });
    const parsed = JSON.parse(result);
    assert.ok(parsed.error);
    assert.ok(parsed.error.includes('multiple start cycles'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('foundry_run with multiple start cycles and explicit cycle bootstraps WORK.md', async () => {
  const dir = tmpDir();
  try {
    initGitRepoAndCheckout(dir, 'work/test-flow-desc');
    writeFlowDef(dir, 'multi-flow', { start: ['cycle-a', 'cycle-b'] });
    writeCycleDef(dir, 'cycle-a');
    writeArtefactDef(dir);
    await handler.execute({ flow: 'multi-flow', cycle: 'cycle-a', goal: 'test goal' }, { worktree: dir, sessionID: 'main-session' });
    // Should have created WORK.md
    assert.ok(existsSync(join(dir, 'WORK.md')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
