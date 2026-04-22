import { memoryPaths } from '../paths.js';
import { loadSchema, writeSchema, bumpVersion, hashFrontmatter } from '../schema.js';
import { invalidateStore } from '../singleton.js';

const IDENT = /^[a-z][a-z0-9_]*$/;

export async function createEntityType({ worktreeRoot, io, name, body }) {
  if (!IDENT.test(name)) throw new Error(`invalid identifier: '${name}' (expected lowercase snake_case)`);
  if (typeof body !== 'string' || !body.trim()) throw new Error(`body must be a non-empty string`);

  const p = memoryPaths('foundry');
  const schema = await loadSchema('foundry', io);

  if (schema.entities[name]) throw new Error(`entity type '${name}' already exists in schema`);
  if (schema.edges[name]) throw new Error(`'${name}' is already declared as an edge type`);
  if (await io.exists(p.entityTypeFile(name))) throw new Error(`entity type file already exists on disk`);

  const frontmatter = { type: name };
  const fileContent = `---\ntype: ${name}\n---\n\n${body.trim()}\n`;
  await io.writeFile(p.entityTypeFile(name), fileContent);
  await io.writeFile(p.relationFile(name), '');

  schema.entities[name] = { frontmatterHash: hashFrontmatter(frontmatter) };
  bumpVersion(schema);
  await writeSchema('foundry', schema, io);

  invalidateStore(worktreeRoot);
  return { type: name };
}
