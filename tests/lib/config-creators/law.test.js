import test from 'node:test';
import assert from 'node:assert/strict';
import { create } from '../../../src/scripts/lib/config-creators/law.js';
import { makeAsyncMockIO } from '../../helpers/async-mock-io.js';

const VALID_BODY = `## must-be-honest

Passing: states only verifiable claims.
Failing: includes claims it cannot back up.
`;

function makeFakeExecFile(dirtyFiles = []) {
  const calls = [];
  const fake = (argv) => {
    calls.push(argv);
    if (argv[0] === 'status') return dirtyFiles.map((f) => `?? ${f}\0`).join('');
    if (argv[0] === 'rev-parse') return 'def5678\n';
    return '';
  };
  fake.calls = calls;
  return fake;
}

test('law creator: happy path (global)', async () => {
  const io = makeAsyncMockIO();
  const path = 'foundry/laws/rules.md';
  const exec = makeFakeExecFile([path]);
  const out = await create({
    name: 'rules', body: VALID_BODY,
    target: { kind: 'global', file: 'rules.md' },
    io, execFile: exec,
  });
  assert.equal(out.ok, true);
  assert.equal(out.path, path);
  assert.equal(out.sha, 'def5678');
  assert.equal(io._get(path), VALID_BODY);
  const commit = exec.calls.find((c) => c[0] === 'commit');
  assert.ok(commit);
  assert.match(commit[2], /^config: add law rules\n\nvia foundry_config_create_law$/);
});

test('law creator: happy path (type-specific)', async () => {
  const io = makeAsyncMockIO();
  const path = 'foundry/artefacts/short-story/laws.md';
  const exec = makeFakeExecFile([path]);
  const out = await create({
    name: 'short-story-laws', body: VALID_BODY,
    target: { kind: 'type-specific', typeId: 'short-story' },
    io, execFile: exec,
  });
  assert.equal(out.ok, true);
  assert.equal(out.path, path);
  assert.equal(io._get(path), VALID_BODY);
  const commit = exec.calls.find((c) => c[0] === 'commit');
  assert.match(commit[2], /^config: add law short-story-laws\n\nvia foundry_config_create_law$/);
});

test('law creator: validator failure', async () => {
  const io = makeAsyncMockIO();
  const exec = makeFakeExecFile();
  const bad = `# no law blocks here\n`;
  const out = await create({
    name: 'rules', body: bad,
    target: { kind: 'global', file: 'rules.md' },
    io, execFile: exec,
  });
  assert.equal(out.ok, false);
  assert.ok(out.errors.length > 0);
  assert.equal(io._has('foundry/laws/rules.md'), false);
  assert.ok(!exec.calls.some((c) => c[0] === 'commit'));
});

test('law creator: target file exists', async () => {
  const path = 'foundry/laws/rules.md';
  const io = makeAsyncMockIO({ [path]: 'pre-existing' });
  const exec = makeFakeExecFile();
  const out = await create({
    name: 'rules', body: VALID_BODY,
    target: { kind: 'global', file: 'rules.md' },
    io, execFile: exec,
  });
  assert.equal(out.ok, false);
  assert.ok(out.errors.some((e) => /already exists/.test(e)));
  assert.equal(io._get(path), 'pre-existing');
  assert.ok(!exec.calls.some((c) => c[0] === 'commit'));
});

test('law creator: missing target', async () => {
  const io = makeAsyncMockIO();
  const exec = makeFakeExecFile();
  const out = await create({ name: 'rules', body: VALID_BODY, io, execFile: exec });
  assert.equal(out.ok, false);
  assert.ok(out.errors.some((e) => /target/.test(e)));
  assert.ok(!exec.calls.some((c) => c[0] === 'commit'));
});

test('law creator: unknown target.kind', async () => {
  const io = makeAsyncMockIO();
  const exec = makeFakeExecFile();
  const out = await create({
    name: 'rules', body: VALID_BODY,
    target: { kind: 'whatever' },
    io, execFile: exec,
  });
  assert.equal(out.ok, false);
  assert.ok(out.errors.some((e) => /unknown target.kind/.test(e)));
});

test('law creator: global without file', async () => {
  const io = makeAsyncMockIO();
  const exec = makeFakeExecFile();
  const out = await create({
    name: 'rules', body: VALID_BODY,
    target: { kind: 'global' },
    io, execFile: exec,
  });
  assert.equal(out.ok, false);
  assert.ok(out.errors.some((e) => /target\.file/.test(e)));
});

test('law creator: type-specific without typeId', async () => {
  const io = makeAsyncMockIO();
  const exec = makeFakeExecFile();
  const out = await create({
    name: 'rules', body: VALID_BODY,
    target: { kind: 'type-specific' },
    io, execFile: exec,
  });
  assert.equal(out.ok, false);
  assert.ok(out.errors.some((e) => /target\.typeId/.test(e)));
});
