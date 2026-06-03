import { join } from 'node:path';
import {
  tryParseFrontmatter,
  requireNonEmptyString,
  validateIdMatch,
  requireHeading,
  validateStringArrayEntries,
} from './helpers.js';

/**
 * Validate a flow definition body.
 *
 * @param {object} opts
 * @param {string} opts.name      Slugged identifier (matches frontmatter.id).
 * @param {string} opts.body      Full markdown body.
 * @param {object} opts.io        IO adapter with `exists(path)`.
 * @returns {Promise<{ok: true} | {ok: false, errors: string[]}>}
 */
export async function validate({ name, body, io }) {
  const parsed = tryParseFrontmatter(body);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };
  const fm = parsed.fm;

  const errors = [
    requireNonEmptyString(fm.id, 'frontmatter.id'),
    validateIdMatch(fm, name),
    requireNonEmptyString(fm.name, 'frontmatter.name'),
    await checkStartingCycles(fm, io),
    requireHeading(body, 'Cycles'),
    ...checkLawGroups(fm),
  ].filter(Boolean);

  return errors.length ? { ok: false, errors } : { ok: true };
}

async function checkStartingCycles(fm, io) {
  const starting = fm['starting-cycles'];
  const isEmpty = !Array.isArray(starting) || starting.length === 0;
  if (isEmpty) {
    return 'frontmatter.starting-cycles is required and must be a non-empty array of cycle ids';
  }

  const entryErr = validateStringArrayEntries(starting, 'frontmatter.starting-cycles');
  if (entryErr) return entryErr;

  return await checkCycleRefsExist(starting, io, 'starting-cycles');
}

async function checkCycleRefsExist(ids, io, label) {
  for (const id of ids) {
    if (typeof id !== 'string' || !id.trim()) continue;
    const filePath = join('foundry', 'cycles', `${id}.md`);
    if (!(await io.exists(filePath))) {
      return `${label} references cycle "${id}" but ${filePath} does not exist`;
    }
  }
  return null;
}

/**
 * Validate the optional law-groups frontmatter field.
 * Each key must map to an object with optional fields:
 *   mode (bundle | law-by-law), passes (integer >= 1),
 *   appraisers (array of non-empty strings).
 * @param {object} fm
 * @returns {string[]} Array of error messages (empty if valid)
 */
function checkLawGroups(fm) {
  const lawGroups = fm['law-groups'];
  if (lawGroups === null || lawGroups === undefined) return [];

  const errors = [];

  if (typeof lawGroups !== 'object' || Array.isArray(lawGroups)) {
    errors.push('frontmatter.law-groups must be an object with group names as keys');
    return errors;
  }

  for (const [groupName, groupConfig] of Object.entries(lawGroups)) {
    if (typeof groupConfig !== 'object' || groupConfig === null || Array.isArray(groupConfig)) {
      errors.push(`frontmatter.law-groups.${groupName} must be an object with mode, passes, and/or appraisers`);
      continue;
    }

    if (groupConfig.mode !== undefined) {
      if (groupConfig.mode !== 'bundle' && groupConfig.mode !== 'law-by-law') {
        errors.push(`frontmatter.law-groups.${groupName}.mode must be "bundle" or "law-by-law"`);
      }
    }

    if (groupConfig.passes !== undefined) {
      if (!Number.isInteger(groupConfig.passes) || groupConfig.passes < 1) {
        errors.push(`frontmatter.law-groups.${groupName}.passes must be an integer >= 1`);
      }
    }

    if (groupConfig.appraisers !== undefined) {
      if (!Array.isArray(groupConfig.appraisers)) {
        errors.push(`frontmatter.law-groups.${groupName}.appraisers must be an array of non-empty strings`);
      } else {
        const apprErr = validateStringArrayEntries(
          groupConfig.appraisers,
          `frontmatter.law-groups.${groupName}.appraisers`,
        );
        if (apprErr) errors.push(apprErr);
      }
    }
  }

  return errors;
}
