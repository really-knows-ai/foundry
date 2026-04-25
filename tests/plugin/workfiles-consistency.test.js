import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import yaml from 'js-yaml';

function assertFeedbackHistoryConsistent(feedbackDoc, historyEntries) {
  const historyPairs = new Set(historyEntries.map(e => `${e.stage}||${e.cycle}`));
  const missing = [];

  for (const item of feedbackDoc.items || []) {
    for (const snap of item.history) {
      // Sort-written deadlocked snapshots are exempt per spec §9.3. Any
      // other state on stage: sort is a bug and must be flagged. The reverse
      // direction is intentionally not asserted per spec §9.3.
      if (snap.stage === 'sort' && snap.state === 'deadlocked') continue;
      const key = `${snap.stage}||${snap.cycle}`;
      if (!historyPairs.has(key)) {
        missing.push(`${item.id}@${snap.state}: stage=${snap.stage} cycle=${snap.cycle}`);
      }
    }
  }

  if (missing.length) {
    assert.fail(`feedback/history inconsistency: ${missing.length} snapshots lack matching history rows:\n${missing.join('\n')}`);
  }
}

// A ULID-legal fixture id. 'I' is NOT in the Crockford base32 alphabet;
// use 'J' instead. 26 chars total: 3 prefix + 23 'Z'.
const FIXTURE_ID = 'JD0' + 'Z'.repeat(23);

describe('workfiles consistency — synthetic', () => {
  test('matching (stage, cycle) pairs pass the invariant', () => {
    const feedbackDoc = yaml.load(yaml.dump({
      items: [{
        id: FIXTURE_ID,
        file: 'a.md',
        tag: 'law:x',
        text: 't',
        source: 'appraise:w',
        history: [
          { state: 'resolved', stage: 'appraise:w', cycle: 'c1', timestamp: 'T3', reason: 'good now' },
          { state: 'actioned', stage: 'forge:w', cycle: 'c1', timestamp: 'T2' },
          { state: 'open', stage: 'appraise:w', cycle: 'c1', timestamp: 'T1' },
        ],
      }],
    }));
    const historyEntries = [
      { stage: 'appraise:w', cycle: 'c1', comment: 'open', timestamp: 'T1', seq: 0, iteration: 0, open_feedback: 1 },
      { stage: 'forge:w', cycle: 'c1', comment: 'action', timestamp: 'T2', seq: 1, iteration: 1, open_feedback: 1 },
      { stage: 'appraise:w', cycle: 'c1', comment: 'resolve', timestamp: 'T3', seq: 2, iteration: 1, open_feedback: 0 },
    ];
    assert.doesNotThrow(() => assertFeedbackHistoryConsistent(feedbackDoc, historyEntries));
  });

  test('missing history row for a non-sort stage fails', () => {
    const feedbackDoc = {
      items: [{
        id: FIXTURE_ID,
        file: 'a.md', tag: 'law:x', text: 't', source: 'appraise:w',
        history: [
          { state: 'actioned', stage: 'forge:w', cycle: 'c1', timestamp: 'T2' },
          { state: 'open', stage: 'appraise:w', cycle: 'c1', timestamp: 'T1' },
        ],
      }],
    };
    const historyEntries = [
      { stage: 'forge:w', cycle: 'c1', comment: 'action', timestamp: 'T2', seq: 0, iteration: 0, open_feedback: 1 },
    ];
    assert.throws(() => assertFeedbackHistoryConsistent(feedbackDoc, historyEntries), /inconsistency/);
  });

  test('a sort-written deadlocked snapshot is allowed without a history row', () => {
    const feedbackDoc = {
      items: [{
        id: FIXTURE_ID,
        file: 'a.md', tag: 'law:x', text: 't', source: 'appraise:w',
        history: [
          { state: 'deadlocked', stage: 'sort', cycle: 'c1', timestamp: 'T4', reason: 'depth=3' },
          { state: 'rejected', stage: 'appraise:w', cycle: 'c1', timestamp: 'T3', reason: 'still bad' },
          { state: 'actioned', stage: 'forge:w', cycle: 'c1', timestamp: 'T2' },
          { state: 'open', stage: 'appraise:w', cycle: 'c1', timestamp: 'T1' },
        ],
      }],
    };
    const historyEntries = [
      { stage: 'appraise:w', cycle: 'c1', comment: 'open', timestamp: 'T1', seq: 0, iteration: 0, open_feedback: 1 },
      { stage: 'forge:w', cycle: 'c1', comment: 'action', timestamp: 'T2', seq: 1, iteration: 1, open_feedback: 1 },
      { stage: 'appraise:w', cycle: 'c1', comment: 'reject', timestamp: 'T3', seq: 2, iteration: 1, open_feedback: 1 },
    ];
    assert.doesNotThrow(() => assertFeedbackHistoryConsistent(feedbackDoc, historyEntries));
  });

  test('a non-deadlocked snapshot on stage: sort FAILS the invariant', () => {
    const feedbackDoc = {
      items: [{
        id: FIXTURE_ID,
        file: 'a.md', tag: 'law:x', text: 't', source: 'appraise:w',
        history: [
          { state: 'actioned', stage: 'sort', cycle: 'c1', timestamp: 'T2' },
          { state: 'open', stage: 'appraise:w', cycle: 'c1', timestamp: 'T1' },
        ],
      }],
    };
    const historyEntries = [
      { stage: 'appraise:w', cycle: 'c1', comment: 'open', timestamp: 'T1', seq: 0, iteration: 0, open_feedback: 1 },
    ];
    assert.throws(() => assertFeedbackHistoryConsistent(feedbackDoc, historyEntries), /inconsistency/);
  });

  test('empty store with empty history passes', () => {
    const feedbackDoc = { items: [] };
    const historyEntries = [];
    assert.doesNotThrow(() => assertFeedbackHistoryConsistent(feedbackDoc, historyEntries));
  });
});
