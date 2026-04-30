import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { memoryPaths } from '../../../scripts/lib/memory/paths.js';

describe('memoryPaths', () => {
  it('produces canonical paths under foundry/memory for definitions', () => {
    const p = memoryPaths('foundry');
    assert.equal(p.root, 'foundry/memory');
    assert.equal(p.config, 'foundry/memory/config.md');
    assert.equal(p.schema, 'foundry/memory/schema.json');
    assert.equal(p.entitiesDir, 'foundry/memory/entities');
    assert.equal(p.edgesDir, 'foundry/memory/edges');
    assert.equal(p.db, 'foundry/memory/memory.db');
  });

  it('relation rows live under top-level foundry-memory/', () => {
    const p = memoryPaths('foundry');
    assert.equal(p.relationsDir, 'foundry-memory/relations');
    assert.equal(p.relationFile('person'), 'foundry-memory/relations/person.ndjson');
  });

  it('resolves per-type file paths for definitions', () => {
    const p = memoryPaths('foundry');
    assert.equal(p.entityTypeFile('class'), 'foundry/memory/entities/class.md');
    assert.equal(p.edgeTypeFile('calls'), 'foundry/memory/edges/calls.md');
  });

  it('resolves per-type relation file paths under foundry-memory/', () => {
    const p = memoryPaths('foundry');
    assert.equal(p.relationFile('class'), 'foundry-memory/relations/class.ndjson');
  });

  it('returns the extractors directory', () => {
    const p = memoryPaths('foundry');
    assert.equal(p.extractorsDir, 'foundry/memory/extractors');
  });

  it('returns the extractor file for a given name', () => {
    const p = memoryPaths('foundry');
    assert.equal(p.extractorFile('java-symbols'), 'foundry/memory/extractors/java-symbols.md');
  });
});
