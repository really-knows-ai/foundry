import test from 'node:test';
import assert from 'node:assert/strict';
import { finishWorkBranchWithArchive } from '../../../src/scripts/lib/git-finish/work-finish.js';
import { sha256Buffer } from '../../../src/scripts/lib/attestation/hash.js';

// Compute a real diff SHA so tests can construct matching readAttest
const FAKE_DIFF = Buffer.from('fake diff');
const FAKE_DIFF_SHA = sha256Buffer(FAKE_DIFF);

function makeValidAttest(sha = FAKE_DIFF_SHA) {
  return `Write a haiku\n\ndiff-sha256: ${sha}\n\n-----BEGIN FOUNDRY ATTESTATION-----\n{}\n-----END FOUNDRY ATTESTATION-----\n`;
}

function makeExecGit(overrides = {}) {
  return (argv) => {
    const cmd = argv.join(' ');
    if (overrides[cmd] !== undefined) return overrides[cmd];
    if (cmd.startsWith('rev-parse work/')) return 'abc1234567890123456789012345678901234567\n';
    if (cmd === 'rev-parse --short HEAD') return 'abc1234\n';
    if (cmd.startsWith('log --oneline -1')) return 'abc1234 [forge] attest: cycle complete\n';
    if (cmd.startsWith('merge-base')) return 'basesha\n';
    if (cmd.startsWith('diff')) return FAKE_DIFF;
    if (cmd.startsWith('branch archive/')) return '';
    if (cmd.startsWith('checkout')) return '';
    if (cmd.startsWith('merge --squash')) return '';
    if (cmd.startsWith('commit')) return '';
    if (cmd.startsWith('branch -D')) return '';
    if (cmd.startsWith('reset')) return '';
    return '';
  };
}

function baseArgs(overrides = {}) {
  return {
    branchName: 'work/test',
    baseBranch: 'main',
    confirm: true,
    execGit: makeExecGit(),
    fileExists: (p) => p.endsWith('ATTEST.md'),
    readAttest: () => makeValidAttest(),
    deleteFile: () => {},
    writeTempMessage: () => '/tmp/test',
    cwd: '/repo',
    ...overrides,
  };
}

// --- ATTEST.md gate tests ---

test('finishWorkBranchWithArchive returns ok:false when ATTEST.md does not exist', async () => {
  const result = await finishWorkBranchWithArchive(baseArgs({
    fileExists: (_p) => false,
  }));
  assert.equal(result.ok, false);
  assert.match(result.error, /ATTEST\.md/i);
});

test('finishWorkBranchWithArchive returns ok:false when HEAD commit is not the ATTEST commit', async () => {
  const result = await finishWorkBranchWithArchive(baseArgs({
    execGit: makeExecGit({
      'log --oneline -1': 'abc1234 regular commit, not attest\n',
    }),
  }));
  assert.equal(result.ok, false);
  assert.match(result.error, /attest.*commit|HEAD.*attest/i);
});

test('finishWorkBranchWithArchive returns ok:false when diff SHA does not match', async () => {
  const wrongSha = 'b'.repeat(64);
  const result = await finishWorkBranchWithArchive(baseArgs({
    readAttest: () => makeValidAttest(wrongSha),
  }));
  assert.equal(result.ok, false);
  assert.match(result.error, /diff.*sha|sha.*mismatch/i);
});

// --- Confirm gate test ---

test('finishWorkBranchWithArchive rejects when confirm !== true', async () => {
  const res = await finishWorkBranchWithArchive(baseArgs({
    confirm: false,
  }));

  assert.equal(res.ok, false);
  assert.match(res.error, /requires.*confirm.*true/i);
});

// --- Happy path test ---

