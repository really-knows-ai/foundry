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
// Workfile creation
// ---------------------------------------------------------------------------

export function createWorkfile(frontmatter, goal) {
  const fm = writeFrontmatter(frontmatter);
  return `${fm}
# Goal

${goal}

| Artefact | Status |
|----------|--------|

## Feedback
`;
}
