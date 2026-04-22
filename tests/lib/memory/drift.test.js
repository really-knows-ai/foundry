import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { detectDrift } from '../../../scripts/lib/memory/drift.js';
import { hashFrontmatter } from '../../../scripts/lib/memory/schema.js';

const fm = { type: 'class' };
const hash = hashFrontmatter(fm);

describe('detectDrift', () => {
  it('reports no drift when hashes match', () => {
    const report = detectDrift({
      vocabulary: { entities: { class: { frontmatter: fm } }, edges: {} },
      schema: { entities: { class: { frontmatterHash: hash } }, edges: {} },
    });
    assert.equal(report.hasDrift, false);
    assert.deepEqual(report.items, []);
  });

  it('reports frontmatter-mismatch when hash differs', () => {
    const report = detectDrift({
      vocabulary: { entities: { class: { frontmatter: { type: 'class', extra: 'x' } } }, edges: {} },
      schema: { entities: { class: { frontmatterHash: hash } }, edges: {} },
    });
    assert.equal(report.hasDrift, true);
    assert.equal(report.items[0].kind, 'frontmatter-mismatch');
    assert.equal(report.items[0].typeFamily, 'entity');
    assert.equal(report.items[0].typeName, 'class');
    assert.match(report.items[0].suggestedSkill, /rename-memory-entity-type|drop-memory-entity-type/);
  });

  it('reports unknown-type for on-disk types not in schema', () => {
    const report = detectDrift({
      vocabulary: { entities: { ghost: { frontmatter: { type: 'ghost' } } }, edges: {} },
      schema: { entities: {}, edges: {} },
    });
    assert.equal(report.items[0].kind, 'unknown-type');
    assert.equal(report.items[0].typeName, 'ghost');
    assert.match(report.items[0].suggestedSkill, /add-memory-entity-type/);
  });

  it('reports missing-file for schema types with no file on disk', () => {
    const report = detectDrift({
      vocabulary: { entities: {}, edges: {} },
      schema: { entities: { class: { frontmatterHash: hash } }, edges: {} },
    });
    assert.equal(report.items[0].kind, 'missing-file');
    assert.equal(report.items[0].typeName, 'class');
    assert.match(report.items[0].suggestedSkill, /drop-memory-entity-type|rename-memory-entity-type/);
  });

  it('checks edges the same way', () => {
    const edgeFm = { type: 'calls', sources: 'any', targets: 'any' };
    const edgeHash = hashFrontmatter(edgeFm);
    const report = detectDrift({
      vocabulary: { entities: {}, edges: { calls: { frontmatter: { ...edgeFm, sources: ['class'] } } } },
      schema: { entities: {}, edges: { calls: { frontmatterHash: edgeHash } } },
    });
    assert.equal(report.items[0].typeFamily, 'edge');
    assert.equal(report.items[0].kind, 'frontmatter-mismatch');
  });
});
