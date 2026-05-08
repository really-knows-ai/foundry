import yaml from 'js-yaml';
import { memoryPaths } from '../memory/paths.js';

/**
 * Extractor Contract
 * ==================
 *
 * An extractor is a project-authored executable (script, binary, etc.) that
 * emits JSONL (newline-delimited JSON) describing entities and edges to upsert
 * into flow memory.
 *
 * Output Format:
 * - One JSON object per line (JSONL/NDJSON format)
 * - Pretty-printed multi-line JSON is NOT supported
 * - Blank lines and lines starting with '#' are ignored
 * - Each object must have a "kind" field: "entity" or "edge"
 *
 * Entity format:
 *   {"kind":"entity","type":"<entity-type>","name":"<id>","value":"<string ≤ 4KB>"}
 *
 * Edge format:
 *   {"kind":"edge","from":{"type":"...","name":"..."},"edge":"<edge-type>","to":{"type":"...","name":"..."}}
 *
 * Exit codes:
 * - 0 on success
 * - Non-zero on failure (aborts the assay stage)
 *
 * Environment:
 * - Extractors inherit the agent's full environment, including any API tokens
 *   or credentials present in the agent process
 * - Extractors are project-authored, committed code; they are trusted paths
 * - Keep environment variable handling internal to extraction logic
 */

const IDENT = /^[a-z][a-z0-9_-]*$/;
const MAX_TIMEOUT_MS = 600_000;

function validateTimeoutMs(ms) {
  if (!Number.isFinite(ms) || ms <= 0) throw new Error(`timeout must be a positive number (ms) or duration string`);
  if (ms > MAX_TIMEOUT_MS) throw new Error(`timeout must not exceed 600000ms (10 minutes)`);
  return ms;
}

function parseNumberTimeout(v) {
  return validateTimeoutMs(v);
}

function unitToMs(unit) {
  if (unit === 'ms') return 1;
  if (unit === 's') return 1_000;
  if (unit === 'm') return 60_000;
  throw new Error(`timeout: impossible unit ${unit}`);
}

function parseStringTimeout(v) {
  const trimmed = v.trim();
  const m = trimmed.match(/^(\d+)(ms|s|m)?$/);
  if (!m) throw new Error(`timeout: unrecognised duration '${trimmed}' (expected e.g. "500ms", "30s", "2m")`);
  const n = Number(m[1]);
  const unit = m[2] ?? 'ms';
  const ms = n * unitToMs(unit);
  return validateTimeoutMs(ms);
}

function parseTimeout(v) {
  if (v === undefined || v === null) return 60_000;
  if (typeof v === 'number') return parseNumberTimeout(v);
  if (typeof v !== 'string') throw new Error(`timeout must be a duration string (e.g. "30s") or a number of ms`);
  return parseStringTimeout(v);
}

function stripBom(text) {
  return text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
}

function findFrontmatterEnd(lines) {
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---') return i;
  }
  return -1;
}

function parseFrontmatterYaml(fmText) {
  const fm = yaml.load(fmText) ?? {};
  if (typeof fm !== 'object' || Array.isArray(fm)) throw new Error(`frontmatter must be a mapping`);
  return fm;
}

function splitFrontmatter(text) {
  const stripped = stripBom(text);
  const lines = stripped.split(/\r?\n/);
  if (lines[0] !== '---') throw new Error(`missing frontmatter: file must start with '---'`);
  const end = findFrontmatterEnd(lines);
  if (end === -1) throw new Error(`missing frontmatter: no closing '---'`);
  const fmText = lines.slice(1, end).join('\n');
  const body = lines.slice(end + 1).join('\n').replace(/^\s+/, '');
  const fm = parseFrontmatterYaml(fmText);
  return { fm, body };
}

function validateCommand(fm, name) {
  if (typeof fm.command !== 'string' || !fm.command.trim()) {
    throw new Error(`extractor '${name}': 'command' is required and must be a non-empty string`);
  }
}

function validateMemoryWrite(fm, name) {
  const writeList = fm?.memory?.write;
  if (!Array.isArray(writeList) || writeList.length === 0) {
    throw new Error(`extractor '${name}': 'memory.write' is required and must be a non-empty array of entity type names`);
  }
  return writeList;
}

function validateEntityTypes(writeList, name) {
  for (const t of writeList) {
    if (typeof t !== 'string' || !IDENT.test(t)) {
      throw new Error(`extractor '${name}': memory.write entry '${t}' is not a valid entity type identifier`);
    }
  }
}

export async function loadExtractor(foundryDir, name, io) {
  if (!IDENT.test(name)) throw new Error(`invalid extractor name '${name}' (expected lowercase identifier)`);
  const p = memoryPaths(foundryDir);
  const path = p.extractorFile(name);
  if (!(await io.exists(path))) throw new Error(`extractor not found: ${name} (expected at ${path})`);
  const text = await io.readFile(path);
  const { fm, body } = splitFrontmatter(text);
  validateCommand(fm, name);
  const writeList = validateMemoryWrite(fm, name);
  validateEntityTypes(writeList, name);
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
