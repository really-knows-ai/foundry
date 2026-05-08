import {
  tryParseFrontmatter,
  requireNonEmptyString,
  validateIdMatch,
  bodyAfterFrontmatter,
} from './helpers.js';

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
  const parsed = tryParseFrontmatter(body);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };
  const fm = parsed.fm;

  const errors = [
    requireNonEmptyString(fm.id, 'frontmatter.id'),
    validateIdMatch(fm, name),
    requireNonEmptyString(fm.name, 'frontmatter.name'),
    checkModel(fm),
    checkBody(body),
  ].filter(Boolean);

  return errors.length ? { ok: false, errors } : { ok: true };
}

function checkModel(fm) {
  if (fm.model !== undefined && (typeof fm.model !== 'string' || !fm.model.trim())) {
    return 'frontmatter.model, when present, must be a non-empty string';
  }
  return null;
}

function checkBody(body) {
  const afterFm = bodyAfterFrontmatter(body);
  if (!afterFm) {
    return 'body must contain a personality description after the frontmatter';
  }
  return null;
}
