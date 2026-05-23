import matter from 'gray-matter';
import yaml from 'js-yaml';

function normaliseFrontmatter(parsed) {
  if (parsed && typeof parsed === 'object') {
    return { ...parsed };
  }
  return {};
}

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
 * NOTE: Intentionally duplicates core logic from ../workfile.js for different
 * use cases. This version provides full error handling and returns structured
 * metadata; workfile.js provides a simpler interface for WORK.md manipulation.
 *
 * @param {string} text
 * @param {{ filename?: string }} [opts]
 * @returns {{ frontmatter: object, body: string, hasFrontmatter: boolean }}
 */
function hasData(d) {
  return d && (typeof d === 'object' ? Object.keys(d).length > 0 : true);
}

export function parseFrontmatter(text, { filename } = {}) {
  const result = tryMatter(text, filename);
  if (!result) {
    return { frontmatter: {}, body: text, hasFrontmatter: false };
  }

  if (!hasData(result.data)) {
    return { frontmatter: {}, body: text, hasFrontmatter: false };
  }

  return {
    frontmatter: normaliseFrontmatter(result.data),
    body: result.content,
    hasFrontmatter: true,
  };
}

function tryMatter(text, filename) {
  try {
    return matter(text);
  } catch (err) {
    if (filename) {
      const msg = err?.message ?? String(err);
      console.warn(`${filename}: malformed YAML frontmatter: ${msg}`);
    }
    return null;
  }
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
