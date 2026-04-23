import yaml from 'js-yaml';
import { memoryPaths } from '../memory/paths.js';

const IDENT = /^[a-z][a-z0-9_-]*$/;

function parseTimeout(v) {
  if (v === undefined || v === null) return 60_000;
  if (typeof v === 'number') {
    if (!Number.isFinite(v) || v <= 0) throw new Error(`timeout must be a positive number (ms) or duration string`);
    return v;
  }
  if (typeof v !== 'string') throw new Error(`timeout must be a duration string (e.g. "30s") or a number of ms`);
  const m = v.trim().match(/^(\d+)(ms|s|m)?$/);
  if (!m) throw new Error(`timeout: unrecognised duration '${v}' (expected e.g. "500ms", "30s", "2m")`);
  const n = Number(m[1]);
  const unit = m[2] ?? 'ms';
  if (unit === 'ms') return n;
  if (unit === 's') return n * 1000;
  if (unit === 'm') return n * 60_000;
  throw new Error(`timeout: impossible unit ${unit}`);
}

function splitFrontmatter(text) {
  const lines = text.split(/\r?\n/);
  if (lines[0] !== '---') throw new Error(`missing frontmatter: file must start with '---'`);
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---') { end = i; break; }
  }
  if (end === -1) throw new Error(`missing frontmatter: no closing '---'`);
  const fmText = lines.slice(1, end).join('\n');
  const body = lines.slice(end + 1).join('\n').replace(/^\s+/, '');
  const fm = yaml.load(fmText) ?? {};
  if (typeof fm !== 'object' || Array.isArray(fm)) throw new Error(`frontmatter must be a mapping`);
  return { fm, body };
}

export async function loadExtractor(foundryDir, name, io) {
  if (!IDENT.test(name)) throw new Error(`invalid extractor name '${name}' (expected lowercase identifier)`);
  const p = memoryPaths(foundryDir);
  const path = p.extractorFile(name);
  if (!(await io.exists(path))) throw new Error(`extractor not found: ${name} (expected at ${path})`);
  const text = await io.readFile(path);
  const { fm, body } = splitFrontmatter(text);
  if (typeof fm.command !== 'string' || !fm.command.trim()) {
    throw new Error(`extractor '${name}': 'command' is required and must be a non-empty string`);
  }
  const writeList = fm?.memory?.write;
  if (!Array.isArray(writeList) || writeList.length === 0) {
    throw new Error(`extractor '${name}': 'memory.write' is required and must be a non-empty array of entity type names`);
  }
  for (const t of writeList) {
    if (typeof t !== 'string' || !IDENT.test(t)) {
      throw new Error(`extractor '${name}': memory.write entry '${t}' is not a valid entity type identifier`);
    }
  }
  const timeoutMs = parseTimeout(fm.timeout);
  return {
    name,
    command: fm.command,
    memoryWrite: writeList,
    timeoutMs,
    body: body,
  };
}

export async function listExtractors(foundryDir, io) {
  const p = memoryPaths(foundryDir);
  if (!(await io.exists(p.extractorsDir))) return [];
  const entries = await io.readDir(p.extractorsDir);
  return entries
    .filter((f) => f.endsWith('.md'))
    .map((f) => f.slice(0, -3))
    .sort();
}
