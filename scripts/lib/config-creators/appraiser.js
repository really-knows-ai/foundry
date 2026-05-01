import { join } from 'node:path';
import { validate } from '../config-validators/appraiser.js';
import { makeCreator } from './factory.js';

export const create = makeCreator({
  kind: { human: 'appraiser', underscored: 'appraiser' },
  pathFor: (args) => join('foundry', 'appraisers', `${args.name}.md`),
  validator: validate,
});
