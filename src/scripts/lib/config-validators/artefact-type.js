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
    checkFilePatterns(fm),
    checkAppraisers(fm, name),
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

/**
 * Validate the optional appraisers frontmatter field.
 *
 * The field maps named roles to arrays of appraiser IDs:
 *   appraisers:
 *     default: [generalist]
 *     security: [skeptic, auditor]
 *
 * Legacy keys `count` and `allowed` are rejected.
 *
 * @param {object} fm
 * @param {string} name  Artefact type name (for error messages).
 * @returns {string|null}
 */
function checkAppraisers(fm, name) {
  const appraisers = fm.appraisers;
  if (appraisers === undefined || appraisers === null) return null;
  return checkAppraisersPresent(appraisers, name);
}

function checkAppraisersPresent(appraisers, name) {
  if (typeof appraisers !== 'object' || Array.isArray(appraisers)) {
    return `frontmatter.appraisers in artefact type "${name}" must be a plain object with appraiser roles as keys`;
  }

  const legacyErr = checkLegacyAppraiserKeys(appraisers, name);
  if (legacyErr) return legacyErr;

  return checkAppraiserEntries(appraisers, name);
}

/**
 * Reject legacy keys `count` and `allowed` in the appraisers object.
 * @param {object} appraisers
 * @param {string} name
 * @returns {string|null}
 */
function checkLegacyAppraiserKeys(appraisers, name) {
  if ('count' in appraisers) {
    return `frontmatter.appraisers in artefact type "${name}" contains legacy key "count"; use named appraiser roles instead`;
  }
  if ('allowed' in appraisers) {
    return `frontmatter.appraisers in artefact type "${name}" contains legacy key "allowed"; use named appraiser roles instead`;
  }
  return null;
}

/**
 * Validate each appraisers entry is an array of non-empty strings.
 * @param {object} appraisers
 * @param {string} name
 * @returns {string|null}
 */
function checkAppraiserEntries(appraisers, name) {
  for (const [role, list] of Object.entries(appraisers)) {
    if (!Array.isArray(list)) {
      return `frontmatter.appraisers.${role} in artefact type "${name}" must be an array of non-empty strings`;
    }
    const err = validateStringArrayEntries(list, `frontmatter.appraisers.${role}`);
    if (err) return err;
  }
  return null;
}
