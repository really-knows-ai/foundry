// tests/lib/finalize.test.js
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { execSync, execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { finalizeStage } from '../../src/scripts/lib/finalize.js';

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t',
  GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
};
function git(cwd, cmd) { return execSync(`git ${cmd}`, { cwd, env: GIT_ENV }).toString().trim(); }

function makeTestIo(cwd) {
  return {
    exec: (argv) => execFileSync(argv[0], argv.slice(1), { cwd, encoding: 'utf8', stdio: 'pipe' }),
  };
}

describe('finalizeStage', () => {
  let dir, baseSha;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'foundry-fin-'));
    execSync('git init -q', { cwd: dir, env: GIT_ENV });
    writeFileSync(join(dir, 'README.md'), 'hi');
    git(dir, 'add .'); git(dir, 'commit -m init -q');
    baseSha = git(dir, 'rev-parse HEAD');
  });

  it('clean forge diff: matching file registers as artefact', () => {
    mkdirSync(join(dir, 'haikus'), { recursive: true });
    writeFileSync(join(dir, 'haikus/one.md'), '...');
    const res = finalizeStage({
      cwd: dir, baseSha,
      stageBase: 'forge',
      cycleDef: { outputArtefactType: 'haiku' },
      artefactTypes: { haiku: { filePatterns: ['haikus/*.md'] } },
      io: makeTestIo(dir),
    });
    assert.equal(res.ok, true);
    assert.deepEqual(res.artefacts, [{ file: 'haikus/one.md', type: 'haiku' }]);
  });

  it('forge diff with stray file rejects', () => {
    writeFileSync(join(dir, 'stray.txt'), 'x');
    mkdirSync(join(dir, 'haikus'), { recursive: true });
    writeFileSync(join(dir, 'haikus/a.md'), '');
    const res = finalizeStage({
      cwd: dir, baseSha, stageBase: 'forge',
      cycleDef: { outputArtefactType: 'haiku' },
      artefactTypes: { haiku: { filePatterns: ['haikus/*.md'] } },
      io: makeTestIo(dir),
    });
    assert.equal(res.ok, false);
    assert.equal(res.error, 'unexpected_files');
    assert.deepEqual(res.files, ['stray.txt']);
  });

  it('quench with any diff rejects', () => {
    writeFileSync(join(dir, 'x.md'), '');
    const res = finalizeStage({
      cwd: dir, baseSha, stageBase: 'quench',
      cycleDef: { outputArtefactType: 'haiku' },
      artefactTypes: { haiku: { filePatterns: ['haikus/*.md'] } },
      io: makeTestIo(dir),
    });
    assert.equal(res.ok, false);
    assert.deepEqual(res.files, ['x.md']);
  });

  it('empty diff is ok', () => {
    const res = finalizeStage({
      cwd: dir, baseSha, stageBase: 'quench',
      cycleDef: { outputArtefactType: 'haiku' },
      artefactTypes: { haiku: { filePatterns: ['haikus/*.md'] } },
      io: makeTestIo(dir),
    });
    assert.equal(res.ok, true);
    assert.deepEqual(res.artefacts, []);
  });

  it('filters out tool-managed files', () => {
    writeFileSync(join(dir, 'WORK.md'), 'x');
    writeFileSync(join(dir, 'WORK.history.yaml'), 'x');
    mkdirSync(join(dir, '.foundry'), { recursive: true });
    writeFileSync(join(dir, '.foundry/active-stage.json'), '{}');
    const res = finalizeStage({
      cwd: dir, baseSha, stageBase: 'quench',
      cycleDef: { outputArtefactType: 'haiku' },
      artefactTypes: { haiku: { filePatterns: ['haikus/*.md'] } },
      io: makeTestIo(dir),
    });
    assert.equal(res.ok, true);
  });

  it('detects staged unexpected file (git add of stray)', () => {
    writeFileSync(join(dir, 'stray.txt'), 'x');
    git(dir, 'add stray.txt');
    const res = finalizeStage({
      cwd: dir, baseSha, stageBase: 'forge',
      cycleDef: { outputArtefactType: 'haiku' },
      artefactTypes: { haiku: { filePatterns: ['haikus/*.md'] } },
      io: makeTestIo(dir),
    });
    assert.equal(res.ok, false);
    assert.equal(res.error, 'unexpected_files');
    assert.deepEqual(res.files, ['stray.txt']);
  });

  it('detects staged allowed artefact (git add of matching file)', () => {
    mkdirSync(join(dir, 'haikus'), { recursive: true });
    writeFileSync(join(dir, 'haikus/staged.md'), '...');
    git(dir, 'add haikus/staged.md');
    const res = finalizeStage({
      cwd: dir, baseSha, stageBase: 'forge',
      cycleDef: { outputArtefactType: 'haiku' },
      artefactTypes: { haiku: { filePatterns: ['haikus/*.md'] } },
      io: makeTestIo(dir),
    });
    assert.equal(res.ok, true);
    assert.deepEqual(res.artefacts, [{ file: 'haikus/staged.md', type: 'haiku' }]);
  });

  it('detects staged deletion of unexpected file', () => {
    // Add an extra tracked file in the base, then stage its deletion
    writeFileSync(join(dir, 'extra.txt'), 'x');
    git(dir, 'add extra.txt'); git(dir, 'commit -m extra -q');
    baseSha = git(dir, 'rev-parse HEAD');
    git(dir, 'rm extra.txt');
    const res = finalizeStage({
      cwd: dir, baseSha, stageBase: 'forge',
      cycleDef: { outputArtefactType: 'haiku' },
      artefactTypes: { haiku: { filePatterns: ['haikus/*.md'] } },
      io: makeTestIo(dir),
    });
    assert.equal(res.ok, false);
    assert.equal(res.error, 'unexpected_files');
    assert.deepEqual(res.files, ['extra.txt']);
  });

  it('detects staged rename as changed files', () => {
    writeFileSync(join(dir, 'old.txt'), 'content');
    git(dir, 'add old.txt'); git(dir, 'commit -m old -q');
    baseSha = git(dir, 'rev-parse HEAD');
    execSync('git mv old.txt new.txt', { cwd: dir, env: GIT_ENV });
    const res = finalizeStage({
      cwd: dir, baseSha, stageBase: 'forge',
      cycleDef: { outputArtefactType: 'haiku' },
      artefactTypes: { haiku: { filePatterns: ['haikus/*.md'] } },
      io: makeTestIo(dir),
    });
    assert.equal(res.ok, false);
    assert.equal(res.error, 'unexpected_files');
    // Both old and new paths should appear as changed
    assert.ok(res.files.includes('old.txt'), `expected old.txt in ${JSON.stringify(res.files)}`);
    assert.ok(res.files.includes('new.txt'), `expected new.txt in ${JSON.stringify(res.files)}`);
  });

  it('detects mixed staged and unstaged changes', () => {
    mkdirSync(join(dir, 'haikus'), { recursive: true });
    writeFileSync(join(dir, 'haikus/a.md'), 'staged');
    git(dir, 'add haikus/a.md');
    writeFileSync(join(dir, 'haikus/b.md'), 'unstaged'); // untracked
    const res = finalizeStage({
      cwd: dir, baseSha, stageBase: 'forge',
      cycleDef: { outputArtefactType: 'haiku' },
      artefactTypes: { haiku: { filePatterns: ['haikus/*.md'] } },
      io: makeTestIo(dir),
    });
    assert.equal(res.ok, true);
    const files = res.artefacts.map(a => a.file).sort();
    assert.deepEqual(files, ['haikus/a.md', 'haikus/b.md']);
  });

  describe('baseSha validation', () => {
    function callWith(badSha) {
      return finalizeStage({
        cwd: dir, baseSha: badSha, stageBase: 'forge',
        cycleDef: { outputArtefactType: 'haiku' },
        artefactTypes: { haiku: { filePatterns: ['haikus/*.md'] } },
        io: makeTestIo(dir),
      });
    }

    it('rejects a non-hex string', () => {
      assert.throws(() => callWith('not-a-sha'), /invalid baseSha/);
    });

    it('rejects symbolic refs like HEAD', () => {
      assert.throws(() => callWith('HEAD'), /invalid baseSha/);
    });

    it('rejects argument-injection attempts', () => {
      assert.throws(() => callWith('--upload-pack=evil'), /invalid baseSha/);
    });

    it('rejects empty string', () => {
      assert.throws(() => callWith(''), /invalid baseSha/);
    });

    it('rejects null/undefined', () => {
      assert.throws(() => callWith(undefined), /invalid baseSha/);
      assert.throws(() => callWith(null), /invalid baseSha/);
    });

    it('rejects shell metacharacters', () => {
      assert.throws(() => callWith(';rm -rf /'), /invalid baseSha/);
      assert.throws(() => callWith('$(echo pwned)'), /invalid baseSha/);
      assert.throws(() => callWith('abc123 ; ls'), /invalid baseSha/);
    });

    it('rejects too-short hex (under 7 chars)', () => {
      assert.throws(() => callWith('abc12'), /invalid baseSha/);
    });

    it('rejects too-long hex (over 64 chars)', () => {
      assert.throws(() => callWith('a'.repeat(65)), /invalid baseSha/);
    });

    it('accepts a normal full SHA', () => {
      // baseSha from beforeEach is a real 40-hex SHA
      const res = finalizeStage({
        cwd: dir, baseSha, stageBase: 'quench',
        cycleDef: { outputArtefactType: 'haiku' },
        artefactTypes: { haiku: { filePatterns: ['haikus/*.md'] } },
        io: makeTestIo(dir),
      });
      assert.equal(res.ok, true);
    });

    it('accepts a 7-char short SHA', () => {
      const shortSha = baseSha.slice(0, 7);
      const res = finalizeStage({
        cwd: dir, baseSha: shortSha, stageBase: 'quench',
        cycleDef: { outputArtefactType: 'haiku' },
        artefactTypes: { haiku: { filePatterns: ['haikus/*.md'] } },
        io: makeTestIo(dir),
      });
      assert.equal(res.ok, true);
    });
  });

  it('does not flag WORK.feedback.yaml as an unexpected file', () => {
    writeFileSync(join(dir, 'WORK.feedback.yaml'), 'items: []');
    mkdirSync(join(dir, 'haikus'), { recursive: true });
    writeFileSync(join(dir, 'haikus/a.md'), '...');

    const res = finalizeStage({
      cwd: dir, baseSha, stageBase: 'forge',
      cycleDef: { outputArtefactType: 'haiku' },
      artefactTypes: { haiku: { filePatterns: ['haikus/*.md'] } },
      io: makeTestIo(dir),
    });

    assert.equal(res.ok, true);
    assert.deepEqual(res.artefacts, [{ file: 'haikus/a.md', type: 'haiku' }]);
  });
});
