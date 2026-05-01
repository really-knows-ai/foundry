import { join } from 'node:path';
import { parseFrontmatter } from '../workfile.js';

const VALID_INPUT_TYPES = new Set(['any-of', 'all-of']);

/**
 * Validate a cycle definition body.
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

  if (typeof fm['output-type'] !== 'string' || !fm['output-type'].trim()) {
    errors.push('frontmatter.output-type is required and must be a non-empty string');
  } else {
    const filePath = join('foundry', 'artefacts', fm['output-type'], 'definition.md');
    if (!(await io.exists(filePath)))
      errors.push(`output-type references artefact type "${fm['output-type']}" but ${filePath} does not exist`);
  }

  if (fm.inputs !== undefined) {
    if (typeof fm.inputs !== 'object' || fm.inputs === null || Array.isArray(fm.inputs)) {
      errors.push('frontmatter.inputs, when present, must be an object with type and artefacts');
    } else {
      if (!VALID_INPUT_TYPES.has(fm.inputs.type))
        errors.push('frontmatter.inputs.type must be one of: any-of, all-of');
      if (!Array.isArray(fm.inputs.artefacts) || fm.inputs.artefacts.length === 0) {
        errors.push('frontmatter.inputs.artefacts must be a non-empty array of artefact-type ids');
      } else {
        for (const id of fm.inputs.artefacts) {
          if (typeof id !== 'string' || !id.trim()) {
            errors.push('every frontmatter.inputs.artefacts entry must be a non-empty string');
            continue;
          }
          const filePath = join('foundry', 'artefacts', id, 'definition.md');
          if (!(await io.exists(filePath)))
            errors.push(`inputs.artefacts references artefact type "${id}" but ${filePath} does not exist`);
        }
      }
    }
  }

  if (fm.targets !== undefined) {
    if (!Array.isArray(fm.targets)) {
      errors.push('frontmatter.targets, when present, must be an array of cycle ids');
    } else {
      for (const id of fm.targets) {
        if (typeof id !== 'string' || !id.trim()) {
          errors.push('every frontmatter.targets entry must be a non-empty string');
          continue;
        }
        const filePath = join('foundry', 'cycles', `${id}.md`);
        if (!(await io.exists(filePath)))
          errors.push(`targets references cycle "${id}" but ${filePath} does not exist`);
      }
    }
  }

  return errors.length ? { ok: false, errors } : { ok: true };
}
