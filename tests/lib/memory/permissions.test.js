import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolvePermissions, checkEntityRead, checkEntityWrite, checkEdgeRead, checkEdgeWrite } from '../../../scripts/lib/memory/permissions.js';

const vocab = {
  entities: { class: {}, method: {}, table: {}, finding: {} },
  edges: {
    calls: { sources: ['class', 'method'], targets: ['class', 'method'] },
    writes: { sources: ['class', 'method'], targets: ['table'] },
    references: { sources: 'any', targets: 'any' },
  },
};

describe('resolvePermissions', () => {
  it('empty when cycle has no memory block', () => {
    const perms = resolvePermissions({ cycleFrontmatter: {}, vocabulary: vocab });
    assert.equal(perms.enabled, false);
    assert.deepEqual([...perms.readTypes], []);
    assert.deepEqual([...perms.writeTypes], []);
  });

  it('derives edge read/write from entity permissions (any type wildcard)', () => {
    const perms = resolvePermissions({
      cycleFrontmatter: { memory: { read: ['class', 'method'], write: ['finding'] } },
      vocabulary: vocab,
    });
    assert.equal(perms.enabled, true);
    assert.ok(perms.readTypes.has('class'));
    assert.ok(perms.writeTypes.has('finding'));

    assert.ok(checkEdgeRead(perms, 'calls'));
    assert.ok(!checkEdgeWrite(perms, 'calls'));

    assert.ok(checkEdgeRead(perms, 'references'));

    assert.ok(checkEdgeRead(perms, 'writes'));
  });

  it('checkEntityRead enforces read set', () => {
    const perms = resolvePermissions({
      cycleFrontmatter: { memory: { read: ['class'] } },
      vocabulary: vocab,
    });
    assert.ok(checkEntityRead(perms, 'class'));
    assert.ok(!checkEntityRead(perms, 'method'));
  });

  it('checkEntityWrite enforces write set', () => {
    const perms = resolvePermissions({
      cycleFrontmatter: { memory: { write: ['finding'] } },
      vocabulary: vocab,
    });
    assert.ok(checkEntityWrite(perms, 'finding'));
    assert.ok(!checkEntityWrite(perms, 'class'));
  });

  it('silently ignores unknown type names in cycle frontmatter', () => {
    const perms = resolvePermissions({
      cycleFrontmatter: { memory: { read: ['ghost', 'class'] } },
      vocabulary: vocab,
    });
    assert.ok(perms.readTypes.has('class'));
    assert.ok(!perms.readTypes.has('ghost'));
  });
});
