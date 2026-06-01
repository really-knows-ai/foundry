import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import yaml from 'js-yaml';
import { computeOpenFeedback } from '../src/scripts/orchestrate-cycle.js';
import { makeMockIO } from './helpers/mock-io.js';

describe('computeOpenFeedback (spec §10)', () => {
  test('counts non-resolved items', () => {
    const io = makeMockIO({
      'WORK.feedback.yaml': yaml.dump({ items: [
        { id: 'A', file: 'a', tag: 'x', text: 't', source: 's', history: [{ state: 'open',     stage: 's', cycle: 'c', timestamp: 'T' }] },
        { id: 'B', file: 'a', tag: 'x', text: 't', source: 's', history: [{ state: 'resolved', stage: 's', cycle: 'c', timestamp: 'T' }] },
        { id: 'C', file: 'a', tag: 'x', text: 't', source: 's', history: [{ state: 'actioned', stage: 's', cycle: 'c', timestamp: 'T' }] },
      ]}),
    });
    assert.equal(computeOpenFeedback(io), 2);
  });

  test('resolved-only store yields 0', () => {
    const io = makeMockIO({
      'WORK.feedback.yaml': yaml.dump({ items: [
        { id: 'A', file: 'a', tag: 'x', text: 't', source: 's', history: [{ state: 'resolved', stage: 's', cycle: 'c', timestamp: 'T' }] },
      ]}),
    });
    assert.equal(computeOpenFeedback(io), 0);
  });

  test('deadlocked items count as open', () => {
    const io = makeMockIO({
      'WORK.feedback.yaml': yaml.dump({ items: [
        { id: 'A', file: 'a', tag: 'x', text: 't', source: 's', history: [{ state: 'deadlocked', stage: 'sort', cycle: 'c', timestamp: 'T', reason: 'd' }] },
        { id: 'B', file: 'a', tag: 'x', text: 't', source: 's', history: [{ state: 'resolved',   stage: 's',    cycle: 'c', timestamp: 'T' }] },
      ]}),
    });
    assert.equal(computeOpenFeedback(io), 1);
  });

  test('missing feedback.yaml returns 0 without reading', () => {
    const io = makeMockIO({});
    let readCount = 0;
    const readFile = io.readFile;
    io.readFile = (p) => {
      readCount++;
      return readFile(p);
    };

    assert.equal(computeOpenFeedback(io), 0);
    assert.equal(readCount, 0);
  });
});
