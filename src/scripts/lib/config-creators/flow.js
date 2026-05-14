import { join } from 'node:path';
import { validate } from '../config-validators/flow.js';
import { makeCreator } from './factory.js';

const KIND = 'flow';

/**
 * Assemble the markdown body for a flow definition from structured arguments.
 *
 * @param {object} args
 * @param {string} args.id              Slugged identifier; becomes frontmatter.id.
 * @param {string} args.name            Human-readable display name; becomes frontmatter.name.
 * @param {string[]} args.startingCycles  Cycle IDs that can start this flow.
 * @param {string} args.description     Prose placed under ## Cycles.
 * @returns {string} Assembled markdown body.
 */
export function assembleFlowMarkdown(args) {
  const { id, name, startingCycles, description } = args;
  let body = `---\nid: ${id}\nname: ${name}\nstarting-cycles:\n`;
  for (const c of startingCycles) {
    body += `  - ${c}\n`;
  }
  body += `---\n\n## Cycles\n\n${description}\n`;
  return body;
}

const _create = makeCreator({
  kind: KIND,
  pathFor: (args) => join('foundry', 'flows', `${args.id}.md`),
  validator: validate,
});

export async function create(args) {
  const body = assembleFlowMarkdown(args);
  return _create({ ...args, name: args.id, body });
}
