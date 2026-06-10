// tests/lib/appraise-consensus.test.js
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeConsensus,
  collectAddressedItems,
  readConsensusConfig,
} from '../../src/scripts/lib/appraise-consensus.js';

// ── D3.1: computeConsensus ────────────────────────────────────────────

describe('computeConsensus — unanimous mode', () => {
  test('all resolved → resolved', () => {
    const result = computeConsensus([
      { appraiser: 'a1', verdict: 'resolved' },
      { appraiser: 'a2', verdict: 'resolved' },
    ], 'unanimous');
    assert.equal(result.outcome, 'resolved');
    assert.equal(result.resolved, 2);
    assert.equal(result.rejected, 0);
  });

  test('one rejected among resolved → rejected', () => {
    const result = computeConsensus([
      { appraiser: 'a1', verdict: 'resolved' },
      { appraiser: 'a2', verdict: 'rejected' },
      { appraiser: 'a3', verdict: 'resolved' },
    ], 'unanimous');
    assert.equal(result.outcome, 'rejected');
    assert.equal(result.resolved, 2);
    assert.equal(result.rejected, 1);
  });

  test('all rejected → rejected', () => {
    const result = computeConsensus([
      { appraiser: 'a1', verdict: 'rejected' },
      { appraiser: 'a2', verdict: 'rejected' },
    ], 'unanimous');
    assert.equal(result.outcome, 'rejected');
    assert.equal(result.resolved, 0);
    assert.equal(result.rejected, 2);
  });
});

describe('computeConsensus — majority mode', () => {
  test('3 resolved, 1 rejected → resolved', () => {
    const result = computeConsensus([
      { appraiser: 'a1', verdict: 'resolved' },
      { appraiser: 'a2', verdict: 'resolved' },
      { appraiser: 'a3', verdict: 'resolved' },
      { appraiser: 'a4', verdict: 'rejected' },
    ], 'majority');
    assert.equal(result.outcome, 'resolved');
    assert.equal(result.resolved, 3);
    assert.equal(result.rejected, 1);
  });

  test('2 resolved, 2 rejected → rejected (tie)', () => {
    const result = computeConsensus([
      { appraiser: 'a1', verdict: 'resolved' },
      { appraiser: 'a2', verdict: 'resolved' },
      { appraiser: 'a3', verdict: 'rejected' },
      { appraiser: 'a4', verdict: 'rejected' },
    ], 'majority');
    assert.equal(result.outcome, 'rejected');
    assert.equal(result.resolved, 2);
    assert.equal(result.rejected, 2);
  });

  test('1 resolved, 3 rejected → rejected', () => {
    const result = computeConsensus([
      { appraiser: 'a1', verdict: 'resolved' },
      { appraiser: 'a2', verdict: 'rejected' },
      { appraiser: 'a3', verdict: 'rejected' },
      { appraiser: 'a4', verdict: 'rejected' },
    ], 'majority');
    assert.equal(result.outcome, 'rejected');
    assert.equal(result.resolved, 1);
    assert.equal(result.rejected, 3);
  });
});

describe('computeConsensus — any mode', () => {
  test('1 resolved, 3 rejected → resolved', () => {
    const result = computeConsensus([
      { appraiser: 'a1', verdict: 'resolved' },
      { appraiser: 'a2', verdict: 'rejected' },
      { appraiser: 'a3', verdict: 'rejected' },
      { appraiser: 'a4', verdict: 'rejected' },
    ], 'any');
    assert.equal(result.outcome, 'resolved');
    assert.equal(result.resolved, 1);
    assert.equal(result.rejected, 3);
  });

  test('all rejected → rejected', () => {
    const result = computeConsensus([
      { appraiser: 'a1', verdict: 'rejected' },
      { appraiser: 'a2', verdict: 'rejected' },
    ], 'any');
    assert.equal(result.outcome, 'rejected');
    assert.equal(result.resolved, 0);
    assert.equal(result.rejected, 2);
  });

  test('0 resolved, 0 rejected (empty) → resolved', () => {
    const result = computeConsensus([], 'any');
    assert.equal(result.outcome, 'resolved');
    assert.equal(result.resolved, 0);
    assert.equal(result.rejected, 0);
  });
});

