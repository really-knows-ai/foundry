// tests/forge-contract.test.js
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import yaml from 'js-yaml';
import { openFeedbackStore } from '../src/scripts/lib/feedback-store.js';
import { enforceForgeContract } from '../src/scripts/lib/forge-contract.js';
import { baseStage } from '../src/scripts/lib/sort-routing.js';
import { applyFmDefaults } from '../src/scripts/orchestrate-phases.js';

// ---------------------------------------------------------------------------
// In-memory IO shim
// ---------------------------------------------------------------------------

function mockIO(files = {}) {
  const store = { ...files };
  return {
    exists: (p) => Object.hasOwn(store, p),
    readFile: (p) => {
      if (!(p in store)) throw new Error(`ENOENT: ${p}`);
      return store[p];
    },
    writeFile: (p, c) => { store[p] = c; },
    rename: (from, to) => {
      if (!(from in store)) throw new Error(`ENOENT: ${from}`);
      store[to] = store[from];
      delete store[from];
    },
    unlink: (p) => { delete store[p]; },
    _files: store,
  };
}

// ---------------------------------------------------------------------------
// Helpers: build test fixtures
// ---------------------------------------------------------------------------

function buildItem(opts) {
  const defaults = {
    file: 'test.md', tag: 'law:test', text: 'test feedback',
    source: 'quench:test-cycle', state: 'open', cycle: 'test-cycle',
  };
  const merged = { ...defaults, ...opts };
  return {
    id: merged.id, file: merged.file, tag: merged.tag,
    text: merged.text, source: merged.source,
    artefact_version: merged.artefactVersion,
    history: [{
      state: merged.state, stage: merged.source,
      cycle: merged.cycle, timestamp: new Date().toISOString(),
    }],
  };
}

function makeFeedbackYaml(items) {
  return yaml.dump({ items });
}

function createStore(initialItems) {
  const io = mockIO();
  if (initialItems && initialItems.length > 0) {
    io.writeFile('WORK.feedback.yaml', makeFeedbackYaml(initialItems));
  }
  return { store: openFeedbackStore('WORK.feedback.yaml', io), io };
}

// ---------------------------------------------------------------------------
// enforceForgeContract — single-item contract
// ---------------------------------------------------------------------------

