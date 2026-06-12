/**
 * Attestation wiring tests for run-executors.js.
 *
 * Verifies that the executor-attestation helpers call appendStageAttestation
 * with the correct payloads on all code paths.
 */

import { mock, test, describe } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// Track calls to appendStageAttestation
// ---------------------------------------------------------------------------

const attestationCalls = [];

// Provide all exports that hash.js normally provides so dependent modules
// (artefacts.js, history.js, etc.) still resolve their imports.
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
  store['foundry/cycles/test-cycle.md'] = '---\noutput-type: haiku\n---\n';
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
    history: i.history || [{ state: 'open', stage: 'test', cycle: 'test-cycle', timestamp: new Date().toISOString() }],
  }));
  return {
    list() { return _items.map(i => ({ ...i, history: [...i.history] })); },
    get(id) { const it = _items.find(x => x.id === id); return it ? { ...it } : null; },
    add(params) {
      const id = 'mock-id';
      _items.push({ ...params, id, history: [{ state: 'open', stage: 'test', cycle: 'test-cycle', timestamp: new Date().toISOString() }] });
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
// appendForgeAttestation
// ---------------------------------------------------------------------------

describe('appendForgeAttestation', () => {
  test('appends attestation with stage forge', () => {
    const io = makeMockIo();
    helpers.appendForgeAttestation(io, 'test-cycle', {
      result: { ok: true, changedFiles: [] },
      arV: 'abc123',
      outputType: 'haiku',
      forgeItem: null,
      wont_fix: false,
    });

    const calls = attestationCalls.filter(c => c.params && c.params.stage === 'forge');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].params.cycle, 'test-cycle');
    assert.equal(calls[0].params.iteration, 1);
    assert.equal(calls[0].params.violations, 0);
    assert.equal(calls[0].params.wont_fix, false);
  });

  test('sets violations to 1 when result.ok is false', () => {
    const io = makeMockIo();
    helpers.appendForgeAttestation(io, 'test-cycle', {
      result: { ok: false, changedFiles: [] },
      arV: null,
      outputType: 'haiku',
      forgeItem: null,
      wont_fix: false,
    });

    const calls = attestationCalls.filter(c => c.params && c.params.stage === 'forge');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].params.violations, 1);
    assert.equal(calls[0].params.wont_fix, false);
  });

  test('includes resolved feedback IDs when forgeItem is present', () => {
    const io = makeMockIo();
    helpers.appendForgeAttestation(io, 'test-cycle', {
      result: { ok: true, changedFiles: [] },
      arV: null,
      outputType: 'haiku',
      forgeItem: { id: 'fb-01' },
      wont_fix: false,
    });

    const calls = attestationCalls.filter(c => c.params && c.params.stage === 'forge');
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].params.feedback_resolved, ['fb-01']);
    assert.equal(calls[0].params.wont_fix, false);
  });

  test('includes changed_files from result', () => {
    const io = makeMockIo();
    helpers.appendForgeAttestation(io, 'test-cycle', {
      result: { ok: true, changedFiles: ['haikus/cats.md'] },
      arV: 'abc123',
      outputType: 'haiku',
      forgeItem: null,
      wont_fix: false,
    });

    const calls = attestationCalls.filter(c => c.params && c.params.stage === 'forge');
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].params.changed_files, ['haikus/cats.md']);
    assert.equal(calls[0].params.wont_fix, false);
  });
});

// ---------------------------------------------------------------------------
// appendQuenchAttestation — early-return (no store) and main paths
// ---------------------------------------------------------------------------

