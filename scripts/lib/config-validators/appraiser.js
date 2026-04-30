import { parseFrontmatter } from '../workfile.js';

/**
 * Validate an appraiser definition body.
 *
 * Checks the rules the runtime depends on: `getAppraisers()` reads
 * `frontmatter.id`, optional `frontmatter.model`, and the body prose. The
 * `add-appraiser` skill additionally requires a human-facing `name`.
 *
 * @param {object} opts
 * @param {string} opts.name  Slugged identifier (matches frontmatter.id).
 * @param {string} opts.body  Full markdown body.
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
  if (typeof fm.id !== 'string' || !fm.id.trim())
    errors.push('frontmatter.id is required and must be a non-empty string');
  if (fm.id && fm.id !== name)
    errors.push(`frontmatter.id (${fm.id}) must match the supplied name (${name})`);
  if (typeof fm.name !== 'string' || !fm.name.trim())
    errors.push('frontmatter.name is required and must be a non-empty string');
  if (fm.model !== undefined && (typeof fm.model !== 'string' || !fm.model.trim()))
    errors.push('frontmatter.model, when present, must be a non-empty string');
  const afterFm = body.replace(/^---\n[\s\S]*?\n---\n?/, '').trim();
  if (!afterFm)
    errors.push('body must contain a personality description after the frontmatter');
  return errors.length ? { ok: false, errors } : { ok: true };
}
