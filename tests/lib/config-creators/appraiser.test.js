import test from 'node:test';
import assert from 'node:assert/strict';
import { create } from '../../../src/scripts/lib/config-creators/appraiser.js';
import { makeAsyncMockIO } from '../../helpers/async-mock-io.js';

const VALID_BODY = `---
id: skeptic
name: The Skeptic
---

A reviewer who looks for unsupported claims.
`;

function makeFakeExecFile(dirtyFiles = []) {
  const calls = [];
  const fake = (argv) => {
    calls.push(argv);
    if (argv[0] === 'status') return dirtyFiles.map((f) => `?? ${f}\0`).join('');
    if (argv[0] === 'rev-parse') return 'aa11bb2\n';
    return '';
  };
  fake.calls = calls;
  return fake;
}

test('appraiser creator: happy path', async () => {
  const io = makeAsyncMockIO();
  const path = 'foundry/appraisers/skeptic.md';
  const exec = makeFakeExecFile([path]);
  const out = await create({ name: 'skeptic', body: VALID_BODY, io, execFile: exec });
  assert.equal(out.ok, true);
  assert.equal(out.path, path);
  assert.equal(out.sha, 'aa11bb2');
  assert.equal(io._get(path), VALID_BODY);
  const commit = exec.calls.find((c) => c[0] === 'commit');
  assert.match(commit[2], /^config: add appraiser skeptic\n\nvia foundry_config_create_appraiser$/);
});

test('appraiser creator: validator failure', async () => {
  const io = makeAsyncMockIO();
  const exec = makeFakeExecFile();
  const bad = `---\nid: skeptic\n---\n`; // missing name + body prose
  const out = await create({ name: 'skeptic', body: bad, io, execFile: exec });
  assert.equal(out.ok, false);
  assert.ok(out.errors.length > 0);
  assert.equal(io._has('foundry/appraisers/skeptic.md'), false);
  assert.ok(!exec.calls.some((c) => c[0] === 'commit'));
});

test('appraiser creator: target file exists', async () => {
  const path = 'foundry/appraisers/skeptic.md';
  const io = makeAsyncMockIO({ [path]: 'pre-existing' });
  const exec = makeFakeExecFile();
  const out = await create({ name: 'skeptic', body: VALID_BODY, io, execFile: exec });
  assert.equal(out.ok, false);
  assert.ok(out.errors.some((e) => /already exists/.test(e)));
  assert.equal(io._get(path), 'pre-existing');
  assert.ok(!exec.calls.some((c) => c[0] === 'commit'));
});
