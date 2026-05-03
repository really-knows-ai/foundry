import { parseFrontmatter } from '../workfile.js';

/**
 * Validate an artefact-type definition body.
 *
 * @param {object} opts
 * @param {string} opts.name      Slugged identifier (matches frontmatter.name).
 * @param {string} opts.body      Full markdown body.
 * @returns {Promise<{ok: true} | {ok: false, errors: string[]}>}
 */
export async function validate({ name, body }) {
  const errors = [];
  if (!/^---\n[\s\S]*?\n---/.test(body)) {
    errors.push('frontmatter is missing or unparseable');
    return { ok: false, errors };
  }
  let fm;
  try {
    fm = parseFrontmatter(body);
  } catch (err) {
    errors.push(`frontmatter is unparseable: ${err.message}`);
    return { ok: false, errors };
  }
  if (typeof fm.name !== 'string' || !fm.name.trim())
    errors.push('frontmatter.name is required and must be a non-empty string');
  if (fm.name && fm.name !== name)
    errors.push(`frontmatter.name (${fm.name}) must match the supplied name (${name})`);
  if (typeof fm['output-type'] !== 'string' || !fm['output-type'].trim())
    errors.push('frontmatter.output-type is required and must be a non-empty string');
  if (!Array.isArray(fm['file-patterns']) || fm['file-patterns'].length === 0)
    errors.push('frontmatter.file-patterns is required and must be a non-empty array of glob strings');
  if (Array.isArray(fm['file-patterns']) &&
      fm['file-patterns'].some((p) => typeof p !== 'string' || !p.trim()))
    errors.push('every frontmatter.file-patterns entry must be a non-empty string');
  if (!/^##\s+Definition\s*$/m.test(body))
    errors.push('body must contain a "## Definition" section');
  return errors.length ? { ok: false, errors } : { ok: true };
}
