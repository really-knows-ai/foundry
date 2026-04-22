import yaml from 'js-yaml';
import { memoryPaths } from './paths.js';

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

function parseFrontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  const parsed = yaml.load(m[1]);
  return parsed && typeof parsed === 'object' ? parsed : {};
}

function mergeEmbeddings(userE) {
  const base = { ...DEFAULT_CONFIG.embeddings };
  if (!userE || typeof userE !== 'object') return base;
  for (const key of Object.keys(base)) {
    if (key in userE && userE[key] !== undefined) base[key] = userE[key];
  }
  return base;
}

function validate(cfg) {
  if (!['strict', 'lax'].includes(cfg.validation)) {
    throw new Error(`memory config: validation must be 'strict' or 'lax', got ${JSON.stringify(cfg.validation)}`);
  }
  const e = cfg.embeddings;
  if (typeof e.enabled !== 'boolean') throw new Error('memory config: embeddings.enabled must be boolean');
  if (e.enabled) {
    if (typeof e.baseURL !== 'string' || !e.baseURL) throw new Error('memory config: embeddings.baseURL required');
    if (typeof e.model !== 'string' || !e.model) throw new Error('memory config: embeddings.model required');
    if (!Number.isInteger(e.dimensions) || e.dimensions <= 0) throw new Error('memory config: embeddings.dimensions must be positive integer');
    if (!Number.isInteger(e.batchSize) || e.batchSize <= 0) throw new Error('memory config: embeddings.batchSize must be positive integer');
  }
}

export async function loadMemoryConfig(foundryDir, io) {
  const p = memoryPaths(foundryDir);
  if (!(await io.exists(p.config))) {
    return { ...DEFAULT_CONFIG, embeddings: { ...DEFAULT_CONFIG.embeddings } };
  }
  const text = await io.readFile(p.config);
  const fm = parseFrontmatter(text);
  const cfg = {
    present: true,
    enabled: fm.enabled === true,
    validation: fm.validation ?? DEFAULT_CONFIG.validation,
    embeddings: mergeEmbeddings(fm.embeddings),
  };
  validate(cfg);
  return cfg;
}
