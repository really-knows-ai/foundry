// tests/appraise-consensus.integration.test.js
// Integration tests for the appraise-address sub-stage.
//
// Tests the full pipeline: collect addressed items, collect verdicts,
// compute consensus, and transition items.

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeFeedbackItem(overrides = {}) {
  const defaults = {
    id: 'item-001',
    file: 'src/test.js',
    tag: 'law:test',
    text: 'some feedback text',
    source: 'forge:test-cycle',
    artefact_version: 'abc123',
  };
  const merged = { ...defaults, ...overrides };
  return {
    id: merged.id,
    file: merged.file,
    tag: merged.tag,
    text: merged.text,
    source: merged.source,
    artefact_version: merged.artefact_version,
    history: [{
      state: merged.state || 'actioned',
      stage: merged.stage || merged.source,
      cycle: merged.cycle || 'test-cycle',
      timestamp: '2025-01-01T00:00:00.000Z',
      ...(merged.reason ? { reason: merged.reason } : {}),
    }],
  };
}

function mockStore(items = []) {
  const clone = i => ({ ...i, history: i.history.map(h => ({ ...h })) });
  const _items = items.map(clone);
  return {
    list() { return _items.map(clone); },
    get(id) { const it = _items.find(x => x.id === id); return it ? clone(it) : null; },
    add(params) {
      _items.push({
        ...params,
        id: params.id || 'mock-id',
        history: [{ state: 'open', stage: params.source, cycle: params.cycle, timestamp: new Date().toISOString() }],
      });
      return { id: params.id || 'mock-id', deduped: false };
    },
    transition(params) {
      const idx = _items.findIndex(x => x.id === params.id);
      if (idx === -1) return { ok: false, error: 'not found' };
      const snapshot = {
        state: params.target,
        stage: params.stage,
        cycle: params.cycle,
        timestamp: new Date().toISOString(),
      };
      if (params.reason) snapshot.reason = params.reason;
      _items[idx].history.unshift(snapshot);
      return { ok: true };
    },
    forceState(id, state, cycle, stage) {
      const idx = _items.findIndex(x => x.id === id);
      if (idx === -1) return { ok: false, error: 'not found' };
      _items[idx].history.unshift({ state, stage: stage || 'system:test', cycle, timestamp: new Date().toISOString() });
      return { ok: true };
    },
    autoResolve() { return { ok: true }; },
  };
}

function frontmatterToYaml(fm) {
  return Object.entries(fm).map(function([k, v]) { return k + ': ' + v; }).join('\n');
}

function makeIo(frontmatter) {
  const fm = frontmatter || { id: 'test-cycle', name: 'Test', 'output-type': 'doc' };
  const body = '---\n' + frontmatterToYaml(fm) + '\n---\n\n# Test Cycle\n';
  return {
    exists: async function(p) { return p.includes('cycles/test-cycle.md'); },
    readFile: async function() { return body; },
    readDir: function() { return []; },
    unlink: function() {},
    mkdir: function() {},
  };
}

// ---------------------------------------------------------------------------
// Module under test
// ---------------------------------------------------------------------------

let executeAppraiseAddress;
let processAddressedItem;
let buildAddressPrompt;

beforeEach(async () => {
  // Dynamic import to get fresh module each time
  const mod = await import('../src/scripts/appraise-address.js');
  executeAppraiseAddress = mod.executeAppraiseAddress;
  processAddressedItem = mod.processAddressedItem;
  buildAddressPrompt = mod.buildAddressPrompt;
});

// ---------------------------------------------------------------------------
// buildAddressPrompt tests
// ---------------------------------------------------------------------------