describe('enforceForgeContract', () => {
  // #1 — No item (null) passes
  test('no item (null) — passes with no side-effects', () => {
    const feedbackStore = {
      get: () => null,
      transition: () => { throw new Error('transition must not be called'); },
      forceState: () => { throw new Error('forceState must not be called'); },
      add: () => { throw new Error('add must not be called'); },
    };
    const result = enforceForgeContract({
      item: null,
      preVersion: 'v1', postVersion: 'v2',
      summary: 'did work',
      feedbackStore, cycleId: 'test-cycle',
    });
    assert.deepEqual(result, { contractPassed: true });
  });

  // #2 — No item (undefined) passes
  test('no item (undefined) — passes with no side-effects', () => {
    const feedbackStore = {
      get: () => null,
      transition: () => { throw new Error('transition must not be called'); },
      forceState: () => { throw new Error('forceState must not be called'); },
      add: () => { throw new Error('add must not be called'); },
    };
    const result = enforceForgeContract({
      item: undefined,
      preVersion: 'v1', postVersion: 'v2',
      summary: 'did work',
      feedbackStore, cycleId: 'test-cycle',
    });
    assert.deepEqual(result, { contractPassed: true });
  });

  // #3 — Version changed → actioned
  test('version changed — transitions item to actioned', () => {
    const { store } = createStore([
      buildItem({ id: 'item-1', state: 'open', source: 'quench:test-cycle' }),
    ]);

    const result = enforceForgeContract({
      item: { id: 'item-1', source: 'quench:test-cycle' },
      preVersion: 'v1',
      postVersion: 'v2',
      summary: 'fixed the issue',
      feedbackStore: store,
      cycleId: 'test-cycle',
    });

    assert.deepEqual(result, { contractPassed: true });
    const item = store.get('item-1');
    assert.equal(item.history[0].state, 'actioned');
    assert.equal(item.history[0].stage, 'forge:test-cycle');
  });

  // #4 — Version unchanged + WONT-FIX + appraise source → wont-fix
  test('version unchanged + WONT-FIX + appraise source — transitions to wont-fix with reason', () => {
    const { store } = createStore([
      buildItem({ id: 'item-1', state: 'open', source: 'appraise:test-cycle' }),
    ]);

    const result = enforceForgeContract({
      item: { id: 'item-1', source: 'appraise:test-cycle' },
      preVersion: 'v1',
      postVersion: 'v1',
      summary: 'WONT-FIX: this is a subjective preference, not a bug',
      feedbackStore: store,
      cycleId: 'test-cycle',
    });

    assert.deepEqual(result, { contractPassed: true });
    const item = store.get('item-1');
    assert.equal(item.history[0].state, 'wont-fix');
    assert.equal(item.history[0].reason, 'this is a subjective preference, not a bug');
  });

  // #5 — Version unchanged + WONT-FIX + quench source → violation
  test('version unchanged + WONT-FIX + quench source — contract violation, item reverted', () => {
    const { store, io } = createStore([
      buildItem({ id: 'item-1', state: 'open', source: 'quench:test-cycle' }),
    ]);

    const result = enforceForgeContract({
      item: { id: 'item-1', source: 'quench:test-cycle' },
      preVersion: 'v1',
      postVersion: 'v1',
      summary: 'WONT-FIX: nope',
      feedbackStore: store,
      cycleId: 'test-cycle',
    });

    assert.deepEqual(result, { contractPassed: false });
    const item = store.get('item-1');
    assert.equal(item.history[0].state, 'open');
    // System feedback should have been posted
    const raw = io.readFile('WORK.feedback.yaml');
    const data = yaml.load(raw);
    const sysItems = data.items.filter(it => it.source === 'system:forge-contract-mismatch');
    assert.equal(sysItems.length, 1);
    assert.match(sysItems[0].text, /wont-fix not allowed on quench-sourced item/);
  });

  // #6 — Version unchanged + WONT-FIX + human-appraise source → violation
  test('version unchanged + WONT-FIX + human-appraise source — contract violation', () => {
    const { store, io } = createStore([
      buildItem({ id: 'item-1', state: 'open', source: 'human-appraise:test-cycle' }),
    ]);

    const result = enforceForgeContract({
      item: { id: 'item-1', source: 'human-appraise:test-cycle' },
      preVersion: 'v1',
      postVersion: 'v1',
      summary: 'WONT-FIX: no',
      feedbackStore: store,
      cycleId: 'test-cycle',
    });

    assert.deepEqual(result, { contractPassed: false });
    const raw = io.readFile('WORK.feedback.yaml');
    const data = yaml.load(raw);
    const sysItems = data.items.filter(it => it.source === 'system:forge-contract-mismatch');
    assert.match(sysItems[0].text, /wont-fix not allowed on human-appraise-sourced item/);
  });

  // #7 — Version unchanged + no WONT-FIX → violation
  test('version unchanged + no WONT-FIX — contract violation, item reverted', () => {
    const { store, io } = createStore([
      buildItem({ id: 'item-1', state: 'open', source: 'quench:test-cycle' }),
    ]);

    const result = enforceForgeContract({
      item: { id: 'item-1', source: 'quench:test-cycle' },
      preVersion: 'v1',
      postVersion: 'v1',
      summary: 'did some work but no change',
      feedbackStore: store,
      cycleId: 'test-cycle',
    });

    assert.deepEqual(result, { contractPassed: false });
    const item = store.get('item-1');
    assert.equal(item.history[0].state, 'open');
    const raw = io.readFile('WORK.feedback.yaml');
    const data = yaml.load(raw);
    const sysItems = data.items.filter(it => it.source === 'system:forge-contract-mismatch');
    assert.match(sysItems[0].text, /did not change artefacts and did not provide WONT-FIX/);
  });

  // #8 — Transition failure on store
  test('transition failure — contract violation with system feedback', () => {
    const { store } = createStore([
      buildItem({ id: 'item-1', state: 'open', source: 'quench:test-cycle' }),
    ]);
    // Replace transition with a failing version
    store.transition = () => ({ ok: false, error: 'store is locked' });

    const result = enforceForgeContract({
      item: { id: 'item-1', source: 'quench:test-cycle' },
      preVersion: 'v1',
      postVersion: 'v2',
      summary: 'fixed',
      feedbackStore: store,
      cycleId: 'test-cycle',
    });

    assert.deepEqual(result, { contractPassed: false });
    // Item should still be open after forceState
    const item = store.get('item-1');
    assert.equal(item.history[0].state, 'open');
  });

  // #9 — System feedback has correct metadata
  test('system feedback has correct metadata on violation', () => {
    const { store, io } = createStore([
      buildItem({ id: 'item-1', state: 'open', source: 'quench:test-cycle' }),
    ]);

    enforceForgeContract({
      item: { id: 'item-1', source: 'quench:test-cycle' },
      preVersion: 'v1',
      postVersion: 'v1',
      summary: 'no change',
      feedbackStore: store,
      cycleId: 'test-cycle',
    });

    const raw = io.readFile('WORK.feedback.yaml');
    const data = yaml.load(raw);
    const systemItems = data.items.filter(it => it.source === 'system:forge-contract-mismatch');
    assert.equal(systemItems.length, 1);
    assert.equal(systemItems[0].file, '');
    assert.equal(systemItems[0].tag, 'system:forge-contract-mismatch');
    assert.equal(systemItems[0].source, 'system:forge-contract-mismatch');
    assert.equal(systemItems[0].artefact_version, 'v1');
    assert.equal(systemItems[0].history[0].state, 'open');
    assert.equal(systemItems[0].history[0].stage, 'system:forge-contract-mismatch');
  });

  // #10 — ForceState only affects the target item
  test('forceState only affects the target item — other store items unchanged', () => {
    const { store } = createStore([
      buildItem({ id: 'target-1', state: 'actioned', source: 'quench:test-cycle' }),
      buildItem({ id: 'other-1', state: 'actioned', source: 'quench:test-cycle' }),
    ]);

    enforceForgeContract({
      item: { id: 'target-1', source: 'quench:test-cycle' },
      preVersion: 'v1',
      postVersion: 'v1',
      summary: 'no change',
      feedbackStore: store,
      cycleId: 'test-cycle',
    });

    const targetItem = store.get('target-1');
    assert.equal(targetItem.history[0].state, 'open');
    const otherItem = store.get('other-1');
    assert.equal(otherItem.history[0].state, 'actioned', 'non-target item should retain its state');
  });
});

