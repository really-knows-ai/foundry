import { join } from 'node:path';
import { validate } from '../config-validators/cycle.js';
import { makeCreator } from './factory.js';

const KIND = 'cycle';

/** Render a YAML list block: `key:\n  - item1\n  - item2` */
function yamlList(key, items) {
  if (!items || items.length === 0) return '';
  const prefix = key.match(/^(\s*)/)[1];
  let block = `${key}:\n`;
  for (const item of items) {
    block += `${prefix}  - ${item}\n`;
  }
  return block;
}

/** Render the inputs mapping. */
function renderInputs(inputs) {
  if (!inputs) return '';
  let block = 'inputs:\n';
  block += `  type: ${inputs.type}\n`;
  block += yamlList('  artefacts', inputs.artefacts);
  return block;
}

/** Render the assay mapping. */
function renderAssay(assay) {
  if (!assay) return '';
  return 'assay:\n' + yamlList('  extractors', assay.extractors);
}

/** Render the memory mapping. */
function renderMemory(memory) {
  if (!memory) return '';
  let block = 'memory:\n';
  block += yamlList('  read', memory.read);
  block += yamlList('  write', memory.write);
  return block;
}

/** Render models mapping (flat string key → string value). */
function renderModels(models) {
  if (!models) return '';
  let block = 'models:\n';
  for (const [key, value] of Object.entries(models)) {
    block += `  ${key}: ${value}\n`;
  }
  return block;
}

/** Render boolean and numeric flags (camelCase to kebab-case). */
function renderFlags(args) {
  let fm = '';
  if (args.humanAppraise !== undefined) {
    fm += `human-appraise: ${args.humanAppraise}\n`;
  }
  if (args.deadlockAppraise !== undefined) {
    fm += `deadlock-appraise: ${args.deadlockAppraise}\n`;
  }
  if (args.deadlockIterations !== undefined) {
    fm += `deadlock-iterations: ${args.deadlockIterations}\n`;
  }
  if (args.maxIterations !== undefined) {
    fm += `max-iterations: ${args.maxIterations}\n`;
  }
  return fm;
}

/**
 * Assemble the markdown body for a cycle definition from structured arguments.
 *
 * @param {object} args
 * @param {string} args.id               Slugged identifier; becomes frontmatter.id.
 * @param {string} args.name             Human-readable display name; becomes frontmatter.name.
 * @param {string} args.outputType       Artefact type ID this cycle produces.
 * @param {{ type: 'any-of'|'all-of', artefacts: string[] }} [args.inputs]  Input contract.
 * @param {string[]} [args.targets]      Downstream cycle IDs.
 * @param {boolean} [args.humanAppraise] Include human-appraise in every iteration.
 * @param {boolean} [args.deadlockAppraise] Route to human-appraise on deadlock.
 * @param {number} [args.deadlockIterations] Iteration threshold for deadlock detection.
 * @param {number} [args.maxIterations]  Maximum forge iterations.
 * @param {{ extractors: string[] }} [args.assay]  Assay stage config.
 * @param {{ read: string[], write: string[] }} [args.memory]  Flow memory permissions.
 * @param {object} [args.models]         Per-stage model overrides.
 * @param {string} [args.description]    Prose placed after frontmatter under ## Cycle.
 * @returns {string} Assembled markdown body.
 */
export function assembleCycleMarkdown(args) {
  const { id, name, outputType } = args;

  let fm = `---\nid: ${id}\nname: ${name}\noutput-type: ${outputType}\n`;

  fm += renderInputs(args.inputs);
  fm += yamlList('targets', args.targets);
  fm += renderFlags(args);
  fm += renderAssay(args.assay);
  fm += renderMemory(args.memory);
  fm += renderModels(args.models);

  fm += '---';

  if (args.description) {
    fm += `\n\n## Cycle\n\n${args.description}\n`;
  } else {
    fm += '\n';
  }

  return fm;
}

const _create = makeCreator({
  kind: KIND,
  pathFor: (args) => join('foundry', 'cycles', `${args.id}.md`),
  validator: validate,
});

export async function create(args) {
  const body = assembleCycleMarkdown(args);
  return _create({ ...args, name: args.id, body });
}
