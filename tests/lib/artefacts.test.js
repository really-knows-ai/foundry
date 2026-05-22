import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { resolveBranchBaseSha, getArtefactFiles } from '../../src/scripts/lib/artefacts.js';

// ---------------------------------------------------------------------------
// resolveBranchBaseSha
// ---------------------------------------------------------------------------

describe('resolveBranchBaseSha', () => {
  it('calls io.exec with correct git merge-base args', () => {
    const exec = mock.fn(() => 'abc123\n');
    const io = { exec };
    const sha = resolveBranchBaseSha(io, 'main');
    assert.equal(sha, 'abc123');
    assert.equal(exec.mock.calls.length, 1);
    assert.deepEqual(exec.mock.calls[0].arguments[0], ['git', 'merge-base', 'HEAD', 'main']);
  });

  it('uses default baseBranch when not specified', () => {
    const exec = mock.fn(() => 'def456\n');
    const io = { exec };
    const sha = resolveBranchBaseSha(io);
    assert.equal(sha, 'def456');
    assert.deepEqual(exec.mock.calls[0].arguments[0], ['git', 'merge-base', 'HEAD', 'main']);
  });

  it('throws when io.exec is missing', () => {
    assert.throws(() => resolveBranchBaseSha({}), /io\.exec is required/);
  });

  it('throws when merge-base returns empty string', () => {
    const io = { exec: () => '' };
    assert.throws(() => resolveBranchBaseSha(io), /Failed to resolve/);
  });
});

// ---------------------------------------------------------------------------
// getArtefactFiles
// ---------------------------------------------------------------------------

describe('getArtefactFiles', () => {
  it('returns empty array when type has no file-patterns', async () => {
    const io = {
      exec: () => '',
      readFile: () => '---\nid: test\n---\n',
      exists: () => true,
    };
    const result = await getArtefactFiles('/foundry', 'test', io);
    assert.deepEqual(result, []);
  });

  it('returns filtered, sorted, deduplicated { file, state } entries', async () => {
    const exec = mock.fn((args) => {
      const cmd = args.join(' ');
      if (cmd.includes('merge-base')) return 'basesha\n';
      if (cmd.includes('..HEAD')) return 'M\tout/a.md\nA\tout/c.md\n';
      if (cmd.includes('--cached')) return 'M\tout/b.md\n';
      if (cmd.includes('ls-files')) return 'out/d.md\n';
      return '';
    });
    const readFile = mock.fn((p) => {
      if (p.endsWith('definition.md')) return '---\nid: test\nfile-patterns:\n  - "out/*.md"\n---\n';
      return '';
    });
    const testIo = { exec, readFile, exists: mock.fn(() => true) };

    const result = await getArtefactFiles('/foundry', 'test', testIo);

    // a (new), b (modified), c (new), d (new) — sorted by file
    assert.equal(result.length, 4);
    assert.deepEqual(result[0], { file: 'out/a.md', state: 'modified' });
    assert.deepEqual(result[1], { file: 'out/b.md', state: 'modified' });
    assert.deepEqual(result[2], { file: 'out/c.md', state: 'new' });
    assert.deepEqual(result[3], { file: 'out/d.md', state: 'new' });
  });

  it('includes deleted files with state: deleted', async () => {
    const exec = mock.fn((args) => {
      const cmd = args.join(' ');
      if (cmd.includes('merge-base')) return 'basesha\n';
      if (cmd.includes('ls-files')) return '';
      // All diff commands except the committed one return empty
      if (!cmd.includes('..HEAD')) return '';
      return 'D\tout/old.md\n';
    });
    const readFile = mock.fn(() => '---\nid: test\nfile-patterns:\n  - "out/*.md"\n---\n');
    const io = { exec, readFile, exists: () => true };

    const result = await getArtefactFiles('/foundry', 'test', io);
    assert.equal(result.length, 1);
    assert.deepEqual(result[0], { file: 'out/old.md', state: 'deleted' });
  });

  it('branchBaseSha option takes precedence over baseBranch', async () => {
    let mergeBaseCalls = 0;
    const exec = mock.fn((args) => {
      const cmd = args.join(' ');
      if (cmd.includes('merge-base')) {
        mergeBaseCalls++;
        return 'basesha\n';
      }
      if (cmd.includes('diff --name-status')) return '';
      if (cmd.includes('ls-files')) return '';
      return '';
    });
    const readFile = mock.fn(() => '---\nid: test\nfile-patterns:\n  - "out/*.md"\n---\n');
    const io = { exec, readFile, exists: () => true };

    await getArtefactFiles('/foundry', 'test', io, {
      branchBaseSha: 'explicit-sha',
      baseBranch: 'develop',
    });

    // merge-base should not be called because branchBaseSha was provided
    assert.equal(mergeBaseCalls, 0);
  });
});
