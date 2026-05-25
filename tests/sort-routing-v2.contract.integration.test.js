/**
 * Integration tests for forge contract enforcement (R9).
 *
 * Tests enforceForgeContract with a mock feedback store providing get,
 * forceState, and add.  Covers the four contract scenarios plus
 * consecutive-failure semantics.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { enforceForgeContract } from '../src/scripts/lib/forge-contract.js';

// ---------------------------------------------------------------------------
// Mock feedback store — provides get, forceState, add
// ---------------------------------------------------------------------------

function applyItemDefaults(raw) {
  const d = {
    id: raw.id,
    file: 'test.md', tag: 'law:test', text: 'test feedback',
    source: 'quench:test-cycle', state: 'open',
    artefact_version: raw.artefact_version,
  };
  return { ...d, ...raw };
}

function makeItem(raw) {
  const ent = applyItemDefaults(raw);
  return {
    id: ent.id, file: ent.file, tag: ent.tag, text: ent.text,
    source: ent.source, artefact_version: ent.artefact_version,
    history: ent.history || [
      { state: ent.state, stage: 'quench:test-cycle',
        cycle: 'test-cycle', timestamp: new Date().toISOString() },
    ],
  };
}

function makeAddParams(params) {
  const d = {
    file: '', tag: 'system:forge-contract-mismatch', text: '',
    source: 'system:forge-contract-mismatch', state: 'open',
    cycle: 'test-cycle',
  };
  return { ...d, ...params };
}

function makeMockStore(initialItems = []) {
  const items = initialItems.map(makeItem);

  return {
    get(id) {
      const found = items.find(i => i.id === id);
      if (!found) return null;
      return { ...found, history: found.history.map(h => ({ ...h })) };
    },
    forceState(id, state, cycle) {
      const found = items.find(i => i.id === id);
      if (found) {
        found.history.unshift({
          state, stage: 'system:forge-contract-mismatch',
          cycle, timestamp: new Date().toISOString(),
        });
      }
    },
    add(params) {
      const p = makeAddParams(params);
      const entry = {
        id: `sys-${items.length + 1}`,
        file: p.file, tag: p.tag, text: p.text,
        source: p.source, artefact_version: p.artefact_version,
        history: [{
          state: p.state, stage: p.source,
          cycle: p.cycle, timestamp: new Date().toISOString(),
        }],
      };
      items.push(entry);
    },
    _items: items,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('enforceForgeContract', () => {
  // #1 — Forge marks actioned, artefact version unchanged
  it('fails contract when forge marks actioned but artefact version is unchanged', () => {
    const store = makeMockStore([{ id: 'item-1', state: 'actioned' }]);

    const result = enforceForgeContract({
      items: [{ id: 'item-1' }],
      preVersion: 'v1',
      postVersion: 'v1',
      feedbackStore: store,
      cycleId: 'test-cycle',
    });

    assert.equal(result.contractPassed, false);
    const item = store.get('item-1');
    assert.equal(item.history[0].state, 'open');
  });

  // #2 — Forge marks wont-fix on all items, version changed
  it('fails contract when all items are wont-fix but artefact version changed', () => {
    const store = makeMockStore([{ id: 'item-1', state: 'wont-fix' }]);

    const result = enforceForgeContract({
      items: [{ id: 'item-1' }],
      preVersion: 'v1',
      postVersion: 'v2',
      feedbackStore: store,
      cycleId: 'test-cycle',
    });

    assert.equal(result.contractPassed, false);
    const item = store.get('item-1');
    assert.equal(item.history[0].state, 'open');
  });

  // #3 — Mixed batch: actioned with version change + wont-fix (legitimate)
  it('passes contract with mixed batch (actioned + changed, wont-fix unchanged)', () => {
    const store = makeMockStore([
      { id: 'item-1', state: 'actioned' },
      { id: 'item-2', state: 'wont-fix' },
    ]);

    const result = enforceForgeContract({
      items: [{ id: 'item-1' }, { id: 'item-2' }],
      preVersion: 'v1',
      postVersion: 'v2',
      feedbackStore: store,
      cycleId: 'test-cycle',
    });

    assert.equal(result.contractPassed, true);
    // Items retain their forge-applied states
    assert.equal(store.get('item-1').history[0].state, 'actioned');
    assert.equal(store.get('item-2').history[0].state, 'wont-fix');
  });

  // #4 — All items wont-fix, version unchanged
  it('passes contract when all items are wont-fix and version unchanged', () => {
    const store = makeMockStore([
      { id: 'item-1', state: 'wont-fix' },
      { id: 'item-2', state: 'wont-fix' },
    ]);

    const result = enforceForgeContract({
      items: [{ id: 'item-1' }, { id: 'item-2' }],
      preVersion: 'v1',
      postVersion: 'v1',
      feedbackStore: store,
      cycleId: 'test-cycle',
    });

    assert.equal(result.contractPassed, true);
    assert.equal(store.get('item-1').history[0].state, 'wont-fix');
    assert.equal(store.get('item-2').history[0].state, 'wont-fix');
  });

  // #5 — 3 consecutive forge contract failures leave items open and post system feedback
  it('three consecutive contract failures leave items open and post system feedback each time', () => {
    const store = makeMockStore([{ id: 'item-1', state: 'open' }]);

    const runContract = () => enforceForgeContract({
      items: [{ id: 'item-1' }],
      preVersion: 'v1',
      postVersion: 'v1',
      feedbackStore: store,
      cycleId: 'test-cycle',
    });

    // First failure
    assert.equal(runContract().contractPassed, false);
    assert.equal(store.get('item-1').history[0].state, 'open');

    // Second failure
    assert.equal(runContract().contractPassed, false);
    assert.equal(store.get('item-1').history[0].state, 'open');

    // Third failure
    assert.equal(runContract().contractPassed, false);
    assert.equal(store.get('item-1').history[0].state, 'open');

    // System feedback items were added for each failure
    const sysItems = store._items.filter(i => i.source === 'system:forge-contract-mismatch');
    assert.equal(sysItems.length, 3);
  });

  // #6 — Consecutive failure counter resets on successful pass after one failure
  it('after a contract failure, a subsequent passing run succeeds', () => {
    const store = makeMockStore([{ id: 'item-1', state: 'open' }]);

    // First run: item is open → contract fails
    const r1 = enforceForgeContract({
      items: [{ id: 'item-1' }],
      preVersion: 'v1',
      postVersion: 'v1',
      feedbackStore: store,
      cycleId: 'test-cycle',
    });
    assert.equal(r1.contractPassed, false);

    // Forge correctly addresses the item (simulate state change)
    store.forceState('item-1', 'actioned', 'test-cycle');

    // Second run: item is actioned, version changes → contract passes
    const r2 = enforceForgeContract({
      items: [{ id: 'item-1' }],
      preVersion: 'v1',
      postVersion: 'v2',
      feedbackStore: store,
      cycleId: 'test-cycle',
    });
    assert.equal(r2.contractPassed, true);
  });
});
