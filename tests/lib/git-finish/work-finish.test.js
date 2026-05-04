import test from 'node:test';
import assert from 'node:assert/strict';
import { finishWorkBranchWithArchive } from '../../../src/scripts/lib/git-finish/work-finish.js';

test('finishWorkBranchWithArchive rejects when confirm !== true', async () => {
  const res = await finishWorkBranchWithArchive({
    branchName: 'work/make-haiku-demo',
    baseBranch: 'main',
    confirm: false,
    message: 'feat: add haiku flow',
    execGit: () => '',
    buildPayload: async () => ({ schema: 'foundry-attestation/v1' }),
    writeTempMessage: () => '/tmp/test',
  });

  assert.equal(res.ok, false);
  assert.match(res.error, /requires \{confirm: true\}/);
});

test('finishWorkBranchWithArchive requires writeTempMessage dependency', async () => {
  await assert.rejects(
    async () => {
      await finishWorkBranchWithArchive({
        branchName: 'work/test',
        baseBranch: 'main',
        confirm: true,
        message: 'test',
        execGit: (argv) => {
          if (argv[0] === 'rev-parse') return 'abc1234\n';
          return '';
        },
        buildPayload: async () => ({ schema: 'foundry-attestation/v1' }),
        // writeTempMessage intentionally omitted
      });
    },
    /writeTempMessage is required/,
    'Should throw when writeTempMessage is not provided'
  );
});

