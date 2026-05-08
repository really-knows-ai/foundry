import {
  tryParseFrontmatter,
  requireNonEmptyString,
  validateNameMatch,
  requireHeading,
  validateStringArrayEntries,
} from './helpers.js';

/**
 * Validate an artefact-type definition body.
 *
 * @param {object} opts
 * @param {string} opts.name      Slugged identifier (matches frontmatter.name).
 * @param {string} opts.body      Full markdown body.
 * @returns {Promise<{ok: true} | {ok: false, errors: string[]}>}
 */
export async function validate({ name, body }) {
  const parsed = tryParseFrontmatter(body);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };
  const fm = parsed.fm;

  const errors = [
    requireNonEmptyString(fm.name, 'frontmatter.name'),
    validateNameMatch(fm, name),
    requireNonEmptyString(fm['output-type'], 'frontmatter.output-type'),
    checkFilePatterns(fm),
    requireHeading(body, 'Definition'),
  ].filter(Boolean);

  return errors.length ? { ok: false, errors } : { ok: true };
}

function checkFilePatterns(fm) {
  const patterns = fm['file-patterns'];
  if (!Array.isArray(patterns) || patterns.length === 0) {
    return 'frontmatter.file-patterns is required and must be a non-empty array of glob strings';
  }
  return validateStringArrayEntries(patterns, 'frontmatter.file-patterns');
}
