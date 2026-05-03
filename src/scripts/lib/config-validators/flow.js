import { join } from 'node:path';
import { parseFrontmatter } from '../workfile.js';

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
  const errors = [];
  if (!/^---\n[\s\S]*?\n---/.test(body)) {
    errors.push('frontmatter is missing or unparseable');
    return { ok: false, errors };
  }
  let fm;
  try {
    fm = parseFrontmatter(body);
  } catch (err) {
    return { ok: false, errors: [`frontmatter is unparseable: ${err.message}`] };
  }

  if (typeof fm.id !== 'string' || !fm.id.trim())
    errors.push('frontmatter.id is required and must be a non-empty string');
  if (fm.id && fm.id !== name)
    errors.push(`frontmatter.id (${fm.id}) must match the supplied name (${name})`);
  if (typeof fm.name !== 'string' || !fm.name.trim())
    errors.push('frontmatter.name is required and must be a non-empty string');

  const starting = fm['starting-cycles'];
  if (!Array.isArray(starting) || starting.length === 0) {
    errors.push('frontmatter.starting-cycles is required and must be a non-empty array of cycle ids');
  } else {
    if (starting.some((c) => typeof c !== 'string' || !c.trim()))
      errors.push('every frontmatter.starting-cycles entry must be a non-empty string');
    for (const cycleId of starting) {
      if (typeof cycleId !== 'string' || !cycleId.trim()) continue;
      const path = join('foundry', 'cycles', `${cycleId}.md`);
      if (!(await io.exists(path)))
        errors.push(`starting-cycles references cycle "${cycleId}" but ${path} does not exist`);
    }
  }

  if (!/^##\s+Cycles\s*$/m.test(body))
    errors.push('body must contain a "## Cycles" section');

  return errors.length ? { ok: false, errors } : { ok: true };
}
