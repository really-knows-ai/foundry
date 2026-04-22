import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadVocabulary } from '../../../scripts/lib/memory/types.js';

function mockIO(files = {}, dirs = {}) {
  return {
    exists: async (p) => p in files || p in dirs,
    readFile: async (p) => files[p],
    readDir: async (p) => dirs[p] ?? [],
  };
}

const CLASS_MD = `---
type: class
---

# class

A Java class observed in the current source tree.

## Name
Fully-qualified dot-notation name.

## Value
Intrinsic description. Relationships live in edges.

## Relationships
- has method
`;

const CALLS_MD = `---
type: calls
sources: [class, method]
targets: [class, method]
---

# calls

Call-site relationship observed in current source.
`;

describe('loadVocabulary', () => {
  it('loads an empty vocabulary when memory dir is absent', async () => {
    const vocab = await loadVocabulary('foundry', mockIO());
    assert.deepEqual(vocab.entities, {});
    assert.deepEqual(vocab.edges, {});
  });

  it('loads entity and edge type files', async () => {
    const io = mockIO(
      {
        'foundry/memory/entities/class.md': CLASS_MD,
        'foundry/memory/edges/calls.md': CALLS_MD,
      },
      {
        'foundry/memory': ['entities', 'edges'],
        'foundry/memory/entities': ['class.md'],
        'foundry/memory/edges': ['calls.md'],
      },
    );
    const vocab = await loadVocabulary('foundry', io);
    assert.equal(vocab.entities.class.type, 'class');
    assert.ok(vocab.entities.class.body.length > 0);
    assert.equal(vocab.edges.calls.type, 'calls');
    assert.deepEqual(vocab.edges.calls.sources, ['class', 'method']);
    assert.deepEqual(vocab.edges.calls.targets, ['class', 'method']);
  });

  it('rejects entity type with empty body', async () => {
    const text = `---\ntype: class\n---\n\n`;
    const io = mockIO(
      { 'foundry/memory/entities/class.md': text },
      { 'foundry/memory': ['entities'], 'foundry/memory/entities': ['class.md'], 'foundry/memory/edges': [] },
    );
    await assert.rejects(() => loadVocabulary('foundry', io), /empty body/i);
  });

  it('rejects entity type where frontmatter.type does not match filename stem', async () => {
    const text = `---\ntype: klass\n---\n\nbody\n`;
    const io = mockIO(
      { 'foundry/memory/entities/class.md': text },
      { 'foundry/memory': ['entities'], 'foundry/memory/entities': ['class.md'], 'foundry/memory/edges': [] },
    );
    await assert.rejects(() => loadVocabulary('foundry', io), /does not match filename/i);
  });

  it('accepts edge with any as sources or targets', async () => {
    const text = `---\ntype: references\nsources: any\ntargets: any\n---\n\nbody\n`;
    const io = mockIO(
      { 'foundry/memory/edges/references.md': text },
      { 'foundry/memory': ['edges'], 'foundry/memory/entities': [], 'foundry/memory/edges': ['references.md'] },
    );
    const vocab = await loadVocabulary('foundry', io);
    assert.equal(vocab.edges.references.sources, 'any');
    assert.equal(vocab.edges.references.targets, 'any');
  });

  it('rejects edge missing sources', async () => {
    const text = `---\ntype: calls\ntargets: [class]\n---\n\nbody\n`;
    const io = mockIO(
      { 'foundry/memory/edges/calls.md': text },
      { 'foundry/memory': ['edges'], 'foundry/memory/entities': [], 'foundry/memory/edges': ['calls.md'] },
    );
    await assert.rejects(() => loadVocabulary('foundry', io), /sources/);
  });
});
