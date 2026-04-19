// tests/lib/finalize.test.js
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { finalizeStage } from '../../scripts/lib/finalize.js';

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t',
  GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
};
function git(cwd, cmd) { return execSync(`git ${cmd}`, { cwd, env: GIT_ENV }).toString().trim(); }

describe('finalizeStage', () => {
  let dir, baseSha;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'foundry-fin-'));
    execSync('git init -q', { cwd: dir, env: GIT_ENV });
    writeFileSync(join(dir, 'README.md'), 'hi');
    git(dir, 'add .'); git(dir, 'commit -m init -q');
    baseSha = git(dir, 'rev-parse HEAD');
  });

  it('clean forge diff: matching file registers as draft', () => {
    mkdirSync(join(dir, 'haikus'), { recursive: true });
    writeFileSync(join(dir, 'haikus/one.md'), '...');
    const res = finalizeStage({
      cwd: dir, baseSha,
      stageBase: 'forge',
      cycleDef: { outputArtefactType: 'haiku' },
      artefactTypes: { haiku: { filePatterns: ['haikus/*.md'] } },
      registerArtefact: () => {},
    });
    assert.equal(res.ok, true);
    assert.deepEqual(res.artefacts, [{ file: 'haikus/one.md', type: 'haiku', status: 'draft' }]);
  });

  it('forge diff with stray file rejects', () => {
    writeFileSync(join(dir, 'stray.txt'), 'x');
    mkdirSync(join(dir, 'haikus'), { recursive: true });
    writeFileSync(join(dir, 'haikus/a.md'), '');
    const res = finalizeStage({
      cwd: dir, baseSha, stageBase: 'forge',
      cycleDef: { outputArtefactType: 'haiku' },
      artefactTypes: { haiku: { filePatterns: ['haikus/*.md'] } },
      registerArtefact: () => {},
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
      registerArtefact: () => {},
    });
    assert.equal(res.ok, false);
    assert.deepEqual(res.files, ['x.md']);
  });

  it('empty diff is ok', () => {
    const res = finalizeStage({
      cwd: dir, baseSha, stageBase: 'quench',
      cycleDef: { outputArtefactType: 'haiku' },
      artefactTypes: { haiku: { filePatterns: ['haikus/*.md'] } },
      registerArtefact: () => {},
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
      registerArtefact: () => {},
    });
    assert.equal(res.ok, true);
  });
});
