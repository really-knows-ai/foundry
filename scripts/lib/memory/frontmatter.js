import yaml from 'js-yaml';

/**
 * Parse a markdown document with YAML frontmatter.
 *
 * Accepts both LF and CRLF line endings (so files saved on Windows parse the
 * same as files saved on Unix). Returns the parsed frontmatter object, the
 * body (text after the closing `---`, untrimmed), and a `hasFrontmatter`
 * flag. The body preserves original line endings.
 *
 * Throws with a filename-prefixed message on malformed YAML so errors are
 * actionable (bare `YAMLException` from `js-yaml` gives no file context).
 *
 * @param {string} text
 * @param {{ filename?: string }} [opts]
 * @returns {{ frontmatter: object, body: string, hasFrontmatter: boolean }}
 */
export function parseFrontmatter(text, { filename = '<unknown>' } = {}) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { frontmatter: {}, body: text, hasFrontmatter: false };
  let parsed;
  try {
    parsed = yaml.load(m[1]);
  } catch (err) {
    const msg = err?.message ?? String(err);
    throw new Error(`${filename}: malformed YAML frontmatter: ${msg}`);
  }
  return {
    frontmatter: parsed && typeof parsed === 'object' ? parsed : {},
    body: m[2] ?? '',
    hasFrontmatter: true,
  };
}

/**
 * Render a markdown document from a frontmatter object and a body string.
 * Uses `yaml.dump` — callers that need a specific key order (e.g. edge type
 * files where `sources`/`targets` are rendered as inline YAML arrays) should
 * build the YAML text themselves and wrap with `---\n...\n---\n`.
 */
export function renderMarkdown(frontmatter, body = '') {
  const yamlText = yaml.dump(frontmatter, { lineWidth: -1, noRefs: true }).replace(/\n$/, '');
  const prefix = body.startsWith('\n') ? '' : '\n';
  return `---\n${yamlText}\n---\n${prefix}${body}`;
}
