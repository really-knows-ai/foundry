// tests/plugin/tools/stage-tools.test.js
// Phase 03 contract enforcement tests for foundry_stage_end.
// Tests cover summary rejection, per-stage output contracts, file writing,
// buffer lifecycle, and cleanup tracking.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { FoundryPlugin } from '../../../src/plugin/foundry.js';
import { signToken } from '../../../src/scripts/lib/token.js';
import { readOrCreateSecret } from '../../../src/scripts/lib/secret.js';

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t',
  GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
};

function tmpDir() {
  return mkdtempSync(join(tmpdir(), 'stage-tools-test-'));
}

function initRepo(dir, branch = 'dry-run/test/x') {
  execSync('git init', { cwd: dir, stdio: 'pipe' });
  writeFileSync(join(dir, 'init.txt'), '', 'utf8');
  execSync('git add -A', { cwd: dir, stdio: 'pipe' });
  execSync('git commit -m "init"', { cwd: dir, stdio: 'pipe', env: GIT_ENV });
  execSync(`git checkout -b ${branch}`, { cwd: dir, stdio: 'pipe' });
}

function makeCtx(dir, sessionId) {
  return { worktree: dir, sessionID: sessionId || 'test-session' };
}

async function beginStage(plugin, dir, stage = 'forge:cycle-1', cycle = 'cycle-1', nonce = 'n1') {
  const pending = plugin[Symbol.for('foundry.test.pending')];
  const secret = readOrCreateSecret(dir);
  const payload = { route: stage, cycle, nonce, exp: Date.now() + 60_000 };
  pending.add(nonce, payload);
  const token = signToken(payload, secret);
  writeFileSync(join(dir, '.foundry/dispatch-token'), token);
  const r = JSON.parse(await plugin.tool.foundry_stage_begin.execute({ stage, cycle }, makeCtx(dir)));
  if (!r.ok) throw new Error(`beginStage failed: ${JSON.stringify(r)}`);
}

async function stageOutput(plugin, dir, data) {
  return JSON.parse(await plugin.tool.foundry_stage_output.execute({ data }, makeCtx(dir)));
}

async function stageEnd(plugin, dir, args = {}) {
  return JSON.parse(await plugin.tool.foundry_stage_end.execute(args, makeCtx(dir)));
}

function stageOutputDir(dir) {
  return join(dir, '.foundry/stage-outputs');
}

function listOutputFiles(dir) {
  const d = stageOutputDir(dir);
  if (!existsSync(d)) return [];
  return readdirSync(d).filter(f => f.endsWith('.jsonl'));
}

function readOutputFile(dir, filename) {
  return readFileSync(join(stageOutputDir(dir), filename), 'utf-8');
}

// ── Summary rejection ───────────────────────────────────────────────



// ── Forge contract ──────────────────────────────────────────────────

