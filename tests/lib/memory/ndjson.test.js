import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  serialiseEntityRows,
  parseEntityRows,
  serialiseEdgeRows,
  parseEdgeRows,
} from '../../../scripts/lib/memory/ndjson.js';

describe('serialiseEntityRows', () => {
  it('sorts by name and produces one line per row with trailing newline', () => {
    const rows = [
      { name: 'b', value: 'vb' },
      { name: 'a', value: 'va' },
    ];
    const text = serialiseEntityRows(rows);
    assert.equal(text, '{"name":"a","value":"va"}\n{"name":"b","value":"vb"}\n');
  });

  it('returns empty string for empty array', () => {
    assert.equal(serialiseEntityRows([]), '');
  });

  it('sorts JSON keys alphabetically regardless of input order', () => {
    const rows = [{ value: 'v', name: 'a' }];
    assert.equal(serialiseEntityRows(rows), '{"name":"a","value":"v"}\n');
  });

  it('preserves embeddings array verbatim', () => {
    const rows = [{ name: 'a', value: 'v', embedding: [0.1, 0.2, 0.3] }];
    const text = serialiseEntityRows(rows);
    assert.equal(text, '{"embedding":[0.1,0.2,0.3],"name":"a","value":"v"}\n');
  });

  it('rejects non-finite numbers in embeddings', () => {
    assert.throws(
      () => serialiseEntityRows([{ name: 'a', value: 'v', embedding: [NaN] }]),
      /non-finite/i,
    );
  });

  it('round-trips through parse', () => {
    const rows = [{ name: 'a', value: 'hello "world"\nline2' }];
    const parsed = parseEntityRows(serialiseEntityRows(rows));
    assert.deepEqual(parsed, rows);
  });
});

describe('serialiseEdgeRows', () => {
  it('sorts by (from_type, from_name, to_type, to_name)', () => {
    const rows = [
      { from_type: 'class', from_name: 'B', to_type: 'table', to_name: 'x' },
      { from_type: 'class', from_name: 'A', to_type: 'table', to_name: 'x' },
    ];
    const text = serialiseEdgeRows(rows);
    const lines = text.trim().split('\n').map(JSON.parse);
    assert.equal(lines[0].from_name, 'A');
    assert.equal(lines[1].from_name, 'B');
  });

  it('round-trips', () => {
    const rows = [{ from_type: 'a', from_name: 'x', to_type: 'b', to_name: 'y' }];
    assert.deepEqual(parseEdgeRows(serialiseEdgeRows(rows)), rows);
  });
});

describe('parseEntityRows', () => {
  it('handles empty and whitespace-only input', () => {
    assert.deepEqual(parseEntityRows(''), []);
    assert.deepEqual(parseEntityRows('\n\n'), []);
  });

  it('throws on malformed line with line number', () => {
    assert.throws(() => parseEntityRows('{"name":"a"}\nnotjson\n'), /line 2/);
  });
});
