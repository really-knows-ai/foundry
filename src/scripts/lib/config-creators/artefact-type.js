import { join } from 'node:path';
import { validate } from '../config-validators/artefact-type.js';
import { makeCreator } from './factory.js';

/**
 * Render the optional appraisers block as YAML lines.
 *
 * @param {{ count?: number, allowed?: string[] } | undefined} appraisers
 * @returns {string}
 */
function renderAppraisers(appraisers) {
  if (!appraisers) return '';
  let block = 'appraisers:\n';
  if (appraisers.count !== undefined) {
    block += `  count: ${appraisers.count}\n`;
  }
  if (appraisers.allowed && appraisers.allowed.length > 0) {
    block += '  allowed:\n';
    block += appraisers.allowed.map((a) => `    - ${a}`).join('\n') + '\n';
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
 * @param {{ count?: number, allowed?: string[] }} [args.appraisers]  Optional appraiser config.
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
