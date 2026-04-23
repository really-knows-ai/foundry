import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseExtractorOutput } from '../../../scripts/lib/assay/parse-jsonl.js';

describe('parseExtractorOutput', () => {
  it('parses entity and edge rows', () => {
    const text = [
      '{"kind":"entity","type":"class","name":"Foo","value":"x"}',
      '{"kind":"edge","from":{"type":"method","name":"Foo.bar"},"edge":"defined-in","to":{"type":"class","name":"Foo"}}',
    ].join('\n');
    const rows = parseExtractorOutput(text);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].kind, 'entity');
    assert.equal(rows[0].type, 'class');
    assert.equal(rows[0].name, 'Foo');
    assert.equal(rows[0].value, 'x');
    assert.equal(rows[1].kind, 'edge');
    assert.equal(rows[1].edge_type, 'defined-in');
    assert.equal(rows[1].from_type, 'method');
    assert.equal(rows[1].from_name, 'Foo.bar');
    assert.equal(rows[1].to_type, 'class');
    assert.equal(rows[1].to_name, 'Foo');
  });

  it('skips blank lines and comment lines', () => {
    const text = [
      '# a comment',
      '',
      '{"kind":"entity","type":"class","name":"A","value":"v"}',
      '   ',
      '# trailing',
    ].join('\n');
    const rows = parseExtractorOutput(text);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].name, 'A');
  });

  it('reports bad JSON with line number', () => {
    const text = [
      '{"kind":"entity","type":"class","name":"A","value":"v"}',
      'not json',
    ].join('\n');
    assert.throws(() => parseExtractorOutput(text), /line 2/);
  });

  it('rejects unknown kind', () => {
    assert.throws(
      () => parseExtractorOutput('{"kind":"bogus"}'),
      /unknown kind 'bogus' at line 1/,
    );
  });

  it('rejects unknown top-level fields on entity', () => {
    assert.throws(
      () => parseExtractorOutput('{"kind":"entity","type":"class","name":"A","value":"v","extra":1}'),
      /unknown field.*extra/,
    );
  });

  it('rejects unknown top-level fields on edge', () => {
    assert.throws(
      () => parseExtractorOutput('{"kind":"edge","from":{"type":"c","name":"A"},"edge":"e","to":{"type":"c","name":"B"},"x":1}'),
      /unknown field.*x/,
    );
  });

  it('requires entity fields', () => {
    assert.throws(() => parseExtractorOutput('{"kind":"entity","type":"class","name":"A"}'), /value.*required/);
    assert.throws(() => parseExtractorOutput('{"kind":"entity","type":"class","value":"v"}'), /name.*required/);
    assert.throws(() => parseExtractorOutput('{"kind":"entity","name":"A","value":"v"}'), /type.*required/);
  });

  it('requires edge fields', () => {
    assert.throws(() => parseExtractorOutput('{"kind":"edge","edge":"e","to":{"type":"c","name":"B"}}'), /from/);
    assert.throws(() => parseExtractorOutput('{"kind":"edge","from":{"type":"c","name":"A"},"to":{"type":"c","name":"B"}}'), /edge.*required/);
    assert.throws(() => parseExtractorOutput('{"kind":"edge","from":{"type":"c","name":"A"},"edge":"e"}'), /to/);
    assert.throws(() => parseExtractorOutput('{"kind":"edge","from":{"type":"c"},"edge":"e","to":{"type":"c","name":"B"}}'), /from\.name/);
  });

  it('rejects oversize entity value', () => {
    const big = 'x'.repeat(5000);
    assert.throws(
      () => parseExtractorOutput(`{"kind":"entity","type":"class","name":"A","value":"${big}"}`),
      /value.*4096|too large/i,
    );
  });

  it('returns an empty array for empty input', () => {
    assert.deepEqual(parseExtractorOutput(''), []);
    assert.deepEqual(parseExtractorOutput('\n\n# only comments\n'), []);
  });
});
