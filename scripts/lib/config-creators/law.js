import { join } from 'node:path';
import { validate } from '../config-validators/law.js';
import { makeCreator } from './factory.js';

function pathFor(target) {
  if (target.kind === 'global') return join('foundry', 'laws', target.file);
  if (target.kind === 'type-specific')
    return join('foundry', 'artefacts', target.typeId, 'laws.md');
  throw new Error(`unknown law target kind: ${target.kind}`);
}

function customValidation({ target }) {
  if (!target || typeof target !== 'object')
    return { ok: false, errors: ['target argument is required (object with kind + locator)'] };
  if (target.kind !== 'global' && target.kind !== 'type-specific')
    return { ok: false, errors: [`unknown target.kind: ${target.kind}`] };
  if (target.kind === 'global' && (typeof target.file !== 'string' || !target.file.trim()))
    return { ok: false, errors: ['target.file is required for kind: "global"'] };
  if (target.kind === 'type-specific' && (typeof target.typeId !== 'string' || !target.typeId.trim()))
    return { ok: false, errors: ['target.typeId is required for kind: "type-specific"'] };
  return { ok: true };
}

export const create = makeCreator({
  kind: { human: 'law', underscored: 'law' },
  pathFor,
  validator: validate,
  customValidation,
});
