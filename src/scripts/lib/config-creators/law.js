import { join } from 'node:path';
import { validate } from '../config-validators/law.js';
import { makeCreator } from './factory.js';

function pathFor(args) {
  if (args.target.kind === 'global') return join('foundry', 'laws', args.target.file);
  if (args.target.kind === 'type-specific')
    return join('foundry', 'artefacts', args.target.typeId, 'laws.md');
  throw new Error(`unknown law target kind: ${args.target.kind}`);
}

function validateGlobalTarget(target) {
  if (typeof target.file !== 'string' || !target.file.trim()) {
    return { ok: false, errors: ['target.file is required for kind: "global"'] };
  }
  return { ok: true };
}

function validateTypeSpecificTarget(target) {
  if (typeof target.typeId !== 'string' || !target.typeId.trim()) {
    return { ok: false, errors: ['target.typeId is required for kind: "type-specific"'] };
  }
  return { ok: true };
}

function validateTargetShape(target) {
  if (!target || typeof target !== 'object')
    return { ok: false, errors: ['target argument is required (object with kind + locator)'] };
  if (target.kind !== 'global' && target.kind !== 'type-specific')
    return { ok: false, errors: [`unknown target.kind: ${target.kind}`] };
  return null;
}

function customValidation({ target }) {
  const shapeError = validateTargetShape(target);
  if (shapeError) return shapeError;
  if (target.kind === 'global') return validateGlobalTarget(target);
  return validateTypeSpecificTarget(target);
}

export const create = makeCreator({
  kind: { human: 'law', underscored: 'law' },
  pathFor,
  validator: validate,
  customValidation,
});
