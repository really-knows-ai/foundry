/**
 * Shared helpers for memory admin operations.
 */

/**
 * Render edge frontmatter as YAML.
 * @param {Object} fm - Frontmatter object with type, sources, targets
 * @returns {string} YAML frontmatter content (without delimiters)
 */
export function renderEdgeFrontmatter(fm) {
  const lines = [`type: ${fm.type}`];
  for (const key of ['sources', 'targets']) {
    const v = fm[key];
    lines.push(v === 'any' ? `${key}: any` : `${key}: [${v.join(', ')}]`);
  }
  return lines.join('\n');
}

/**
 * Compose a markdown file from frontmatter and body.
 * Handles the "strip leading newline from body if present" pattern
 * used throughout memory admin modules.
 * 
 * @param {string} frontmatter - YAML frontmatter content (without delimiters)
 * @param {string} body - Markdown body content
 * @returns {string} Complete markdown file with frontmatter delimiters
 */
export function composeMarkdown(frontmatter, body) {
  const normalizedBody = body.startsWith('\n') ? body.slice(1) : body;
  return `---\n${frontmatter}\n---\n${normalizedBody}`;
}
