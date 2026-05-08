import { memoryPaths } from '../paths.js';
import { loadSchema } from '../schema.js';

const IDENT = /^[a-z][a-z0-9_-]*$/;

function validateName(name) {
  if (!IDENT.test(name)) throw new Error(`invalid identifier: '${name}' (expected lowercase kebab/snake)`);
}

function validateCommand(command) {
  if (typeof command !== 'string' || !command.trim()) throw new Error(`command must be a non-empty string`);
}

function validateMemoryWrite(memoryWrite) {
  if (!Array.isArray(memoryWrite) || memoryWrite.length === 0) {
    throw new Error(`memoryWrite must be a non-empty array of entity type names`);
  }
}

function validateBody(body) {
  if (typeof body !== 'string' || !body.trim()) throw new Error(`body must be a non-empty string`);
}

async function validateSchemaTypes(foundryDir, io, memoryWrite) {
  const schema = await loadSchema(foundryDir, io);
  const undeclared = memoryWrite.filter((t) => !schema.entities[t]);
  if (undeclared.length) {
    throw new Error(`memoryWrite includes ${undeclared.join(', ')} which ${undeclared.length > 1 ? 'are' : 'is'} not declared in the project vocabulary (create entity types with add-memory-entity-type)`);
  }
}

async function ensureExtractorsDir(p, io) {
  if (!(await io.exists(p.extractorsDir))) {
    await io.mkdir(p.extractorsDir, { recursive: true });
  }
}

export async function createExtractor({ worktreeRoot, io, name, command, memoryWrite, timeout, body }) {
  validateName(name);
  validateCommand(command);
  validateMemoryWrite(memoryWrite);
  validateBody(body);

  const foundryDir = 'foundry';
  await validateSchemaTypes(foundryDir, io, memoryWrite);

  const p = memoryPaths(foundryDir);
  const path = p.extractorFile(name);
  if (await io.exists(path)) throw new Error(`extractor already exists: ${name} (${path})`);

  await ensureExtractorsDir(p, io);

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