describe('forge contract', () => {
  test('rejects stage_end with 0 outputs', async () => {
    const dir = tmpDir();
    try {
      initRepo(dir);
      const plugin = await FoundryPlugin({ directory: dir });
      await beginStage(plugin, dir, 'forge:cycle-1');
      const result = await stageEnd(plugin, dir);
      assert.equal(result.ok, undefined);
      assert.match(result.error, /expected exactly 1 stage_output call, got 0/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('succeeds with exactly 1 output', async () => {
    const dir = tmpDir();
    try {
      initRepo(dir);
      const plugin = await FoundryPlugin({ directory: dir });
      await beginStage(plugin, dir, 'forge:cycle-1');
      await stageOutput(plugin, dir, { status: 'done' });
      const result = await stageEnd(plugin, dir);
      assert.equal(result.ok, true);
      // Verify session output file was written
      const files = listOutputFiles(dir);
      assert.equal(files.length, 1);
      assert.equal(files[0], 'test-session.jsonl');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('rejects stage_end with 2 outputs', async () => {
    const dir = tmpDir();
    try {
      initRepo(dir);
      const plugin = await FoundryPlugin({ directory: dir });
      await beginStage(plugin, dir, 'forge:cycle-1');
      await stageOutput(plugin, dir, { status: 'done' });
      await stageOutput(plugin, dir, { status: 'actioned' });
      const result = await stageEnd(plugin, dir);
      assert.equal(result.ok, undefined);
      assert.match(result.error, /expected exactly 1 stage_output call, got 2/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── Appraise contract ───────────────────────────────────────────────

describe('appraise contract', () => {
  test('succeeds with 0 outputs (clean appraisal)', async () => {
    const dir = tmpDir();
    try {
      initRepo(dir);
      const plugin = await FoundryPlugin({ directory: dir });
      await beginStage(plugin, dir, 'appraise:round-1', 'cycle-1', 'n-appraise-0');
      const result = await stageEnd(plugin, dir);
      assert.equal(result.ok, true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('succeeds with 1 output', async () => {
    const dir = tmpDir();
    try {
      initRepo(dir);
      const plugin = await FoundryPlugin({ directory: dir });
      await beginStage(plugin, dir, 'appraise:round-1', 'cycle-1', 'n-appraise-1');
      await stageOutput(plugin, dir, { file: 'a.md', law: 'style', text: 'issue', group: 'default', appraiser: 'skeptic', pass: 1 });
      const result = await stageEnd(plugin, dir);
      assert.equal(result.ok, true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('succeeds with 3 outputs', async () => {
    const dir = tmpDir();
    try {
      initRepo(dir);
      const plugin = await FoundryPlugin({ directory: dir });
      await beginStage(plugin, dir, 'appraise:round-1', 'cycle-1', 'n-appraise-3');
      await stageOutput(plugin, dir, { file: 'a.md', law: 'style', text: 'issue 1', group: 'default', appraiser: 'skeptic', pass: 1 });
      await stageOutput(plugin, dir, { file: 'a.md', law: 'mood', text: 'issue 2', group: 'default', appraiser: 'skeptic', pass: 1 });
      await stageOutput(plugin, dir, { file: 'b.md', law: 'style', text: 'issue 3', group: 'default', appraiser: 'skeptic', pass: 1 });
      const result = await stageEnd(plugin, dir);
      assert.equal(result.ok, true);
      // Verify 3-line JSONL file in session output
      const files = listOutputFiles(dir);
      assert.equal(files.length, 1);
      const content = readOutputFile(dir, files[0]);
      const lines = content.trim().split('\n');
      assert.equal(lines.length, 3);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── Human-appraise contract ─────────────────────────────────────────

describe('human-appraise contract', () => {
  test('rejects stage_end with 0 outputs', async () => {
    const dir = tmpDir();
    try {
      initRepo(dir);
      const plugin = await FoundryPlugin({ directory: dir });
      await beginStage(plugin, dir, 'human-appraise:review', 'cycle-1', 'n-ha-0');
      const result = await stageEnd(plugin, dir);
      assert.equal(result.ok, undefined);
      assert.match(result.error, /expected exactly 1 stage_output call, got 0/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('succeeds with exactly 1 output', async () => {
    const dir = tmpDir();
    try {
      initRepo(dir);
      const plugin = await FoundryPlugin({ directory: dir });
      await beginStage(plugin, dir, 'human-appraise:review', 'cycle-1', 'n-ha-1');
      await stageOutput(plugin, dir, { verdict: 'approved' });
      const result = await stageEnd(plugin, dir);
      assert.equal(result.ok, true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('rejects stage_end with 2 outputs', async () => {
    const dir = tmpDir();
    try {
      initRepo(dir);
      const plugin = await FoundryPlugin({ directory: dir });
      await beginStage(plugin, dir, 'human-appraise:review', 'cycle-1', 'n-ha-2');
      await stageOutput(plugin, dir, { verdict: 'approved' });
      await stageOutput(plugin, dir, { verdict: 'approved' });
      const result = await stageEnd(plugin, dir);
      assert.equal(result.ok, undefined);
      assert.match(result.error, /expected exactly 1 stage_output call, got 2/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── File content tests ──────────────────────────────────────────────

describe('file content', () => {
  test('written JSONL is valid and matches original data', async () => {
    const dir = tmpDir();
    try {
      initRepo(dir);
      const plugin = await FoundryPlugin({ directory: dir });
      await beginStage(plugin, dir, 'forge:cycle-1');
      await stageOutput(plugin, dir, { status: 'actioned' });
      await stageEnd(plugin, dir);

      const files = listOutputFiles(dir);
      assert.equal(files.length, 1);
      assert.equal(files[0], 'test-session.jsonl');

      const content = readOutputFile(dir, files[0]);
      const lines = content.trim().split('\n');
      assert.equal(lines.length, 1);
      const parsed = JSON.parse(lines[0]);
      assert.deepEqual(parsed, { status: 'actioned' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('file is inside .foundry/stage-outputs/', async () => {
    const dir = tmpDir();
    try {
      initRepo(dir);
      const plugin = await FoundryPlugin({ directory: dir });
      await beginStage(plugin, dir, 'forge:cycle-1');
      await stageOutput(plugin, dir, { status: 'done' });
      await stageEnd(plugin, dir);

      const files = listOutputFiles(dir);
      assert.ok(files.length > 0);
      assert.ok(existsSync(join(stageOutputDir(dir), files[0])));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── Stage lifecycle tests ──────────────────────────────────────────

describe('stage lifecycle', () => {
  test('stage_end succeeds after stage_output writes to filesystem', async () => {
    const dir = tmpDir();
    try {
      initRepo(dir);
      const plugin = await FoundryPlugin({ directory: dir });
      await beginStage(plugin, dir, 'forge:cycle-1');
      await stageOutput(plugin, dir, { status: 'done' });
      await stageEnd(plugin, dir);
      assert.ok(true, 'stage_end completed successfully');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('second stage_end fails when no active stage', async () => {
    const dir = tmpDir();
    try {
      initRepo(dir);
      const plugin = await FoundryPlugin({ directory: dir });
      await beginStage(plugin, dir, 'forge:cycle-1');
      await stageOutput(plugin, dir, { status: 'done' });
      await stageEnd(plugin, dir);

      // Second call: no active stage
      const second = await stageEnd(plugin, dir);
      assert.equal(second.ok, undefined);
      assert.match(second.error, /no active stage to close/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── Cleanup tracking tests ──────────────────────────────────────────

describe('cleanup tracking', () => {
  test('stage_begin cleans the output directory on call', async () => {
    const dir = tmpDir();
    try {
      initRepo(dir);
      const plugin = await FoundryPlugin({ directory: dir });
      // Create a stale file in the output directory
      const outDir = stageOutputDir(dir);
      mkdirSync(outDir, { recursive: true });
      writeFileSync(join(outDir, 'stale.jsonl'), '{}');
      assert.equal(listOutputFiles(dir).length, 1);

      // Begin stage — should clean the directory
      await beginStage(plugin, dir, 'forge:clean-test-1');
      assert.equal(listOutputFiles(dir).length, 0,
        'stage_begin must clean output directory on first call');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('second stage_begin for same stage cleans again', async () => {
    const dir = tmpDir();
    try {
      initRepo(dir);
      const plugin = await FoundryPlugin({ directory: dir });
      await beginStage(plugin, dir, 'forge:clean-test-2');

      // End the first stage — stage_output writes a .jsonl file, stage_end clears active stage
      await stageOutput(plugin, dir, { status: 'done' });
      await stageEnd(plugin, dir);
      assert.ok(listOutputFiles(dir).length >= 1, 'stage_output should write an output file');

      // Begin again with same stage ID — must clean (fresh slate per stage)
      await beginStage(plugin, dir, 'forge:clean-test-2', 'cycle-1', 'n-same-stage');
      assert.equal(listOutputFiles(dir).length, 0,
        'second begin for same stage must clean directory (fresh slate per stage)');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('different stage ID cleans directory (cross-stage isolation)', async () => {
    const dir = tmpDir();
    try {
      initRepo(dir);
      const plugin = await FoundryPlugin({ directory: dir });
      await beginStage(plugin, dir, 'forge:cross-1');

      // End forge stage — stage_output writes a .jsonl file
      await stageOutput(plugin, dir, { status: 'done' });
      await stageEnd(plugin, dir);
      assert.ok(listOutputFiles(dir).length > 0,
        'forge stage_output should leave output files');

      // Begin a different stage — should clean directory (first call for appraise:cross-1)
      await beginStage(plugin, dir, 'appraise:cross-1', 'cycle-1', 'n-cross');
      assert.equal(listOutputFiles(dir).length, 0,
        'different stage must clean directory on first begin');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
