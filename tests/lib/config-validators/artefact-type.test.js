import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validate } from '../../../src/scripts/lib/config-validators/artefact-type.js';

const fixture = (name) =>
  readFileSync(new URL(`./fixtures/artefact-type/${name}.md`, import.meta.url), 'utf8');

const passIO = { exists: async () => true, readFile: async () => '' };

test('artefact-type validator: minimal valid', async () => {
  const out = await validate({
    name: 'short-story',
    body: fixture('valid-basic'),
    io: passIO,
  });
  assert.deepEqual(out, { ok: true });
});

test('artefact-type validator: output-type is not required', async () => {
  const out = await validate({
    name: 'short-story',
    body: fixture('valid-basic'),
    io: passIO,
  });
  assert.deepEqual(out, { ok: true });
});

test('artefact-type validator: name mismatch', async () => {
  const out = await validate({
    name: 'novel',
    body: fixture('valid-basic'),
    io: passIO,
  });
  assert.equal(out.ok, false);
  assert.ok(out.errors.some((e) => /name/.test(e)));
});

test('artefact-type validator: missing Definition section', async () => {
  const body = `---
name: x
file-patterns:
  - artefacts/x/*.md
---

no heading here.
`;
  const out = await validate({ name: 'x', body, io: passIO });
  assert.equal(out.ok, false);
  assert.ok(out.errors.some((e) => /Definition/.test(e)));
});

test('artefact-type validator: empty file-patterns', async () => {
  const body = `---
name: x
file-patterns: []
---

## Definition

x.
`;
  const out = await validate({ name: 'x', body, io: passIO });
  assert.equal(out.ok, false);
  assert.ok(out.errors.some((e) => /file-patterns/.test(e)));
});

test('artefact-type validator: rejects legacy appraisers.count', async () => {
  const body = `---
name: x
file-patterns:
  - x/*.md
appraisers:
  count: 3
---

## Definition

x.
`;
  const out = await validate({ name: 'x', body, io: passIO });
  assert.equal(out.ok, false);
  assert.ok(out.errors.some((e) => /count/.test(e)), 'should mention count');
});

test('artefact-type validator: rejects legacy appraisers.allowed', async () => {
  const body = `---
name: x
file-patterns:
  - x/*.md
appraisers:
  allowed:
    - skeptic
---

## Definition

x.
`;
  const out = await validate({ name: 'x', body, io: passIO });
  assert.equal(out.ok, false);
  assert.ok(out.errors.some((e) => /allowed/.test(e)), 'should mention allowed');
});
