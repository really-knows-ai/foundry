import { join } from 'node:path';
import { validate } from '../config-validators/artefact-type.js';
import { makeCreator } from './factory.js';

export const create = makeCreator({
  kind: { human: 'artefact-type', underscored: 'artefact_type' },
  pathFor: (name) => join('foundry', 'artefacts', name, 'definition.md'),
  validator: validate,
});