// ---------------------------------------------------------------------------
// forceState
// ---------------------------------------------------------------------------

describe('forceState', () => {
  test('sets item to open regardless of current state', () => {
    const { store } = createStore([
      buildItem({ id: 'item-1', state: 'actioned' }),
    ]);
    const result = store.forceState('item-1', 'open', 'test-cycle');
    assert.deepEqual(result, { ok: true });
    const item = store.get('item-1');
    assert.equal(item.history[0].state, 'open');
  });

  test('history entry has stage system:forge-contract-mismatch', () => {
    const { store } = createStore([
      buildItem({ id: 'item-1', state: 'actioned' }),
    ]);
    store.forceState('item-1', 'open', 'test-cycle');
    const item = store.get('item-1');
    assert.equal(item.history[0].stage, 'system:forge-contract-mismatch');
    assert.match(item.history[0].timestamp, /^\d{4}-\d{2}-\d{2}T/);
  });

  test('returns error for non-existent id', () => {
    const { store } = createStore([]);
    const result = store.forceState('nonexistent', 'open', 'test-cycle');
    assert.deepEqual(result, { ok: false, error: 'feedback item not found: nonexistent' });
  });

  test('does not affect other items', () => {
    const { store } = createStore([
      buildItem({ id: 'item-1', state: 'actioned' }),
      buildItem({ id: 'item-2', state: 'wont-fix' }),
    ]);
    store.forceState('item-1', 'open', 'test-cycle');
    const item2 = store.get('item-2');
    assert.equal(item2.history[0].state, 'wont-fix');
  });
});

// ---------------------------------------------------------------------------
// feedback store with system source
// ---------------------------------------------------------------------------

