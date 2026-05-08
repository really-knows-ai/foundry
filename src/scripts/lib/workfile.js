/**
 * Shared WORK.md parsing and generation utilities.
 */

import yaml from 'js-yaml';

// ---------------------------------------------------------------------------
// Frontmatter parsing
// ---------------------------------------------------------------------------

/**
 * Parse YAML frontmatter from a markdown document.
 * NOTE: Intentionally duplicates logic from memory/frontmatter.js for
 * different use cases. See memory/frontmatter.js for the canonical version
 * with full error handling and line-ending normalisation.
 */
export function parseFrontmatter(text) {
  const match = text.match(/^---\r?\n(.+?)\r?\n---/s);
  if (!match) return {};
  const fm = yaml.load(match[1]) || {};
  // Normalize: on-disk canonical key is `max-iterations` (kebab).
  // Tolerate legacy `maxIterations` (camel) by rewriting on read.
  if (fm.maxIterations !== undefined) {
    if (fm['max-iterations'] === undefined) {
      fm['max-iterations'] = fm.maxIterations;
    }
    delete fm.maxIterations;
  }
  return fm;
}

export function writeFrontmatter(fields) {
  const body = yaml.dump(fields, { lineWidth: -1, sortKeys: false }).trimEnd();
  return `---\n${body}\n---`;
}

export function getFrontmatterField(text, key) {
  const fm = parseFrontmatter(text);
  return fm[key];
}

/**
 * Update a frontmatter field.
 * 
 * Note: This function preserves key order but does not preserve YAML comments.
 * If the frontmatter contains comments, they will be lost during rewrite.
 */
export function setFrontmatterField(text, key, value) {
  // Coerce legacy camelCase key to canonical kebab form on write.
  const normalisedKey = key === 'maxIterations' ? 'max-iterations' : key;
  const fm = parseFrontmatter(text);
  fm[normalisedKey] = value;
  const fmBlock = writeFrontmatter(fm);

  // Strip existing frontmatter (if any) and prepend new one
  const body = text.replace(/^---\r?\n.+?\r?\n---\r?\n?/s, '');
  return body ? `${fmBlock}\n${body}` : fmBlock;
}

// ---------------------------------------------------------------------------
// Stage alias enrichment
// ---------------------------------------------------------------------------

/**
 * Ensure each stage has a base:alias format.
 * Bare names (e.g. "forge") become "forge:<cycleId>".
 * Already-aliased names (e.g. "forge:write-haiku") pass through unchanged.
 */
export function enrichStages(stages, cycleId) {
  return stages.map(s => s.includes(':') ? s : `${s}:${cycleId}`);
}

/**
 * Parse a stages value from tool input.
 * Accepts JSON array string or comma-separated string.
 * Always returns an array of trimmed, non-empty strings.
 */
export function parseStagesValue(raw) {
  // Try JSON first
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
  } catch { /* not JSON */ }
  // Fall back to comma-separated
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}

function parseKvPairs(raw) {
  const result = {};
  for (const part of raw.split(',')) {
    const colonIdx = part.indexOf(':');
    if (colonIdx === -1) continue;
    const key = part.slice(0, colonIdx).trim();
    const val = part.slice(colonIdx + 1).trim();
    if (key && val) result[key] = val;
  }
  return result;
}

function tryParseJsonObject(raw) {
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch { /* not JSON */ }
  return null;
}

/**
 * Parse a models value from tool input.
 * Accepts JSON object string or "key: value, key: value" string.
 * Always returns an object mapping stage base names to model IDs.
 */
export function parseModelsValue(raw) {
  if (!raw || !raw.trim()) return {};
  const jsonResult = tryParseJsonObject(raw);
  if (jsonResult) return jsonResult;
  return parseKvPairs(raw);
}

// ---------------------------------------------------------------------------
// Workfile creation
// ---------------------------------------------------------------------------

export function createWorkfile(frontmatter, goal) {
  const fm = writeFrontmatter(frontmatter);
  return `${fm}
# Goal

${goal}

| File | Type | Cycle | Status |
|------|------|-------|--------|
`;
}