describe('buildAddressPrompt', () => {
  test('includes item details for actioned state', () => {
    const item = makeFeedbackItem({ id: '1', state: 'actioned', text: 'the issue' });
    const prompt = buildAddressPrompt(item, 'appr-1', 'critical');
    assert.ok(prompt.includes('the issue'));
    assert.ok(prompt.includes('Forge status: actioned'));
    assert.ok(prompt.includes('foundry_stage_output'));
    assert.ok(prompt.includes('resolve'));
    assert.ok(prompt.includes('reject'));
  });

  test('includes wont-fix reason for wont-fix items', () => {
    const item = makeFeedbackItem({ id: '1', state: 'wont-fix', text: 'the issue', reason: 'wont do' });
    const prompt = buildAddressPrompt(item, 'appr-1', 'critical');
    assert.ok(prompt.includes('the issue'));
    assert.ok(prompt.includes('wont-fix'));
    assert.ok(prompt.includes('wont do'));
  });
});

// ---------------------------------------------------------------------------
// processAddressedItem tests
// ---------------------------------------------------------------------------

describe('processAddressedItem', () => {
  test('single appraiser resolve → item transitions to resolved', () => {
    const item = makeFeedbackItem({ id: '1', state: 'actioned' });
    const store = mockStore([item]);

    const collectVerdicts = () => [
      { action: 'resolve' },
    ];

    const result = processAddressedItem(item, store, 'test-cycle', 'unanimous', collectVerdicts);
    assert.equal(result.ok, true);

    const updated = store.get('1');
    assert.equal(updated.history[0].state, 'resolved');
  });

  test('single appraiser reject → item transitions to rejected with reason', () => {
    const item = makeFeedbackItem({ id: '1', state: 'actioned' });
    const store = mockStore([item]);

    const collectVerdicts = () => [
      { action: 'reject', feedback: 'Fix is incomplete.' },
    ];

    const result = processAddressedItem(item, store, 'test-cycle', 'unanimous', collectVerdicts);
    assert.equal(result.ok, true);

    const updated = store.get('1');
    assert.equal(updated.history[0].state, 'rejected');
    assert.ok(updated.history[0].reason);
    assert.ok(updated.history[0].reason.includes('Fix is incomplete.'));
  });

  test('multiple appraisers majority mode: 2 of 3 resolved → resolved', () => {
    const item = makeFeedbackItem({ id: '1', state: 'actioned' });
    const store = mockStore([item]);

    const collectVerdicts = () => [
      { action: 'resolve' },
      { action: 'resolve' },
      { action: 'reject', feedback: 'nope' },
    ];

    const result = processAddressedItem(item, store, 'test-cycle', 'majority', collectVerdicts);
    assert.equal(result.ok, true);

    const updated = store.get('1');
    assert.equal(updated.history[0].state, 'resolved');
  });

  test('multiple appraisers majority mode: 1 of 3 resolved → rejected', () => {
    const item = makeFeedbackItem({ id: '1', state: 'actioned' });
    const store = mockStore([item]);

    const collectVerdicts = () => [
      { action: 'resolve' },
      { action: 'reject', feedback: 'still broken' },
      { action: 'reject', feedback: 'not fixed' },
    ];

    const result = processAddressedItem(item, store, 'test-cycle', 'majority', collectVerdicts);
    assert.equal(result.ok, true);

    const updated = store.get('1');
    assert.equal(updated.history[0].state, 'rejected');
    assert.ok(updated.history[0].reason);
    assert.ok(updated.history[0].reason.includes('still broken'));
    assert.ok(updated.history[0].reason.includes('not fixed'));
  });

  test('any mode: 1 of 3 resolved → resolved', () => {
    const item = makeFeedbackItem({ id: '1', state: 'actioned' });
    const store = mockStore([item]);

    const collectVerdicts = () => [
      { action: 'resolve' },
      { action: 'reject', feedback: 'no' },
      { action: 'reject', feedback: 'bad' },
    ];

    const result = processAddressedItem(item, store, 'test-cycle', 'any', collectVerdicts);
    assert.equal(result.ok, true);

    const updated = store.get('1');
    assert.equal(updated.history[0].state, 'resolved');
  });

  test('non-addressed items (open/rejected) not affected', () => {
    const item = makeFeedbackItem({ id: '1', state: 'actioned' });
    const openItem = makeFeedbackItem({ id: '2', state: 'open' });
    const store = mockStore([item, openItem]);

    const collectVerdicts = () => [{ action: 'resolve' }];

    const result = processAddressedItem(item, store, 'test-cycle', 'unanimous', collectVerdicts);
    assert.equal(result.ok, true);

    const updatedOpen = store.get('2');
    assert.equal(updatedOpen.history[0].state, 'open');
    assert.equal(updatedOpen.history.length, 1);
  });

  test('returns error for invalid item id', () => {
    const item = makeFeedbackItem({ id: 'non-existent' });
    const store = mockStore([]);

    const collectVerdicts = () => [{ action: 'resolve' }];

    const result = processAddressedItem(item, store, 'test-cycle', 'unanimous', collectVerdicts);
    assert.equal(result.ok, false);
  });
});

