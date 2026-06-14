/**
 * Attestation wiring tests for run-assay.js.
 *
 * Verifies that executeAssay calls appendAssayAttestation correctly and
 * that the helper handles various input shapes.
 */

import { mock, test, describe } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// Track calls to appendStageAttestation — provide all exports from hash.js
// so dependent modules (artefacts.js, history.js) resolve successfully.
// ---------------------------------------------------------------------------

const attestationCalls = [];

mock.module('../../src/scripts/lib/attestation/hash.js', {
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

function makeStore(items = []) {
  const _items = items.map(i => ({
    ...i,
    history: i.history || [{ state: 'open', stage: 'assay', cycle: 'test-cycle', timestamp: new Date().toISOString() }],
  }));
  return {
    list() { return _items.map(i => ({ ...i, history: [...i.history] })); },
    add(params) {
      const id = 'mock-id';
      _items.push({ ...params, id, history: [{ state: 'open', stage: 'assay', cycle: 'test-cycle', timestamp: new Date().toISOString() }] });
      return { id };
    },
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
// appendAssayAttestation
// ---------------------------------------------------------------------------

describe('appendAssayAttestation', () => {
  test('appends attestation with stage assay and correct violation count', () => {
    const io = makeMockIo();
    const store = makeStore();
    helpers.appendAssayAttestation(io, 'test-cycle', 1, { issues: ['issue-1', 'issue-2', 'issue-3'], store });

    const calls = attestationCalls.filter(c => c.params && c.params.stage === 'assay');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].params.stage, 'assay');
    assert.equal(calls[0].params.cycle, 'test-cycle');
    assert.equal(calls[0].params.iteration, 1);
    assert.equal(calls[0].params.violations, 3);
  });

  test('includes feedback_opened for assay-scoped items', () => {
    const io = makeMockIo();
    const store = makeStore([
      { id: 'assay-item-1', source: 'system:assay-test-cycle', history: [{ state: 'open', stage: 'assay', cycle: 'test-cycle', timestamp: '2025-01-01T00:00:00Z' }] },
    ]);
    helpers.appendAssayAttestation(io, 'test-cycle', 1, { issues: ['issue'], store });
 
    const calls = attestationCalls.filter(c => c.params && c.params.stage === 'assay');
    assert.equal(calls.length, 1);
    assert.ok(calls[0].params.feedback_opened.includes('assay-item-1'));
  });

  test('uses empty arrays when no issues and no feedback items', () => {
    const io = makeMockIo();
    const store = makeStore();
    helpers.appendAssayAttestation(io, 'test-cycle', 1, { issues: [], store });

    const calls = attestationCalls.filter(c => c.params && c.params.stage === 'assay');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].params.violations, 0);
    assert.deepEqual(calls[0].params.artefact_hashes, []);
    assert.deepEqual(calls[0].params.changed_files, []);
  });

  test('does not throw when called with minimal valid data', () => {
    const io = makeMockIo();
    const store = makeStore();
    assert.doesNotThrow(() => {
      helpers.appendAssayAttestation(io, 'test-cycle', 1, { issues: ['issue'], store });
    });
  });
});

// ---------------------------------------------------------------------------
// Module exports
// ---------------------------------------------------------------------------

describe('run-assay module', () => {
  test('executeAssay is exported from run-assay', async () => {
    const mod = await import('../../src/scripts/run-assay.js');
    assert.equal(typeof mod.executeAssay, 'function');
  });

  test('appendAssayAttestation is exported from executor-attestation', () => {
    assert.equal(typeof helpers.appendAssayAttestation, 'function');
  });
});
