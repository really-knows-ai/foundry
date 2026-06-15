import test from 'node:test';
import assert from 'node:assert/strict';
import { makeCreator } from '../../../src/scripts/lib/config-creators/factory.js';
import { makeAsyncMockIO } from '../../helpers/async-mock-io.js';

const VALID_BODY = `---
name: test-type
---

## Definition

A test type.
`;

function makeFakeExecFile(dirtyFiles = []) {
  const calls = [];
  const fake = (argv) => {
    calls.push(argv);
    if (argv[0] === 'status') {
      return dirtyFiles.map((f) => `?? ${f}\0`).join('');
    }
    if (argv[0] === 'rev-parse') return 'abc1234\n';
    return '';
  };
  fake.calls = calls;
  return fake;
}

function makeMockValidator(shouldPass = true) {
  return async ({ name, body }) => {
    if (!shouldPass) {
      return { ok: false, errors: ['validation failed'] };
    }
    return { ok: true };
  };
}

test('factory: creates a simple creator function', async () => {
  const pathFor = (args) => `foundry/test/${args.name}.md`;
  const validator = makeMockValidator(true);
  const create = makeCreator({
    kind: { human: 'test-type', underscored: 'test_type' },
    pathFor,
    validator,
  });

  const io = makeAsyncMockIO();
  const exec = makeFakeExecFile(['foundry/test/foo.md']);
  const result = await create({ name: 'foo', body: VALID_BODY, io, execFile: exec });

  assert.equal(result.ok, true);
  assert.equal(result.path, 'foundry/test/foo.md');
  assert.equal(result.sha, 'abc1234');
  assert.equal(io._get('foundry/test/foo.md'), VALID_BODY);
});

test('factory: includes correct commit message', async () => {
  const pathFor = (args) => `foundry/test/${args.name}.md`;
  const validator = makeMockValidator(true);
  const create = makeCreator({
    kind: { human: 'test-type', underscored: 'test_type' },
    pathFor,
    validator,
  });

  const io = makeAsyncMockIO();
  const exec = makeFakeExecFile(['foundry/test/foo.md']);
  await create({ name: 'foo', body: VALID_BODY, io, execFile: exec });

  const commit = exec.calls.find((c) => c[0] === 'commit');
  assert.ok(commit, 'commit was called');
  assert.match(commit[2], /^config: add test-type foo\n\nvia foundry_config_create_test_type$/);
});

test('factory: returns validation errors', async () => {
  const pathFor = (args) => `foundry/test/${args.name}.md`;
  const validator = makeMockValidator(false);
  const create = makeCreator({
    kind: { human: 'test-type', underscored: 'test_type' },
    pathFor,
    validator,
  });

  const io = makeAsyncMockIO();
  const exec = makeFakeExecFile();
  const result = await create({ name: 'foo', body: VALID_BODY, io, execFile: exec });

  assert.equal(result.ok, false);
  assert.ok(result.errors.includes('validation failed'));
  assert.equal(io._has('foundry/test/foo.md'), false);
  assert.ok(!exec.calls.some((c) => c[0] === 'commit'));
});

test('factory: rejects when file already exists', async () => {
  const pathFor = (args) => `foundry/test/${args.name}.md`;
  const validator = makeMockValidator(true);
  const create = makeCreator({
    kind: { human: 'test-type', underscored: 'test_type' },
    pathFor,
    validator,
  });

  const path = 'foundry/test/foo.md';
  const io = makeAsyncMockIO({ [path]: 'existing content' });
  const exec = makeFakeExecFile();
  const result = await create({ name: 'foo', body: VALID_BODY, io, execFile: exec });

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => /already exists/.test(e)));
  assert.equal(io._get(path), 'existing content');
  assert.ok(!exec.calls.some((c) => c[0] === 'commit'));
});

test('factory: removes created file when commit policy rejects the worktree', async () => {
  const pathFor = (args) => `foundry/test/${args.name}.md`;
  const validator = makeMockValidator(true);
  const create = makeCreator({
    kind: { human: 'test-type', underscored: 'test_type' },
    pathFor,
    validator,
  });

  const io = makeAsyncMockIO();
  const exec = makeFakeExecFile(['foundry/test/foo.md', 'notes.txt']);

  await assert.rejects(
    () => create({ name: 'foo', body: VALID_BODY, io, execFile: exec }),
    /unexpected_files/,
  );
  assert.equal(io._has('foundry/test/foo.md'), false);
  assert.ok(!exec.calls.some((c) => c[0] === 'commit'));
});

test('factory: supports custom validation logic', async () => {
  const pathFor = (args) => `foundry/test/${args.target.file}`;
  const validator = makeMockValidator(true);
  const customValidation = ({ target }) => {
    if (!target || !target.file) {
      return { ok: false, errors: ['target.file is required'] };
    }
    return { ok: true };
  };
  const create = makeCreator({
    kind: { human: 'test-type', underscored: 'test_type' },
    pathFor,
    validator,
    customValidation,
  });

  const io = makeAsyncMockIO();
  const exec = makeFakeExecFile();
  const result = await create({ name: 'foo', body: VALID_BODY, io, execFile: exec });

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => /target\.file/.test(e)));
  assert.ok(!exec.calls.some((c) => c[0] === 'commit'));
});

test('factory: custom validation passes with valid input', async () => {
  const pathFor = (args) => `foundry/test/${args.target.file}`;
  const validator = makeMockValidator(true);
  const customValidation = ({ target }) => {
    if (!target || !target.file) {
      return { ok: false, errors: ['target.file is required'] };
    }
    return { ok: true };
  };
  const create = makeCreator({
    kind: { human: 'test-type', underscored: 'test_type' },
    pathFor,
    validator,
    customValidation,
  });

  const io = makeAsyncMockIO();
  const exec = makeFakeExecFile(['foundry/test/rules.md']);
  const result = await create({
    name: 'foo',
    body: VALID_BODY,
    target: { file: 'rules.md' },
    io,
    execFile: exec,
  });

  assert.equal(result.ok, true);
  assert.equal(result.path, 'foundry/test/rules.md');
});

test('factory: accepts string kind when human and underscored are identical', async () => {
  const pathFor = (args) => `foundry/test/${args.name}.md`;
  const validator = makeMockValidator(true);
  const create = makeCreator({
    kind: 'simple',
    pathFor,
    validator,
  });

  const io = makeAsyncMockIO();
  const exec = makeFakeExecFile(['foundry/test/bar.md']);
  const result = await create({ name: 'bar', body: VALID_BODY, io, execFile: exec });

  assert.equal(result.ok, true);
  const commit = exec.calls.find((c) => c[0] === 'commit');
  assert.match(commit[2], /^config: add simple bar\n\nvia foundry_config_create_simple$/);
});
