// tests/run-executors.test.js
// Unit tests for run-executors.js functions, including selectForgeFeedback,
// executeForge feedback injection, and finalizeForgeOutcome contract wiring.

import { mock, test, describe } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// Module mocks for executeForge tests
// ---------------------------------------------------------------------------

const mockForgeDispatch = mock.fn();
const mockOpenFeedbackStore = mock.fn();
const mockGetCycleDefinition = mock.fn();
const mockComputeArtefactVersion = mock.fn();

mock.module('../src/scripts/lib/forge-dispatch.js', {
  namedExports: { forgeDispatch: mockForgeDispatch },
});

mock.module('../src/scripts/lib/feedback-store.js', {
  namedExports: { openFeedbackStore: mockOpenFeedbackStore },
});

// Note: only forge-dispatch.js is mocked to avoid sub-process spawning.
// Other dependencies (config, artefacts, state, feedback-store, etc.) use
// their real implementations in this test file.

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeItem(overrides = {}) {
  const defaults = {
    id: '01HXY8K9Q5Z3WN0GJM2TYBR4AA',
    state: 'open',
    timestamp: '2025-01-01T00:00:00.000Z',
    file: 'test.md',
    text: 'test feedback',
    source: 'quench:test-cycle',
    tag: 'law:test',
    artefact_version: '',
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
      state: merged.state,
      stage: merged.source,
      cycle: 'test-cycle',
      timestamp: merged.timestamp,
    }],
  };
}

function mockStore(items = []) {
  const clone = i => ({ ...i, history: i.history.map(h => ({ ...h })) });
  const _items = items.map(clone);
  return {
    list() { return _items.map(clone); },
    get(id) { const it = _items.find(x => x.id === id); return it ? clone(it) : null; },
    add(params) { _items.push({ ...params, id: 'mock-id', history: [{ state: 'open', stage: params.source, cycle: params.cycle, timestamp: new Date().toISOString() }] }); return { id: 'mock-id', deduped: false }; },
    transition(params) {
      const idx = _items.findIndex(x => x.id === params.id);
      if (idx === -1) return { ok: false, error: 'not found' };
      _items[idx].history.unshift({
        state: params.target, stage: params.stage,
        cycle: params.cycle, timestamp: new Date().toISOString(),
        reason: params.reason,
      });
      return { ok: true };
    },
    forceState(id, state, cycle, stage) {
      const idx = _items.findIndex(x => x.id === id);
      if (idx === -1) return { ok: false, error: 'not found' };
      _items[idx].history.unshift({ state, stage: stage || 'system:test', cycle, timestamp: new Date().toISOString() });
      return { ok: true };
    },
    autoResolve() { return { ok: true }; },
    resolveSystemItems() {},
  };
}

function mockIo() {
  const store = {};
  return {
    exists: (p) => Object.hasOwn(store, p),
    readFile: (p) => {
      if (!(p in store)) throw new Error(`ENOENT: ${p}`);
      return store[p];
    },
    writeFile: (p, c) => { store[p] = c; },
    rename: (from, to) => { store[to] = store[from]; delete store[from]; },
    unlink: (p) => { delete store[p]; },
    mkdir: () => {},
    readDir: () => [],
    exec: () => '',
  };
}

// ---------------------------------------------------------------------------
// Import the target module once — shared by all test groups.
// ---------------------------------------------------------------------------

let selectForgeFeedbackFn;
let finalizeForgeOutcomeFn;
let executeForgeFn;

test.before(async () => {
  const mod = await import('../src/scripts/run-executors.js');
  selectForgeFeedbackFn = mod.selectForgeFeedback;
  finalizeForgeOutcomeFn = mod.finalizeForgeOutcome;
  executeForgeFn = mod.executeForge;
});

// ---------------------------------------------------------------------------
// D1 — selectForgeFeedback
// ---------------------------------------------------------------------------

