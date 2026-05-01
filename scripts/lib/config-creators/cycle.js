import { join } from 'node:path';
import { validate } from '../config-validators/cycle.js';
import { makeCreator } from './factory.js';

const KIND = 'cycle';

export const create = makeCreator({
  kind: KIND,
  pathFor: (args) => join('foundry', 'cycles', `${args.name}.md`),
  validator: validate,
});
