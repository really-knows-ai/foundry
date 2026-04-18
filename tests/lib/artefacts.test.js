import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseArtefactsTable, addArtefactRow, setArtefactStatus } from '../../scripts/lib/artefacts.js';
import { createWorkfile } from '../../scripts/lib/workfile.js';

// ---------------------------------------------------------------------------
// parseArtefactsTable
// ---------------------------------------------------------------------------

describe('parseArtefactsTable', () => {
  it('parses a standard table', () => {
    const text = [
      '| File | Type | Cycle | Status |',
      '|------|------|-------|--------|',
      '| foo.md | doc | write | draft |',
      '| bar.js | code | build | done |',
    ].join('\n');
    const result = parseArtefactsTable(text);
    assert.equal(result.length, 2);
    assert.deepEqual(result[0], { file: 'foo.md', type: 'doc', cycle: 'write', status: 'draft' });
    assert.deepEqual(result[1], { file: 'bar.js', type: 'code', cycle: 'build', status: 'done' });
  });

  it('returns empty array when no table', () => {
    assert.deepEqual(parseArtefactsTable('no table here'), []);
  });

  it('returns empty array for empty string', () => {
    assert.deepEqual(parseArtefactsTable(''), []);
  });

  it('stops parsing at table end', () => {
    const text = [
      '| File | Type | Cycle | Status |',
      '|------|------|-------|--------|',
      '| a.md | t | c | s |',
      '',
      'Some other content',
      '| not | a | table | row |',
    ].join('\n');
    const result = parseArtefactsTable(text);
    assert.equal(result.length, 1);
    assert.equal(result[0].file, 'a.md');
  });
});

// ---------------------------------------------------------------------------
// addArtefactRow
// ---------------------------------------------------------------------------

describe('addArtefactRow', () => {
  it('adds row to empty table (header + separator only)', () => {
    const text = [
      '# Artefacts',
      '| File | Type | Cycle | Status |',
      '|------|------|-------|--------|',
      '',
      '# Other',
    ].join('\n');
    const result = addArtefactRow(text, { file: 'x.md', type: 'doc', cycle: 'c1', status: 'draft' });
    assert.ok(result.includes('| x.md | doc | c1 | draft |'));
    // Other content preserved
    assert.ok(result.includes('# Other'));
  });

  it('adds row after existing rows', () => {
    const text = [
      '| File | Type | Cycle | Status |',
      '|------|------|-------|--------|',
      '| a.md | t | c | s |',
    ].join('\n');
    const result = addArtefactRow(text, { file: 'b.md', type: 't2', cycle: 'c2', status: 'new' });
    const lines = result.split('\n');
    assert.equal(lines[2], '| a.md | t | c | s |');
    assert.equal(lines[3], '| b.md | t2 | c2 | new |');
  });

  it('preserves surrounding content', () => {
    const text = [
      'before',
      '| File | Type | Cycle | Status |',
      '|------|------|-------|--------|',
      '| a.md | t | c | s |',
      'after',
    ].join('\n');
    const result = addArtefactRow(text, { file: 'b.md', type: 't', cycle: 'c', status: 's' });
    assert.ok(result.startsWith('before'));
    assert.ok(result.includes('after'));
  });

  it('throws if no table found', () => {
    assert.throws(() => addArtefactRow('no table', { file: 'x', type: 't', cycle: 'c', status: 's' }), /not found/);
  });

  it('works with createWorkfile output', () => {
    const work = createWorkfile({ cycle: 'create-haiku' }, 'Write a haiku');
    const result = addArtefactRow(work, { file: 'haikus/test.md', type: 'haiku', cycle: 'create-haiku', status: 'draft' });
    assert.ok(result.includes('| haikus/test.md | haiku | create-haiku | draft |'));
  });
});

// ---------------------------------------------------------------------------
// setArtefactStatus
// ---------------------------------------------------------------------------

describe('setArtefactStatus', () => {
  const table = [
    '| File | Type | Cycle | Status |',
    '|------|------|-------|--------|',
    '| a.md | t1 | c1 | draft |',
    '| b.md | t2 | c2 | pending |',
  ].join('\n');

  it('updates status for specific file', () => {
    const result = setArtefactStatus(table, 'a.md', 'done');
    const parsed = parseArtefactsTable(result);
    assert.equal(parsed[0].status, 'done');
  });

  it('leaves other rows unchanged', () => {
    const result = setArtefactStatus(table, 'a.md', 'done');
    const parsed = parseArtefactsTable(result);
    assert.equal(parsed[1].status, 'pending');
  });

  it('throws on missing file', () => {
    assert.throws(() => setArtefactStatus(table, 'nope.md', 'done'), /not found/i);
  });
});
