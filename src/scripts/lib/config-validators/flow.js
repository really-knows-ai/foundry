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
