import { join } from 'node:path';
import { validate } from '../config-validators/flow.js';
import { makeCreator } from './factory.js';

const KIND = 'flow';

/**
 * Render the YAML lines for a single appraiser list.
 *
 * @param {string[]} [appraisers]
 * @returns {string}
 */
function renderAppraisers(appraisers) {
  if (!appraisers || appraisers.length === 0) {
    return '';
  }
  let out = '    appraisers:\n';
  for (const a of appraisers) {
    out += `      - ${a}\n`;
  }
  return out;
}

/**
 * Render the YAML lines for a single law-group's settings.
 *
 * @param {{mode?: string, passes?: number, appraisers?: string[]}} settings
 * @returns {string}
 */
function renderLawGroupSettings(settings) {
  let out = '';
  if (settings.mode) {
    out += `    mode: ${settings.mode}\n`;
  }
  if (settings.passes !== undefined) {
    out += `    passes: ${settings.passes}\n`;
  }
  out += renderAppraisers(settings.appraisers);
  return out;
}

/**
 * Render a YAML `law-groups:` block for flow frontmatter.
 *
 * @param {Record<string, {mode?: string, passes?: number, appraisers?: string[]}>} lawGroups
 * @returns {string} Rendered block or empty string when no groups exist.
 */
function renderLawGroups(lawGroups) {
  if (!lawGroups || Object.keys(lawGroups).length === 0) {
    return '';
  }
  let out = 'law-groups:\n';
  for (const [groupName, settings] of Object.entries(lawGroups)) {
    out += `  ${groupName}:\n`;
    out += renderLawGroupSettings(settings);
  }
  return out;
}

/**
 * Assemble the markdown body for a flow definition from structured arguments.
 *
 * @param {object} args
 * @param {string} args.id                Slugged identifier; becomes frontmatter.id.
 * @param {string} args.name              Human-readable display name; becomes frontmatter.name.
 * @param {string[]} args.startingCycles  Cycle IDs that can start this flow.
 * @param {Record<string, {mode?: string, passes?: number, appraisers?: string[]}>}
 *   [args.lawGroups]                     Optional law-group configurations rendered as a
 *                                        law-groups frontmatter block.
 * @param {string} args.description       Prose placed under ## Cycles.
 * @returns {string} Assembled markdown body.
 */
export function assembleFlowMarkdown(args) {
  const { id, name, startingCycles, description, lawGroups } = args;
  let body = `---\nid: ${id}\nname: ${name}\nstarting-cycles:\n`;
  for (const c of startingCycles) {
    body += `  - ${c}\n`;
  }
  body += renderLawGroups(lawGroups);
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