test('finishWorkBranchWithArchive executes expected git sequence and returns correct shape', async () => {
  const calls = [];
  const res = await finishWorkBranchWithArchive(baseArgs({
    execGit(argv) {
      calls.push(argv);
      if (argv[0] === 'rev-parse' && argv[1]?.startsWith('work/')) {
        return 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef\n';
      }
      if (argv[0] === 'rev-parse' && argv[1] === '--short') {
        return 'deadbee\n';
      }
      if (argv[0] === 'log') return 'deadbee [forge] attest: cycle complete\n';
      if (argv[0] === 'merge-base') return 'basesha\n';
      if (argv[0] === 'diff') return FAKE_DIFF;
      return '';
    },
  }));

  // Verify return shape
  assert.equal(res.ok, true);
  assert.equal(res.archiveBranch, 'archive/work/test-deadbee');
  assert.equal(res.archiveTipSha, 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef');
  assert.equal(res.branch, 'main');
  assert.equal(res.hash, 'deadbee');

  // Verify git call sequence
  const branchArchiveIdx = calls.findIndex(c => c[0] === 'branch' && c[1]?.startsWith('archive/'));
  const checkoutIdx = calls.findIndex(c => c[0] === 'checkout' && c[1] === 'main');
  const mergeIdx = calls.findIndex(c => c[0] === 'merge' && c[1] === '--squash');
  const commitIdx = calls.findIndex(c => c[0] === 'commit');
  const branchDeleteIdx = calls.findIndex(c => c[0] === 'branch' && c[1] === '-D');

  assert.ok(branchArchiveIdx !== -1, 'Should create archive branch');
  assert.ok(checkoutIdx !== -1, 'Should checkout base branch');
  assert.ok(mergeIdx !== -1, 'Should squash merge');
  assert.ok(commitIdx !== -1, 'Should commit');
  assert.ok(branchDeleteIdx !== -1, 'Should delete work branch');

  // Verify order
  assert.ok(branchArchiveIdx < checkoutIdx, 'Archive branch before checkout');
  assert.ok(checkoutIdx < mergeIdx, 'Checkout before merge');
  assert.ok(mergeIdx < commitIdx, 'Merge before commit');
  assert.ok(commitIdx < branchDeleteIdx, 'Commit before branch deletion');
});

test('finishWorkBranchWithArchive invokes signed commit with -S flag', async () => {
  const calls = [];
  await finishWorkBranchWithArchive(baseArgs({
    execGit(argv) {
      calls.push(argv);
      if (argv[0] === 'rev-parse' && argv[1]?.startsWith('work/')) {
        return 'abc1234567890123456789012345678901234567\n';
      }
      if (argv[0] === 'log') return 'abc1234 [forge] attest: cycle complete\n';
      if (argv[0] === 'merge-base') return 'basesha\n';
      if (argv[0] === 'diff') return FAKE_DIFF;
      return '';
    },
  }));

  const commitCall = calls.find(argv => argv[0] === 'commit');
  assert.ok(commitCall, 'Should have a commit call');
  assert.ok(commitCall.includes('-S'), 'Commit should include -S flag for signing');
});

// --- Failure tests ---

test('finishWorkBranchWithArchive restores branch on squash-merge failure', async () => {
  const calls = [];

  const result = await finishWorkBranchWithArchive(baseArgs({
    execGit(argv) {
      calls.push(argv);
      if (argv[0] === 'rev-parse' && argv[1]?.startsWith('work/')) {
        return 'abc1234567890123456789012345678901234567\n';
      }
      if (argv[0] === 'log') return 'abc1234 [forge] attest: cycle complete\n';
      if (argv[0] === 'merge-base') return 'basesha\n';
      if (argv[0] === 'diff') return FAKE_DIFF;
      if (argv[0] === 'merge' && argv[1] === '--squash') {
        const err = new Error('merge conflict');
        err.stderr = 'CONFLICT: Merge conflict in file.txt';
        throw err;
      }
      return '';
    },
  }));

  assert.equal(result.ok, false, 'Should fail on merge conflict');
  assert.match(result.error, /squash merge failed/, 'Should report squash merge failure');

  // Verify rollback occurred
  const resetIdx = calls.findIndex(argv => argv[0] === 'reset' && argv[1] === '--merge');
  const checkoutBackIdx = calls.findIndex(argv => argv[0] === 'checkout' && argv[1] === 'work/test');

  assert.ok(resetIdx !== -1, 'Should reset to clean state');
  assert.ok(checkoutBackIdx !== -1, 'Should checkout back to work branch');
});

test('finishWorkBranchWithArchive restores state on commit failure', async () => {
  const calls = [];

  const result = await finishWorkBranchWithArchive(baseArgs({
    execGit(argv) {
      calls.push(argv);
      if (argv[0] === 'rev-parse' && argv[1]?.startsWith('work/')) {
        return 'abc1234567890123456789012345678901234567\n';
      }
      if (argv[0] === 'log') return 'abc1234 [forge] attest: cycle complete\n';
      if (argv[0] === 'merge-base') return 'basesha\n';
      if (argv[0] === 'diff') return FAKE_DIFF;
      if (argv[0] === 'commit' && argv.includes('-S')) {
        const err = new Error('GPG signing failed');
        err.stderr = 'error: gpg failed to sign the data';
        throw err;
      }
      return '';
    },
  }));

  assert.equal(result.ok, false, 'Should fail on commit error');
  assert.match(result.error, /commit failed/, 'Should report commit failure');

  // Verify rollback occurred
  const resetIdx = calls.findIndex(argv => argv[0] === 'reset' && argv[1] === '--merge');
  const checkoutBackIdx = calls.findIndex(argv => argv[0] === 'checkout' && argv[1] === 'work/test');

  assert.ok(resetIdx !== -1, 'Should reset to clean state');
  assert.ok(checkoutBackIdx !== -1, 'Should checkout back to work branch');
});

test('finishWorkBranchWithArchive returns success when branch deletion fails after commit succeeds', async () => {
  const calls = [];

  const result = await finishWorkBranchWithArchive(baseArgs({
    execGit(argv) {
      calls.push(argv);
      if (argv[0] === 'rev-parse' && argv[1]?.startsWith('work/')) {
        return 'abc1234567890123456789012345678901234567\n';
      }
      if (argv[0] === 'rev-parse' && argv[1] === '--short') {
        return 'def5678\n';
      }
      if (argv[0] === 'log') return 'abc1234 [forge] attest: cycle complete\n';
      if (argv[0] === 'merge-base') return 'basesha\n';
      if (argv[0] === 'diff') return FAKE_DIFF;
      if (argv[0] === 'branch' && argv[1] === '-D') {
        // Simulate branch deletion failure (e.g., branch checked out elsewhere)
        const err = new Error('branch deletion failed');
        err.stderr = "error: Cannot delete branch 'work/test' checked out at '/other/worktree'";
        throw err;
      }
      return '';
    },
  }));

  // Critical: the signed commit succeeded, so ok should be true
  assert.equal(result.ok, true, 'Should report success when commit succeeded even if branch deletion fails');
  assert.equal(result.hash, 'def5678', 'Should return the commit hash');
  assert.equal(result.branch, 'main', 'Should return the base branch');

  // Optional: check if there's a warning about branch deletion
  if (result.warning) {
    assert.match(result.warning, /branch.*delete/i, 'Warning should mention branch deletion failure');
  }
});

// --- Temp file cleanup tests ---

test('finishWorkBranchWithArchive cleans up temp commit-message file on success', async () => {
  const deletedFiles = [];
  const tempFile = '/tmp/git-dir/COMMIT_EDITMSG_1234567890';

  await finishWorkBranchWithArchive(baseArgs({
    writeTempMessage: () => tempFile,
    deleteFile: (filePath) => {
      deletedFiles.push(filePath);
    },
  }));

  assert.ok(deletedFiles.includes(tempFile), 'Should clean up temp commit-message file on success');
});

test('finishWorkBranchWithArchive cleans up temp commit-message file on rollback', async () => {
  const deletedFiles = [];
  const tempFile = '/tmp/git-dir/COMMIT_EDITMSG_1234567890';

  await finishWorkBranchWithArchive(baseArgs({
    execGit(argv) {
      if (argv[0] === 'rev-parse' && argv[1]?.startsWith('work/')) {
        return 'abc1234567890123456789012345678901234567\n';
      }
      if (argv[0] === 'log') return 'abc1234 [forge] attest: cycle complete\n';
      if (argv[0] === 'merge-base') return 'basesha\n';
      if (argv[0] === 'diff') return FAKE_DIFF;
      if (argv[0] === 'commit' && argv.includes('-S')) {
        const err = new Error('GPG signing failed');
        err.stderr = 'error: gpg failed to sign the data';
        throw err;
      }
      return '';
    },
    writeTempMessage: () => tempFile,
    deleteFile: (filePath) => {
      deletedFiles.push(filePath);
    },
  }));

  assert.ok(deletedFiles.includes(tempFile), 'Should clean up temp commit-message file on rollback');
});