describe('selectForgeFeedback', () => {

  test('returns null when the store is empty', () => {
    const store = mockStore([]);
    assert.equal(selectForgeFeedbackFn(store), null);
  });

  test('returns null when all items are resolved', () => {
    const store = mockStore([
      makeItem({ id: 'a', state: 'resolved', timestamp: '2025-01-01T00:00:00.000Z' }),
      makeItem({ id: 'b', state: 'resolved', timestamp: '2025-01-02T00:00:00.000Z' }),
    ]);
    assert.equal(selectForgeFeedbackFn(store), null);
  });

  test('returns the only open item', () => {
    const items = [makeItem({ id: 'a', state: 'open', timestamp: '2025-01-01T00:00:00.000Z' })];
    const store = mockStore(items);
    const result = selectForgeFeedbackFn(store);
    assert.notEqual(result, null);
    assert.equal(result.id, 'a');
    assert.equal(result.history[0].state, 'open');
  });

  test('returns the oldest open item when multiple exist', () => {
    const items = [
      makeItem({ id: 'old', state: 'open', timestamp: '2025-01-01T00:00:00.000Z' }),
      makeItem({ id: 'mid', state: 'open', timestamp: '2025-01-02T00:00:00.000Z' }),
      makeItem({ id: 'new', state: 'open', timestamp: '2025-01-03T00:00:00.000Z' }),
    ];
    const store = mockStore(items);
    const result = selectForgeFeedbackFn(store);
    assert.notEqual(result, null);
    assert.equal(result.id, 'old');
  });

  test('returns a rejected item (forge retries it)', () => {
    const items = [makeItem({ id: 'a', state: 'rejected', timestamp: '2025-01-01T00:00:00.000Z' })];
    const store = mockStore(items);
    const result = selectForgeFeedbackFn(store);
    assert.notEqual(result, null);
    assert.equal(result.id, 'a');
    assert.equal(result.history[0].state, 'rejected');
  });

  test('prefers open over rejected when timestamps are same', () => {
    const ts = '2025-01-01T00:00:00.000Z';
    const items = [
      makeItem({ id: 'b-rejected', state: 'rejected', timestamp: ts }),
      makeItem({ id: 'a-open',     state: 'open',     timestamp: ts }),
    ];
    const store = mockStore(items);
    const result = selectForgeFeedbackFn(store);
    assert.notEqual(result, null);
    assert.equal(result.id, 'a-open');
  });

  test('ignores actioned, wont-fix, resolved, deadlocked items', () => {
    const items = [
      makeItem({ id: 'a', state: 'actioned',  timestamp: '2025-01-01T00:00:00.000Z' }),
      makeItem({ id: 'b', state: 'wont-fix',  timestamp: '2025-01-02T00:00:00.000Z' }),
      makeItem({ id: 'c', state: 'resolved',  timestamp: '2025-01-03T00:00:00.000Z' }),
      makeItem({ id: 'd', state: 'deadlocked', timestamp: '2025-01-04T00:00:00.000Z' }),
    ];
    const store = mockStore(items);
    assert.equal(selectForgeFeedbackFn(store), null);
  });

  test('selects oldest open/rejected among mixed states', () => {
    const items = [
      makeItem({ id: 'a', state: 'open',     timestamp: '2025-01-03T00:00:00.000Z' }),
      makeItem({ id: 'b', state: 'rejected', timestamp: '2025-01-01T00:00:00.000Z' }),
      makeItem({ id: 'c', state: 'resolved', timestamp: '2025-01-02T00:00:00.000Z' }),
    ];
    const store = mockStore(items);
    const result = selectForgeFeedbackFn(store);
    assert.notEqual(result, null);
    assert.equal(result.id, 'b');
  });
});

// ---------------------------------------------------------------------------
// D3 — finalizeForgeOutcome
//
// We test with the real enforceForgeContract, appendEntry, and
// buildForgeHistoryEntry. The mock store handles transitions, and the
// mock IO discards writes, so there are no side-effects.
// ---------------------------------------------------------------------------

