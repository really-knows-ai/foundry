import { test } from 'node:test';
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FoundryPlugin } from '../../src/plugin/foundry.js';

test('foundry_attestation_show lists runs when no run_id given', async () => {
  // Arrange: create a temporary git repo with an attestations directory
  const testDir = mkdtempSync(path.join(tmpdir(), 'attestation-show-list-'));
  try {
    execFileSync('git', ['init'], { cwd: testDir });
    execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: testDir });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: testDir });

    writeFileSync(path.join(testDir, 'test.txt'), 'initial\n');
    execFileSync('git', ['add', 'test.txt'], { cwd: testDir });
    execFileSync('git', ['commit', '-m', 'init', '--no-gpg-sign'], { cwd: testDir });

    // Create attestations directory with a couple of JSONL files
    const attDir = path.join(testDir, '.foundry', 'attestations');
    mkdirSync(attDir, { recursive: true });
    writeFileSync(path.join(attDir, 'run-001.jsonl'), '{"stage":"forge"}\n');
    writeFileSync(path.join(attDir, 'run-002.jsonl'), '{"stage":"appraise"}\n');

    const plugin = await FoundryPlugin({ directory: testDir });
    const tool = plugin.tool.foundry_attestation_show;

    // Act: list runs
    const result = await tool.execute({}, { worktree: testDir });
    const parsed = JSON.parse(result);

    // Assert
    assert.strictEqual(parsed.ok, true);
    assert.ok(Array.isArray(parsed.runs));
    assert.strictEqual(parsed.runs.length, 2);
    assert.ok(parsed.runs.includes('run-001'));
    assert.ok(parsed.runs.includes('run-002'));
  } finally {
    rmSync(testDir, { recursive: true, force: true });
  }
});

test('foundry_attestation_show returns entries for a valid run_id', async () => {
  // Arrange: create a temporary git repo with a JSONL file
  const testDir = mkdtempSync(path.join(tmpdir(), 'attestation-show-run-'));
  try {
    execFileSync('git', ['init'], { cwd: testDir });
    execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: testDir });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: testDir });

    writeFileSync(path.join(testDir, 'test.txt'), 'content\n');
    execFileSync('git', ['add', 'test.txt'], { cwd: testDir });
    execFileSync('git', ['commit', '-m', 'init', '--no-gpg-sign'], { cwd: testDir });

    // Create a JSONL file with two lines
    const attDir = path.join(testDir, '.foundry', 'attestations');
    mkdirSync(attDir, { recursive: true });
    const runId = '01JKVT7Z8Q3WN0GJM2TYBR4AA';
    const line1 = JSON.stringify({ stage: 'forge', status: 'actioned', _hash: 'a'.repeat(64) });
    const line2 = JSON.stringify({ stage: 'appraise', status: 'passed', _hash: 'b'.repeat(64) });
    writeFileSync(path.join(attDir, `${runId}.jsonl`), line1 + '\n' + line2 + '\n');

    const plugin = await FoundryPlugin({ directory: testDir });
    const tool = plugin.tool.foundry_attestation_show;

    // Act: show run
    const result = await tool.execute({ run_id: runId }, { worktree: testDir });
    const parsed = JSON.parse(result);

    // Assert
    assert.strictEqual(parsed.ok, true);
    assert.strictEqual(parsed.run_id, runId);
    assert.ok(Array.isArray(parsed.entries));
    assert.strictEqual(parsed.entries.length, 2);
    assert.strictEqual(parsed.entries[0].stage, 'forge');
    assert.strictEqual(parsed.entries[1].stage, 'appraise');
  } finally {
    rmSync(testDir, { recursive: true, force: true });
  }
});

test('foundry_attestation_show returns error for unknown run_id', async () => {
  const testDir = mkdtempSync(path.join(tmpdir(), 'attestation-show-unknown-'));
  try {
    execFileSync('git', ['init'], { cwd: testDir });
    execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: testDir });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: testDir });

    writeFileSync(path.join(testDir, 'test.txt'), 'content\n');
    execFileSync('git', ['add', 'test.txt'], { cwd: testDir });
    execFileSync('git', ['commit', '-m', 'init', '--no-gpg-sign'], { cwd: testDir });

    // Create the attestations dir but no file for this run
    mkdirSync(path.join(testDir, '.foundry', 'attestations'), { recursive: true });

    const plugin = await FoundryPlugin({ directory: testDir });
    const tool = plugin.tool.foundry_attestation_show;

    const result = await tool.execute({ run_id: 'nonexistent-run' }, { worktree: testDir });
    const parsed = JSON.parse(result);

    assert.strictEqual(parsed.ok, false);
    assert.ok(parsed.error.includes('no attestation file found'));
  } finally {
    rmSync(testDir, { recursive: true, force: true });
  }
});

