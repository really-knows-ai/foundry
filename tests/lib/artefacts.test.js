import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, accessSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveBranchBaseSha, getArtefactFiles, computeArtefactVersion } from '../../src/scripts/lib/artefacts.js';

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

// ---------------------------------------------------------------------------
// computeArtefactVersion
// ---------------------------------------------------------------------------

describe('computeArtefactVersion', () => {
  const EMPTY_SHA = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

  function makeFoundryDir() {
    const dir = mkdtempSync(join(tmpdir(), 'foundry-art-'));
    mkdirSync(join(dir, 'out'), { recursive: true });
    // Create an artefact definition file that getArtefactType reads
    const defDir = join(dir, 'artefacts', 'haiku');
    mkdirSync(defDir, { recursive: true });
    return dir;
  }

  function makeTypeIo(foundryDir, definitionYaml, files = {}) {
    const defPath = join(foundryDir, 'artefacts', 'haiku', 'definition.md');
    writeFileSync(defPath, definitionYaml);
    for (const [filePath, content] of Object.entries(files)) {
      const full = join(foundryDir, filePath);
      const parentDir = join(foundryDir, 'out');
      mkdirSync(parentDir, { recursive: true });
      writeFileSync(full, content);
    }
    return {
      exists: mock.fn(async (p) => {
        try {
          const checkPath = p.startsWith('/') ? p : join(foundryDir, p);
          accessSync(checkPath);
          return true;
        } catch {
          return false;
        }
      }),
      readFile: mock.fn(async (p, enc) => {
        const fullPath = p.startsWith('/') ? p : join(foundryDir, p);
        try {
          return readFileSync(fullPath, enc || 'utf8');
        } catch {
          throw new Error(`ENOENT: ${p}`);
        }
      }),
    };
  }

  it('returns empty-input SHA when no file patterns exist', async () => {
    const dir = makeFoundryDir();
    const io = makeTypeIo(dir, '---\nid: haiku\n---\n');
    const result = await computeArtefactVersion(dir, 'haiku', io);
    assert.equal(result, EMPTY_SHA);
  });

  it('returns empty-input SHA when no files match the patterns', async () => {
    const dir = makeFoundryDir();
    const io = makeTypeIo(dir, '---\nid: haiku\nfile-patterns:\n  - "nomatch/*.md"\n---\n');
    const result = await computeArtefactVersion(dir, 'haiku', io);
    assert.equal(result, EMPTY_SHA);
  });

  it('returns deterministic hash for a single file', async () => {
    const dir = makeFoundryDir();
    const io = makeTypeIo(dir, '---\nid: haiku\nfile-patterns:\n  - "out/*.md"\n---\n', {
      'out/a.md': 'hello world',
    });
    const r1 = await computeArtefactVersion(dir, 'haiku', io);
    const r2 = await computeArtefactVersion(dir, 'haiku', io);
    assert.equal(r1, r2);
    assert.equal(r1.length, 64);
    assert.match(r1, /^[0-9a-f]{64}$/);
  });

  it('returns different hash for different file content', async () => {
    const dirA = makeFoundryDir();
    const ioA = makeTypeIo(dirA, '---\nid: haiku\nfile-patterns:\n  - "out/*.md"\n---\n', {
      'out/a.md': 'content a',
    });
    const hashA = await computeArtefactVersion(dirA, 'haiku', ioA);

    const dirB = makeFoundryDir();
    const ioB = makeTypeIo(dirB, '---\nid: haiku\nfile-patterns:\n  - "out/*.md"\n---\n', {
      'out/a.md': 'content b',
    });
    const hashB = await computeArtefactVersion(dirB, 'haiku', ioB);
    assert.notEqual(hashA, hashB);
  });

  it('returns different hash for different file path', async () => {
    const dirA = makeFoundryDir();
    const ioA = makeTypeIo(dirA, '---\nid: haiku\nfile-patterns:\n  - "out/*.md"\n---\n', {
      'out/a.md': 'same content',
    });
    const hashA = await computeArtefactVersion(dirA, 'haiku', ioA);

    const dirB = makeFoundryDir();
    const ioB = makeTypeIo(dirB, '---\nid: haiku\nfile-patterns:\n  - "out/*.md"\n---\n', {
      'out/other.md': 'same content',
    });
    const hashB = await computeArtefactVersion(dirB, 'haiku', ioB);
    assert.notEqual(hashA, hashB);
  });

  it('includes all matching files (two files produce different hash than one)', async () => {
    const dirOne = makeFoundryDir();
    const ioOne = makeTypeIo(dirOne, '---\nid: haiku\nfile-patterns:\n  - "out/*.md"\n---\n', {
      'out/a.md': 'content a',
      'out/b.md': 'content b',
    });
    const hashOne = await computeArtefactVersion(dirOne, 'haiku', ioOne);

    const dirTwo = makeFoundryDir();
    const ioTwo = makeTypeIo(dirTwo, '---\nid: haiku\nfile-patterns:\n  - "out/*.md"\n---\n', {
      'out/a.md': 'content a',
      'out/b.md': 'content b',
      'out/c.md': 'content c',
    });
    const hashTwo = await computeArtefactVersion(dirTwo, 'haiku', ioTwo);
    assert.notEqual(hashOne, hashTwo);
  });

  it('throws when artefact type is unknown', async () => {
    const dir = makeFoundryDir();
    const io = {
      exists: mock.fn(async () => false),
      readFile: mock.fn(async () => { throw new Error('ENOENT'); }),
    };
    await assert.rejects(
      () => computeArtefactVersion(dir, 'nonexistent', io),
      /Artefact type not found/,
    );
  });

  it('throws on file read failure', async () => {
    const dir = makeFoundryDir();
    const io = makeTypeIo(dir, '---\nid: haiku\nfile-patterns:\n  - "out/*.md"\n---\n', {
      'out/a.md': 'content a',
    });
    // Override readFile to fail on non-definition files
    const realReadFile = io.readFile;
    io.readFile = mock.fn(async (p, enc) => {
      if (p.endsWith('definition.md')) return realReadFile(p, enc);
      throw new Error('EACCES: permission denied');
    });
    await assert.rejects(
      () => computeArtefactVersion(dir, 'haiku', io),
      /EACCES/,
    );
  });
});