describe('finalizeForgeOutcome — contract wiring', () => {

  test('passes the forge item to enforceForgeContract and transitions on version change', () => {
    const forgeItem = makeItem({ id: 'item-1', artefact_version: 'abc123', source: 'quench:test-cycle' });
    const store = mockStore([forgeItem]);

    const result = finalizeForgeOutcomeFn({
      cycleId: 'test-cycle',
      historyPath: 'WORK.history.yaml',
      io: mockIo(),
      stageOutputLines: [{ status: 'actioned' }],
      store,
      arV: 'new-version',
      route: 'forge:test-cycle',
      forgeItem,
    });

    assert.equal(result.ok, true);
    // The contract should have transitioned the item to actioned
    const updatedItem = store.get('item-1');
    assert.equal(updatedItem.history[0].state, 'actioned');
  });

  test('passes null item when no forge item is provided — contract is a no-op', () => {
    const store = mockStore([]);

    const result = finalizeForgeOutcomeFn({
      cycleId: 'test-cycle',
      historyPath: 'WORK.history.yaml',
      io: mockIo(),
      stageOutputLines: [{ status: 'done' }],
      store,
      arV: '',
      route: 'forge:test-cycle',
      forgeItem: undefined,
    });

    assert.equal(result.ok, true);
    // No items to transition — contract passed as no-op
  });

  test('passes empty preVersion when forge item has no artefact_version', () => {
    const forgeItem = makeItem({ id: 'item-2', source: 'quench:test-cycle' });
    delete forgeItem.artefact_version;
    const store = mockStore([forgeItem]);

    const result = finalizeForgeOutcomeFn({
      cycleId: 'test-cycle',
      historyPath: 'WORK.history.yaml',
      io: mockIo(),
      stageOutputLines: [{ status: 'actioned' }],
      store,
      arV: 'v2',
      route: 'forge:test-cycle',
      forgeItem,
    });

    assert.equal(result.ok, true);
    // With empty preVersion and a non-empty postVersion, version changed → actioned
    const updatedItem = store.get('item-2');
    assert.equal(updatedItem.history[0].state, 'actioned');
  });
});

// ---------------------------------------------------------------------------
// D2 — executeForge feedback injection
// ---------------------------------------------------------------------------

describe('executeForge — feedback injection', () => {

  test.beforeEach(() => {
    mockForgeDispatch.mock.resetCalls();
  });

  /** Create a mock IO pre-populated with a cycle definition. */
  function makeForgeIo() {
    const io = mockIo();
    io.writeFile('foundry/cycles/test-cycle.md', [
      '---',
      'output-type: haiku',
      'models:',
      '  forge: ""',
      '---',
      '',
    ].join('\n'));
    return io;
  }

  function makeBaseOpts(io) {
    return {
      sort: { route: 'forge:test-cycle', cycleId: 'test-cycle', token: '' },
      io,
      worktree: '/tmp',
      historyPath: 'WORK.history.yaml',
      feedbackPath: '.foundry/feedback.yaml',
      cwd: '/tmp',
      cycleId: 'test-cycle',
    };
  }

  test('injects selected forgeItem into dispatch prompt when open item exists', async () => {
    const io = makeForgeIo();
    const items = [makeItem({ id: 'item-1', file: 'test.md', text: 'test feedback', source: 'quench:test-cycle' })];
    mockOpenFeedbackStore.mock.mockImplementation(() => mockStore(items));

    let capturedItem = null;
    mockForgeDispatch.mock.mockImplementation(({ dispatchPrompt }) => {
      capturedItem = dispatchPrompt.forgeItem;
      return Promise.resolve({ stageOutputLines: [{ status: 'actioned' }] });
    });

    const result = await executeForgeFn(makeBaseOpts(io));
    assert.ok(result.ok);
    assert.notEqual(capturedItem, null);
    assert.equal(capturedItem.id, 'item-1');
  });

  test('passes null forgeItem when no open or rejected items exist', async () => {
    const io = makeForgeIo();
    mockOpenFeedbackStore.mock.mockImplementation(() => mockStore([]));

    let capturedItem = 'not-yet-set';
    mockForgeDispatch.mock.mockImplementation(({ dispatchPrompt }) => {
      capturedItem = dispatchPrompt.forgeItem;
      return Promise.resolve({ stageOutputLines: [{ status: 'actioned' }] });
    });

    const result = await executeForgeFn(makeBaseOpts(io));
    assert.ok(result.ok);
    assert.equal(capturedItem, null);
  });

  test('includes item details (id, file, text, source) in forgeItem', async () => {
    const io = makeForgeIo();
    const items = [makeItem({ id: 'fb-1', file: 'haiku/a.md', text: 'too dark', source: 'quench:test-cycle' })];
    mockOpenFeedbackStore.mock.mockImplementation(() => mockStore(items));

    let capturedItem = null;
    mockForgeDispatch.mock.mockImplementation(({ dispatchPrompt }) => {
      capturedItem = dispatchPrompt.forgeItem;
      return Promise.resolve({ stageOutputLines: [{ status: 'actioned' }] });
    });

    const result = await executeForgeFn(makeBaseOpts(io));
    assert.ok(result.ok);
    assert.equal(capturedItem.id, 'fb-1');
    assert.equal(capturedItem.file, 'haiku/a.md');
    assert.equal(capturedItem.text, 'too dark');
    assert.equal(capturedItem.source, 'quench:test-cycle');
  });
});