describe('computeConsensus — empty verdicts', () => {
  test('empty array returns resolved regardless of mode', () => {
    for (const mode of ['unanimous', 'majority', 'any']) {
      const result = computeConsensus([], mode);
      assert.equal(result.outcome, 'resolved');
      assert.equal(result.resolved, 0);
      assert.equal(result.rejected, 0);
    }
  });
});

describe('computeConsensus — default mode fallback', () => {
  test('null mode defaults to unanimous', () => {
    const result = computeConsensus([
      { appraiser: 'a1', verdict: 'resolved' },
      { appraiser: 'a2', verdict: 'rejected' },
    ], null);
    assert.equal(result.outcome, 'rejected');
  });

  test('undefined mode defaults to unanimous', () => {
    const result = computeConsensus([
      { appraiser: 'a1', verdict: 'resolved' },
      { appraiser: 'a2', verdict: 'resolved' },
    ], undefined);
    assert.equal(result.outcome, 'resolved');
  });

  test('unknown mode string defaults to unanimous', () => {
    const result = computeConsensus([
      { appraiser: 'a1', verdict: 'resolved' },
      { appraiser: 'a2', verdict: 'rejected' },
    ], 'consensus');
    assert.equal(result.outcome, 'rejected');
  });
});

describe('computeConsensus — unknown verdict values', () => {
  test('unknown verdict string is counted as rejected', () => {
    const result = computeConsensus([
      { appraiser: 'a1', verdict: 'resolved' },
      { appraiser: 'a2', verdict: 'unknown' },
    ], 'unanimous');
    assert.equal(result.outcome, 'rejected');
    assert.equal(result.resolved, 1);
    assert.equal(result.rejected, 1);
  });

  test('missing verdict field is counted as rejected', () => {
    const result = computeConsensus([
      { appraiser: 'a1', verdict: 'resolved' },
      { appraiser: 'a2' },
    ], 'unanimous');
    assert.equal(result.outcome, 'rejected');
    assert.equal(result.resolved, 1);
    assert.equal(result.rejected, 1);
  });
});

// ── D3.2: collectAddressedItems ───────────────────────────────────────

function makeFeedbackItem(overrides = {}) {
  const defaults = {
    id: 'item-001',
    file: 'src/test.js',
    tag: 'law:test',
    text: 'some feedback',
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
      stage: merged.source,
      cycle: merged.cycle || 'test-cycle',
      timestamp: '2025-01-01T00:00:00.000Z',
    }],
  };
}

function mockStore(items) {
  return { list() { return items.map(i => ({ ...i, history: i.history.map(h => ({ ...h })) })); } };
}

