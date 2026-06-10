// tests/schemas/stage-output.test.js
// Schema validation tests for appraise-address verdict shapes.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { validateAppraiseAddressVerdict } from '../../src/scripts/lib/stage-output-schemas.js';

// ── Valid objects ─────────────────────────────────────────────────────

describe('validateAppraiseAddressVerdict — valid objects', () => {
  test('accepts { action: "resolve" }', () => {
    assert.deepEqual(
      validateAppraiseAddressVerdict({ action: 'resolve' }),
      { ok: true },
    );
  });

  test('accepts { action: "reject", feedback: "Not sufficient." }', () => {
    assert.deepEqual(
      validateAppraiseAddressVerdict({ action: 'reject', feedback: 'Not sufficient.' }),
      { ok: true },
    );
  });
});

// ── Invalid objects ───────────────────────────────────────────────────

describe('validateAppraiseAddressVerdict — invalid objects', () => {
  test('rejects { action: "reject" } without feedback', () => {
    const r = validateAppraiseAddressVerdict({ action: 'reject' });
    assert.equal(r.ok, false);
    assert.ok(r.errors.some(e => e.includes('feedback')));
  });

  test('rejects { action: "resolve", feedback: "Looks good" } (feedback on resolve)', () => {
    const r = validateAppraiseAddressVerdict({ action: 'resolve', feedback: 'Looks good' });
    assert.equal(r.ok, false);
    assert.ok(r.errors.some(e => e.includes('feedback') && e.includes('not')));
  });

  test('rejects { action: "approve" } (unknown action)', () => {
    const r = validateAppraiseAddressVerdict({ action: 'approve' });
    assert.equal(r.ok, false);
    assert.ok(r.errors.some(e => e.includes('action')));
  });

  test('rejects empty object', () => {
    const r = validateAppraiseAddressVerdict({});
    assert.equal(r.ok, false);
    assert.ok(r.errors.some(e => e.includes('action')));
  });

  test('rejects { action: "skip" } (unknown action)', () => {
    const r = validateAppraiseAddressVerdict({ action: 'skip' });
    assert.equal(r.ok, false);
    assert.ok(r.errors.some(e => e.includes('action')));
  });

  test('rejects null', () => {
    const r = validateAppraiseAddressVerdict(null);
    assert.equal(r.ok, false);
    assert.ok(r.errors.some(e => e.includes('plain object')));
  });
});
