import test from 'node:test';
import assert from 'node:assert/strict';
import { create } from '../../../src/scripts/lib/config-creators/flow.js';
import { makeAsyncMockIO } from '../../helpers/async-mock-io.js';

const VALID_BODY = `---
id: creative
name: Creative
starting-cycles:
  - draft
---

## Cycles

Some prose.
`;

function makeFakeExecFile(dirtyFiles = []) {
  const calls = [];
  const fake = (argv) => {
    calls.push(argv);
    if (argv[0] === 'status') return dirtyFiles.map((f) => `?? ${f}\0`).join('');
    if (argv[0] === 'rev-parse') return 'cc33dd4\n';
    return '';
  };
  fake.calls = calls;
  return fake;
}

test('flow creator: happy path', async () => {
  const io = makeAsyncMockIO({ 'foundry/cycles/draft.md': '' });
  const path = 'foundry/flows/creative.md';
  const exec = makeFakeExecFile([path]);
  const out = await create({ name: 'creative', body: VALID_BODY, io, execFile: exec });
  assert.equal(out.ok, true);
  assert.equal(out.path, path);
  assert.equal(out.sha, 'cc33dd4');
  assert.equal(io._get(path), VALID_BODY);
  const commit = exec.calls.find((c) => c[0] === 'commit');
  assert.match(commit[2], /^config: add flow creative\n\nvia foundry_config_create_flow$/);
});

test('flow creator: validator failure', async () => {
  const io = makeAsyncMockIO();
  const exec = makeFakeExecFile();
  const bad = `---\nid: creative\n---\n\n## Cycles\n`; // missing name, starting-cycles
  const out = await create({ name: 'creative', body: bad, io, execFile: exec });
  assert.equal(out.ok, false);
  assert.ok(out.errors.length > 0);
  assert.equal(io._has('foundry/flows/creative.md'), false);
  assert.ok(!exec.calls.some((c) => c[0] === 'commit'));
});

test('flow creator: target file exists', async () => {
  const path = 'foundry/flows/creative.md';
  const io = makeAsyncMockIO({
    [path]: 'pre-existing',
    'foundry/cycles/draft.md': '',
  });
  const exec = makeFakeExecFile();
  const out = await create({ name: 'creative', body: VALID_BODY, io, execFile: exec });
  assert.equal(out.ok, false);
  assert.ok(out.errors.some((e) => /already exists/.test(e)));
  assert.equal(io._get(path), 'pre-existing');
  assert.ok(!exec.calls.some((c) => c[0] === 'commit'));
});