test('finishWorkBranchWithArchive executes expected git sequence and returns correct shape', async () => {
  const calls = [];
  const res = await finishWorkBranchWithArchive({
    branchName: 'work/make-haiku-demo',
    baseBranch: 'main',
    confirm: true,
    message: 'feat: add haiku flow',
    execGit(argv) {
      calls.push(argv);
      if (argv[0] === 'rev-parse') return 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef\n';
      return '';
    },
    buildPayload: async ({ archiveBranch, archiveTipSha }) => {
      assert.equal(archiveBranch, 'archive/work/make-haiku-demo-deadbee');
      assert.equal(archiveTipSha, 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef');
      return { schema: 'foundry-attestation/v1' };
    },
    writeTempMessage: (content) => {
      assert.match(content, /feat: add haiku flow/);
      assert.match(content, /"schema":\s*"foundry-attestation\/v1"/);
      return '/tmp/commit-msg-test';
    },
  });

  // Verify return shape
  assert.equal(res.ok, true);
  assert.equal(res.archiveBranch, 'archive/work/make-haiku-demo-deadbee');
  assert.equal(res.archiveTipSha, 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef');
  assert.equal(res.branch, 'main');

  // Verify git call sequence
  assert.deepEqual(calls[0], ['rev-parse', 'work/make-haiku-demo']);
  assert.deepEqual(calls[1], ['branch', 'archive/work/make-haiku-demo-deadbee', 'work/make-haiku-demo']);
  assert.deepEqual(calls[2], ['checkout', 'main']);
  assert.deepEqual(calls[3], ['merge', '--squash', 'work/make-haiku-demo']);
  assert.deepEqual(calls[4], ['commit', '-S', '-F', '/tmp/commit-msg-test']);
});

test('finishWorkBranchWithArchive invokes signed commit with -S flag', async () => {
  const calls = [];
  await finishWorkBranchWithArchive({
    branchName: 'work/test',
    baseBranch: 'main',
    confirm: true,
    message: 'test',
    execGit(argv) {
      calls.push(argv);
      if (argv[0] === 'rev-parse') return 'abc1234567890123456789012345678901234567\n';
      return '';
    },
    buildPayload: async () => ({ schema: 'foundry-attestation/v1' }),
    writeTempMessage: () => '/tmp/test',
  });

  const commitCall = calls.find(argv => argv[0] === 'commit');
  assert.ok(commitCall, 'Should have a commit call');
  assert.ok(commitCall.includes('-S'), 'Commit should include -S flag for signing');
});

test('finishWorkBranchWithArchive removes WORK files before final commit', async () => {
  const calls = [];
  const deletedFiles = [];
  
  await finishWorkBranchWithArchive({
    branchName: 'work/test',
    baseBranch: 'main',
    confirm: true,
    message: 'test',
    execGit(argv) {
      calls.push(argv);
      if (argv[0] === 'rev-parse') return 'abc1234567890123456789012345678901234567\n';
      if (argv[0] === 'status' && argv[1] === '--porcelain') return 'D  WORK.md\nD  WORK.history.yaml';
      return '';
    },
    buildPayload: async () => ({ schema: 'foundry-attestation/v1' }),
    writeTempMessage: () => '/tmp/test',
    deleteFile: (filePath) => {
      deletedFiles.push(filePath);
    },
    fileExists: (filePath) => {
      const workFiles = ['WORK.md', 'WORK.history.yaml', 'WORK.feedback.yaml'];
      return workFiles.some(f => filePath.endsWith(f));
    },
    cwd: '/test/repo',
  });

  // Verify WORK files were deleted
  assert.ok(deletedFiles.some(f => f.endsWith('WORK.md')), 'Should delete WORK.md');
  assert.ok(deletedFiles.some(f => f.endsWith('WORK.history.yaml')), 'Should delete WORK.history.yaml');
  assert.ok(deletedFiles.some(f => f.endsWith('WORK.feedback.yaml')), 'Should delete WORK.feedback.yaml');

  // Verify cleanup commit was made before final commit
  const cleanupCommitIdx = calls.findIndex(argv => 
    argv[0] === 'commit' && argv.some(arg => arg.includes('cleanup'))
  );
  const finalCommitIdx = calls.findIndex(argv => 
    argv[0] === 'commit' && argv.includes('-S')
  );
  
  assert.ok(cleanupCommitIdx !== -1, 'Should have a cleanup commit');
  assert.ok(finalCommitIdx !== -1, 'Should have a final signed commit');
  assert.ok(cleanupCommitIdx < finalCommitIdx, 'Cleanup commit should occur before final commit');
});

test('finishWorkBranchWithArchive restores branch on squash-merge failure', async () => {
  const calls = [];
  
  const result = await finishWorkBranchWithArchive({
    branchName: 'work/test',
    baseBranch: 'main',
    confirm: true,
    message: 'test',
    execGit(argv) {
      calls.push(argv);
      if (argv[0] === 'rev-parse') return 'abc1234567890123456789012345678901234567\n';
      if (argv[0] === 'merge' && argv[1] === '--squash') {
        const err = new Error('merge conflict');
        err.stderr = 'CONFLICT: Merge conflict in file.txt';
        throw err;
      }
      return '';
    },
    buildPayload: async () => ({ schema: 'foundry-attestation/v1' }),
    writeTempMessage: () => '/tmp/test',
  });

  assert.equal(result.ok, false, 'Should fail on merge conflict');
  assert.match(result.error, /squash merge failed/, 'Should report squash merge failure');
  
  // Verify rollback occurred
  const resetIdx = calls.findIndex(argv => argv[0] === 'reset' && argv[1] === '--hard');
  const checkoutBackIdx = calls.findIndex(argv => argv[0] === 'checkout' && argv[1] === 'work/test');
  
  assert.ok(resetIdx !== -1, 'Should reset to clean state');
  assert.ok(checkoutBackIdx !== -1, 'Should checkout back to work branch');
});

test('finishWorkBranchWithArchive restores state on commit failure', async () => {
  const calls = [];
  
  const result = await finishWorkBranchWithArchive({
    branchName: 'work/test',
    baseBranch: 'main',
    confirm: true,
    message: 'test',
    execGit(argv) {
      calls.push(argv);
      if (argv[0] === 'rev-parse') return 'abc1234567890123456789012345678901234567\n';
      if (argv[0] === 'commit' && argv.includes('-S')) {
        const err = new Error('GPG signing failed');
        err.stderr = 'error: gpg failed to sign the data';
        throw err;
      }
      return '';
    },
    buildPayload: async () => ({ schema: 'foundry-attestation/v1' }),
    writeTempMessage: () => '/tmp/test',
  });

  assert.equal(result.ok, false, 'Should fail on commit error');
  assert.match(result.error, /commit failed/, 'Should report commit failure');
  
  // Verify rollback occurred
  const resetIdx = calls.findIndex(argv => argv[0] === 'reset' && argv[1] === '--hard');
  const checkoutBackIdx = calls.findIndex(argv => argv[0] === 'checkout' && argv[1] === 'work/test');
  
  assert.ok(resetIdx !== -1, 'Should reset to clean state');
  assert.ok(checkoutBackIdx !== -1, 'Should checkout back to work branch');
});

test('finishWorkBranchWithArchive rollback after cleanup restores original work state', async () => {
  const calls = [];
  let workBranchHead = 'original123456789012345678901234567890';
  
  const result = await finishWorkBranchWithArchive({
    branchName: 'work/test',
    baseBranch: 'main',
    confirm: true,
    message: 'test',
    execGit(argv) {
      calls.push(argv);
      if (argv[0] === 'rev-parse' && argv[1] === 'work/test') {
        return workBranchHead + '\n';
      }
      if (argv[0] === 'status' && argv[1] === '--porcelain') {
        return 'D  WORK.md\nD  WORK.history.yaml';
      }
      if (argv[0] === 'commit' && argv.some(arg => arg.includes('cleanup'))) {
        // Cleanup commit changes the HEAD
        workBranchHead = 'cleanup456789012345678901234567890123';
        return '';
      }
      if (argv[0] === 'merge' && argv[1] === '--squash') {
        const err = new Error('merge conflict');
        err.stderr = 'CONFLICT: Merge conflict in file.txt';
        throw err;
      }
      return '';
    },
    buildPayload: async () => ({ schema: 'foundry-attestation/v1' }),
    writeTempMessage: () => '/tmp/test',
    deleteFile: () => {},
    fileExists: (filePath) => {
      return filePath.endsWith('WORK.md') || filePath.endsWith('WORK.history.yaml');
    },
    cwd: '/test/repo',
  });

  assert.equal(result.ok, false, 'Should fail on merge conflict');
  
  // Verify rollback: should checkout work branch and reset to original state BEFORE cleanup
  const checkoutBackIdx = calls.findIndex(argv => 
    argv[0] === 'checkout' && argv[1] === 'work/test'
  );
  assert.ok(checkoutBackIdx !== -1, 'Should checkout back to work branch');
  
  const resetIdx = calls.findIndex(argv => 
    argv[0] === 'reset' && argv.includes('original123456789012345678901234567890')
  );
  assert.ok(resetIdx !== -1, 'Should reset work branch to original tip SHA before cleanup');
  assert.ok(checkoutBackIdx < resetIdx, 'Should checkout work branch before resetting to original SHA');
});

test('finishWorkBranchWithArchive payload builder reads empty captured work files', async () => {
  let capturedPayload = null;
  
  await finishWorkBranchWithArchive({
    branchName: 'work/test',
    baseBranch: 'main',
    confirm: true,
    message: 'test',
    execGit(argv) {
      if (argv[0] === 'rev-parse') return 'abc1234567890123456789012345678901234567\n';
      return '';
    },
    buildPayload: async ({ archiveBranch, archiveTipSha }) => {
      capturedPayload = { archiveBranch, archiveTipSha };
      return { schema: 'foundry-attestation/v1' };
    },
    writeTempMessage: () => '/tmp/test',
    deleteFile: () => {},
    fileExists: () => false,
    cwd: '/test/repo',
  });

  // This test verifies that buildPayload is called (work-finish.js doesn't check file content)
  // The actual empty-content handling is tested via git-tools.test.js integration
  assert.ok(capturedPayload, 'buildPayload should have been called');
  assert.equal(capturedPayload.archiveBranch, 'archive/work/test-abc1234');
});

test('finishWorkBranchWithArchive clears base-branch state before restoring work branch on squash-merge failure', async () => {
  const calls = [];
  let currentBranch = 'work/test';
  
  const result = await finishWorkBranchWithArchive({
    branchName: 'work/test',
    baseBranch: 'main',
    confirm: true,
    message: 'test',
    execGit(argv) {
      calls.push({ argv, currentBranch });
      
      if (argv[0] === 'rev-parse') return 'abc1234567890123456789012345678901234567\n';
      if (argv[0] === 'checkout') {
        currentBranch = argv[1];
        return '';
      }
      if (argv[0] === 'merge' && argv[1] === '--squash') {
        // Simulate squash-merge conflict leaving base branch in conflicted state
        const err = new Error('merge conflict');
        err.stderr = 'CONFLICT: Merge conflict in file.txt';
        throw err;
      }
      if (argv[0] === 'reset') {
        // This is the dangerous operation - should only run after we're back on work branch
        return '';
      }
      return '';
    },
    buildPayload: async () => ({ schema: 'foundry-attestation/v1' }),
    writeTempMessage: () => '/tmp/test',
  });

  assert.equal(result.ok, false, 'Should fail on merge conflict');
  
  // Critical safety requirement: base branch state must be cleared BEFORE checkout to work branch
  const mergeIdx = calls.findIndex(c => c.argv[0] === 'merge' && c.argv[1] === '--squash');
  const resetMainIdx = calls.findIndex(c => 
    c.argv[0] === 'reset' && c.argv[1] === '--merge' && c.currentBranch === 'main'
  );
  const checkoutWorkIdx = calls.findIndex(c => 
    c.argv[0] === 'checkout' && c.argv[1] === 'work/test' && c.currentBranch === 'main'
  );
  const resetWorkIdx = calls.findIndex(c => 
    c.argv[0] === 'reset' && c.argv[1] === '--hard' && c.currentBranch === 'work/test'
  );
  
  assert.ok(mergeIdx !== -1, 'Should have attempted merge');
  assert.ok(resetMainIdx !== -1, 'Should reset --merge on main to clear conflict state');
  assert.ok(checkoutWorkIdx !== -1, 'Should checkout work branch');
  assert.ok(resetWorkIdx !== -1, 'Should reset work branch to original tip');
  
  // Order must be: merge fails -> reset main -> checkout work -> reset work
  assert.ok(resetMainIdx > mergeIdx, 'Should reset main after merge fails');
  assert.ok(checkoutWorkIdx > resetMainIdx, 'Should checkout work branch after clearing main state');
  assert.ok(resetWorkIdx > checkoutWorkIdx, 'Should reset work branch after checking it out');
});

test('finishWorkBranchWithArchive removes archive branch on squash-merge failure', async () => {
  const calls = [];
  
  const result = await finishWorkBranchWithArchive({
    branchName: 'work/test',
    baseBranch: 'main',
    confirm: true,
    message: 'test',
    execGit(argv) {
      calls.push(argv);
      if (argv[0] === 'rev-parse') return 'abc1234567890123456789012345678901234567\n';
      if (argv[0] === 'merge' && argv[1] === '--squash') {
        const err = new Error('merge conflict');
        err.stderr = 'CONFLICT: Merge conflict in file.txt';
        throw err;
      }
      return '';
    },
    buildPayload: async () => ({ schema: 'foundry-attestation/v1' }),
    writeTempMessage: () => '/tmp/test',
  });

  assert.equal(result.ok, false, 'Should fail on merge conflict');
  
  // Archive branch should be created then deleted on failure
  const createArchiveIdx = calls.findIndex(c => 
    c[0] === 'branch' && c[1].startsWith('archive/')
  );
  const deleteArchiveIdx = calls.findIndex(c => 
    c[0] === 'branch' && c[1] === '-D' && c[2]?.startsWith('archive/')
  );
  
  assert.ok(createArchiveIdx !== -1, 'Should have created archive branch');
  assert.ok(deleteArchiveIdx !== -1, 'Should delete archive branch on failure');
  assert.ok(deleteArchiveIdx > createArchiveIdx, 'Should delete archive branch after creating it');
});

test('finishWorkBranchWithArchive removes archive branch on commit failure', async () => {
  const calls = [];
  
  const result = await finishWorkBranchWithArchive({
    branchName: 'work/test',
    baseBranch: 'main',
    confirm: true,
    message: 'test',
    execGit(argv) {
      calls.push(argv);
      if (argv[0] === 'rev-parse') return 'abc1234567890123456789012345678901234567\n';
      if (argv[0] === 'commit' && argv.includes('-S')) {
        const err = new Error('GPG signing failed');
        err.stderr = 'error: gpg failed to sign the data';
        throw err;
      }
      return '';
    },
    buildPayload: async () => ({ schema: 'foundry-attestation/v1' }),
    writeTempMessage: () => '/tmp/test',
  });

  assert.equal(result.ok, false, 'Should fail on commit error');
  
  // Archive branch should be created then deleted on failure
  const createArchiveIdx = calls.findIndex(c => 
    c[0] === 'branch' && c[1].startsWith('archive/')
  );
  const deleteArchiveIdx = calls.findIndex(c => 
    c[0] === 'branch' && c[1] === '-D' && c[2]?.startsWith('archive/')
  );
  
  assert.ok(createArchiveIdx !== -1, 'Should have created archive branch');
  assert.ok(deleteArchiveIdx !== -1, 'Should delete archive branch on commit failure');
  assert.ok(deleteArchiveIdx > createArchiveIdx, 'Should delete archive branch after creating it');
});

test('finishWorkBranchWithArchive stops safely when cleanup commit fails', async () => {
  const calls = [];
  
  const result = await finishWorkBranchWithArchive({
    branchName: 'work/test',
    baseBranch: 'main',
    confirm: true,
    message: 'test',
    execGit(argv) {
      calls.push(argv);
      if (argv[0] === 'rev-parse') return 'abc1234567890123456789012345678901234567\n';
      if (argv[0] === 'status' && argv[1] === '--porcelain') return 'D  WORK.md';
      if (argv[0] === 'commit' && argv.some(arg => arg.includes('cleanup'))) {
        const err = new Error('cleanup commit failed');
        err.stderr = 'error: pre-commit hook failed';
        throw err;
      }
      return '';
    },
    buildPayload: async () => ({ schema: 'foundry-attestation/v1' }),
    writeTempMessage: () => '/tmp/test',
    deleteFile: () => {},
    fileExists: (filePath) => filePath.endsWith('WORK.md'),
    cwd: '/test/repo',
  });

  assert.equal(result.ok, false, 'Should fail when cleanup commit fails');
  assert.match(result.error, /cleanup commit failed/, 'Should report cleanup commit failure');
  
  // Critical: should NOT proceed to checkout base branch
  const checkoutBaseIdx = calls.findIndex(c => c[0] === 'checkout' && c[1] === 'main');
  assert.equal(checkoutBaseIdx, -1, 'Should not checkout base branch after cleanup commit failure');
  
  // Should attempt to restore work branch
  const checkoutWorkIdx = calls.findIndex(c => c[0] === 'checkout' && c[1] === 'work/test');
  assert.ok(checkoutWorkIdx !== -1, 'Should checkout work branch for cleanup');
  
  // Should delete archive branch
  const deleteArchiveIdx = calls.findIndex(c => 
    c[0] === 'branch' && c[1] === '-D' && c[2]?.startsWith('archive/')
  );
  assert.ok(deleteArchiveIdx !== -1, 'Should delete archive branch on cleanup commit failure');
});

test('finishWorkBranchWithArchive triggers rollback when buildPayload throws after squash', async () => {
  const calls = [];
  
  const result = await finishWorkBranchWithArchive({
    branchName: 'work/test',
    baseBranch: 'main',
    confirm: true,
    message: 'test',
    execGit(argv) {
      calls.push(argv);
      if (argv[0] === 'rev-parse') return 'abc1234567890123456789012345678901234567\n';
      return '';
    },
    buildPayload: async () => {
      throw new Error('payload builder error');
    },
    writeTempMessage: () => '/tmp/test',
  });

  assert.equal(result.ok, false, 'Should fail on buildPayload error');
  assert.match(result.error, /payload builder error/, 'Should report buildPayload error');
  
  // Verify rollback occurred
  const resetIdx = calls.findIndex(argv => argv[0] === 'reset' && argv[1] === '--merge');
  const checkoutWorkIdx = calls.findIndex(argv => argv[0] === 'checkout' && argv[1] === 'work/test');
  const resetWorkIdx = calls.findIndex(argv => 
    argv[0] === 'reset' && argv[1] === '--hard' && argv[2] === 'abc1234567890123456789012345678901234567'
  );
  
  assert.ok(resetIdx !== -1, 'Should reset base branch to clear squash');
  assert.ok(checkoutWorkIdx !== -1, 'Should checkout work branch');
  assert.ok(resetWorkIdx !== -1, 'Should reset work branch to original tip');
  
  // Should delete archive branch
  const deleteArchiveIdx = calls.findIndex(c => 
    c[0] === 'branch' && c[1] === '-D' && c[2]?.startsWith('archive/')
  );
  assert.ok(deleteArchiveIdx !== -1, 'Should delete archive branch on buildPayload failure');
});

test('finishWorkBranchWithArchive triggers rollback when writeTempMessage throws after squash', async () => {
  const calls = [];
  
  const result = await finishWorkBranchWithArchive({
    branchName: 'work/test',
    baseBranch: 'main',
    confirm: true,
    message: 'test',
    execGit(argv) {
      calls.push(argv);
      if (argv[0] === 'rev-parse') return 'abc1234567890123456789012345678901234567\n';
      return '';
    },
    buildPayload: async () => ({ schema: 'foundry-attestation/v1' }),
    writeTempMessage: () => {
      throw new Error('write temp file failed');
    },
  });

  assert.equal(result.ok, false, 'Should fail on writeTempMessage error');
  assert.match(result.error, /write temp file failed/, 'Should report writeTempMessage error');
  
  // Verify rollback occurred
  const resetIdx = calls.findIndex(argv => argv[0] === 'reset' && argv[1] === '--merge');
  const checkoutWorkIdx = calls.findIndex(argv => argv[0] === 'checkout' && argv[1] === 'work/test');
  const resetWorkIdx = calls.findIndex(argv => 
    argv[0] === 'reset' && argv[1] === '--hard' && argv[2] === 'abc1234567890123456789012345678901234567'
  );
  
  assert.ok(resetIdx !== -1, 'Should reset base branch to clear squash');
  assert.ok(checkoutWorkIdx !== -1, 'Should checkout work branch');
  assert.ok(resetWorkIdx !== -1, 'Should reset work branch to original tip');
  
  // Should delete archive branch
  const deleteArchiveIdx = calls.findIndex(c => 
    c[0] === 'branch' && c[1] === '-D' && c[2]?.startsWith('archive/')
  );
  assert.ok(deleteArchiveIdx !== -1, 'Should delete archive branch on writeTempMessage failure');
});

test('finishWorkBranchWithArchive requires signed commit in production mode', async () => {
  const calls = [];
  
  await finishWorkBranchWithArchive({
    branchName: 'work/test',
    baseBranch: 'main',
    confirm: true,
    message: 'test',
    execGit(argv) {
      calls.push(argv);
      if (argv[0] === 'rev-parse') return 'abc1234567890123456789012345678901234567\n';
      return '';
    },
    buildPayload: async () => ({ schema: 'foundry-attestation/v1' }),
    writeTempMessage: () => '/tmp/test',
  });

  const commitCall = calls.find(argv => argv[0] === 'commit');
  assert.ok(commitCall, 'Should have a commit call');
  assert.ok(commitCall.includes('-S'), 'Production commit must include -S flag');
  assert.ok(commitCall.includes('-F'), 'Commit should use temp file');
});

test('finishWorkBranchWithArchive restores work branch and removes archive when checkout base fails after cleanup', async () => {
  const calls = [];
  
  const result = await finishWorkBranchWithArchive({
    branchName: 'work/test',
    baseBranch: 'main',
    confirm: true,
    message: 'test',
    execGit(argv) {
      calls.push(argv);
      if (argv[0] === 'rev-parse') return 'abc1234567890123456789012345678901234567\n';
      if (argv[0] === 'status' && argv[1] === '--porcelain') return 'D  WORK.md';
      if (argv[0] === 'checkout' && argv[1] === 'main') {
        // Simulate linked worktree checkout failure
        const err = new Error('checkout failed');
        err.stderr = 'fatal: \'main\' is already checked out at /Users/user/project';
        throw err;
      }
      return '';
    },
    buildPayload: async () => ({ schema: 'foundry-attestation/v1' }),
    writeTempMessage: () => '/tmp/test',
    deleteFile: () => {},
    fileExists: (filePath) => filePath.endsWith('WORK.md'),
    cwd: '/test/repo',
  });

  assert.equal(result.ok, false, 'Should fail when base checkout fails');
  assert.match(result.error, /checkout.*failed/, 'Should report checkout failure');
  
  // Critical: should restore work branch to original state BEFORE cleanup mutation
  const checkoutWorkIdx = calls.findIndex(c => c[0] === 'checkout' && c[1] === 'work/test');
  assert.ok(checkoutWorkIdx !== -1, 'Should checkout work branch for rollback');
  
  const resetWorkIdx = calls.findIndex(c => 
    c[0] === 'reset' && c[1] === '--hard' && c[2] === 'abc1234567890123456789012345678901234567'
  );
  assert.ok(resetWorkIdx !== -1, 'Should reset work branch to original tip before cleanup');
  
  // Should delete leaked archive branch
  const deleteArchiveIdx = calls.findIndex(c => 
    c[0] === 'branch' && c[1] === '-D' && c[2]?.startsWith('archive/')
  );
  assert.ok(deleteArchiveIdx !== -1, 'Should delete archive branch on checkout failure');
  
  // Ensure proper rollback order: checkout work -> reset work -> delete archive
  assert.ok(checkoutWorkIdx < resetWorkIdx, 'Should checkout work branch before resetting');
});

test('finishWorkBranchWithArchive handles real linked-worktree scenario with default main branch', async () => {
  const calls = [];
  
  const result = await finishWorkBranchWithArchive({
    branchName: 'work/feature',
    // No explicit baseBranch provided in many real scenarios; caller determines it
    baseBranch: 'main',
    confirm: true,
    message: 'feat: add feature',
    execGit(argv) {
      calls.push(argv);
      if (argv[0] === 'rev-parse') return 'def5678901234567890123456789012345678901\n';
      if (argv[0] === 'checkout' && argv[1] === 'main') {
        // Real linked-worktree failure: main is checked out in parent worktree
        const err = new Error('checkout failed');
        err.stderr = 'fatal: \'main\' is already checked out at /Users/user/foundry';
        throw err;
      }
      return '';
    },
    buildPayload: async () => ({ schema: 'foundry-attestation/v1' }),
    writeTempMessage: () => '/tmp/test',
  });

  assert.equal(result.ok, false, 'Should fail when main is checked out in parent worktree');
  
  // Verify the real error scenario is detected
  assert.match(result.error, /checkout.*failed/, 'Should report checkout failure');
  
  // Verify archive branch was created (proving we got past initial setup)
  const createArchiveIdx = calls.findIndex(c => 
    c[0] === 'branch' && c[1].startsWith('archive/')
  );
  assert.ok(createArchiveIdx !== -1, 'Should have created archive branch before checkout failure');
  
  // Verify rollback cleanup happened
  const deleteArchiveIdx = calls.findIndex(c => 
    c[0] === 'branch' && c[1] === '-D'
  );
  assert.ok(deleteArchiveIdx !== -1, 'Should clean up leaked archive branch');
});

// BLOCKING ISSUE 1: Temporary commit-message files must be cleaned up on success
test('finishWorkBranchWithArchive cleans up temp commit-message file on success', async () => {
  const calls = [];
  const deletedFiles = [];
  const tempFile = '/tmp/git-dir/COMMIT_EDITMSG_1234567890';
  
  await finishWorkBranchWithArchive({
    branchName: 'work/test',
    baseBranch: 'main',
    confirm: true,
    message: 'test',
    execGit(argv) {
      calls.push(argv);
      if (argv[0] === 'rev-parse') return 'abc1234567890123456789012345678901234567\n';
      return '';
    },
    buildPayload: async () => ({ schema: 'foundry-attestation/v1' }),
    writeTempMessage: () => tempFile,
    deleteFile: (filePath) => {
      deletedFiles.push(filePath);
    },
    fileExists: () => false,
    cwd: '/test/repo',
  });

  assert.ok(deletedFiles.includes(tempFile), 'Should clean up temp commit-message file on success');
});

// BLOCKING ISSUE 1: Temporary commit-message files must be cleaned up on rollback
test('finishWorkBranchWithArchive cleans up temp commit-message file on rollback', async () => {
  const deletedFiles = [];
  const tempFile = '/tmp/git-dir/COMMIT_EDITMSG_1234567890';
  
  await finishWorkBranchWithArchive({
    branchName: 'work/test',
    baseBranch: 'main',
    confirm: true,
    message: 'test',
    execGit(argv) {
      if (argv[0] === 'rev-parse') return 'abc1234567890123456789012345678901234567\n';
      if (argv[0] === 'commit' && argv.includes('-S')) {
        const err = new Error('GPG signing failed');
        err.stderr = 'error: gpg failed to sign the data';
        throw err;
      }
      return '';
    },
    buildPayload: async () => ({ schema: 'foundry-attestation/v1' }),
    writeTempMessage: () => tempFile,
    deleteFile: (filePath) => {
      deletedFiles.push(filePath);
    },
    fileExists: () => false,
    cwd: '/test/repo',
  });

  assert.ok(deletedFiles.includes(tempFile), 'Should clean up temp commit-message file on rollback');
});

// BLOCKING ISSUE 2: Cleanup must use selective staging, not git add -A
test('finishWorkBranchWithArchive uses selective staging for cleanup commit', async () => {
  const calls = [];
  
  await finishWorkBranchWithArchive({
    branchName: 'work/test',
    baseBranch: 'main',
    confirm: true,
    message: 'test',
    execGit(argv) {
      calls.push(argv);
      if (argv[0] === 'rev-parse') return 'abc1234567890123456789012345678901234567\n';
      if (argv[0] === 'status' && argv[1] === '--porcelain') return 'D  WORK.md';
      return '';
    },
    buildPayload: async () => ({ schema: 'foundry-attestation/v1' }),
    writeTempMessage: () => '/tmp/test',
    deleteFile: () => {},
    fileExists: (filePath) => filePath.endsWith('WORK.md'),
    cwd: '/test/repo',
  });

  // Should NOT use 'git add -A'
  const addAllIdx = calls.findIndex(argv => 
    argv[0] === 'add' && argv[1] === '-A'
  );
  assert.equal(addAllIdx, -1, 'Should NOT use git add -A which can sweep unrelated files');
  
  // Should use selective staging for WORK files only
  const addWorkMdIdx = calls.findIndex(argv => 
    argv[0] === 'add' && argv.includes('WORK.md')
  );
  assert.ok(addWorkMdIdx !== -1, 'Should selectively stage WORK.md deletion');
});

// BLOCKING ISSUE 3: Production finish path must not be controllable via environment
test('finishWorkBranchWithArchive ignores skipGpgSign parameter for security', async () => {
  const calls = [];
  
  // Attempt to bypass signing via skipGpgSign parameter
  await finishWorkBranchWithArchive({
    branchName: 'work/test',
    baseBranch: 'main',
    confirm: true,
    message: 'test',
    execGit(argv) {
      calls.push(argv);
      if (argv[0] === 'rev-parse') return 'abc1234567890123456789012345678901234567\n';
      return '';
    },
    buildPayload: async () => ({ schema: 'foundry-attestation/v1' }),
    writeTempMessage: () => '/tmp/test',
    skipGpgSign: true, // Caller attempting to bypass signing
  });

  const commitCall = calls.find(argv => argv[0] === 'commit');
  assert.ok(commitCall, 'Should have a commit call');
  assert.ok(commitCall.includes('-S'), 'Production code must always require -S flag regardless of skipGpgSign parameter');
});

// PHASE 2 TASK 2: Post-success branch deletion failure must not appear as overall failure
test('finishWorkBranchWithArchive returns success when branch deletion fails after commit succeeds', async () => {
  const calls = [];
  
  const result = await finishWorkBranchWithArchive({
    branchName: 'work/test',
    baseBranch: 'main',
    confirm: true,
    message: 'test',
    execGit(argv) {
      calls.push(argv);
      if (argv[0] === 'rev-parse' && argv[1] === 'work/test') {
        return 'abc1234567890123456789012345678901234567\n';
      }
      if (argv[0] === 'rev-parse' && argv[1] === '--short') {
        return 'def5678\n';
      }
      if (argv[0] === 'branch' && argv[1] === '-D') {
        // Simulate branch deletion failure (e.g., branch checked out elsewhere)
        const err = new Error('branch deletion failed');
        err.stderr = 'error: Cannot delete branch \'work/test\' checked out at \'/other/worktree\'';
        throw err;
      }
      return '';
    },
    buildPayload: async () => ({ schema: 'foundry-attestation/v1' }),
    writeTempMessage: () => '/tmp/test',
  });

  // Critical: the signed commit succeeded, so ok should be true
  assert.equal(result.ok, true, 'Should report success when commit succeeded even if branch deletion fails');
  assert.equal(result.hash, 'def5678', 'Should return the commit hash');
  assert.equal(result.branch, 'main', 'Should return the base branch');
  
  // Optional: check if there's a warning about branch deletion
  if (result.warning) {
    assert.match(result.warning, /branch.*delete/i, 'Warning should mention branch deletion failure');
  }
});
