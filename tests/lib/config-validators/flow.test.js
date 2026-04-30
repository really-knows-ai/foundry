import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validate } from '../../../scripts/lib/config-validators/flow.js';

const fx = (n) => readFileSync(new URL(`./fixtures/flow/${n}.md`, import.meta.url), 'utf8');

const ioPass = { exists: async (p) => p.endsWith('.md'), readFile: async () => '' };
const ioFail = { exists: async () => false, readFile: async () => '' };

test('flow validator: minimal valid', async () => {
  const out = await validate({ name: 'creative', body: fx('valid-basic'), io: ioPass });
  assert.deepEqual(out, { ok: true });
});

test('flow validator: missing starting-cycles', async () => {
  const out = await validate({ name: 'creative', body: fx('invalid-missing-starting-cycles'), io: ioPass });
  assert.equal(out.ok, false);
  assert.ok(out.errors.some((e) => /starting-cycles/.test(e)));
});

test('flow validator: starting-cycles references missing cycle', async () => {
  const out = await validate({ name: 'creative', body: fx('valid-basic'), io: ioFail });
  assert.equal(out.ok, false);
  assert.ok(out.errors.some((e) => /cycle.*does not exist|not found/i.test(e)));
});

test('flow validator: id mismatch with supplied name', async () => {
  const body = `---\nid: other\nname: Other\nstarting-cycles:\n  - one\n---\n\n# Other\n\n## Cycles\n\n- one\n`;
  const out = await validate({ name: 'creative', body, io: ioPass });
  assert.equal(out.ok, false);
  assert.ok(out.errors.some((e) => /must match/.test(e)));
});

test('flow validator: missing ## Cycles section', async () => {
  const body = `---\nid: creative\nname: Creative\nstarting-cycles:\n  - one\n---\n\n# Creative\n\nNo cycles section.\n`;
  const out = await validate({ name: 'creative', body, io: ioPass });
  assert.equal(out.ok, false);
  assert.ok(out.errors.some((e) => /## Cycles/.test(e)));
});
