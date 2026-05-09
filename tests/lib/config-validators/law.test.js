import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validate } from '../../../src/scripts/lib/config-validators/law.js';

const fx = (n) => readFileSync(new URL(`./fixtures/law/${n}.md`, import.meta.url), 'utf8');

test('law validator: multi-block valid', async () => {
  const out = await validate({ name: 'rules', body: fx('valid-multi') });
  assert.deepEqual(out, { ok: true });
});

test('law validator: prose-only law without Passing/Failing is valid', async () => {
  const body = '## clarity\nBe clear and concise.';
  const out = await validate({ name: 'rules', body });
  assert.equal(out.ok, true);
});

test('law validator: duplicate ids', async () => {
  const dup = `## a\nPassing: x\nFailing: y\n## a\nPassing: x\nFailing: y\n`;
  const out = await validate({ name: 'rules', body: dup });
  assert.equal(out.ok, false);
  assert.ok(out.errors.some((e) => /duplicate/.test(e)));
});

test('law validator: no laws at all', async () => {
  const out = await validate({ name: 'rules', body: '# empty\n' });
  assert.equal(out.ok, false);
  assert.ok(out.errors.some((e) => /at least one law/.test(e)));
});
