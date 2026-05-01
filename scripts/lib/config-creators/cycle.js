import { join } from 'node:path';
import { validate } from '../config-validators/cycle.js';
import { makeCreator } from './factory.js';

export const create = makeCreator({
  kind: { human: 'cycle', underscored: 'cycle' },
  pathFor: (name) => join('foundry', 'cycles', `${name}.md`),
  validator: validate,
});