describe('collectAddressedItems', () => {
  test('returns items in actioned state', () => {
    const items = [
      makeFeedbackItem({ id: '1', state: 'actioned', cycle: 'test-cycle' }),
    ];
    const result = collectAddressedItems(mockStore(items), 'test-cycle');
    assert.equal(result.length, 1);
    assert.equal(result[0].id, '1');
  });

  test('returns items in wont-fix state', () => {
    const items = [
      makeFeedbackItem({ id: '1', state: 'wont-fix', cycle: 'test-cycle' }),
    ];
    const result = collectAddressedItems(mockStore(items), 'test-cycle');
    assert.equal(result.length, 1);
    assert.equal(result[0].id, '1');
  });

  test('excludes items in open state', () => {
    const items = [
      makeFeedbackItem({ id: '1', state: 'open', cycle: 'test-cycle' }),
    ];
    const result = collectAddressedItems(mockStore(items), 'test-cycle');
    assert.equal(result.length, 0);
  });

  test('excludes items in rejected state', () => {
    const items = [
      makeFeedbackItem({ id: '1', state: 'rejected', cycle: 'test-cycle' }),
    ];
    const result = collectAddressedItems(mockStore(items), 'test-cycle');
    assert.equal(result.length, 0);
  });

  test('excludes items in resolved state', () => {
    const items = [
      makeFeedbackItem({ id: '1', state: 'resolved', cycle: 'test-cycle' }),
    ];
    const result = collectAddressedItems(mockStore(items), 'test-cycle');
    assert.equal(result.length, 0);
  });

  test('excludes deadlocked items', () => {
    const items = [
      makeFeedbackItem({ id: '1', state: 'deadlocked', cycle: 'test-cycle' }),
    ];
    const result = collectAddressedItems(mockStore(items), 'test-cycle');
    assert.equal(result.length, 0);
  });

  test('excludes items from other cycles', () => {
    const items = [
      makeFeedbackItem({ id: '1', state: 'actioned', cycle: 'other-cycle' }),
      makeFeedbackItem({ id: '2', state: 'actioned', cycle: 'test-cycle' }),
    ];
    const result = collectAddressedItems(mockStore(items), 'test-cycle');
    assert.equal(result.length, 1);
    assert.equal(result[0].id, '2');
  });

  test('returns empty array when no eligible items exist', () => {
    const items = [
      makeFeedbackItem({ id: '1', state: 'open', cycle: 'test-cycle' }),
      makeFeedbackItem({ id: '2', state: 'resolved', cycle: 'test-cycle' }),
    ];
    const result = collectAddressedItems(mockStore(items), 'test-cycle');
    assert.deepEqual(result, []);
  });

  test('includes items from any source stage (forge, quench, appraise)', () => {
    const items = [
      makeFeedbackItem({ id: '1', state: 'actioned', source: 'forge:test-cycle', cycle: 'test-cycle' }),
      makeFeedbackItem({ id: '2', state: 'actioned', source: 'quench:test-cycle', cycle: 'test-cycle' }),
      makeFeedbackItem({ id: '3', state: 'wont-fix', source: 'appraise:test-cycle', cycle: 'test-cycle' }),
    ];
    const result = collectAddressedItems(mockStore(items), 'test-cycle');
    assert.equal(result.length, 3);
  });
});

// ── D3.3: readConsensusConfig ─────────────────────────────────────────

function frontmatterToYaml(fm) {
  return Object.entries(fm).map(function([k, v]) { return k + ': ' + v; }).join('\n');
}

function makeIo(frontmatter) {
  const body = '---\n' + frontmatterToYaml(frontmatter) + '\n---\n\n# Cycle\n';
  return {
    exists: async function() { return true; },
    readFile: async function() { return body; },
  };
}

describe('readConsensusConfig', () => {
  test('reads unanimous from valid frontmatter', async () => {
    const io = makeIo({ id: 'test-cycle', name: 'Test', 'output-type': 'doc', 'appraise-consensus': 'unanimous' });
    const result = await readConsensusConfig('foundry', 'test-cycle', io);
    assert.equal(result, 'unanimous');
  });

  test('reads majority from valid frontmatter', async () => {
    const io = makeIo({ id: 'test-cycle', name: 'Test', 'output-type': 'doc', 'appraise-consensus': 'majority' });
    const result = await readConsensusConfig('foundry', 'test-cycle', io);
    assert.equal(result, 'majority');
  });

  test('reads any from valid frontmatter', async () => {
    const io = makeIo({ id: 'test-cycle', name: 'Test', 'output-type': 'doc', 'appraise-consensus': 'any' });
    const result = await readConsensusConfig('foundry', 'test-cycle', io);
    assert.equal(result, 'any');
  });

  test('defaults to unanimous when field is absent', async () => {
    const io = makeIo({ id: 'test-cycle', name: 'Test', 'output-type': 'doc' });
    const result = await readConsensusConfig('foundry', 'test-cycle', io);
    assert.equal(result, 'unanimous');
  });

  test('defaults to unanimous when field is an invalid string', async () => {
    const io = makeIo({ id: 'test-cycle', name: 'Test', 'output-type': 'doc', 'appraise-consensus': 'invalid-mode' });
    const result = await readConsensusConfig('foundry', 'test-cycle', io);
    assert.equal(result, 'unanimous');
  });

  test('returns unanimous when cycle definition cannot be read', async () => {
    const io = {
      exists: async () => false,
      readFile: async () => { throw new Error('not found'); },
    };
    const result = await readConsensusConfig('foundry', 'missing-cycle', io);
    assert.equal(result, 'unanimous');
  });
});
