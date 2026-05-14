import test from 'node:test';
import assert from 'node:assert/strict';
import { create, assembleCycleMarkdown } from '../../../src/scripts/lib/config-creators/cycle.js';
import { makeAsyncMockIO } from '../../helpers/async-mock-io.js';

const VALID_ARGS = {
  id: 'draft',
  name: 'Draft',
  outputType: 'short-story',
  inputs: { type: 'any-of', artefacts: ['brief'] },
  targets: ['revise'],
  description: 'A drafting cycle.',
};

const VALID_BODY = assembleCycleMarkdown(VALID_ARGS);

function makeFakeExecFile(dirtyFiles = []) {
  const calls = [];
  const fake = (argv) => {
    calls.push(argv);
    if (argv[0] === 'status') return dirtyFiles.map((f) => `?? ${f}\0`).join('');
    if (argv[0] === 'rev-parse') return 'ee55ff6\n';
    return '';
  };
  fake.calls = calls;
  return fake;
}

function seed() {
  return makeAsyncMockIO({
    'foundry/artefacts/short-story/definition.md': '',
    'foundry/artefacts/brief/definition.md': '',
    'foundry/cycles/revise.md': '',
  });
}

test('cycle creator: happy path', async () => {
  const io = seed();
  const path = 'foundry/cycles/draft.md';
  const exec = makeFakeExecFile([path]);
  const out = await create({ ...VALID_ARGS, io, execFile: exec });
  assert.equal(out.ok, true);
  assert.equal(out.path, path);
  assert.equal(out.sha, 'ee55ff6');
  assert.equal(io._get(path), VALID_BODY);
  const commit = exec.calls.find((c) => c[0] === 'commit');
  assert.match(commit[2], /^config: add cycle draft\n\nvia foundry_config_create_cycle$/);
});

test('cycle creator: validator failure', async () => {
  const io = seed();
  const exec = makeFakeExecFile();
  // Missing outputType would cause the assemble function to produce a body
  // that fails validation (no output-type in frontmatter). Actually the
  // assemble function requires outputType, so we pass an invalid one.
  // Instead, pass args that produce a body the validator rejects.
  const out = await create({ id: 'draft', name: 'Draft', outputType: 'nonexistent', io, execFile: exec });
  assert.equal(out.ok, false);
  assert.ok(out.errors.length > 0);
  assert.equal(io._has('foundry/cycles/draft.md'), false);
  assert.ok(!exec.calls.some((c) => c[0] === 'commit'));
});

test('cycle creator: target file exists', async () => {
  const io = seed();
  const path = 'foundry/cycles/draft.md';
  io._set(path, 'pre-existing');
  const exec = makeFakeExecFile();
  const out = await create({ ...VALID_ARGS, io, execFile: exec });
  assert.equal(out.ok, false);
  assert.ok(out.errors.some((e) => /already exists/.test(e)));
  assert.equal(io._get(path), 'pre-existing');
  assert.ok(!exec.calls.some((c) => c[0] === 'commit'));
});
