import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkExtractorAgainstCycle,
  checkEntityRowAgainstExtractor,
  checkEdgeRowAgainstExtractor,
} from '../../../scripts/lib/assay/permissions.js';

const extractor = {
  name: 'java-symbols',
  memoryWrite: ['class', 'method'],
};

const vocabulary = {
  entities: { class: {}, method: {}, file: {} },
  edges: {
    'defined-in': { sources: ['method'], targets: ['class'] },
    'imports':    { sources: ['file'],   targets: ['file'] },
    'any-edge':   { sources: 'any',      targets: 'any' },
  },
};

describe('checkExtractorAgainstCycle', () => {
  it('passes when extractor.memoryWrite ⊆ cycle.memory.write', () => {
    const r = checkExtractorAgainstCycle(extractor, { writeTypes: new Set(['class', 'method', 'documentation-section']) });
    assert.equal(r.ok, true);
  });

  it('fails listing every missing type', () => {
    const r = checkExtractorAgainstCycle(extractor, { writeTypes: new Set(['documentation-section']) });
    assert.equal(r.ok, false);
    assert.match(r.error, /java-symbols/);
    assert.match(r.error, /class/);
    assert.match(r.error, /method/);
  });
});

describe('checkEntityRowAgainstExtractor', () => {
  it('permits a row whose type is in memoryWrite', () => {
    assert.equal(checkEntityRowAgainstExtractor(extractor, 'class').ok, true);
  });

  it('rejects a row whose type is outside memoryWrite', () => {
    const r = checkEntityRowAgainstExtractor(extractor, 'file');
    assert.equal(r.ok, false);
    assert.match(r.error, /'file'.*not.*memory\.write/);
  });
});

describe('checkEdgeRowAgainstExtractor', () => {
  it('permits an edge when at least one endpoint type is in memoryWrite', () => {
    // defined-in: sources=[method], targets=[class]. method ∈ extractor.memoryWrite. OK.
    const r = checkEdgeRowAgainstExtractor(extractor, {
      edge_type: 'defined-in', from_type: 'method', to_type: 'class',
    }, vocabulary);
    assert.equal(r.ok, true);
  });

  it('rejects an edge when neither endpoint is in memoryWrite', () => {
    // imports: sources=[file], targets=[file]. file ∉ memoryWrite.
    const r = checkEdgeRowAgainstExtractor(extractor, {
      edge_type: 'imports', from_type: 'file', to_type: 'file',
    }, vocabulary);
    assert.equal(r.ok, false);
    assert.match(r.error, /imports/);
    assert.match(r.error, /neither endpoint/i);
  });

  it('rejects an edge whose edge_type is not in the vocabulary', () => {
    const r = checkEdgeRowAgainstExtractor(extractor, {
      edge_type: 'unknown', from_type: 'class', to_type: 'method',
    }, vocabulary);
    assert.equal(r.ok, false);
    assert.match(r.error, /edge type 'unknown'.*not declared/i);
  });

  it('rejects an entity type not in the vocabulary', () => {
    // (caller should pre-validate, but defensive check)
    const r = checkEdgeRowAgainstExtractor(extractor, {
      edge_type: 'defined-in', from_type: 'bogus', to_type: 'class',
    }, vocabulary);
    assert.equal(r.ok, false);
    assert.match(r.error, /from_type 'bogus'/);
  });
});
