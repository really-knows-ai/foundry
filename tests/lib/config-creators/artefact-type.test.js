import test from 'node:test';
import assert from 'node:assert/strict';
import { create, assembleArtefactTypeMarkdown } from '../../../src/scripts/lib/config-creators/artefact-type.js';
import { makeAsyncMockIO } from '../../helpers/async-mock-io.js';

const VALID_ARGS = {
  id: 'short-story',
  name: 'Short Story',
  filePatterns: ['artefacts/short-story/*.md'],
  description: 'A short story.',
};

const VALID_BODY = assembleArtefactTypeMarkdown(VALID_ARGS);

function makeFakeExecFile(dirtyFiles = []) {
  const calls = [];
  const fake = (argv) => {
    calls.push(argv);
    if (argv[0] === 'status') {
      // Emit `?? <path>\0` per untracked file.
      return dirtyFiles.map((f) => `?? ${f}\0`).join('');
    }
    if (argv[0] === 'rev-parse') return 'abc1234\n';
    return '';
  };
  fake.calls = calls;
  return fake;
}

test('artefact-type creator: happy path', async () => {
  const io = makeAsyncMockIO();
  const path = 'foundry/artefacts/short-story/definition.md';
  const exec = makeFakeExecFile([path]);
  const out = await create({ ...VALID_ARGS, io, execFile: exec });
  assert.equal(out.ok, true);
  assert.equal(out.path, path);
  assert.equal(out.sha, 'abc1234');
  assert.equal(io._get(path), VALID_BODY);
  const commit = exec.calls.find((c) => c[0] === 'commit');
  assert.ok(commit, 'commit was called');
  assert.match(commit[2], /^config: add artefact-type short-story\n\nvia foundry_config_create_artefact_type$/);
  // git add was called with allowed paths
  const add = exec.calls.find((c) => c[0] === 'add');
  assert.ok(add, 'git add was called');
  assert.ok(add.includes(path));
});

test('artefact-type creator: validator failure', async () => {
  const io = makeAsyncMockIO();
  const exec = makeFakeExecFile();
  // Empty filePatterns produces a body that fails validation
  const out = await create({ id: 'short-story', name: 'Short Story', filePatterns: [], description: 'A short story.', io, execFile: exec });
  assert.equal(out.ok, false);
  assert.ok(out.errors.length > 0);
  assert.equal(io._has('foundry/artefacts/short-story/definition.md'), false);
  assert.ok(!exec.calls.some((c) => c[0] === 'commit'));
});

test('artefact-type creator: target file exists', async () => {
  const path = 'foundry/artefacts/short-story/definition.md';
  const io = makeAsyncMockIO({ [path]: 'pre-existing' });
  const exec = makeFakeExecFile();
  const out = await create({ ...VALID_ARGS, io, execFile: exec });
  assert.equal(out.ok, false);
  assert.ok(out.errors.some((e) => /already exists/.test(e)));
  assert.equal(io._get(path), 'pre-existing');
  assert.ok(!exec.calls.some((c) => c[0] === 'commit'));
});
