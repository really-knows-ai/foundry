import { join, basename, extname } from 'node:path';
import { memoryPaths } from './paths.js';
import { parseFrontmatter } from './frontmatter.js';

function splitFrontmatter(text, filename) {
  const parsed = parseFrontmatter(text, { filename });
  return { frontmatter: parsed.frontmatter, body: parsed.body.trim() };
}

function validateEntity(filename, parsed) {
  const stem = basename(filename, extname(filename));
  const fm = parsed.frontmatter;
  if (!fm.type || typeof fm.type !== 'string') {
    throw new Error(`entity type ${filename}: missing frontmatter 'type'`);
  }
  if (fm.type !== stem) {
    throw new Error(`entity type ${filename}: frontmatter type '${fm.type}' does not match filename stem '${stem}'`);
  }
  if (!parsed.body) {
    throw new Error(`entity type ${filename}: empty body is not allowed`);
  }
}

function validateEdge(filename, parsed) {
  const stem = basename(filename, extname(filename));
  const fm = parsed.frontmatter;
  if (!fm.type || typeof fm.type !== 'string') {
    throw new Error(`edge type ${filename}: missing frontmatter 'type'`);
  }
  if (fm.type !== stem) {
    throw new Error(`edge type ${filename}: frontmatter type '${fm.type}' does not match filename stem '${stem}'`);
  }
  for (const key of ['sources', 'targets']) {
    const v = fm[key];
    if (v === undefined) throw new Error(`edge type ${filename}: missing frontmatter '${key}'`);
    if (v === 'any') continue;
    if (!Array.isArray(v) || v.length === 0 || !v.every((s) => typeof s === 'string' && s)) {
      throw new Error(`edge type ${filename}: '${key}' must be 'any' or a non-empty list of strings`);
    }
  }
  if (!parsed.body) {
    throw new Error(`edge type ${filename}: empty body is not allowed`);
  }
}

async function loadDir(dir, io) {
  if (!(await io.exists(dir))) return [];
  const entries = await io.readDir(dir);
  return entries.filter((e) => e.endsWith('.md') && e !== '.gitkeep').sort();
}

export async function loadVocabulary(foundryDir, io) {
  const p = memoryPaths(foundryDir);
  const vocab = { entities: {}, edges: {} };

  for (const file of await loadDir(p.entitiesDir, io)) {
    const fullPath = join(p.entitiesDir, file);
    const text = await io.readFile(fullPath);
    const parsed = splitFrontmatter(text, fullPath);
    validateEntity(file, parsed);
    const { type } = parsed.frontmatter;
    vocab.entities[type] = {
      type,
      body: parsed.body,
      frontmatter: parsed.frontmatter,
      file: fullPath,
    };
  }

  for (const file of await loadDir(p.edgesDir, io)) {
    const fullPath = join(p.edgesDir, file);
    const text = await io.readFile(fullPath);
    const parsed = splitFrontmatter(text, fullPath);
    validateEdge(file, parsed);
    const { type, sources, targets } = parsed.frontmatter;
    vocab.edges[type] = {
      type,
      sources,
      targets,
      body: parsed.body,
      frontmatter: parsed.frontmatter,
      file: fullPath,
    };
  }

  return vocab;
}
