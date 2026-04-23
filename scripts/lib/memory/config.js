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
  const { frontmatter: fm } = parseFrontmatter(text, { filename: p.config });
  // `enabled` must be a real YAML boolean. YAML's `true` / `false` parse as
  // booleans; `"true"` (quoted) parses as a string and would previously have
  // silently disabled memory via the `=== true` check. Throw with a
  // filename-prefixed message so the user fixes config.md rather than
  // debugging a phantom "memory off" state.
  if (fm.enabled !== undefined && typeof fm.enabled !== 'boolean') {
    throw new Error(
      `memory config (${p.config}): enabled must be a YAML boolean (true/false), got ${JSON.stringify(fm.enabled)}`,
    );
  }
  const cfg = {
    present: true,
    enabled: fm.enabled === true,
    validation: fm.validation ?? DEFAULT_CONFIG.validation,
    embeddings: mergeEmbeddings(fm.embeddings),
  };
  // Gate embeddings on the outer switch: if memory is disabled, embeddings are
  // disabled too — regardless of what DEFAULT_CONFIG.embeddings.enabled says or
  // what leaked through a partial user-supplied embeddings block. This prevents
  // validate() from enforcing baseURL/model/dimensions against a provider the
  // user never configured, and prevents the init-memory probe from firing for
  // a memory install that was explicitly turned off.
  if (!cfg.enabled) {
    cfg.embeddings = { ...cfg.embeddings, enabled: false };
  }
  validate(cfg);
  return cfg;
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
  let existingFm = {};
  let body = '';
  if (await io.exists(p.config)) {
    const text = await io.readFile(p.config);
    const parsed = parseFrontmatter(text, { filename: p.config });
    if (parsed.hasFrontmatter) {
      existingFm = parsed.frontmatter;
      body = parsed.body;
    } else {
      body = text;
    }
  }

  const nextFm = { ...existingFm };
  if ('enabled' in updates) nextFm.enabled = updates.enabled;
  if ('validation' in updates) nextFm.validation = updates.validation;
  if (updates.embeddings && typeof updates.embeddings === 'object') {
    const baseE = (existingFm.embeddings && typeof existingFm.embeddings === 'object')
      ? existingFm.embeddings
      : {};
    nextFm.embeddings = { ...baseE, ...updates.embeddings };
  }

  await io.writeFile(p.config, renderMarkdown(nextFm, body));
}
