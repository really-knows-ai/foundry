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

// Gitignore only the runtime DB files under foundry/memory/.
// foundry-memory/relations/ (NDJSON row data) is intentionally tracked.
const DEFAULT_GITIGNORE_ENTRIES = [
  'foundry/memory/memory.db',
  'foundry/memory/memory.db-wal',
  'foundry/memory/memory.db-shm',
];

function buildEmbeddingsBlock(embeddingsEnabled) {
  const d = DEFAULT_CONFIG.embeddings;
  return {
    enabled: embeddingsEnabled,
    baseURL: d.baseURL,
    model: d.model,
    dimensions: d.dimensions,
    apiKey: null,
    batchSize: d.batchSize,
    timeoutMs: d.timeoutMs,
  };
}

function buildConfigFm(embeddingsBlock) {
  return {
    enabled: true,
    validation: 'strict',
    embeddings: embeddingsBlock,
  };
}

async function createGitkeeps(io, dirs, created) {
  for (const d of dirs) {
    const f = join(d, '.gitkeep');
    await io.writeFile(f, '');
    created.push(f);
  }
}

function handleProbeError(err) {
  return { ok: false, error: err?.message ?? String(err) };
}

async function runProbe(embeddingsBlock) {
  try {
    const result = await probeEmbeddings({ config: embeddingsBlock });
    if (result.ok) {
      return { probeResult: result, actualDimensions: result.dimensions };
    }
    return { probeResult: result, actualDimensions: DEFAULT_CONFIG.embeddings.dimensions };
  } catch (err) {
    return { probeResult: handleProbeError(err), actualDimensions: DEFAULT_CONFIG.embeddings.dimensions };
  }
}

async function probeEmbeddingsIfNeeded(embeddingsEnabled, probe, embeddingsBlock) {
  if (!probe || !embeddingsEnabled) {
    return { probeResult: null, actualDimensions: DEFAULT_CONFIG.embeddings.dimensions };
  }
  return runProbe(embeddingsBlock);
}

function buildSchema(embeddingsEnabled, model, dimensions) {
  return {
    version: 1,
    entities: {},
    edges: {},
    embeddings: embeddingsEnabled
      ? { model, dimensions }
      : null,
  };
}

async function validatePrerequisites(io, p) {
  if (!(await io.exists('foundry'))) {
    throw new Error('foundry/ does not exist. Restart OpenCode to initialise Foundry.');
  }
  if (await io.exists(p.root)) {
    throw new Error('foundry/memory/ already exists');
  }
  if (await io.exists('foundry-memory')) {
    throw new Error('foundry-memory/ already exists');
  }
}

async function writeConfigFile(io, configPath, embeddingsEnabled) {
  const embeddingsBlock = buildEmbeddingsBlock(embeddingsEnabled);
  const configFm = buildConfigFm(embeddingsBlock);
  await io.writeFile(configPath, renderMarkdown(configFm, CONFIG_BODY));
  return embeddingsBlock;
}

/**
 * Scaffold `foundry/memory/` and `foundry-memory/relations/` deterministically.
 *
 * Creates:
 *   - entities/.gitkeep, edges/.gitkeep under foundry/memory/
 *   - foundry-memory/relations/.gitkeep (sibling of foundry/, holds row data)
 *   - config.md (frontmatter derived from DEFAULT_CONFIG)
 *   - schema.json (version 1, empty entities/edges, embeddings block
 *     populated from probe when enabled, null otherwise)
 *   - appends .gitignore entries (idempotent)
 *
 * When `embeddingsEnabled && probe`, probes the embedding provider first, then
 * writes schema.json with the actual dimensions returned by the probe (if
 * successful). If probe fails or is disabled, uses DEFAULT_CONFIG dimensions.
 * The caller decides whether to surface probe failure to the user — initMemory
 * itself does not fail on a bad probe (config.md already on disk with sensible
 * defaults can be edited).
 *
 * @param {object} opts
 * @param {object} opts.io                    memory-style IO (exists, readFile, writeFile, mkdir)
 * @param {boolean} [opts.embeddingsEnabled]  default true
 * @param {boolean} [opts.probe]              default true; only runs if embeddingsEnabled
 * @returns {Promise<{ created: string[], gitignoreAdded: string[], probe: object|null }>}
 */
export async function initMemory({ io, embeddingsEnabled = true, probe = true }) {
  const p = memoryPaths('foundry');
  await validatePrerequisites(io, p);

  const created = [];

  await io.mkdir(p.entitiesDir);
  await io.mkdir(p.edgesDir);
  await io.mkdir(p.relationsDir);
  await createGitkeeps(io, [p.entitiesDir, p.edgesDir, p.relationsDir], created);

  const embeddingsBlock = await writeConfigFile(io, p.config, embeddingsEnabled);
  created.push(p.config);

  const gitignoreAdded = await appendGitignore(io, DEFAULT_GITIGNORE_ENTRIES);

  const { probeResult, actualDimensions } = await probeEmbeddingsIfNeeded(
    embeddingsEnabled,
    probe,
    embeddingsBlock,
  );

  const schema = buildSchema(embeddingsEnabled, DEFAULT_CONFIG.embeddings.model, actualDimensions);
  await io.writeFile(p.schema, JSON.stringify(schema, null, 2) + '\n');
  created.push(p.schema);

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
