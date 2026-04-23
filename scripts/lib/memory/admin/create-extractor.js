import { memoryPaths } from '../paths.js';
import { loadSchema } from '../schema.js';

const IDENT = /^[a-z][a-z0-9_-]*$/;

export async function createExtractor({ worktreeRoot, io, name, command, memoryWrite, timeout, body }) {
  if (!IDENT.test(name)) throw new Error(`invalid identifier: '${name}' (expected lowercase kebab/snake)`);
  if (typeof command !== 'string' || !command.trim()) throw new Error(`command must be a non-empty string`);
  if (!Array.isArray(memoryWrite) || memoryWrite.length === 0) {
    throw new Error(`memoryWrite must be a non-empty array of entity type names`);
  }
  if (typeof body !== 'string' || !body.trim()) throw new Error(`body must be a non-empty string`);

  const schema = await loadSchema('foundry', io);
  const undeclared = memoryWrite.filter((t) => !schema.entities[t]);
  if (undeclared.length) {
    throw new Error(`memoryWrite includes ${undeclared.join(', ')} which ${undeclared.length > 1 ? 'are' : 'is'} not declared in the project vocabulary (create entity types with add-memory-entity-type)`);
  }

  const p = memoryPaths('foundry');
  const path = p.extractorFile(name);
  if (await io.exists(path)) throw new Error(`extractor already exists: ${name} (${path})`);

  // Ensure the extractors directory exists.
  if (!(await io.exists(p.extractorsDir))) {
    await io.mkdir(p.extractorsDir, { recursive: true });
  }

  const writeLine = `  write: [${memoryWrite.join(', ')}]`;
  const timeoutLine = timeout ? `timeout: ${timeout}\n` : '';
  const fileContent =
    `---\n` +
    `command: ${command}\n` +
    `memory:\n` +
    `${writeLine}\n` +
    timeoutLine +
    `---\n\n` +
    `# ${name}\n\n` +
    `${body.trim()}\n`;

  await io.writeFile(path, fileContent);
  return { path };
}
