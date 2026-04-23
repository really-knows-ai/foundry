import { join } from 'node:path';
import { memoryPaths } from '../paths.js';
import { DEFAULT_CONFIG } from '../config.js';
import { renderMarkdown } from '../frontmatter.js';
import { probeEmbeddings } from '../embeddings.js';

const CONFIG_BODY = `
# Memory configuration

This project uses Foundry flow memory. Add prose notes here if helpful.

The embedding provider defaults to a local Ollama instance. Edit the
frontmatter to point at a different OpenAI-compatible endpoint, or set
\`embeddings.enabled: false\` if you don't want vector search.
`;

const DEFAULT_GITIGNORE_ENTRIES = [
  'foundry/memory/memory.db',
  'foundry/memory/memory.db-wal',
  'foundry/memory/memory.db-shm',
];

/**
 * Scaffold `foundry/memory/` deterministically.
 *
 * Creates:
 *   - entities/.gitkeep, edges/.gitkeep, relations/.gitkeep
 *   - config.md (frontmatter derived from DEFAULT_CONFIG)
 *   - schema.json (version 1, empty entities/edges, embeddings block
 *     populated from DEFAULT_CONFIG when enabled, null otherwise)
 *   - appends .gitignore entries (idempotent)
 *
 * When `embeddingsEnabled && probe`, runs a single probe against the
 * configured provider and returns the result. The caller decides whether to
 * surface probe failure to the user — initMemory itself does not fail on a
 * bad probe (config.md already on disk with sensible defaults can be edited).
 *
 * @param {object} opts
 * @param {object} opts.io                    memory-style IO (exists, readFile, writeFile, mkdir)
 * @param {boolean} [opts.embeddingsEnabled]  default true
 * @param {boolean} [opts.probe]              default true; only runs if embeddingsEnabled
 * @returns {Promise<{ created: string[], gitignoreAdded: string[], probe: object|null }>}
 */
export async function initMemory({ io, embeddingsEnabled = true, probe = true }) {
  const p = memoryPaths('foundry');

  if (!(await io.exists('foundry'))) {
    throw new Error('foundry/ does not exist; run init-foundry first');
  }
  if (await io.exists(p.root)) {
    throw new Error('foundry/memory/ already exists');
  }

  const created = [];

  await io.mkdir(p.entitiesDir);
  await io.mkdir(p.edgesDir);
  await io.mkdir(p.relationsDir);

  for (const d of [p.entitiesDir, p.edgesDir, p.relationsDir]) {
    const f = join(d, '.gitkeep');
    await io.writeFile(f, '');
    created.push(f);
  }

  const defaults = DEFAULT_CONFIG.embeddings;
  const embeddingsBlock = {
    enabled: embeddingsEnabled,
    baseURL: defaults.baseURL,
    model: defaults.model,
    dimensions: defaults.dimensions,
    apiKey: null,
    batchSize: defaults.batchSize,
    timeoutMs: defaults.timeoutMs,
  };
  const configFm = {
    enabled: true,
    validation: 'strict',
    embeddings: embeddingsBlock,
  };
  await io.writeFile(p.config, renderMarkdown(configFm, CONFIG_BODY));
  created.push(p.config);

  const schema = {
    version: 1,
    entities: {},
    edges: {},
    embeddings: embeddingsEnabled
      ? { model: defaults.model, dimensions: defaults.dimensions }
      : null,
  };
  await io.writeFile(p.schema, JSON.stringify(schema, null, 2) + '\n');
  created.push(p.schema);

  const gitignoreAdded = await appendGitignore(io, DEFAULT_GITIGNORE_ENTRIES);

  let probeResult = null;
  if (probe && embeddingsEnabled) {
    try {
      probeResult = await probeEmbeddings({ config: embeddingsBlock });
    } catch (err) {
      probeResult = { ok: false, error: err?.message ?? String(err) };
    }
  }

  return { created, gitignoreAdded, probe: probeResult };
}

async function appendGitignore(io, entries) {
  const path = '.gitignore';
  const exists = await io.exists(path);
  const current = exists ? await io.readFile(path) : '';
  const present = new Set(current.split(/\r?\n/).map((l) => l.trim()));
  const toAdd = entries.filter((e) => !present.has(e));
  if (toAdd.length === 0) return [];
  const tail = current.length === 0 || current.endsWith('\n') ? '' : '\n';
  await io.writeFile(path, current + tail + toAdd.join('\n') + '\n');
  return toAdd;
}
