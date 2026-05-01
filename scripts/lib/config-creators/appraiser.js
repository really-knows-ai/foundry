import { join } from 'node:path';
import { validate } from '../config-validators/appraiser.js';
import { makeCreator } from './factory.js';

export const create = makeCreator({
  kind: { human: 'appraiser', underscored: 'appraiser' },
  pathFor: (name) => join('foundry', 'appraisers', `${name}.md`),
  validator: validate,
});
