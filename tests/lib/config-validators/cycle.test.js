import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validate } from '../../../src/scripts/lib/config-validators/cycle.js';

const fx = (n) => readFileSync(new URL(`./fixtures/cycle/${n}.md`, import.meta.url), 'utf8');

const ioAllExist = { exists: async () => true, readFile: async () => '' };
const ioNoneExist = { exists: async () => false, readFile: async () => '' };

test('cycle validator: minimal valid', async () => {
  const out = await validate({ name: 'draft', body: fx('valid-basic'), io: ioAllExist });
  assert.deepEqual(out, { ok: true });
});

test('cycle validator: missing output-type', async () => {
  const out = await validate({ name: 'draft', body: fx('invalid-missing-output-type'), io: ioAllExist });
  assert.equal(out.ok, false);
  assert.ok(out.errors.some((e) => /output-type/.test(e)));
});

test('cycle validator: output-type references missing artefact type', async () => {
  const out = await validate({ name: 'draft', body: fx('valid-basic'), io: ioNoneExist });
  assert.equal(out.ok, false);
  assert.ok(out.errors.some((e) => /artefact type|does not exist/i.test(e)));
});

test('cycle validator: id mismatch with supplied name', async () => {
  const body = `---\nid: other\nname: Other\noutput-type: foo\n---\n\n# Other\n\nProse.\n`;
  const out = await validate({ name: 'draft', body, io: ioAllExist });
  assert.equal(out.ok, false);
  assert.ok(out.errors.some((e) => /must match/.test(e)));
});

test('cycle validator: targets references missing cycle', async () => {
  const body = `---\nid: draft\nname: Draft\noutput-type: foo\ntargets:\n  - missing-cycle\n---\n\n# Draft\n\nProse.\n`;
  const io = {
    exists: async (p) => p.includes('artefacts/'),
    readFile: async () => '',
  };
  const out = await validate({ name: 'draft', body, io });
  assert.equal(out.ok, false);
  assert.ok(out.errors.some((e) => /target|cycle.*missing-cycle/i.test(e)));
});

test('cycle validator: inputs malformed', async () => {
  const body = `---\nid: draft\nname: Draft\noutput-type: foo\ninputs:\n  type: invalid-type\n  artefacts:\n    - bar\n---\n\n# Draft\n\nProse.\n`;
  const out = await validate({ name: 'draft', body, io: ioAllExist });
  assert.equal(out.ok, false);
  assert.ok(out.errors.some((e) => /inputs\.type|any-of|all-of/.test(e)));
});

// ── appraise-consensus field (D3.5) ────────────────────────────────────

test('cycle validator: appraise-consensus unanimous is valid', async () => {
  const body = `---\nid: draft\nname: Draft\noutput-type: foo\nappraise-consensus: unanimous\n---\n\n# Draft\n\nProse.\n`;
  const out = await validate({ name: 'draft', body, io: ioAllExist });
  assert.deepEqual(out, { ok: true });
});

test('cycle validator: appraise-consensus majority is valid', async () => {
  const body = `---\nid: draft\nname: Draft\noutput-type: foo\nappraise-consensus: majority\n---\n\n# Draft\n\nProse.\n`;
  const out = await validate({ name: 'draft', body, io: ioAllExist });
  assert.deepEqual(out, { ok: true });
});

test('cycle validator: appraise-consensus any is valid', async () => {
  const body = `---\nid: draft\nname: Draft\noutput-type: foo\nappraise-consensus: any\n---\n\n# Draft\n\nProse.\n`;
  const out = await validate({ name: 'draft', body, io: ioAllExist });
  assert.deepEqual(out, { ok: true });
});

test('cycle validator: appraise-consensus absent is accepted', async () => {
  // Uses the existing valid-basic fixture which does not include appraise-consensus
  const out = await validate({ name: 'draft', body: fx('valid-basic'), io: ioAllExist });
  assert.deepEqual(out, { ok: true });
});

test('cycle validator: appraise-consensus invalid value fails', async () => {
  const body = `---\nid: draft\nname: Draft\noutput-type: foo\nappraise-consensus: invalid-value\n---\n\n# Draft\n\nProse.\n`;
  const out = await validate({ name: 'draft', body, io: ioAllExist });
  assert.equal(out.ok, false);
  assert.ok(out.errors.some((e) => /appraise-consensus/i.test(e)));
});
