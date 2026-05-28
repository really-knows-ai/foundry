// tests/plugin/stage-output-tool.test.js
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { createStageOutputTool, _clearAllOutputs, getStageOutputs } from '../../src/plugin/tools/stage-output-tool.js';

// ── Mock tool factory ───────────────────────────────────────────────

function createMockTool() {
  const schema = {};
  schema.string = () => ({ describe: () => schema.string });
  schema.string.optional = () => schema.string();
  schema.object = () => ({ describe: () => schema.object });
  schema.object.optional = () => schema.object();
  schema.array = () => ({ describe: () => schema.array });
  schema.array.optional = () => schema.array();
  schema.boolean = () => ({ describe: () => schema.boolean });
  schema.boolean.optional = () => schema.boolean();
  const fn = (opts) => opts;
  fn.schema = schema;
  return fn;
}

// ── Temp directory helpers ──────────────────────────────────────────

/** Create a temporary directory for a test worktree. */
function tmpDir() {
  return mkdtempSync(join(tmpdir(), 'stage-output-tool-'));
}

/** Initialise a git repo on a flow branch so flowBranchGuard passes. */
function initGitRepo(dir, branch = 'dry-run/test/x') {
  execSync('git init', { cwd: dir, stdio: 'pipe' });
  writeFileSync(join(dir, 'init.txt'), '', 'utf8');
  execSync('git add -A', { cwd: dir, stdio: 'pipe' });
  execSync('git commit -m "init"', {
    cwd: dir,
    stdio: 'pipe',
    env: {
      ...process.env,
      GIT_COMMITTER_NAME: 'test',
      GIT_COMMITTER_EMAIL: 'test@test.com',
      GIT_AUTHOR_NAME: 'test',
      GIT_AUTHOR_EMAIL: 'test@test.com',
    },
  });
  execSync(`git checkout -b ${branch}`, { cwd: dir, stdio: 'pipe' });
}

/** Write .foundry/active-stage.json so requireActiveStage resolves. */
function writeActiveStage(dir, stage, cycle = 'test-cycle') {
  const foundryDir = join(dir, '.foundry');
  mkdirSync(foundryDir, { recursive: true });
  writeFileSync(join(foundryDir, 'active-stage.json'), JSON.stringify({ stage, cycle }));
}

/** Write WORK.md with status: failed so notFailedGuard rejects. */
function writeFailedWorkfile(dir) {
  writeFileSync(join(dir, 'WORK.md'), '---\nstatus: failed\nreason: test failure\n---\n');
}

// ── Handler reference (shared across tests) ─────────────────────────

const mockTool = createMockTool();
/** @type {{ execute: Function }} */
const handler = createStageOutputTool({ tool: mockTool }).foundry_stage_output;

// ── Guard failure tests ─────────────────────────────────────────────

