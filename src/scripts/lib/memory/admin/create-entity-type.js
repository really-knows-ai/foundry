import { memoryPaths } from '../paths.js';
import { loadSchema, writeSchema, bumpVersion, hashFrontmatter } from '../schema.js';
import { invalidateStore } from '../singleton.js';
import { withLiveMemoryDb, createLiveEntityType } from './live-store.js';

const IDENT = /^[a-z][a-z0-9_]*$/;

function validateInputs(name, body) {
  if (!IDENT.test(name)) throw new Error(`invalid identifier: '${name}' (expected lowercase snake_case)`);
  if (typeof body !== 'string' || !body.trim()) throw new Error(`body must be a non-empty string`);
}

export async function createEntityType({ worktreeRoot, io, name, body }) {
  validateInputs(name, body);

  // Use relative path 'foundry' since the IO abstraction joins with worktreeRoot.
  // worktreeRoot is used for invalidateStore() and withLiveMemoryDb() calls.
  const foundryDir = 'foundry';
  const p = memoryPaths(foundryDir);
  const schema = await loadSchema(foundryDir, io);

  if (schema.entities[name]) throw new Error(`entity type '${name}' already exists in schema`);
  if (schema.edges[name]) throw new Error(`'${name}' is already declared as an edge type`);
  if (await io.exists(p.entityTypeFile(name))) throw new Error(`entity type file already exists on disk`);

  const frontmatter = { type: name };
  const fileContent = `---\ntype: ${name}\n---\n\n${body.trim()}\n`;
  await io.writeFile(p.entityTypeFile(name), fileContent);
  await io.writeFile(p.relationFile(name), '');

  // eslint-disable-next-line require-atomic-updates
  schema.entities[name] = { frontmatterHash: hashFrontmatter(frontmatter) };
  bumpVersion(schema);
  await writeSchema(foundryDir, schema, io);

  try {
    await withLiveMemoryDb({ worktreeRoot, io }, async (db) => {
      await createLiveEntityType(db, name, { embeddingsDim: schema.embeddings?.dimensions });
    });
  } finally {
    invalidateStore(worktreeRoot);
  }
  return { type: name };
}
