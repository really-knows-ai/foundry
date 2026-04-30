import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validate } from '../../../scripts/lib/config-validators/appraiser.js';

const fx = (n) => readFileSync(new URL(`./fixtures/appraiser/${n}.md`, import.meta.url), 'utf8');

test('appraiser validator: minimal valid', async () => {
  const out = await validate({ name: 'the-pedant', body: fx('valid-basic') });
  assert.deepEqual(out, { ok: true });
});

test('appraiser validator: missing id', async () => {
  const out = await validate({ name: 'the-pedant', body: fx('invalid-missing-id') });
  assert.equal(out.ok, false);
  assert.ok(out.errors.some((e) => /id/.test(e)));
});

test('appraiser validator: id mismatch with supplied name', async () => {
  const body = `---\nid: someone-else\nname: Different\n---\n\n# Different\n\nProse.\n`;
  const out = await validate({ name: 'the-pedant', body });
  assert.equal(out.ok, false);
  assert.ok(out.errors.some((e) => /must match/.test(e)));
});

test('appraiser validator: empty body', async () => {
  const body = `---\nid: the-pedant\nname: The Pedant\n---\n`;
  const out = await validate({ name: 'the-pedant', body });
  assert.equal(out.ok, false);
  assert.ok(out.errors.some((e) => /personality|body/.test(e)));
});
