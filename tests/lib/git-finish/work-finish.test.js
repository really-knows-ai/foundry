import test from 'node:test';
import assert from 'node:assert/strict';
import { finishWorkBranchWithArchive } from '../../../src/scripts/lib/git-finish/work-finish.js';

function makeGitError(argv) {
  const err = new Error(`${argv[0]} failed`);
  err.stderr = `error: ${argv[0]} failed`;
  return err;
}

function matchPrefixCmd(first, second, sha) {
  if (first === 'rev-parse' && second?.startsWith('work/')) return sha;
  return '';
}

function buildResponses(options) {
  const { shortHash, workSha, overrides: extraResponses } = options;
  const sha = workSha || 'abc1234567890123456789012345678901234567\n';
  const short = shortHash || 'abc1234\n';
  const logBody = '[test-cycle] appraise:test-cycle: completed\n\nfoundry-run: 01TESTRUNID\nattestation-seal: abc123def456\ncomposite-status: pass\nstage-count: 4\n';

  return {
    sha,
    map: {
      'rev-parse --short HEAD': short,
      'log -1 --pretty=%B': logBody,
      'merge-base': 'basesha\n',
      ...extraResponses,
    },
  };
}

function makeSuccessExecGit(options = {}) {
  const { sha, map } = buildResponses(options);

  return (argv) => {
    const cmd = argv.join(' ');
    if (map[cmd] !== undefined) return map[cmd];
    return matchPrefixCmd(argv[0], argv[1], sha);
  };
}

function makeFailingExecGit(failWhen, options = {}) {
  const { sha, map } = buildResponses(options);

  return (argv) => {
    const cmd = argv.join(' ');
    if (failWhen(argv)) throw makeGitError(argv);
    if (map[cmd] !== undefined) return map[cmd];
    return matchPrefixCmd(argv[0], argv[1], sha);
  };
}

function withCallTracking(execGit) {
  const calls = [];
  const tracked = (argv) => {
    calls.push(argv);
    return execGit(argv);
  };
  tracked.calls = calls;
  return tracked;
}

function baseArgs(overrides = {}) {
  return {
    branchName: 'work/test',
    baseBranch: 'main',
    confirm: true,
    execGit: makeSuccessExecGit(),
    deleteFile: () => {},
    writeTempMessage: () => '/tmp/test',
    ...overrides,
  };
}

// --- Seal gate tests ---

test('finishWorkBranchWithArchive passes seal gate when HEAD has foundry-run and attestation-seal', async () => {
  const result = await finishWorkBranchWithArchive(baseArgs());
  assert.equal(result.ok, true);
});

test('finishWorkBranchWithArchive fails seal gate when HEAD has no foundry-run field', async () => {
  const body = '[test-cycle] appraise:test-cycle: completed\n\nattestation-seal: abc123def456\ncomposite-status: pass\nstage-count: 4\n';
  const result = await finishWorkBranchWithArchive(baseArgs({
    execGit: makeSuccessExecGit({
      overrides: { 'log -1 --pretty=%B': body },
    }),
  }));
  assert.equal(result.ok, false);
  assert.match(result.error, /no attestation seal found/);
});

test('finishWorkBranchWithArchive fails seal gate when HEAD has no attestation-seal field', async () => {
  const body = '[test-cycle] appraise:test-cycle: completed\n\nfoundry-run: 01TESTRUNID\ncomposite-status: pass\nstage-count: 4\n';
  const result = await finishWorkBranchWithArchive(baseArgs({
    execGit: makeSuccessExecGit({
      overrides: { 'log -1 --pretty=%B': body },
    }),
  }));
  assert.equal(result.ok, false);
  assert.match(result.error, /no attestation seal found/);
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
  const execGit = withCallTracking(makeSuccessExecGit({
    shortHash: 'deadbee\n',
    workSha: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef\n',
  }));
  const res = await finishWorkBranchWithArchive(baseArgs({ execGit }));

  // Verify return shape
  assert.equal(res.ok, true);
  assert.equal(res.archiveBranch, 'archive/work/test-deadbee');
  assert.equal(res.archiveTipSha, 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef');
  assert.equal(res.branch, 'main');
  assert.equal(res.hash, 'deadbee');

  // Verify git call sequence
  const calls = execGit.calls;
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
  const execGit = withCallTracking(makeSuccessExecGit());
  await finishWorkBranchWithArchive(baseArgs({ execGit }));

  const commitCall = execGit.calls.find(argv => argv[0] === 'commit');
  assert.ok(commitCall, 'Should have a commit call');
  assert.ok(commitCall.includes('-S'), 'Commit should include -S flag for signing');
});

// --- Failure tests ---

test('finishWorkBranchWithArchive restores branch on squash-merge failure', async () => {
  const execGit = withCallTracking(makeFailingExecGit(
    (argv) => argv[0] === 'merge' && argv[1] === '--squash',
  ));

  const result = await finishWorkBranchWithArchive(baseArgs({ execGit }));

  assert.equal(result.ok, false, 'Should fail on merge conflict');
  assert.match(result.error, /squash merge failed/, 'Should report squash merge failure');

  // Verify rollback occurred
  const calls = execGit.calls;
  const resetIdx = calls.findIndex(argv => argv[0] === 'reset' && argv[1] === '--merge');
  const checkoutBackIdx = calls.findIndex(argv => argv[0] === 'checkout' && argv[1] === 'work/test');

  assert.ok(resetIdx !== -1, 'Should reset to clean state');
  assert.ok(checkoutBackIdx !== -1, 'Should checkout back to work branch');
});

test('finishWorkBranchWithArchive restores state on commit failure', async () => {
  const execGit = withCallTracking(makeFailingExecGit(
    (argv) => argv[0] === 'commit' && argv.includes('-S'),
  ));

  const result = await finishWorkBranchWithArchive(baseArgs({ execGit }));

  assert.equal(result.ok, false, 'Should fail on commit error');
  assert.match(result.error, /commit failed/, 'Should report commit failure');

  // Verify rollback occurred
  const calls = execGit.calls;
  const resetIdx = calls.findIndex(argv => argv[0] === 'reset' && argv[1] === '--merge');
  const checkoutBackIdx = calls.findIndex(argv => argv[0] === 'checkout' && argv[1] === 'work/test');

  assert.ok(resetIdx !== -1, 'Should reset to clean state');
  assert.ok(checkoutBackIdx !== -1, 'Should checkout back to work branch');
});

test('finishWorkBranchWithArchive returns success when branch deletion fails after commit succeeds', async () => {
  const execGit = makeFailingExecGit(
    (argv) => argv[0] === 'branch' && argv[1] === '-D',
    { shortHash: 'def5678\n' },
  );

  const result = await finishWorkBranchWithArchive(baseArgs({ execGit }));

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

  const execGit = makeFailingExecGit(
    (argv) => argv[0] === 'commit' && argv.includes('-S'),
  );

  await finishWorkBranchWithArchive(baseArgs({
    execGit,
    writeTempMessage: () => tempFile,
    deleteFile: (filePath) => {
      deletedFiles.push(filePath);
    },
  }));

  assert.ok(deletedFiles.includes(tempFile), 'Should clean up temp commit-message file on rollback');
});
