/**
 * Attestation wiring tests for run-appraise.js.
 *
 * Verifies that appendAppraiseAttestation handles various coverage shapes.
 */

import { mock, test, describe } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// Track calls to appendStageAttestation — provide all exports from hash.js
// so dependent modules resolve successfully.
// ---------------------------------------------------------------------------

const attestationCalls = [];

mock.module(new URL('../../src/scripts/lib/attestation/hash.js', import.meta.url), {
  exports: {
    sha256Text: () => 'abc123',
    sha256Buffer: () => 'abc123',
    sortPaths: p => [...p].sort(),
    hashAttestation: () => 'abc123',
    generateRunId: () => '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    appendStageAttestation: (io, runId, params) => {
      attestationCalls.push({ runId, params });
      return Promise.resolve({ ok: true });
    },
  },
});

// ---------------------------------------------------------------------------
// Mock IO
// ---------------------------------------------------------------------------

function makeMockIo() {
  const store = {
    'WORK.md': '---\ncycle: test-cycle\nfoundry-run: 01ARZ3NDEKTSV4RRFFQ69G5FAV\n---\n# Goal\nTest',
    'WORK.feedback.yaml': 'items: []\n',
  };
  return {
    exists(p) { return Object.hasOwn(store, p); },
    readFile(p) {
      if (!(p in store)) throw new Error('ENOENT: ' + p);
      return store[p];
    },
    writeFile(p, c) { store[p] = c; },
    appendFile() { return Promise.resolve(); },
    mkdir() {},
    readDir() { return []; },
    exec() { return ''; },
  };
}

let helpers;

test.before(async () => {
  attestationCalls.length = 0;
  helpers = await import('../../src/scripts/lib/attestation/executor-attestation.js');
});

test.afterEach(() => {
  attestationCalls.length = 0;
});

// ---------------------------------------------------------------------------
// appendAppraiseAttestation
// ---------------------------------------------------------------------------

describe('appendAppraiseAttestation', () => {
  test('appends attestation with stage appraise', () => {
    const io = makeMockIo();
    const coverage = new Map();
    coverage.set('unit-1', { unitId: 'unit-1', group: 'default', mode: 'bundle', evaluations: [{ appraiser: 'test', verdict: 'passed', completed: true }], violations: 2 });

    helpers.appendAppraiseAttestation(io, 'test-cycle', 1, coverage, 'WORK.feedback.yaml');

    const calls = attestationCalls.filter(c => c.params && c.params.stage === 'appraise');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].params.stage, 'appraise');
    assert.equal(calls[0].params.cycle, 'test-cycle');
    assert.equal(calls[0].params.iteration, 1);
    assert.deepEqual(calls[0].params.appraiser_verdicts, [
      { appraiser: 'test', verdict: 'resolved' },
    ]);
  });

  test('sums violations across all coverage entries', () => {
    const io = makeMockIo();
    const coverage = new Map();
    coverage.set('u1', { unitId: 'u1', evaluations: [{ appraiser: 'a', verdict: 'passed', completed: true }], violations: 5 });
    coverage.set('u2', { unitId: 'u2', evaluations: [{ appraiser: 'b', verdict: 'passed', completed: true }], violations: 3 });

    helpers.appendAppraiseAttestation(io, 'test-cycle', 1, coverage, 'WORK.feedback.yaml');

    const calls = attestationCalls.filter(c => c.params && c.params.stage === 'appraise');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].params.violations, 8);
  });

  test('collects evaluations from all coverage entries', () => {
    const io = makeMockIo();
    const coverage = new Map();
    coverage.set('u1', { unitId: 'u1', evaluations: [{ appraiser: 'a', verdict: 'passed', completed: true }], violations: 0 });

    helpers.appendAppraiseAttestation(io, 'test-cycle', 1, coverage, 'WORK.feedback.yaml');

    const calls = attestationCalls.filter(c => c.params && c.params.stage === 'appraise');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].params.evaluations.length, 1);
    assert.equal(calls[0].params.evaluations[0].appraiser, 'a');
    assert.deepEqual(calls[0].params.appraiser_verdicts, [
      { appraiser: 'a', verdict: 'resolved' },
    ]);
  });

  test('handles empty coverage map', () => {
    const io = makeMockIo();
    const emptyCoverage = new Map();
    helpers.appendAppraiseAttestation(io, 'test-cycle', 1, emptyCoverage, 'WORK.feedback.yaml');

    const calls = attestationCalls.filter(c => c.params && c.params.stage === 'appraise');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].params.violations, 0);
    assert.deepEqual(calls[0].params.evaluations, []);
    assert.deepEqual(calls[0].params.appraiser_verdicts, []);
  });

  test('does not throw when feedback store has no items', () => {
    const io = makeMockIo();
    const emptyCoverage = new Map();
    assert.doesNotThrow(() => {
      helpers.appendAppraiseAttestation(io, 'test-cycle', 1, emptyCoverage, 'WORK.feedback.yaml');
    });
  });
});

// ---------------------------------------------------------------------------
// Module exports
// ---------------------------------------------------------------------------

describe('module exports', () => {
  test('executeAppraise is exported from run-appraise', async () => {
    const mod = await import('../../src/scripts/run-appraise.js');
    assert.equal(typeof mod.executeAppraise, 'function');
  });

  test('appendAppraiseAttestation is exported from executor-attestation', () => {
    assert.equal(typeof helpers.appendAppraiseAttestation, 'function');
  });
});
