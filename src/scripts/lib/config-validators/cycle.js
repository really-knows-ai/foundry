import { join } from 'node:path';
import {
  tryParseFrontmatter,
  requireNonEmptyString,
  validateIdMatch,
  validateStringArrayEntries,
} from './helpers.js';

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
  const parsed = tryParseFrontmatter(body);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };
  const fm = parsed.fm;

  const errors = [
    requireNonEmptyString(fm.id, 'frontmatter.id'),
    validateIdMatch(fm, name),
    requireNonEmptyString(fm.name, 'frontmatter.name'),
    await checkOutputType(fm, io),
    ...await checkInputs(fm, io),
    ...await checkTargets(fm, io),
    checkIterationLimits(fm),
  ].filter(Boolean);

  return errors.length ? { ok: false, errors } : { ok: true };
}

async function checkOutputType(fm, io) {
  const outputType = fm['output-type'];
  const strErr = requireNonEmptyString(outputType, 'frontmatter.output-type');
  if (strErr) return strErr;
  const filePath = join('foundry', 'artefacts', outputType, 'definition.md');
  if (!(await io.exists(filePath))) {
    return `output-type references artefact type "${outputType}" but ${filePath} does not exist`;
  }
  return null;
}

async function checkInputs(fm, io) {
  const inputs = fm.inputs;
  if (inputs === undefined) return [];

  const shapeErrors = checkInputsShape(inputs);
  if (shapeErrors.length) return shapeErrors;

  const typeErrors = checkInputType(inputs);
  const artefactErrors = await checkInputArtefacts(inputs, io);
  return [...typeErrors, ...artefactErrors];
}

function checkInputsShape(inputs) {
  const errors = [];
  const isInvalidShape = typeof inputs !== 'object' || inputs === null || Array.isArray(inputs);
  if (isInvalidShape) {
    errors.push('frontmatter.inputs, when present, must be an object with type and artefacts');
  }
  return errors;
}

function checkInputType(inputs) {
  const errors = [];
  if (!VALID_INPUT_TYPES.has(inputs.type)) {
    errors.push('frontmatter.inputs.type must be one of: any-of, all-of');
  }
  return errors;
}

async function checkInputArtefacts(inputs, io) {
  const artefacts = inputs.artefacts;
  const noArtefacts = !Array.isArray(artefacts) || artefacts.length === 0;
  if (noArtefacts) {
    return ['frontmatter.inputs.artefacts must be a non-empty array of artefact-type ids'];
  }

  const entryErr = validateStringArrayEntries(artefacts, 'frontmatter.inputs.artefacts');
  const refErrors = await validateArtefactRefs(artefacts, io);
  return entryErr ? [entryErr, ...refErrors] : refErrors;
}

async function validateArtefactRefs(artefacts, io) {
  const errors = [];
  for (const id of artefacts) {
    const isValidId = typeof id === 'string' && id.trim();
    if (!isValidId) continue;
    const refErr = await validateArtefactRef(id, io, 'inputs.artefacts');
    if (refErr) errors.push(refErr);
  }
  return errors;
}

async function validateArtefactRef(id, io, label) {
  const filePath = join('foundry', 'artefacts', id, 'definition.md');
  if (!(await io.exists(filePath))) {
    return `${label} references artefact type "${id}" but ${filePath} does not exist`;
  }
  return null;
}

async function checkTargets(fm, io) {
  const targets = fm.targets;
  if (targets === undefined) return [];

  if (!Array.isArray(targets)) {
    return ['frontmatter.targets, when present, must be an array of cycle ids'];
  }

  const entryErr = validateStringArrayEntries(targets, 'frontmatter.targets');
  const refErrors = await validateCycleRefs(targets, io);
  return entryErr ? [entryErr, ...refErrors] : refErrors;
}

async function validateCycleRefs(targets, io) {
  const errors = [];
  for (const id of targets) {
    if (typeof id !== 'string' || !id.trim()) continue;
    const filePath = join('foundry', 'cycles', `${id}.md`);
    if (!(await io.exists(filePath))) {
      errors.push(`targets references cycle "${id}" but ${filePath} does not exist`);
    }
  }
  return errors;
}

function checkIterationLimits(fm) {
  const maxIt = fm['max-iterations'];
  const dlIt = fm['deadlock-iterations'];
  if (maxIt !== undefined && dlIt !== undefined && dlIt > maxIt) {
    return `deadlock-iterations (${dlIt}) must be <= max-iterations (${maxIt}); deadlock would never trigger before the cycle blocks`;
  }
  return null;
}
