// tests/lib/git-policy.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  TOOL_MANAGED,
  isToolManaged,
  parsePorcelainZ,
  partitionDirty,
  allowedPatternsForStage,
  checkConfigBranchFiles,
} from '../../src/scripts/lib/git-policy.js';

describe('isToolManaged', () => {
  it('matches the canonical workfiles', () => {
    for (const f of TOOL_MANAGED) assert.equal(isToolManaged(f), true);
  });
  it('matches anything under .foundry/', () => {
    assert.equal(isToolManaged('.foundry/active-stage.json'), true);
    assert.equal(isToolManaged('.foundry/last-stage.json'), true);
    assert.equal(isToolManaged('.foundry/nested/deep/file.txt'), true);
  });
  it('matches .gitignore (plugin appends `.foundry/` on boot)', () => {
    assert.equal(isToolManaged('.gitignore'), true);
  });
  it('rejects ordinary repo files', () => {
    assert.equal(isToolManaged('README.md'), false);
    assert.equal(isToolManaged('haikus/a.md'), false);
    assert.equal(isToolManaged('foundry/cycles/c.md'), false);
  });
});

describe('parsePorcelainZ', () => {
  it('returns [] for empty input', () => {
    assert.deepEqual(parsePorcelainZ(''), []);
  });
  it('parses untracked, modified, and added entries', () => {
    const out = '?? secret.env\0 M src/a.js\0A  newfile.md\0';
    assert.deepEqual(parsePorcelainZ(out), ['secret.env', 'src/a.js', 'newfile.md']);
  });
  it('emits BOTH paths for a rename (destination then source)', () => {
    // -z rename format: "R  new\0old\0"
    const out = 'R  new.txt\0old.txt\0';
    assert.deepEqual(parsePorcelainZ(out), ['new.txt', 'old.txt']);
  });
  it('de-duplicates repeated paths', () => {
    const out = 'MM a.txt\0?? a.txt\0';
    assert.deepEqual(parsePorcelainZ(out), ['a.txt']);
  });
  it('handles paths with spaces', () => {
    const out = '?? path with spaces.txt\0';
    assert.deepEqual(parsePorcelainZ(out), ['path with spaces.txt']);
  });
});

describe('partitionDirty', () => {
  it('puts tool-managed files into allowed regardless of patterns', () => {
    const { allowed, unexpected } = partitionDirty(
      ['WORK.md', 'WORK.history.yaml', '.foundry/active-stage.json'],
      [],
    );
    assert.deepEqual(allowed, ['WORK.md', 'WORK.history.yaml', '.foundry/active-stage.json']);
    assert.deepEqual(unexpected, []);
  });
  it('matches allowed against patterns', () => {
    const { allowed, unexpected } = partitionDirty(
      ['haikus/a.md', 'haikus/b.md', 'stray.txt'],
      ['haikus/*.md'],
    );
    assert.deepEqual(allowed, ['haikus/a.md', 'haikus/b.md']);
    assert.deepEqual(unexpected, ['stray.txt']);
  });
  it('reports everything outside tool-managed and patterns as unexpected', () => {
    const { allowed, unexpected } = partitionDirty(
      ['secret.env', 'src/foo.js', 'WORK.md'],
      [],
    );
    assert.deepEqual(allowed, ['WORK.md']);
    assert.deepEqual(unexpected, ['secret.env', 'src/foo.js']);
  });
  it('dotfiles under matched directories are allowed', () => {
    // `foundry_memory_init` writes `.gitkeep` placeholders so the empty
    // relations directory survives in git. Without { dot: true } minimatch
    // skips dotfiles when expanding `**`, which would let those placeholders
    // surface as unexpected dirty files.
    const { allowed, unexpected } = partitionDirty(
      ['foundry-memory/relations/.gitkeep'],
      ['foundry-memory/**'],
    );
    assert.deepEqual(allowed, ['foundry-memory/relations/.gitkeep']);
    assert.deepEqual(unexpected, []);
  });
});

describe('allowedPatternsForStage', () => {
  it('forge: returns the supplied artefact file-patterns', () => {
    assert.deepEqual(
      allowedPatternsForStage({ stageBase: 'forge', forgeFilePatterns: ['haikus/*.md'] }),
      ['haikus/*.md'],
    );
  });
  it('assay: returns foundry-memory/**', () => {
    assert.deepEqual(allowedPatternsForStage({ stageBase: 'assay' }), ['foundry-memory/**']);
  });
  it('quench / appraise / human-appraise / setup: empty', () => {
    assert.deepEqual(allowedPatternsForStage({ stageBase: 'quench' }), []);
    assert.deepEqual(allowedPatternsForStage({ stageBase: 'appraise' }), []);
    assert.deepEqual(allowedPatternsForStage({ stageBase: 'human-appraise' }), []);
    assert.deepEqual(allowedPatternsForStage({}), []);
  });
});

describe('checkConfigBranchFiles', () => {
  it('allows foundry-owned package files via foundry/** pattern', () => {
    const diffOut = [
      'foundry/artefacts/haiku/laws.md',
      'foundry/artefacts/haiku/validate-syllables.mjs',
      'foundry/package.json',
      'foundry/pnpm-lock.yaml',
    ].join('\n');

    assert.equal(checkConfigBranchFiles(diffOut), null);
  });

  it('rejects root package.json on config branches', () => {
    const result = checkConfigBranchFiles('package.json\n');

    assert.deepEqual(result, { files: ['package.json'] });
  });

  it('rejects root pnpm-lock.yaml on config branches', () => {
    const result = checkConfigBranchFiles('pnpm-lock.yaml\n');

    assert.deepEqual(result, { files: ['pnpm-lock.yaml'] });
  });

  it('rejects root package-lock.yaml on config branches', () => {
    const result = checkConfigBranchFiles('package-lock.yaml\n');

    assert.deepEqual(result, { files: ['package-lock.yaml'] });
  });

  it('rejects root yarn.lock on config branches', () => {
    const result = checkConfigBranchFiles('yarn.lock\n');

    assert.deepEqual(result, { files: ['yarn.lock'] });
  });

  it('rejects root bun.lock on config branches', () => {
    const result = checkConfigBranchFiles('bun.lock\n');

    assert.deepEqual(result, { files: ['bun.lock'] });
  });

  it('allows foundry/package.json and rejects root README.md in same diff', () => {
    const diffOut = 'foundry/package.json\nREADME.md\n';

    const result = checkConfigBranchFiles(diffOut);
    assert.deepEqual(result, { files: ['README.md'] });
  });

  it('rejects unrelated root files on config branches', () => {
    const result = checkConfigBranchFiles('foundry/flows/haiku.md\nREADME.md\n');

    assert.deepEqual(result, { files: ['README.md'] });
  });
});
