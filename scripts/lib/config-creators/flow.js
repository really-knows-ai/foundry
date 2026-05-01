import { join } from 'node:path';
import { validate } from '../config-validators/flow.js';
import { makeCreator } from './factory.js';

export const create = makeCreator({
  kind: { human: 'flow', underscored: 'flow' },
  pathFor: (name) => join('foundry', 'flows', `${name}.md`),
  validator: validate,
});