describe('appendQuenchAttestation', () => {
  test('appends quench attestation with violations 0 and empty arrays (early path)', () => {
    const io = makeMockIo();
    helpers.appendQuenchAttestation(io, 'test-cycle', { artefact_hashes: [] });

    const calls = attestationCalls.filter(c => c.params && c.params.stage === 'quench');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].params.violations, 0);
    assert.deepEqual(calls[0].params.violations_list, []);
    assert.deepEqual(calls[0].params.artefact_hashes, []);
    assert.deepEqual(calls[0].params.feedback_opened, []);
    assert.deepEqual(calls[0].params.feedback_resolved, []);
  });

  test('passes artefact_hashes when provided (early path)', () => {
    const io = makeMockIo();
    helpers.appendQuenchAttestation(io, 'test-cycle', {
      artefact_hashes: [{ path: 'haiku/cats.md', hash: 'abc123' }],
    });

    const calls = attestationCalls.filter(c => c.params && c.params.stage === 'quench');
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].params.artefact_hashes, [{ path: 'haiku/cats.md', hash: 'abc123' }]);
  });

  test('appends quench attestation with violation count and opened feedback IDs (main path)', () => {
    const io = makeMockIo();
    const store = makeStore([
      { id: 'q-01', source: 'quench:test-cycle', history: [{ state: 'open', stage: 'quench:test-cycle', cycle: 'test-cycle', timestamp: '2025-01-01T00:00:00Z' }] },
    ]);
    helpers.appendQuenchAttestation(io, 'test-cycle', {
      aVersion: 'abc123',
      outputType: 'haiku',
      store,
      feedbackList: ['violation 1', 'violation 2'],
    });

    const calls = attestationCalls.filter(c => c.params && c.params.stage === 'quench');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].params.violations, 2);
    assert.deepEqual(calls[0].params.violations_list, ['violation 1', 'violation 2']);
    assert.ok(calls[0].params.feedback_opened.includes('q-01'));
  });

  test('uses empty artefact_hashes when aVersion is null (main path)', () => {
    const io = makeMockIo();
    const store = makeStore();
    helpers.appendQuenchAttestation(io, 'test-cycle', {
      aVersion: null,
      outputType: 'haiku',
      store,
      feedbackList: [],
    });

    const calls = attestationCalls.filter(c => c.params && c.params.stage === 'quench');
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].params.artefact_hashes, []);
  });
});

// ---------------------------------------------------------------------------
// appendAssayAttestation
// ---------------------------------------------------------------------------

describe('appendAssayAttestation', () => {
  test('appends assay attestation with correct violation count', () => {
    const io = makeMockIo();
    const store = makeStore();
    helpers.appendAssayAttestation(io, 'test-cycle', ['issue1', 'issue2'], store);

    const calls = attestationCalls.filter(c => c.params && c.params.stage === 'assay');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].params.violations, 2);
    assert.equal(calls[0].params.cycle, 'test-cycle');
  });

  test('includes opened feedback IDs from store', () => {
    const io = makeMockIo();
    const store = makeStore([
      { id: 'a-01', source: 'system:assay-test-cycle', history: [{ state: 'open', stage: 'assay', cycle: 'test-cycle', timestamp: '2025-01-01T00:00:00Z' }] },
    ]);
    helpers.appendAssayAttestation(io, 'test-cycle', ['issue'], store);

    const calls = attestationCalls.filter(c => c.params && c.params.stage === 'assay');
    assert.equal(calls.length, 1);
    assert.ok(calls[0].params.feedback_opened.includes('a-01'));
  });
});

// ---------------------------------------------------------------------------
// Module exports
// ---------------------------------------------------------------------------

describe('module exports', () => {
  test('executeForge is exported from run-executors', async () => {
    const mod = await import('../../src/scripts/run-executors.js');
    assert.equal(typeof mod.executeForge, 'function');
  });

  test('executeQuench is exported from run-executors', async () => {
    const mod = await import('../../src/scripts/run-executors.js');
    assert.equal(typeof mod.executeQuench, 'function');
  });

  test('helpers are exported from executor-attestation module', () => {
    assert.equal(typeof helpers.appendForgeAttestation, 'function');
    assert.equal(typeof helpers.appendQuenchAttestation, 'function');
    assert.equal(typeof helpers.appendAssayAttestation, 'function');
  });
});
