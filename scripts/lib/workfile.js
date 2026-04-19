/**
 * Shared WORK.md parsing and generation utilities.
 */

import yaml from 'js-yaml';

// ---------------------------------------------------------------------------
// Frontmatter parsing
// ---------------------------------------------------------------------------

export function parseFrontmatter(text) {
  const match = text.match(/^---\n(.+?)\n---/s);
  if (!match) return {};
  const fm = yaml.load(match[1]) || {};
  // Normalize: on-disk canonical key is `max-iterations` (kebab).
  // Tolerate legacy `maxIterations` (camel) by rewriting on read.
  if (fm.maxIterations !== undefined && fm['max-iterations'] === undefined) {
    fm['max-iterations'] = fm.maxIterations;
    delete fm.maxIterations;
  }
  return fm;
}

export function writeFrontmatter(fields) {
  const body = yaml.dump(fields, { lineWidth: -1 }).trimEnd();
  return `---\n${body}\n---`;
}

export function getFrontmatterField(text, key) {
  const fm = parseFrontmatter(text);
  return fm[key];
}

export function setFrontmatterField(text, key, value) {
  // Coerce legacy camelCase key to canonical kebab form on write.
  if (key === 'maxIterations') key = 'max-iterations';
  const fm = parseFrontmatter(text);
  fm[key] = value;
  const fmBlock = writeFrontmatter(fm);

  // Strip existing frontmatter (if any) and prepend new one
  const body = text.replace(/^---\n.+?\n---\n?/s, '');
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

/**
 * Parse a models value from tool input.
 * Accepts JSON object string or "key: value, key: value" string.
 * Always returns an object mapping stage base names to model IDs.
 */
export function parseModelsValue(raw) {
  if (!raw || !raw.trim()) return {};
  // Try JSON first
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch { /* not JSON */ }
  // Fall back to "key: value, key: value" format
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

## Feedback
`;
}
