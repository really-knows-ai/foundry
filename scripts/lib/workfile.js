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
  return yaml.load(match[1]) || {};
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
