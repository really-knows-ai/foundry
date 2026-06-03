import { join } from 'node:path';
import { validate } from '../config-validators/artefact-type.js';
import { makeCreator } from './factory.js';

/**
 * Render the optional appraisers block as YAML lines.
 *
 * @param {Record<string, string[]> | undefined} appraisers
 * @returns {string}
 */
function renderAppraisers(appraisers) {
  if (!appraisers) return '';
  const entries = Object.entries(appraisers);
  if (entries.length === 0) return '';
  let block = 'appraisers:\n';
  for (const [group, list] of entries) {
    block += `  ${group}:\n`;
    for (const id of list) {
      block += `    - ${id}\n`;
    }
  }
  return block;
}

/**
 * Assemble the markdown body for an artefact-type definition from structured arguments.
 *
 * @param {object} args
 * @param {string} args.id              Slugged identifier; becomes frontmatter.name.
 * @param {string} args.name            Human-readable display name (not persisted).
 * @param {string[]} args.filePatterns  Glob patterns for write scope.
 * @param {string} args.description     Prose under ## Definition.
 * @param {Record<string, string[]>} [args.appraisers]  Optional appraiser config, keyed by group name.
 * @returns {string} Assembled markdown body.
 */
export function assembleArtefactTypeMarkdown(args) {
  const { id, filePatterns, description } = args;
  let body = `---\nname: ${id}\nfile-patterns:\n`;
  for (const p of filePatterns) {
    body += `  - ${p}\n`;
  }

  body += renderAppraisers(args.appraisers);
  body += `---\n\n## Definition\n\n${description}\n`;
  return body;
}

const _create = makeCreator({
  kind: { human: 'artefact-type', underscored: 'artefact_type' },
  pathFor: (args) => join('foundry', 'artefacts', args.id, 'definition.md'),
  validator: validate,
});

/**
 * Assemble the markdown body for example.md from structured arguments.
 *
 * The example file is a structure document: markdown with code blocks showing
 * the expected output format, plus documentation for the forge agent.
 *
 * @param {string} exampleContent - Raw markdown for example.md
 * @returns {string} Trimmed content with trailing newline.
 */
export function assembleExampleMarkdown(exampleContent) {
  return `${exampleContent.trim()}\n`;
}

export async function create(args) {
  const body = assembleArtefactTypeMarkdown(args);

  if (args.example) {
    const exampleDir = join('foundry', 'artefacts', args.id);
    await args.io.mkdirp(exampleDir);
    await args.io.writeFile(
      join(exampleDir, 'example.md'),
      assembleExampleMarkdown(args.example),
    );
  }

  return _create({ ...args, name: args.id, body });
}
