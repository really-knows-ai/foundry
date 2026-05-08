import { parseFrontmatter } from '../workfile.js';

/**
 * Shared helpers for config validators.
 */

/**
 * Parse frontmatter from a body string.
 * @param {string} body
 * @returns {{ok: true, fm: object} | {ok: false, errors: string[]}}
 */
export function tryParseFrontmatter(body) {
  if (!/^---\n[\s\S]*?\n---/.test(body)) {
    return { ok: false, errors: ['frontmatter is missing or unparseable'] };
  }
  try {
    return { ok: true, fm: parseFrontmatter(body) };
  } catch (err) {
    return { ok: false, errors: [`frontmatter is unparseable: ${err.message}`] };
  }
}

/**
 * Check that a value is a non-empty string.
 * @param {unknown} value
 * @param {string} fieldName
 * @returns {string|null} Error message or null.
 */
export function requireNonEmptyString(value, fieldName) {
  if (typeof value !== 'string' || !value.trim()) {
    return `${fieldName} is required and must be a non-empty string`;
  }
  return null;
}

/**
 * Validate that frontmatter.id matches the supplied name.
 * @param {object} fm
 * @param {string} name
 * @returns {string|null}
 */
export function validateIdMatch(fm, name) {
  if (fm.id && fm.id !== name) {
    return `frontmatter.id (${fm.id}) must match the supplied name (${name})`;
  }
  return null;
}

/**
 * Validate that frontmatter.name matches the supplied name.
 * @param {object} fm
 * @param {string} name
 * @returns {string|null}
 */
export function validateNameMatch(fm, name) {
  if (fm.name && fm.name !== name) {
    return `frontmatter.name (${fm.name}) must match the supplied name (${name})`;
  }
  return null;
}

/**
 * Extract body content after frontmatter.
 * @param {string} body
 * @returns {string}
 */
export function bodyAfterFrontmatter(body) {
  return body.replace(/^---\n[\s\S]*?\n---\n?/, '').trim();
}

/**
 * Check that the body contains a markdown heading matching the given text.
 * @param {string} body
 * @param {string} headingText  e.g. "Definition" or "Cycles"
 * @returns {string|null}
 */
export function requireHeading(body, headingText) {
  const pattern = new RegExp(`^##\\s+${headingText}\\s*$`, 'm');
  if (!pattern.test(body)) {
    return `body must contain a "## ${headingText}" section`;
  }
  return null;
}

/**
 * Validate that an array contains only non-empty strings.
 * @param {unknown[]} arr
 * @param {string} fieldName
 * @returns {string|null}
 */
export function validateStringArrayEntries(arr, fieldName) {
  if (arr.some((item) => typeof item !== 'string' || !item.trim())) {
    return `every ${fieldName} entry must be a non-empty string`;
  }
  return null;
}
