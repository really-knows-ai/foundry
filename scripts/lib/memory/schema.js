import { createHash } from 'node:crypto';
import { memoryPaths } from './paths.js';

export function emptySchema() {
  return { version: 1, entities: {}, edges: {}, embeddings: null };
}

export async function loadSchema(foundryDir, io) {
  const p = memoryPaths(foundryDir);
  if (!(await io.exists(p.schema))) return emptySchema();
  const text = await io.readFile(p.schema);
  const parsed = JSON.parse(text);
  return {
    version: parsed.version ?? 1,
    entities: parsed.entities ?? {},
    edges: parsed.edges ?? {},
    embeddings: parsed.embeddings ?? null,
  };
}

function normaliseForWrite(schema) {
  // Full deep canonicalisation: sorts keys at every level so nested objects
  // (e.g. `entities.<type> = { frontmatterHash: ..., other: ... }`) also
  // stabilise. Previously only top-level `entities` and `edges` keys were
  // sorted, leaving any per-type record order dependent on insertion order —
  // which produced meaningless diffs across runs.
  return canonicalise({
    version: schema.version,
    entities: schema.entities,
    edges: schema.edges,
    embeddings: schema.embeddings,
  });
}

export async function writeSchema(foundryDir, schema, io) {
  const p = memoryPaths(foundryDir);
  if (!(await io.exists(p.root))) await io.mkdir(p.root);
  const out = normaliseForWrite(schema);
  const text = JSON.stringify(out, null, 2) + '\n';
  await io.writeFile(p.schema, text);
}

export function bumpVersion(schema) {
  schema.version = (schema.version ?? 0) + 1;
  return schema.version;
}

function canonicalise(value) {
  if (Array.isArray(value)) return value.map(canonicalise);
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value).sort()) out[k] = canonicalise(value[k]);
    return out;
  }
  return value;
}

export function hashFrontmatter(fm) {
  const canon = JSON.stringify(canonicalise(fm ?? {}));
  return createHash('sha256').update(canon).digest('hex');
}
