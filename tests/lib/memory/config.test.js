import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadMemoryConfig, DEFAULT_CONFIG } from '../../../scripts/lib/memory/config.js';

function mockIO(files) {
  return {
    exists: async (p) => p in files,
    readFile: async (p) => {
      if (!(p in files)) throw new Error(`Not found: ${p}`);
      return files[p];
    },
  };
}

describe('loadMemoryConfig', () => {
  it('returns disabled config when file missing', async () => {
    const cfg = await loadMemoryConfig('foundry', mockIO({}));
    assert.equal(cfg.enabled, false);
    assert.equal(cfg.present, false);
  });

  it('parses frontmatter and applies defaults', async () => {
    const text = `---\nenabled: true\n---\n\n# notes\n`;
    const cfg = await loadMemoryConfig('foundry', mockIO({ 'foundry/memory/config.md': text }));
    assert.equal(cfg.enabled, true);
    assert.equal(cfg.validation, 'strict');
    assert.equal(cfg.embeddings.enabled, DEFAULT_CONFIG.embeddings.enabled);
    assert.equal(cfg.embeddings.baseURL, DEFAULT_CONFIG.embeddings.baseURL);
    assert.equal(cfg.embeddings.model, DEFAULT_CONFIG.embeddings.model);
  });

  it('user config overrides defaults but keeps unspecified keys', async () => {
    const text = `---\nenabled: true\nvalidation: lax\nembeddings:\n  model: all-minilm\n  dimensions: 384\n---\n`;
    const cfg = await loadMemoryConfig('foundry', mockIO({ 'foundry/memory/config.md': text }));
    assert.equal(cfg.validation, 'lax');
    assert.equal(cfg.embeddings.model, 'all-minilm');
    assert.equal(cfg.embeddings.dimensions, 384);
    assert.equal(cfg.embeddings.baseURL, DEFAULT_CONFIG.embeddings.baseURL);
    assert.equal(cfg.embeddings.batchSize, DEFAULT_CONFIG.embeddings.batchSize);
  });

  it('rejects unknown validation mode', async () => {
    const text = `---\nenabled: true\nvalidation: weird\n---\n`;
    await assert.rejects(
      () => loadMemoryConfig('foundry', mockIO({ 'foundry/memory/config.md': text })),
      /validation.*must be/i,
    );
  });
});