test('foundry_attestation_verify verifies every line hash in a valid JSONL', async () => {
  const testDir = mkdtempSync(path.join(tmpdir(), 'attestation-verify-valid-'));
  try {
    execFileSync('git', ['init'], { cwd: testDir });
    execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: testDir });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: testDir });

    writeFileSync(path.join(testDir, 'test.txt'), 'content\n');
    execFileSync('git', ['add', 'test.txt'], { cwd: testDir });
    execFileSync('git', ['commit', '-m', 'init', '--no-gpg-sign'], { cwd: testDir });

    const { hashAttestation } = await import('../../src/scripts/lib/attestation/hash.js');

    // Build valid self-verifying lines
    const stageObj = { stage: 'forge', cycle: 'test', iteration: 1 };
    const stageLine = JSON.stringify({ ...stageObj, _hash: hashAttestation(stageObj) });

    const cycleObj = {
      schema: 'foundry-cycle-attestation/v1',
      cycle: 'test',
      composite_status: 'pass',
      stage_attestations: [stageObj],
    };
    const cycleLine = JSON.stringify({ ...cycleObj, _hash: hashAttestation(cycleObj) });

    const attDir = path.join(testDir, '.foundry', 'attestations');
    mkdirSync(attDir, { recursive: true });
    const runId = '01JKVT7Z8Q3WN0GJM2TYBR4AA';
    writeFileSync(path.join(attDir, `${runId}.jsonl`), stageLine + '\n' + cycleLine + '\n');

    const plugin = await FoundryPlugin({ directory: testDir });
    const tool = plugin.tool.foundry_attestation_verify;

    const result = await tool.execute({ run_id: runId }, { worktree: testDir });
    const parsed = JSON.parse(result);

    assert.strictEqual(parsed.ok, true);
    assert.strictEqual(parsed.run_id, runId);
    assert.strictEqual(parsed.entries_verified, 2);
    assert.strictEqual(parsed.seal_verified, true);
  } finally {
    rmSync(testDir, { recursive: true, force: true });
  }
});

test('foundry_attestation_verify returns error for invalid hash', async () => {
  const testDir = mkdtempSync(path.join(tmpdir(), 'attestation-verify-bad-'));
  try {
    execFileSync('git', ['init'], { cwd: testDir });
    execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: testDir });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: testDir });

    writeFileSync(path.join(testDir, 'test.txt'), 'content\n');
    execFileSync('git', ['add', 'test.txt'], { cwd: testDir });
    execFileSync('git', ['commit', '-m', 'init', '--no-gpg-sign'], { cwd: testDir });

    // A line with a mismatch hash
    const attDir = path.join(testDir, '.foundry', 'attestations');
    mkdirSync(attDir, { recursive: true });
    const runId = '01JKVT7Z8Q3WN0GJM2TYBR4BB';
    const badLine = JSON.stringify({ stage: 'forge', _hash: '0'.repeat(64) });
    writeFileSync(path.join(attDir, `${runId}.jsonl`), badLine + '\n');

    const plugin = await FoundryPlugin({ directory: testDir });
    const tool = plugin.tool.foundry_attestation_verify;

    const result = await tool.execute({ run_id: runId }, { worktree: testDir });
    const parsed = JSON.parse(result);

    assert.strictEqual(parsed.ok, false);
    assert.ok(parsed.error.includes('hash mismatch'));
  } finally {
    rmSync(testDir, { recursive: true, force: true });
  }
});

test('foundry_attestation_verify lists runs when no run_id given', async () => {
  const testDir = mkdtempSync(path.join(tmpdir(), 'attestation-verify-list-'));
  try {
    execFileSync('git', ['init'], { cwd: testDir });
    execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: testDir });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: testDir });

    writeFileSync(path.join(testDir, 'test.txt'), 'content\n');
    execFileSync('git', ['add', 'test.txt'], { cwd: testDir });
    execFileSync('git', ['commit', '-m', 'init', '--no-gpg-sign'], { cwd: testDir });

    const attDir = path.join(testDir, '.foundry', 'attestations');
    mkdirSync(attDir, { recursive: true });
    writeFileSync(path.join(attDir, 'run-alpha.jsonl'), '{"s":1}\n');
    writeFileSync(path.join(attDir, 'run-beta.jsonl'), '{"s":2}\n');

    const plugin = await FoundryPlugin({ directory: testDir });
    const tool = plugin.tool.foundry_attestation_verify;

    const result = await tool.execute({}, { worktree: testDir });
    const parsed = JSON.parse(result);

    assert.strictEqual(parsed.ok, true);
    assert.ok(Array.isArray(parsed.runs));
    assert.strictEqual(parsed.runs.length, 2);
    assert.ok(parsed.runs.includes('run-alpha'));
    assert.ok(parsed.runs.includes('run-beta'));
  } finally {
    rmSync(testDir, { recursive: true, force: true });
  }
});

test('foundry_attestation_verify returns error for unknown run_id', async () => {
  const testDir = mkdtempSync(path.join(tmpdir(), 'attestation-verify-unknown-'));
  try {
    execFileSync('git', ['init'], { cwd: testDir });
    execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: testDir });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: testDir });

    writeFileSync(path.join(testDir, 'test.txt'), 'content\n');
    execFileSync('git', ['add', 'test.txt'], { cwd: testDir });
    execFileSync('git', ['commit', '-m', 'init', '--no-gpg-sign'], { cwd: testDir });

    mkdirSync(path.join(testDir, '.foundry', 'attestations'), { recursive: true });

    const plugin = await FoundryPlugin({ directory: testDir });
    const tool = plugin.tool.foundry_attestation_verify;

    const result = await tool.execute({ run_id: 'no-such-run' }, { worktree: testDir });
    const parsed = JSON.parse(result);

    assert.strictEqual(parsed.ok, false);
    assert.ok(parsed.error.includes('attestation file not found'));
  } finally {
    rmSync(testDir, { recursive: true, force: true });
  }
});
