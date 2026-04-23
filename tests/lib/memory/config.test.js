import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadMemoryConfig, writeMemoryConfig, DEFAULT_CONFIG } from '../../../scripts/lib/memory/config.js';

function mockIO(files) {
  return {
    exists: async (p) => p in files,
    readFile: async (p) => {
      if (!(p in files)) throw new Error(`Not found: ${p}`);
      return files[p];
    },
    writeFile: async (p, data) => { files[p] = data; },
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

  it('forces embeddings.enabled=false when outer enabled is false', async () => {
    // User wrote `enabled: false` and omitted the embeddings block entirely.
    // Without the gating, mergeEmbeddings would return
    // DEFAULT_CONFIG.embeddings (enabled:true) and validate() would then
    // enforce baseURL/model/dimensions against a provider the user never
    // configured.
    const text = `---\nenabled: false\n---\n`;
    const cfg = await loadMemoryConfig('foundry', mockIO({ 'foundry/memory/config.md': text }));
    assert.equal(cfg.enabled, false);
    assert.equal(cfg.embeddings.enabled, false);
  });

  it('forces embeddings.enabled=false even when user explicitly set embeddings.enabled=true but outer is false', async () => {
    // Semantic: memory is off → embeddings are off. No validation error either.
    const text = `---\nenabled: false\nembeddings:\n  enabled: true\n  model: some-model\n  dimensions: 768\n---\n`;
    const cfg = await loadMemoryConfig('foundry', mockIO({ 'foundry/memory/config.md': text }));
    assert.equal(cfg.enabled, false);
    assert.equal(cfg.embeddings.enabled, false);
    // Other embeddings values are preserved (in case the user turns it back on later).
    assert.equal(cfg.embeddings.model, 'some-model');
    assert.equal(cfg.embeddings.dimensions, 768);
  });

  it('leaves embeddings.enabled=true untouched when outer enabled is true', async () => {
    const text = `---\nenabled: true\nembeddings:\n  enabled: true\n  model: m\n  dimensions: 4\n---\n`;
    const cfg = await loadMemoryConfig('foundry', mockIO({ 'foundry/memory/config.md': text }));
    assert.equal(cfg.enabled, true);
    assert.equal(cfg.embeddings.enabled, true);
  });

  it('throws when enabled is a quoted YAML string instead of a boolean', async () => {
    const text = `---\nenabled: "true"\n---\n`;
    await assert.rejects(
      () => loadMemoryConfig('foundry', mockIO({ 'foundry/memory/config.md': text })),
      /enabled must be a YAML boolean/,
    );
  });

  it('throws when enabled is a number', async () => {
    const text = `---\nenabled: 1\n---\n`;
    await assert.rejects(
      () => loadMemoryConfig('foundry', mockIO({ 'foundry/memory/config.md': text })),
      /enabled must be a YAML boolean/,
    );
  });

  it('treats missing enabled key as disabled (back-compat)', async () => {
    const text = `---\nvalidation: strict\n---\n`;
    const cfg = await loadMemoryConfig('foundry', mockIO({ 'foundry/memory/config.md': text }));
    assert.equal(cfg.enabled, false);
  });
});

describe('writeMemoryConfig', () => {
  it('updates embeddings block and preserves body', async () => {
    const files = {
      'foundry/memory/config.md':
        `---\nenabled: true\nvalidation: strict\nembeddings:\n  enabled: true\n  baseURL: http://old\n  model: old-model\n  dimensions: 768\n  apiKey: null\n  batchSize: 64\n  timeoutMs: 30000\n---\n\n# Memory configuration\n\nHand-written notes preserved here.\n`,
    };
    await writeMemoryConfig('foundry', {
      embeddings: {
        enabled: true,
        model: 'new-model',
        dimensions: 1024,
        baseURL: 'http://new',
        apiKey: null,
        batchSize: 64,
        timeoutMs: 30000,
      },
    }, mockIO(files));
    const text = files['foundry/memory/config.md'];
    assert.match(text, /model: new-model/);
    assert.match(text, /dimensions: 1024/);
    assert.match(text, /baseURL: http:\/\/new/);
    assert.match(text, /# Memory configuration/);
    assert.match(text, /Hand-written notes preserved here\./);
    // The reloaded config matches what we wrote.
    const cfg = await loadMemoryConfig('foundry', mockIO(files));
    assert.equal(cfg.embeddings.model, 'new-model');
    assert.equal(cfg.embeddings.dimensions, 1024);
    assert.equal(cfg.embeddings.baseURL, 'http://new');
    assert.equal(cfg.enabled, true);
  });

  it('merges embeddings partial updates onto existing values', async () => {
    const files = {
      'foundry/memory/config.md':
        `---\nenabled: true\nembeddings:\n  enabled: true\n  baseURL: http://keep\n  model: keep-model\n  dimensions: 768\n  batchSize: 32\n---\n`,
    };
    await writeMemoryConfig('foundry', {
      embeddings: { model: 'swapped', dimensions: 1536 },
    }, mockIO(files));
    const cfg = await loadMemoryConfig('foundry', mockIO(files));
    assert.equal(cfg.embeddings.baseURL, 'http://keep');
    assert.equal(cfg.embeddings.batchSize, 32);
    assert.equal(cfg.embeddings.model, 'swapped');
    assert.equal(cfg.embeddings.dimensions, 1536);
  });

  it('creates config.md when missing', async () => {
    const files = {};
    await writeMemoryConfig('foundry', {
      enabled: true,
      validation: 'strict',
      embeddings: {
        enabled: true,
        baseURL: 'http://x',
        model: 'm',
        dimensions: 8,
        batchSize: 16,
        timeoutMs: 1000,
      },
    }, mockIO(files));
    assert.ok(files['foundry/memory/config.md']);
    const cfg = await loadMemoryConfig('foundry', mockIO(files));
    assert.equal(cfg.enabled, true);
    assert.equal(cfg.embeddings.model, 'm');
  });
});
