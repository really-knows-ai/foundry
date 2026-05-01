import { join } from 'node:path';
import { validate } from '../config-validators/cycle.js';
import { makeCreator } from './factory.js';

export const create = makeCreator({
  kind: { human: 'cycle', underscored: 'cycle' },
  pathFor: (args) => join('foundry', 'cycles', `${args.name}.md`),
  validator: validate,
});