describe('feedback store with system source', () => {
  test('add accepts system:forge-contract-mismatch source and artefact_version', () => {
    const { store } = createStore([]);
    const result = store.add({
      file: '',
      tag: 'system:forge-contract-mismatch',
      text: 'test system feedback',
      source: 'system:forge-contract-mismatch',
      artefact_version: 'a1b2c3d4e5f6',
      cycle: 'test-cycle',
    });
    assert.equal(result.deduped, false);
    assert.equal(typeof result.id, 'string');
    const items = store.list();
    const sysItem = items.find(it => it.source === 'system:forge-contract-mismatch');
    assert.ok(sysItem);
    assert.equal(sysItem.artefact_version, 'a1b2c3d4e5f6');
  });

  test('accepts any system:alias format', () => {
    const { store } = createStore([]);
    const result = store.add({
      file: '',
      tag: 'system:other-purpose',
      text: 'other system feedback',
      source: 'system:other-purpose',
      cycle: 'test-cycle',
    });
    assert.equal(result.deduped, false);
  });

  test('rejects bare system without colon', () => {
    const { store } = createStore([]);
    assert.throws(
      () => store.add({
        file: '',
        tag: 'system',
        text: 'bare system',
        source: 'system',
        cycle: 'test-cycle',
      }),
      /source must be in 'base:alias' form/,
    );
  });

  test('created item has file empty string', () => {
    const { store } = createStore([]);
    store.add({
      file: '',
      tag: 'system:forge-contract-mismatch',
      text: 'test',
      source: 'system:forge-contract-mismatch',
      cycle: 'test-cycle',
    });
    const items = store.list();
    const sysItem = items.find(it => it.source === 'system:forge-contract-mismatch');
    assert.equal(sysItem.file, '');
  });

  test('history stage stores the full source string', () => {
    const { store } = createStore([]);
    store.add({
      file: '',
      tag: 'system:forge-contract-mismatch',
      text: 'test',
      source: 'system:forge-contract-mismatch',
      cycle: 'test-cycle',
    });
    const items = store.list();
    const sysItem = items.find(it => it.source === 'system:forge-contract-mismatch');
    assert.equal(sysItem.history[0].stage, 'system:forge-contract-mismatch');
  });
});

// ---------------------------------------------------------------------------
// forgeCount routing
// ---------------------------------------------------------------------------

describe('forgeCount routing', () => {
  function computeForgeCount(history) {
    return history.filter(e =>
      baseStage(e.stage || '') === 'forge' && e.contract_passed !== false,
    ).length;
  }

  test('counts entries with contract_passed: true', () => {
    const history = [
      { stage: 'forge:c1', contract_passed: true },
    ];
    assert.equal(computeForgeCount(history), 1);
  });

  test('excludes entries with contract_passed: false', () => {
    const history = [
      { stage: 'forge:c1', contract_passed: true },
      { stage: 'forge:c1', contract_passed: false },
    ];
    assert.equal(computeForgeCount(history), 1);
  });

  test('includes legacy entries without contract_passed field', () => {
    const history = [
      { stage: 'forge:c1' },
      { stage: 'forge:c1', contract_passed: true },
    ];
    assert.equal(computeForgeCount(history), 2);
  });

  test('does not count non-forge entries', () => {
    const history = [
      { stage: 'quench:c1', contract_passed: true },
      { stage: 'forge:c1', contract_passed: true },
      { stage: 'appraise:c1' },
    ];
    assert.equal(computeForgeCount(history), 1);
  });

  test('returns 0 for empty history', () => {
    assert.equal(computeForgeCount([]), 0);
  });

  test('excludes false but includes undefined, true, and absent', () => {
    const history = [
      { stage: 'forge:c1', contract_passed: false },
      { stage: 'forge:c1', contract_passed: true },
      { stage: 'forge:c1', contract_passed: undefined },
      { stage: 'forge:c1' },
    ];
    assert.equal(computeForgeCount(history), 3);
  });
});

// ---------------------------------------------------------------------------
// applyFmDefaults
// ---------------------------------------------------------------------------

describe('applyFmDefaults', () => {
  const assayExtractors = null;

  test('deadlock-human-appraise defaults to false when absent', () => {
    const newFm = {};
    applyFmDefaults(newFm, {}, assayExtractors);
    assert.equal(newFm['deadlock-human-appraise'], false);
  });

  test('deadlock-human-appraise is true when explicitly true', () => {
    const newFm = {};
    applyFmDefaults(newFm, { 'deadlock-human-appraise': true }, assayExtractors);
    assert.equal(newFm['deadlock-human-appraise'], true);
  });

  test('deadlock-human-appraise is false when explicitly false', () => {
    const newFm = {};
    applyFmDefaults(newFm, { 'deadlock-human-appraise': false }, assayExtractors);
    assert.equal(newFm['deadlock-human-appraise'], false);
  });

  test('always-human-appraise defaults to false', () => {
    const newFm = {};
    applyFmDefaults(newFm, {}, assayExtractors);
    assert.equal(newFm['always-human-appraise'], false);
  });

  test('max-iterations defaults to 3', () => {
    const newFm = {};
    applyFmDefaults(newFm, {}, assayExtractors);
    assert.equal(newFm['max-iterations'], 3);
  });
});
