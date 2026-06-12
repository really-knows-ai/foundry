import { test } from 'node:test';
import assert from 'node:assert';
import { findSealHash, verifySealAgainstCommit, verifySealInResult } from '../../src/plugin/tools/attestation-tools.js';

// ---------------------------------------------------------------------------
// findSealHash
// ---------------------------------------------------------------------------

test('findSealHash returns hash when attestation-seal line is present', () => {
  const msg = `some subject

foundry-run: 01JKVT7Z8Q3WN0GJM2TYBR4AA
attestation-seal: abc123def456
composite-status: pass
stage-count: 8`;

  assert.strictEqual(findSealHash(msg), 'abc123def456');
});

test('findSealHash returns null when attestation-seal is absent', () => {
  const msg = `some subject

foundry-run: 01JKVT7Z8Q3WN0GJM2TYBR4AA
composite-status: pass`;

  assert.strictEqual(findSealHash(msg), null);
});

test('findSealHash returns null for empty message', () => {
  assert.strictEqual(findSealHash(''), null);
});

test('findSealHash handles hash with leading/trailing whitespace', () => {
  const msg = `subject

attestation-seal:   spaced-hash-value   `;
  assert.strictEqual(findSealHash(msg), 'spaced-hash-value');
});

test('findSealHash stops at first attestation-seal line', () => {
  const msg = `subject

attestation-seal: first-hash
something-else
attestation-seal: second-hash`;

  assert.strictEqual(findSealHash(msg), 'first-hash');
});

// ---------------------------------------------------------------------------
// verifySealAgainstCommit
// ---------------------------------------------------------------------------

test('verifySealAgainstCommit returns ok when seal matches commit message', () => {
  const runId = '01JKVT7Z8Q3WN0GJM2TYBR4AA';
  const cycleHash = 'abc123def456';
  const commitMsg = `Commit subject

foundry-run: ${runId}
attestation-seal: ${cycleHash}
composite-status: pass
stage-count: 8`;

  const mockExec = () => commitMsg;

  const result = verifySealAgainstCommit('/some/cwd', runId, cycleHash, mockExec);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.seal_hash, cycleHash);
});

test('verifySealAgainstCommit returns error on hash mismatch', () => {
  const runId = '01JKVT7Z8Q3WN0GJM2TYBR4AA';
  const cycleHash = 'abc123def456';
  const commitHash = 'zyx987wvu321';
  const commitMsg = `subject

attestation-seal: ${commitHash}`;

  const mockExec = () => commitMsg;

  const result = verifySealAgainstCommit('/some/cwd', runId, cycleHash, mockExec);
  assert.strictEqual(result.ok, false);
  assert.ok(result.error.includes('attestation-seal mismatch'));
  assert.ok(result.error.includes(commitHash));
  assert.ok(result.error.includes(cycleHash));
});

test('verifySealAgainstCommit returns error when no attestation-seal in commit', () => {
  const mockExec = () => `subject

foundry-run: 01JKVT7Z8Q3WN0GJM2TYBR4AA`;

  const result = verifySealAgainstCommit('/some/cwd', 'run-id', 'some-hash', mockExec);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.error, 'no attestation-seal found in git commit message');
});

test('verifySealAgainstCommit returns error when git command fails', () => {
  const mockExec = () => {
    throw new Error('git command not found');
  };

  const result = verifySealAgainstCommit('/some/cwd', 'run-id', 'some-hash', mockExec);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.error, 'could not read git commit message for attestation file');
});

// ---------------------------------------------------------------------------
// verifySealInResult
// ---------------------------------------------------------------------------

test('verifySealInResult returns false with error when sealVerified is false', () => {
  const result = verifySealInResult('/cwd', 'run-id', {
    sealVerified: false,
    entries: [],
  });

  assert.strictEqual(result.seal_commit_verified, false);
  assert.strictEqual(result.seal_commit_error, 'no cycle attestation line found in file');
});

test('verifySealInResult returns false with error when no cycle entry found', () => {
  const result = verifySealInResult('/cwd', 'run-id', {
    sealVerified: true,
    entries: [{ schema: 'foundry-stage-attestation/v1', _hash: 'aaa' }],
  });

  assert.strictEqual(result.seal_commit_verified, false);
  assert.strictEqual(result.seal_commit_error, 'no cycle attestation line found in file');
});

test('verifySealInResult returns false with error when cycle entry has no _hash', () => {
  const result = verifySealInResult('/cwd', 'run-id', {
    sealVerified: true,
    entries: [{ schema: 'foundry-cycle-attestation/v1' }],
  });

  assert.strictEqual(result.seal_commit_verified, false);
  assert.strictEqual(result.seal_commit_error, 'no cycle attestation line found in file');
});

test('verifySealInResult returns error when no git history exists', () => {
  const runId = 'run-123';
  const cycleHash = 'matching-hash';

  const result = verifySealInResult('/cwd', runId, {
    sealVerified: true,
    entries: [
      { schema: 'foundry-cycle-attestation/v1', _hash: cycleHash },
      { schema: 'foundry-stage-attestation/v1', _hash: 'stage-hash' },
    ],
  });

  assert.strictEqual(result.seal_commit_verified, false);
  assert.strictEqual(result.seal_commit_error, 'could not read git commit message for attestation file');
});
