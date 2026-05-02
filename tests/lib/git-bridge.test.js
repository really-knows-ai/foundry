// tests/lib/git-bridge.test.js
//
// Drives commitWithPolicy against a real temp git repo. Each test seeds a
// scenario from the REVIEW.md "Stop orchestrator commits from capturing
// unrelated repository changes" item:
//
//   1. pre-existing unrelated tracked change
//   2. pre-existing untracked file
//   3. unrelated secret-like file
//   4. allowed stage file only (happy path)
//   5. dirty worktree after a failed finalize (mix of allowed + unrelated)
//
// Plus targeted unit checks (rename handling, empty diff, index reset).

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { commitWithPolicy, UnexpectedFilesError } from '../../scripts/lib/git-bridge.js';

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t',
  GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
};

function makeRunner(cwd) {
  return (args) => execFileSync('git', args, { cwd, env: GIT_ENV, encoding: 'utf8' });
}

function git(cwd, args) {
  return execFileSync('git', args, { cwd, env: GIT_ENV, encoding: 'utf8' }).trim();
}

describe('commitWithPolicy', () => {
  let dir, run;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'foundry-bridge-'));
    execFileSync('git', ['init', '-q'], { cwd: dir, env: GIT_ENV });
    writeFileSync(join(dir, 'README.md'), 'hello\n');
    git(dir, ['add', '.']);
    git(dir, ['commit', '-q', '-m', 'init']);
    run = makeRunner(dir);
  });

  // 1. Pre-existing unrelated tracked change
  it('refuses commit when an unrelated tracked file has been modified', () => {
    writeFileSync(join(dir, 'README.md'), 'tampered\n'); // tracked, modified
    writeFileSync(join(dir, 'WORK.md'), '---\n---\n');   // tool-managed change

    assert.throws(
      () => commitWithPolicy({
        message: '[c] setup',
        allowedPatterns: [],
        execFile: run,
      }),
      (err) => {
        assert.ok(err instanceof UnexpectedFilesError);
        assert.deepEqual(err.files, ['README.md']);
        assert.equal(err.code, 'unexpected_files');
        return true;
      },
    );
    // Critical: nothing was committed and nothing was left staged.
    const log = git(dir, ['log', '--oneline']).split('\n').length;
    assert.equal(log, 1, 'no new commit');
    const staged = git(dir, ['diff', '--cached', '--name-only']);
    assert.equal(staged, '', 'index left empty');
  });

  // 2. Pre-existing untracked file
  it('refuses commit when an unrelated untracked file is present', () => {
    writeFileSync(join(dir, 'notes.txt'), 'todo\n');
    writeFileSync(join(dir, 'WORK.md'), '---\n---\n');

    assert.throws(
      () => commitWithPolicy({
        message: '[c] setup',
        allowedPatterns: [],
        execFile: run,
      }),
      (err) => {
        assert.ok(err instanceof UnexpectedFilesError);
        assert.deepEqual(err.files, ['notes.txt']);
        return true;
      },
    );
    assert.equal(existsSync(join(dir, 'notes.txt')), true, 'untracked file is preserved');
  });

  // 3. Unrelated secret-like file
  it('refuses commit when a secret-like untracked file is present', () => {
    writeFileSync(join(dir, '.env'), 'API_KEY=hunter2\n');
    writeFileSync(join(dir, 'credentials.json'), '{"token":"x"}\n');
    writeFileSync(join(dir, 'WORK.md'), '---\n---\n');

    assert.throws(
      () => commitWithPolicy({
        message: '[c] setup',
        allowedPatterns: [],
        execFile: run,
      }),
      (err) => {
        assert.ok(err instanceof UnexpectedFilesError);
        // Secrets must appear in the unexpected list verbatim.
        assert.ok(err.files.includes('.env'), `expected .env in ${JSON.stringify(err.files)}`);
        assert.ok(err.files.includes('credentials.json'));
        return true;
      },
    );
    // Most importantly: the secret was not staged or committed.
    const tree = git(dir, ['ls-tree', '-r', 'HEAD', '--name-only']);
    assert.ok(!tree.includes('.env'), 'secret never reaches the tree');
  });

  // 4. Allowed stage file only (happy path)
  it('commits exactly the allowed files for a forge stage', () => {
    mkdirSync(join(dir, 'haikus'), { recursive: true });
    writeFileSync(join(dir, 'haikus/a.md'), 'first draft\n');
    writeFileSync(join(dir, 'WORK.md'), '---\n---\n');
    writeFileSync(join(dir, 'WORK.history.yaml'), '- {}\n');

    const sha = commitWithPolicy({
      message: '[create-haiku] forge:create-haiku: wrote haiku',
      allowedPatterns: ['haikus/*.md'],
      execFile: run,
    });
    assert.match(sha, /^[0-9a-f]{4,}$/);

    const lastFiles = git(dir, ['show', '--name-only', '--pretty=format:', 'HEAD'])
      .split('\n').filter(Boolean).sort();
    assert.deepEqual(lastFiles, ['WORK.history.yaml', 'WORK.md', 'haikus/a.md']);

    const subject = git(dir, ['log', '-1', '--pretty=%s']);
    assert.equal(subject, '[create-haiku] forge:create-haiku: wrote haiku');
  });

  // 5. Dirty worktree after a failed finalize: mix of an allowed stage file
  //    AND an unrelated stray file. Must refuse — the prior failed run is
  //    not a license to commit anything that happens to be lying around.
  it('refuses commit when an allowed file and an unrelated file are both dirty', () => {
    mkdirSync(join(dir, 'haikus'), { recursive: true });
    writeFileSync(join(dir, 'haikus/a.md'), 'partial draft\n');
    writeFileSync(join(dir, 'stray.bin'), 'leftover\n');
    writeFileSync(join(dir, 'WORK.md'), '---\n---\n');

    assert.throws(
      () => commitWithPolicy({
        message: '[c] forge: x',
        allowedPatterns: ['haikus/*.md'],
        execFile: run,
      }),
      (err) => {
        assert.ok(err instanceof UnexpectedFilesError);
        assert.deepEqual(err.files, ['stray.bin']);
        return true;
      },
    );
    // The allowed file was not committed either — we refuse the whole commit.
    const log = git(dir, ['log', '--oneline']).split('\n').length;
    assert.equal(log, 1);
  });

  it('handles a renamed unrelated file by reporting both source and dest', () => {
    writeFileSync(join(dir, 'tracked.txt'), 'x\n');
    git(dir, ['add', '.']);
    git(dir, ['commit', '-q', '-m', 'add tracked']);
    git(dir, ['mv', 'tracked.txt', 'renamed.txt']);
    writeFileSync(join(dir, 'WORK.md'), '---\n---\n');

    assert.throws(
      () => commitWithPolicy({
        message: '[c] setup',
        allowedPatterns: [],
        execFile: run,
      }),
      (err) => {
        assert.ok(err instanceof UnexpectedFilesError);
        // Both old and new appear; either order is acceptable.
        assert.ok(err.files.includes('tracked.txt'));
        assert.ok(err.files.includes('renamed.txt'));
        return true;
      },
    );
  });

  it('returns null when the worktree is clean', () => {
    const sha = commitWithPolicy({
      message: '[c] setup',
      allowedPatterns: [],
      execFile: run,
    });
    assert.equal(sha, null);
    const log = git(dir, ['log', '--oneline']).split('\n').length;
    assert.equal(log, 1);
  });

  it('does not silently commit a pre-staged unexpected file', () => {
    // Simulate a prior failed run that left an unrelated file staged.
    writeFileSync(join(dir, 'leftover.txt'), 'oops\n');
    git(dir, ['add', 'leftover.txt']);
    writeFileSync(join(dir, 'WORK.md'), '---\n---\n');

    assert.throws(
      () => commitWithPolicy({
        message: '[c] setup',
        allowedPatterns: [],
        execFile: run,
      }),
      (err) => {
        assert.ok(err.files.includes('leftover.txt'));
        return true;
      },
    );
    // No new commit was created.
    const log = git(dir, ['log', '--oneline']).split('\n').length;
    assert.equal(log, 1);
    // The leftover file is still on disk for the user to inspect.
    assert.equal(existsSync(join(dir, 'leftover.txt')), true);
  });

  it('resets a stale index of allowed files before staging the current set', () => {
    // Pre-stage an old version of an allowed file, then change the worktree
    // so only the new version is current. The bridge must not commit stale
    // staged content alongside a different worktree state.
    mkdirSync(join(dir, 'haikus'), { recursive: true });
    writeFileSync(join(dir, 'haikus/a.md'), 'old version\n');
    git(dir, ['add', 'haikus/a.md']);
    writeFileSync(join(dir, 'haikus/a.md'), 'new version\n'); // worktree differs from index
    writeFileSync(join(dir, 'WORK.md'), '---\n---\n');

    const sha = commitWithPolicy({
      message: '[c] forge: x',
      allowedPatterns: ['haikus/*.md'],
      execFile: run,
    });
    assert.match(sha, /^[0-9a-f]{4,}$/);
    const committed = git(dir, ['show', 'HEAD:haikus/a.md']);
    assert.equal(committed, 'new version', 'commits the worktree, not the stale index');
  });

  // G4: Atomicity guarantee - index must be clean if commit fails after add
  it('maintains atomicity guarantee when commit fails after add succeeds', () => {
    // Simulate a commit failure (e.g., pre-commit hook reject, gpg error).
    // The index must be rolled back even though add() succeeded.
    mkdirSync(join(dir, 'haikus'), { recursive: true });
    writeFileSync(join(dir, 'haikus/a.md'), 'draft\n');
    writeFileSync(join(dir, 'WORK.md'), '---\n---\n');

    const failingRun = (args) => {
      if (args[0] === 'commit') {
        throw new Error('commit failed: pre-commit hook rejected');
      }
      return run(args);
    };

    assert.throws(
      () => commitWithPolicy({
        message: '[c] forge: x',
        allowedPatterns: ['haikus/*.md'],
        execFile: failingRun,
      }),
      /commit failed/,
    );

    // Critical: the atomicity contract says "Nothing is staged or committed"
    // on failure. The index must be clean even though add() succeeded before
    // the commit failure.
    const staged = git(dir, ['diff', '--cached', '--name-only']);
    assert.equal(staged, '', 'index must be clean after commit failure (atomicity guarantee)');
    
    // No new commit was created
    const log = git(dir, ['log', '--oneline']).split('\n').length;
    assert.equal(log, 1);
  });

  // G36: Error message must be bounded to prevent log flooding
  it('bounds UnexpectedFilesError message to count, not full file list', () => {
    // Create a scenario with many unexpected files to verify message stays compact.
    for (let i = 0; i < 50; i++) {
      writeFileSync(join(dir, `stray-${i}.txt`), `junk ${i}\n`);
    }
    writeFileSync(join(dir, 'WORK.md'), '---\n---\n');

    assert.throws(
      () => commitWithPolicy({
        message: '[c] setup',
        allowedPatterns: [],
        execFile: run,
      }),
      (err) => {
        assert.ok(err instanceof UnexpectedFilesError);
        // The structured err.files array should contain all 50 files.
        assert.equal(err.files.length, 50);
        // But the message should be bounded: just the count, not the full list.
        assert.match(err.message, /unexpected_files: 50 file\(s\)/);
        // Ensure the message does NOT contain individual filenames.
        assert.ok(!err.message.includes('stray-0.txt'), 'message must not list filenames');
        assert.ok(!err.message.includes('stray-49.txt'), 'message must not list filenames');
        return true;
      },
    );
  });
});