// ---------------------------------------------------------------------------
// executeAppraiseAddress tests
// ---------------------------------------------------------------------------

describe('executeAppraiseAddress', () => {
  test('no addressed items → no-op, processed: 0', async () => {
    const store = mockStore([
      makeFeedbackItem({ id: '1', state: 'open', cycle: 'test-cycle' }),
      makeFeedbackItem({ id: '2', state: 'resolved', cycle: 'test-cycle' }),
    ]);

    const result = await executeAppraiseAddress({
      store,
      cycleId: 'test-cycle',
      foundryDir: 'foundry',
      io: makeIo({ id: 'test-cycle', name: 'Test', 'output-type': 'doc' }),
    });

    assert.deepEqual(result, { ok: true, processed: 0 });
  });

  test('single addressed item, unanimous resolved → item transitions to resolved', async () => {
    const item = makeFeedbackItem({ id: '1', state: 'actioned', cycle: 'test-cycle' });
    const store = mockStore([item]);

    const result = await executeAppraiseAddress({
      store,
      cycleId: 'test-cycle',
      foundryDir: 'foundry',
      io: makeIo({
        id: 'test-cycle', name: 'Test', 'output-type': 'doc',
        'appraise-consensus': 'unanimous',
      }),
      collectVerdictsFn: () => [{ action: 'resolve' }],
    });

    assert.equal(result.ok, true);
    assert.equal(result.processed, 1);

    const updated = store.get('1');
    assert.equal(updated.history[0].state, 'resolved');
  });

  test('single addressed item, rejected → item transitions to rejected with reason', async () => {
    const item = makeFeedbackItem({ id: '1', state: 'actioned', cycle: 'test-cycle' });
    const store = mockStore([item]);

    const result = await executeAppraiseAddress({
      store,
      cycleId: 'test-cycle',
      foundryDir: 'foundry',
      io: makeIo({
        id: 'test-cycle', name: 'Test', 'output-type': 'doc',
        'appraise-consensus': 'unanimous',
      }),
      collectVerdictsFn: () => [{ action: 'reject', feedback: 'Fix is incomplete.' }],
    });

    assert.equal(result.ok, true);
    assert.equal(result.processed, 1);

    const updated = store.get('1');
    assert.equal(updated.history[0].state, 'rejected');
    assert.ok(updated.history[0].reason);
  });

  test('multiple appraisers majority mode: 2 of 3 resolved → resolved', async () => {
    const item = makeFeedbackItem({ id: '1', state: 'actioned', cycle: 'test-cycle' });
    const store = mockStore([item]);

    const result = await executeAppraiseAddress({
      store,
      cycleId: 'test-cycle',
      foundryDir: 'foundry',
      io: makeIo({
        id: 'test-cycle', name: 'Test', 'output-type': 'doc',
        'appraise-consensus': 'majority',
      }),
      collectVerdictsFn: () => [
        { action: 'resolve' },
        { action: 'resolve' },
        { action: 'reject', feedback: 'nope' },
      ],
    });

    assert.equal(result.ok, true);
    assert.equal(result.processed, 1);

    const updated = store.get('1');
    assert.equal(updated.history[0].state, 'resolved');
  });

  test('multiple appraisers majority mode: 1 of 3 resolved → rejected', async () => {
    const item = makeFeedbackItem({ id: '1', state: 'actioned', cycle: 'test-cycle' });
    const store = mockStore([item]);

    const result = await executeAppraiseAddress({
      store,
      cycleId: 'test-cycle',
      foundryDir: 'foundry',
      io: makeIo({
        id: 'test-cycle', name: 'Test', 'output-type': 'doc',
        'appraise-consensus': 'majority',
      }),
      collectVerdictsFn: () => [
        { action: 'resolve' },
        { action: 'reject', feedback: 'still broken' },
        { action: 'reject', feedback: 'not fixed' },
      ],
    });

    assert.equal(result.ok, true);
    assert.equal(result.processed, 1);

    const updated = store.get('1');
    assert.equal(updated.history[0].state, 'rejected');
  });

  test('any mode: 1 of 3 resolved → resolved', async () => {
    const item = makeFeedbackItem({ id: '1', state: 'actioned', cycle: 'test-cycle' });
    const store = mockStore([item]);

    const result = await executeAppraiseAddress({
      store,
      cycleId: 'test-cycle',
      foundryDir: 'foundry',
      io: makeIo({
        id: 'test-cycle', name: 'Test', 'output-type': 'doc',
        'appraise-consensus': 'any',
      }),
      collectVerdictsFn: () => [
        { action: 'resolve' },
        { action: 'reject', feedback: 'no' },
        { action: 'reject', feedback: 'bad' },
      ],
    });

    assert.equal(result.ok, true);
    assert.equal(result.processed, 1);

    const updated = store.get('1');
    assert.equal(updated.history[0].state, 'resolved');
  });

  test('multiple addressed items processed independently', async () => {
    const item1 = makeFeedbackItem({ id: '1', state: 'actioned', cycle: 'test-cycle' });
    const item2 = makeFeedbackItem({ id: '2', state: 'actioned', cycle: 'test-cycle' });
    const store = mockStore([item1, item2]);

    let callCount = 0;
    const collectVerdictsFn = () => {
      callCount++;
      if (callCount === 1) return [{ action: 'resolve' }];   // item1 resolved
      return [{ action: 'reject', feedback: 'bad fix' }];     // item2 rejected
    };

    const result = await executeAppraiseAddress({
      store,
      cycleId: 'test-cycle',
      foundryDir: 'foundry',
      io: makeIo({
        id: 'test-cycle', name: 'Test', 'output-type': 'doc',
        'appraise-consensus': 'unanimous',
      }),
      collectVerdictsFn,
    });

    assert.equal(result.ok, true);
    assert.equal(result.processed, 2);

    const updated1 = store.get('1');
    assert.equal(updated1.history[0].state, 'resolved');

    const updated2 = store.get('2');
    assert.equal(updated2.history[0].state, 'rejected');
  });

  test('non-addressed items not affected', async () => {
    const addressed = makeFeedbackItem({ id: '1', state: 'actioned', cycle: 'test-cycle' });
    const openItem = makeFeedbackItem({ id: '2', state: 'open', cycle: 'test-cycle' });
    const rejectedItem = makeFeedbackItem({ id: '3', state: 'rejected', cycle: 'test-cycle' });
    const store = mockStore([addressed, openItem, rejectedItem]);

    const result = await executeAppraiseAddress({
      store,
      cycleId: 'test-cycle',
      foundryDir: 'foundry',
      io: makeIo({
        id: 'test-cycle', name: 'Test', 'output-type': 'doc',
        'appraise-consensus': 'unanimous',
      }),
      collectVerdictsFn: () => [{ action: 'resolve' }],
    });

    assert.equal(result.ok, true);
    assert.equal(result.processed, 1);

    assert.equal(store.get('2').history[0].state, 'open');
    assert.equal(store.get('3').history[0].state, 'rejected');
  });
});
