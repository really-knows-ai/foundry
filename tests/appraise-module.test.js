/**
 * Unit tests for appraise-module.js — resolveStaleFeedback.
 */

import { describe, it, mock, before } from 'node:test';
import assert from 'node:assert/strict';

// Module under test
let resolveStaleFeedback;

before(async () => {
  const mod = await import('../src/scripts/appraise-module.js');
  resolveStaleFeedback = mod.resolveStaleFeedback;
});

// ---------------------------------------------------------------------------
// resolveStaleFeedback — stale feedback detection (Phase 4)
// ---------------------------------------------------------------------------

describe('resolveStaleFeedback (appraise)', () => {
  function makeItem(overrides = {}) {
    return {
      id: 'item-1',
      source: 'appraise:test-cycle',
      artefact_version: 'old-version',
      history: [{ state: 'open' }],
      file: 'a.md',
      tag: 'law:x',
      ...overrides,
    };
  }

  it('resolves items with mismatched version', () => {
    const items = [makeItem({ artefact_version: 'v1' })];
    const feedback = { autoResolve: mock.fn() };
    resolveStaleFeedback(items, 'v2', 'appraise', feedback, 'cycle-1');
    assert.equal(feedback.autoResolve.mock.calls.length, 1);
    assert.match(feedback.autoResolve.mock.calls[0].arguments[0].reason, /superseded by forge revision/);
    assert.equal(feedback.autoResolve.mock.calls[0].arguments[0].cycle, 'cycle-1');
  });

  it('skips items with matching version', () => {
    const items = [makeItem({ artefact_version: 'v1' })];
    const feedback = { autoResolve: mock.fn() };
    resolveStaleFeedback(items, 'v1', 'appraise', feedback, 'cycle-1');
    assert.equal(feedback.autoResolve.mock.calls.length, 0);
  });

  it('skips items from other source bases', () => {
    const items = [makeItem({ source: 'quench:test-cycle' })];
    const feedback = { autoResolve: mock.fn() };
    resolveStaleFeedback(items, 'v2', 'appraise', feedback, 'cycle-1');
    assert.equal(feedback.autoResolve.mock.calls.length, 0);
  });

  it('skips already-resolved items', () => {
    const items = [makeItem({ history: [{ state: 'resolved' }] })];
    const feedback = { autoResolve: mock.fn() };
    resolveStaleFeedback(items, 'v2', 'appraise', feedback, 'cycle-1');
    assert.equal(feedback.autoResolve.mock.calls.length, 0);
  });

  it('passes cycle through to autoResolve', () => {
    const items = [makeItem({ artefact_version: 'v1' })];
    const feedback = { autoResolve: mock.fn() };
    resolveStaleFeedback(items, 'v2', 'appraise', feedback, 'my-cycle');
    assert.equal(feedback.autoResolve.mock.calls[0].arguments[0].cycle, 'my-cycle');
  });
});
