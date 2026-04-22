import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadMemoryConfig } from '../../../scripts/lib/memory/config.js';
import { loadSchema, hashFrontmatter, writeSchema } from '../../../scripts/lib/memory/schema.js';
import { loadVocabulary } from '../../../scripts/lib/memory/types.js';
import { detectDrift } from '../../../scripts/lib/memory/drift.js';

function memIO() {
  const store = {};
  const dirs = new Set();
  return {
    store,
    dirs,
    exists: async (p) => {
      if (p in store || dirs.has(p)) return true;
      const prefix = p + '/';
      return Object.keys(store).some((k) => k.startsWith(prefix));
    },
    readFile: async (p) => store[p],
    writeFile: async (p, c) => { store[p] = c; },
    readDir: async (p) => {
      const prefix = p + '/';
      const names = new Set();
      for (const key of Object.keys(store)) {
        if (key.startsWith(prefix)) {
          const rest = key.slice(prefix.length);
          names.add(rest.split('/')[0]);
        }
      }
      return [...names];
    },
    mkdir: async (p) => { dirs.add(p); },
  };
}

describe('memory foundation integration', () => {
  it('scaffolded project loads cleanly with no drift', async () => {
    const io = memIO();
    io.store['foundry/memory/config.md'] = '---\nenabled: true\n---\n';
    io.store['foundry/memory/entities/class.md'] =
      '---\ntype: class\n---\n\n# class\nBody.\n';
    io.store['foundry/memory/edges/calls.md'] =
      '---\ntype: calls\nsources: [class]\ntargets: [class]\n---\n\n# calls\nBody.\n';

    const cfg = await loadMemoryConfig('foundry', io);
    assert.equal(cfg.enabled, true);

    const vocab = await loadVocabulary('foundry', io);
    const schema = {
      version: 1,
      entities: { class: { frontmatterHash: hashFrontmatter(vocab.entities.class.frontmatter) } },
      edges: { calls: { frontmatterHash: hashFrontmatter(vocab.edges.calls.frontmatter) } },
      embeddings: null,
    };
    await writeSchema('foundry', schema, io);
    const reloaded = await loadSchema('foundry', io);
    const report = detectDrift({ vocabulary: vocab, schema: reloaded });
    assert.equal(report.hasDrift, false);
  });
});
