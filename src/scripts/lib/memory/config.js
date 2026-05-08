import { memoryPaths } from './paths.js';
import { parseFrontmatter, renderMarkdown } from './frontmatter.js';

export const DEFAULT_CONFIG = Object.freeze({
  enabled: false,
  present: false,
  validation: 'strict',
  embeddings: Object.freeze({
    enabled: true,
    baseURL: 'http://localhost:11434/v1',
    model: 'nomic-embed-text',
    dimensions: 768,
    apiKey: null,
    batchSize: 64,
    timeoutMs: 30000,
  }),
});

function mergeEmbeddings(userE) {
  const base = { ...DEFAULT_CONFIG.embeddings };
  if (!userE) return base;
  if (typeof userE !== 'object') return base;
  for (const [key, value] of Object.entries(userE)) {
    if (key in base && value !== undefined) base[key] = value;
  }
  return base;
}

function assertValidationValid(value) {
  if (!['strict', 'lax'].includes(value)) {
    throw new Error(`memory config: validation must be 'strict' or 'lax', got ${JSON.stringify(value)}`);
  }
}

function assertEmbeddingsEnabled(e) {
  if (typeof e.enabled !== 'boolean') throw new Error('memory config: embeddings.enabled must be boolean');
}

function assertEmbeddingsFields(e) {
  const checks = [
    [typeof e.baseURL === 'string' && e.baseURL, 'memory config: embeddings.baseURL required'],
    [typeof e.model === 'string' && e.model, 'memory config: embeddings.model required'],
    [Number.isInteger(e.dimensions) && e.dimensions > 0, 'memory config: embeddings.dimensions must be positive integer'],
    [Number.isInteger(e.batchSize) && e.batchSize > 0, 'memory config: embeddings.batchSize must be positive integer'],
  ];
  for (const [ok, msg] of checks) {
    if (!ok) throw new Error(msg);
  }
}

function validate(cfg) {
  assertValidationValid(cfg.validation);
  assertEmbeddingsEnabled(cfg.embeddings);
  if (cfg.embeddings.enabled) {
    assertEmbeddingsFields(cfg.embeddings);
  }
}

function assertEnabledValid(enabled, configPath) {
  if (enabled !== undefined && typeof enabled !== 'boolean') {
    throw new Error(
      `memory config (${configPath}): enabled must be a YAML boolean (true/false), got ${JSON.stringify(enabled)}`,
    );
  }
}

function buildConfig(fm) {
  const cfg = {
    present: true,
    enabled: fm.enabled === true,
    validation: fm.validation ?? DEFAULT_CONFIG.validation,
    embeddings: mergeEmbeddings(fm.embeddings),
  };
  if (!cfg.enabled) {
    cfg.embeddings = { ...cfg.embeddings, enabled: false };
  }
  return cfg;
}

export async function loadMemoryConfig(foundryDir, io) {
  const p = memoryPaths(foundryDir);
  if (!(await io.exists(p.config))) {
    return { ...DEFAULT_CONFIG, embeddings: { ...DEFAULT_CONFIG.embeddings } };
  }
  const text = await io.readFile(p.config);
  const { frontmatter: fm } = parseFrontmatter(text, { filename: p.config });
  assertEnabledValid(fm.enabled, p.config);
  const cfg = buildConfig(fm);
  validate(cfg);
  return cfg;
}

async function loadExistingFrontmatter(p, io) {
  if (!(await io.exists(p.config))) {
    return { frontmatter: {}, body: '' };
  }
  const text = await io.readFile(p.config);
  const parsed = parseFrontmatter(text, { filename: p.config });
  if (parsed.hasFrontmatter) {
    return { frontmatter: parsed.frontmatter, body: parsed.body };
  }
  return { frontmatter: {}, body: text };
}

function mergeFrontmatterUpdates(existingFm, updates) {
  const nextFm = { ...existingFm };
  if ('enabled' in updates) nextFm.enabled = updates.enabled;
  if ('validation' in updates) nextFm.validation = updates.validation;
  if (updates.embeddings && typeof updates.embeddings === 'object') {
    const baseE = typeof existingFm.embeddings === 'object' && existingFm.embeddings
      ? existingFm.embeddings
      : {};
    nextFm.embeddings = { ...baseE, ...updates.embeddings };
  }
  return nextFm;
}

/**
 * Rewrite foundry/memory/config.md with updated embeddings settings.
 * Preserves any existing markdown body after the frontmatter. If config.md
 * is missing, creates a minimal one with no body.
 *
 * `updates.embeddings` is merged into existing embeddings frontmatter; other
 * top-level keys in `updates` (enabled, validation) overwrite if provided.
 */
export async function writeMemoryConfig(foundryDir, updates, io) {
  const p = memoryPaths(foundryDir);
  const { frontmatter: existingFm, body } = await loadExistingFrontmatter(p, io);
  const nextFm = mergeFrontmatterUpdates(existingFm, updates);
  await io.writeFile(p.config, renderMarkdown(nextFm, body));
}
