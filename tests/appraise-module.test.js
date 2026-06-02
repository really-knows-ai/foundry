/**
 * Unit tests for appraise-module.js — resolveStaleFeedback.
 */

import { describe, it, mock, before } from 'node:test';
import assert from 'node:assert/strict';

// Module under test
let resolveStaleFeedback, parseConsolidatedLine, deduplicateIssues;

before(async () => {
  const mod = await import('../src/scripts/appraise-module.js');
  resolveStaleFeedback = mod.resolveStaleFeedback;
  parseConsolidatedLine = mod.parseConsolidatedLine;
  deduplicateIssues = mod.deduplicateIssues;
});

// ---------------------------------------------------------------------------
// resolveStaleFeedback — stale feedback detection (Phase 4)
// ---------------------------------------------------------------------------

describe('resolveStaleFeedback (appraise)', () => {
  function makeItem(overrides = {}) {
    return {
      id: 'item-1',
      source: 'appraise:test-cycle',
      artefact_version: 'old-version',
      history: [{ state: 'open' }],
      file: 'a.md',
      tag: 'law:x',
      ...overrides,
    };
  }

  it('resolves items with mismatched version', () => {
    const items = [makeItem({ artefact_version: 'v1' })];
    const feedback = { autoResolve: mock.fn() };
    resolveStaleFeedback(items, 'v2', 'appraise', feedback, 'cycle-1');
    assert.equal(feedback.autoResolve.mock.calls.length, 1);
    assert.match(feedback.autoResolve.mock.calls[0].arguments[0].reason, /superseded by forge revision/);
    assert.equal(feedback.autoResolve.mock.calls[0].arguments[0].cycle, 'cycle-1');
  });

  it('skips items with matching version', () => {
    const items = [makeItem({ artefact_version: 'v1' })];
    const feedback = { autoResolve: mock.fn() };
    resolveStaleFeedback(items, 'v1', 'appraise', feedback, 'cycle-1');
    assert.equal(feedback.autoResolve.mock.calls.length, 0);
  });

  it('skips items from other source bases', () => {
    const items = [makeItem({ source: 'quench:test-cycle' })];
    const feedback = { autoResolve: mock.fn() };
    resolveStaleFeedback(items, 'v2', 'appraise', feedback, 'cycle-1');
    assert.equal(feedback.autoResolve.mock.calls.length, 0);
  });

  it('skips already-resolved items', () => {
    const items = [makeItem({ history: [{ state: 'resolved' }] })];
    const feedback = { autoResolve: mock.fn() };
    resolveStaleFeedback(items, 'v2', 'appraise', feedback, 'cycle-1');
    assert.equal(feedback.autoResolve.mock.calls.length, 0);
  });

  it('passes cycle through to autoResolve', () => {
    const items = [makeItem({ artefact_version: 'v1' })];
    const feedback = { autoResolve: mock.fn() };
    resolveStaleFeedback(items, 'v2', 'appraise', feedback, 'my-cycle');
    assert.equal(feedback.autoResolve.mock.calls[0].arguments[0].cycle, 'my-cycle');
  });
});

// ---------------------------------------------------------------------------
// parseConsolidatedLine — identity field parsing (Phase 5)
// ---------------------------------------------------------------------------

describe('parseConsolidatedLine — identity fields', () => {
  it('parses all three identity fields when present', () => {
    const line = JSON.stringify({
      file: 'a.md', law: 'r1', text: 'bad name',
      group: 'style', appraiser: 'spellcheck', pass: 2,
    });
    const result = parseConsolidatedLine(line);
    assert.equal(result.group, 'style');
    assert.equal(result.appraiser, 'spellcheck');
    assert.equal(result.pass, 2);
  });

  it('uses defaults when identity fields are absent', () => {
    const line = JSON.stringify({ file: 'a.md', law: 'r1', text: 'bad name' });
    const result = parseConsolidatedLine(line);
    assert.equal(result.group, 'default');
    assert.equal(result.appraiser, 'unknown');
    assert.equal(result.pass, 0);
  });

  it('uses defaults for wrong-type identity fields', () => {
    const line = JSON.stringify({
      file: 'a.md', law: 'r1', text: 'bad name',
      group: 5, appraiser: null, pass: '2',
    });
    const result = parseConsolidatedLine(line);
    assert.equal(result.group, 'default');
    assert.equal(result.appraiser, 'unknown');
    assert.equal(result.pass, 0);
  });

  it('renames text to issue (unchanged behaviour)', () => {
    const line = JSON.stringify({ file: 'a.md', law: 'r1', text: 'bad name' });
    const result = parseConsolidatedLine(line);
    assert.equal(result.issue, 'bad name');
    assert.equal(result.text, undefined);
  });

  it('still returns null for invalid JSON', () => {
    assert.equal(parseConsolidatedLine('not json'), null);
  });

  it('still returns null for missing file', () => {
    const line = JSON.stringify({ law: 'r1', text: 'bad name' });
    assert.equal(parseConsolidatedLine(line), null);
  });

  it('still returns null for missing text', () => {
    const line = JSON.stringify({ file: 'a.md', law: 'r1' });
    assert.equal(parseConsolidatedLine(line), null);
  });
});

describe('deduplicateIssues — identity preservation', () => {
  it('deduplicates by (file, law, issue) — first wins, preserving identity from first occurrence', () => {
    const issues = [
      { file: 'a.md', law: 'r1', issue: 'bad', evidence: '', group: 'style', appraiser: 'alice', pass: 1 },
      { file: 'a.md', law: 'r1', issue: 'bad', evidence: '', group: 'docs', appraiser: 'bob', pass: 2 },
    ];
    const result = deduplicateIssues(issues);
    assert.equal(result.length, 1);
    assert.equal(result[0].group, 'style');
    assert.equal(result[0].appraiser, 'alice');
    assert.equal(result[0].pass, 1);
  });

  it('keeps distinct (file, law, issue) regardless of identity', () => {
    const issues = [
      { file: 'a.md', law: 'r1', issue: 'bad', evidence: '', group: 'default', appraiser: 'unknown', pass: 0 },
      { file: 'b.md', law: 'r1', issue: 'bad', evidence: '', group: 'default', appraiser: 'unknown', pass: 0 },
    ];
    const result = deduplicateIssues(issues);
    assert.equal(result.length, 2);
  });

  it('returns empty array for empty input', () => {
    assert.deepEqual(deduplicateIssues([]), []);
  });
});