describe('guard failures', () => {
  beforeEach(() => _clearAllOutputs());
  afterEach(() => _clearAllOutputs());

  test('flowBranchGuard rejects when not on a flow branch', async () => {
    const dir = tmpDir();
    try {
      // No git repo — flowBranchGuard will fail
      const result = await handler.execute({ data: { status: 'done' } }, { worktree: dir });
      const parsed = JSON.parse(result);
      assert.equal(parsed.ok, undefined);
      assert.ok(parsed.error.startsWith('foundry_stage_output:'));
      assert.ok(parsed.error.includes('work/') || parsed.error.includes('branch'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('notFailedGuard rejects when flow is in failed state', async () => {
    const dir = tmpDir();
    try {
      initGitRepo(dir, 'dry-run/test/x');
      writeFailedWorkfile(dir);
      writeActiveStage(dir, 'forge:cycle-1');
      const result = await handler.execute({ data: { status: 'done' } }, { worktree: dir });
      const parsed = JSON.parse(result);
      assert.equal(parsed.ok, undefined);
      assert.ok(parsed.error.startsWith('foundry_stage_output:'));
      assert.ok(parsed.error.includes('failed state'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('rejects when no active stage is set', async () => {
    const dir = tmpDir();
    try {
      initGitRepo(dir, 'dry-run/test/x');
      // No .foundry/active-stage.json — requireActiveStage fails
      const result = await handler.execute({ data: { status: 'done' } }, { worktree: dir });
      const parsed = JSON.parse(result);
      assert.equal(parsed.ok, undefined);
      assert.ok(parsed.error.includes('requires active stage'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── Schema dispatch: forge ──────────────────────────────────────────

describe('forge schema dispatch', () => {
  beforeEach(() => _clearAllOutputs());
  afterEach(() => _clearAllOutputs());

  test('accepts valid forge output { status: "done" }', async () => {
    const dir = tmpDir();
    try {
      initGitRepo(dir);
      writeActiveStage(dir, 'forge:cycle-1');
      const result = await handler.execute({ data: { status: 'done' } }, { worktree: dir });
      assert.deepEqual(JSON.parse(result), { ok: true, count: 1 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('rejects forge data with invalid status', async () => {
    const dir = tmpDir();
    try {
      initGitRepo(dir);
      writeActiveStage(dir, 'forge:cycle-1');
      const result = await handler.execute({ data: { status: 'fixed' } }, { worktree: dir });
      const parsed = JSON.parse(result);
      assert.equal(parsed.ok, undefined);
      assert.ok(typeof parsed.error === 'string');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── Schema dispatch: appraise ───────────────────────────────────────

describe('appraise schema dispatch', () => {
  beforeEach(() => _clearAllOutputs());
  afterEach(() => _clearAllOutputs());

  test('accepts valid appraise output with required fields', async () => {
    const dir = tmpDir();
    try {
      initGitRepo(dir);
      writeActiveStage(dir, 'appraise:round-1');
      const result = await handler.execute(
        { data: { file: 'a.md', law: 'b', text: 'c' } },
        { worktree: dir },
      );
      assert.deepEqual(JSON.parse(result), { ok: true, count: 1 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('rejects appraise data with empty required file field', async () => {
    const dir = tmpDir();
    try {
      initGitRepo(dir);
      writeActiveStage(dir, 'appraise:round-1');
      const result = await handler.execute(
        { data: { file: '', law: 'b', text: 'c' } },
        { worktree: dir },
      );
      const parsed = JSON.parse(result);
      assert.equal(parsed.ok, undefined);
      assert.ok(typeof parsed.error === 'string');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── Schema dispatch: human-appraise ─────────────────────────────────

describe('human-appraise schema dispatch', () => {
  beforeEach(() => _clearAllOutputs());
  afterEach(() => _clearAllOutputs());

  test('accepts valid human-appraise output { verdict: "approved" }', async () => {
    const dir = tmpDir();
    try {
      initGitRepo(dir);
      writeActiveStage(dir, 'human-appraise:review');
      const result = await handler.execute(
        { data: { verdict: 'approved' } },
        { worktree: dir },
      );
      assert.deepEqual(JSON.parse(result), { ok: true, count: 1 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('rejects human-appraise data with invalid verdict', async () => {
    const dir = tmpDir();
    try {
      initGitRepo(dir);
      writeActiveStage(dir, 'human-appraise:review');
      const result = await handler.execute(
        { data: { verdict: 'rejected' } },
        { worktree: dir },
      );
      const parsed = JSON.parse(result);
      assert.equal(parsed.ok, undefined);
      assert.ok(typeof parsed.error === 'string');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── Multi-call accumulation ─────────────────────────────────────────

describe('multi-call accumulation', () => {
  beforeEach(() => _clearAllOutputs());
  afterEach(() => _clearAllOutputs());

  test('consecutive valid calls increment the count', async () => {
    const dir = tmpDir();
    try {
      initGitRepo(dir);
      writeActiveStage(dir, 'forge:cycle-1');

      const first = await handler.execute({ data: { status: 'done' } }, { worktree: dir });
      assert.deepEqual(JSON.parse(first), { ok: true, count: 1 });

      const second = await handler.execute({ data: { status: 'actioned' } }, { worktree: dir });
      assert.deepEqual(JSON.parse(second), { ok: true, count: 2 });

      // Verify buffer holds both objects
      const outputs = getStageOutputs('forge:cycle-1');
      assert.equal(outputs.length, 2);
      assert.deepEqual(outputs[0], { status: 'done' });
      assert.deepEqual(outputs[1], { status: 'actioned' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── Unknown stage base ──────────────────────────────────────────────

describe('unknown stage base', () => {
  beforeEach(() => _clearAllOutputs());
  afterEach(() => _clearAllOutputs());

  test('returns error for unrecognised stage base', async () => {
    const dir = tmpDir();
    try {
      initGitRepo(dir);
      writeActiveStage(dir, 'quench:fire');
      const result = await handler.execute({ data: {} }, { worktree: dir });
      assert.deepEqual(JSON.parse(result), { error: 'unknown stage base: quench' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
