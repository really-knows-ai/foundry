import { join } from 'node:path';
import { validate } from '../config-validators/flow.js';
import { makeCreator } from './factory.js';

const KIND = 'flow';

export const create = makeCreator({
  kind: KIND,
  pathFor: (args) => join('foundry', 'flows', `${args.name}.md`),
  validator: validate,
});
