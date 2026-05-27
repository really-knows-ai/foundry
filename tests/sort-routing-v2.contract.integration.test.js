/**
 * Integration tests for forge contract enforcement.
 *
 * Tests enforceForgeContract with a mock feedback store providing get,
 * transition, forceState, and add. Covers the single-item contract scenarios.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { enforceForgeContract } from '../src/scripts/lib/forge-contract.js';

// ---------------------------------------------------------------------------
// Mock feedback store — provides get, transition, forceState, add
// ---------------------------------------------------------------------------

function makeItem(raw) {
  const d = {
    id: raw.id, file: 'test.md', tag: 'law:test', text: 'test feedback',
    source: 'quench:test-cycle', state: 'open',
    artefact_version: raw.artefact_version,
  };
  const ent = { ...d, ...raw };
  return {
    id: ent.id, file: ent.file, tag: ent.tag, text: ent.text,
    source: ent.source, artefact_version: ent.artefact_version,
    history: ent.history || [
      { state: ent.state, stage: 'quench:test-cycle',
        cycle: 'test-cycle', timestamp: new Date().toISOString() },
    ],
  };
}

function makeMockStore(initialItems = []) {
  const items = initialItems.map(makeItem);

  return {
    get(id) {
      const found = items.find(i => i.id === id);
      if (!found) return null;
      return { ...found, history: found.history.map(h => ({ ...h })) };
    },
    transition(params) {
      const found = items.find(i => i.id === params.id);
      if (!found) return { ok: false, error: `feedback item not found: ${params.id}` };
      const snapshot = { state: params.target, stage: params.stage, cycle: params.cycle };
      if (params.reason) snapshot.reason = params.reason;
      found.history.unshift({ ...snapshot, timestamp: new Date().toISOString() });
      return { ok: true };
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
      const src = params.source || 'system:forge-contract-mismatch';
      items.push({
        id: `sys-${items.length + 1}`,
        file: params.file || '',
        tag: params.tag || 'system:forge-contract-mismatch',
        text: params.text || '',
        source: src,
        artefact_version: params.artefact_version,
        history: [{ state: 'open', stage: src, cycle: params.cycle,
          timestamp: new Date().toISOString(),
        }],
      });
    },
    _items: items,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('enforceForgeContract', () => {
  // #1 — Version changed → passes
  it('version changed — passes contract and transitions item to actioned', () => {
    const store = makeMockStore([{ id: 'item-1', state: 'open' }]);

    const result = enforceForgeContract({
      item: { id: 'item-1', source: 'quench:test-cycle' },
      preVersion: 'v1',
      postVersion: 'v2',
      summary: 'fixed the artefact',
      feedbackStore: store,
      cycleId: 'test-cycle',
    });

    assert.equal(result.contractPassed, true);
    const item = store.get('item-1');
    assert.equal(item.history[0].state, 'actioned');
  });

  // #2 — Version unchanged + WONT-FIX on appraise → passes
  it('version unchanged + WONT-FIX on appraise — passes, item wont-fix with reason', () => {
    const store = makeMockStore([{ id: 'item-1', state: 'open' }]);

    const result = enforceForgeContract({
      item: { id: 'item-1', source: 'appraise:test-cycle' },
      preVersion: 'v1',
      postVersion: 'v1',
      summary: 'WONT-FIX: subjective preference, acceptable tradeoff',
      feedbackStore: store,
      cycleId: 'test-cycle',
    });

    assert.equal(result.contractPassed, true);
    const item = store.get('item-1');
    assert.equal(item.history[0].state, 'wont-fix');
    assert.equal(item.history[0].reason, 'subjective preference, acceptable tradeoff');
  });

  // #3 — Version unchanged + WONT-FIX on quench → passes
  it('version unchanged + WONT-FIX on quench — passes, item marked wont-fix', () => {
    const store = makeMockStore([{ id: 'item-1', state: 'open' }]);

    const result = enforceForgeContract({
      item: { id: 'item-1', source: 'quench:test-cycle' },
      preVersion: 'v1',
      postVersion: 'v1',
      summary: 'WONT-FIX: not a bug',
      feedbackStore: store,
      cycleId: 'test-cycle',
    });

    assert.equal(result.contractPassed, true);
  });

  // #4 — Version unchanged + no WONT-FIX → fails
  it('version unchanged + no WONT-FIX — fails, item reverted, system feedback', () => {
    const store = makeMockStore([{ id: 'item-1', state: 'open' }]);

    const result = enforceForgeContract({
      item: { id: 'item-1', source: 'quench:test-cycle' },
      preVersion: 'v1',
      postVersion: 'v1',
      summary: 'made some changes but artefacts are the same',
      feedbackStore: store,
      cycleId: 'test-cycle',
    });

    assert.equal(result.contractPassed, false);
    const item = store.get('item-1');
    assert.equal(item.history[0].state, 'open');
    const sysItems = store._items.filter(i => i.source === 'system:forge-contract-mismatch');
    assert.equal(sysItems.length, 1);
    assert.match(sysItems[0].text, /did not change artefacts and did not provide WONT-FIX/);
  });

  // #5 — No item → passes
  it('no item (null) — passes with no side-effects', () => {
    const store = makeMockStore([]);

    const result = enforceForgeContract({
      item: null,
      preVersion: 'v1',
      postVersion: 'v2',
      summary: 'irrelevant',
      feedbackStore: store,
      cycleId: 'test-cycle',
    });

    assert.equal(result.contractPassed, true);
    // No system feedback or transitions should have occurred
    assert.equal(store._items.length, 0);
  });

  // #6 — System feedback text describes the specific violation
  it('system feedback text differs per violation type', () => {
    // Violation: no WONT-FIX, no version change
    const store1 = makeMockStore([{ id: 'item-1', state: 'open' }]);
    enforceForgeContract({
      item: { id: 'item-1', source: 'quench:test-cycle' },
      preVersion: 'v1', postVersion: 'v1',
      summary: 'did some work',
      feedbackStore: store1, cycleId: 'test-cycle',
    });
    const sys1 = store1._items.find(i => i.source === 'system:forge-contract-mismatch');
    assert.match(sys1.text, /did not change artefacts/);
  });
});
