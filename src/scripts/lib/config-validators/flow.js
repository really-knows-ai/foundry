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
function collectGroupErrors(lawGroups) {
  const errors = [];
  for (const [groupName, groupConfig] of Object.entries(lawGroups)) {
    errors.push(...checkLawGroupEntry(groupName, groupConfig));
  }
  return errors;
}

function checkLawGroups(fm) {
  const lawGroups = fm['law-groups'];
  if (lawGroups === null || lawGroups === undefined) return [];

  if (typeof lawGroups !== 'object' || Array.isArray(lawGroups)) {
    return ['frontmatter.law-groups must be an object with group names as keys'];
  }

  return collectGroupErrors(lawGroups);
}

function checkGroupAppraisers(groupName, appraisers) {
  if (!Array.isArray(appraisers)) {
    return [`frontmatter.law-groups.${groupName}.appraisers must be an array of non-empty strings`];
  }
  const err = validateStringArrayEntries(appraisers, `frontmatter.law-groups.${groupName}.appraisers`);
  return err ? [err] : [];
}

function checkGroupMode(groupName, mode) {
  if (mode === 'bundle' || mode === 'law-by-law') return null;
  return `frontmatter.law-groups.${groupName}.mode must be "bundle" or "law-by-law"`;
}

function checkGroupPasses(groupName, passes) {
  if (Number.isInteger(passes) && passes >= 1) return null;
  return `frontmatter.law-groups.${groupName}.passes must be an integer >= 1`;
}

function isPlainObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function checkGroupFields(groupName, groupConfig) {
  const errors = [];
  if (groupConfig.mode !== undefined) {
    errors.push(checkGroupMode(groupName, groupConfig.mode));
  }
  if (groupConfig.passes !== undefined) {
    errors.push(checkGroupPasses(groupName, groupConfig.passes));
  }
  if (groupConfig.appraisers !== undefined) {
    errors.push(...checkGroupAppraisers(groupName, groupConfig.appraisers));
  }
  return errors.filter(Boolean);
}

function checkLawGroupEntry(groupName, groupConfig) {
  if (!isPlainObject(groupConfig)) {
    return [`frontmatter.law-groups.${groupName} must be an object with mode, passes, and/or appraisers`];
  }

  return checkGroupFields(groupName, groupConfig);
}
