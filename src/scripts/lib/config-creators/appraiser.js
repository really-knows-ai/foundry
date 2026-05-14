import { join } from 'node:path';
import { validate } from '../config-validators/appraiser.js';
import { makeCreator } from './factory.js';

/**
 * Assemble the markdown body for an appraiser definition from structured arguments.
 *
 * @param {object} args
 * @param {string} args.id           Slugged identifier; becomes frontmatter.id.
 * @param {string} args.name         Human-readable display name; becomes frontmatter.name.
 * @param {string} args.description  Prose personality description after frontmatter.
 * @param {string} [args.model]      Optional model override.
 * @returns {string} Assembled markdown body.
 */
export function assembleAppraiserMarkdown(args) {
  const { id, name, description } = args;
  let body = `---\nid: ${id}\nname: ${name}\n`;

  if (args.model) {
    body += `model: ${args.model}\n`;
  }

  body += `---\n\n${description}\n`;
  return body;
}

export const create = makeCreator({
  kind: { human: 'appraiser', underscored: 'appraiser' },
  pathFor: (args) => join('foundry', 'appraisers', `${args.name}.md`),
  validator: validate,
});
