/**
 * @file Law markdown assembly helpers for add_law and edit_law tools.
 *
 * Laws have no YAML frontmatter — each law is a `## <id>` block within a
 * markdown file. The block contains a combined name–description line,
 * passing criteria, failing criteria, and an optional validators block.
 */

/**
 * Build a validators block string from an array of validator objects.
 *
 * @param {{ id: string, command: string, failureMeans?: string }[]} validators
 * @returns {string}  Validators block (empty string if none).
 */
function buildValidatorsBlock(validators) {
  if (!validators || validators.length === 0) return '';

  let block = 'validators:\n';
  for (const v of validators) {
    block += `  - id: ${v.id}\n    command: ${v.command}`;
    if (v.failureMeans) {
      block += `\n    failure-means: ${v.failureMeans}`;
    }
    block += '\n';
  }
  return block.trimEnd();
}

/**
 * Assemble a law markdown block from structured arguments.
 *
 * @param {object} args
 * @param {string} args.id           Law identifier; becomes `## <id>` heading.
 * @param {string} args.name         Human-readable name.
 * @param {string} args.description  Prose describing what the law covers.
 * @param {string} args.passing      Criteria defining a passing artefact.
 * @param {string} args.failing      Criteria defining a failing artefact.
 * @param {{ id: string, command: string, failureMeans?: string }[]} [args.validators]
 * @returns {string} Assembled law block (no trailing newline).
 */
export function assembleLawMarkdown(args) {
  const { id, name, description, passing, failing } = args;
  let block = `## ${id}\n\n${name} — ${description}\n\n${passing}\n\n${failing}`;

  if (args.validators && args.validators.length > 0) {
    block += '\n\n' + buildValidatorsBlock(args.validators);
  }

  return block;
}

/**
 * Parse a single law block from a body that contains one or more `## <id>`
 * headings. Returns data for the first block found.
 *
 * @param {string} body  Full file body.
 * @returns {{ heading: string, headingIndex: number, blockEndIndex: number,
 *             proseContent: string, validatorsContent: string } | null}
 */
function parseLawBlock(body) {
  const headingMatch = body.match(/^(## .+)/m);
  if (!headingMatch) return null;

  const heading = headingMatch[1];
  const headingIndex = headingMatch.index;

  // Find the end of this block — next ## at same level or EOF
  const afterHeading = body.slice(headingIndex);
  const nextHeadingRe = /\n(?=## )/;
  const nextMatch = afterHeading.match(nextHeadingRe);
  const blockText = nextMatch
    ? afterHeading.slice(0, nextMatch.index)
    : afterHeading;
  const blockEndIndex = nextMatch
    ? headingIndex + nextMatch.index
    : body.length;

  // Locate the validators: block within this law block
  const validatorsRe = /^validators:\n((?:[ \t]+\S.*(?:\n|$))*)/m;
  const vMatch = blockText.match(validatorsRe);

  let proseContent;
  let validatorsContent;

  if (vMatch) {
    proseContent = blockText.slice(0, vMatch.index);
    validatorsContent = blockText.slice(vMatch.index);
  } else {
    proseContent = blockText;
    validatorsContent = '';
  }

  return {
    heading, headingIndex, blockEndIndex, proseContent, validatorsContent,
  };
}

/**
 * Parse the name–description pair from a single line.
 *
 * Expected format: `<name> — <description>`
 *
 * @param {string} line
 * @returns {{ name: string, description: string }}
 */
function parseNameDescription(line) {
  const sep = ' — ';
  const sepIndex = line.indexOf(sep);
  if (sepIndex !== -1) {
    return {
      name: line.slice(0, sepIndex).trim(),
      description: line.slice(sepIndex + sep.length).trim(),
    };
  }
  return { name: line.trim(), description: '' };
}

/**
 * Advance index past consecutive blank lines.
 *
 * @param {string[]} lines
 * @param {number} start
 * @returns {number} Index of first non-blank line (or lines.length).
 */
function skipBlankLines(lines, start) {
  let i = start;
  while (i < lines.length && lines[i].trim() === '') i++;
  return i;
}

/**
 * Collect consecutive non-blank lines starting at `start`.
 *
 * @param {string[]} lines
 * @param {number} start
 * @returns {{ lines: string[], nextIndex: number }}
 */
function collectNonBlank(lines, start) {
  const collected = [];
  let i = start;
  while (i < lines.length && lines[i].trim() !== '') {
    collected.push(lines[i]);
    i++;
  }
  return { lines: collected, nextIndex: i };
}

/**
 * Parse the prose section of a law block into its constituent fields.
 *
 * Expected prose structure:
 *
 *   <name> — <description>
 *   (blank line)
 *   <passing>
 *   (blank line)
 *   <failing>
 *
 * Each of passing/failing may be multi-line prose.
 *
 * @param {string} proseContent  Block content from heading to validators.
 * @returns {{ name: string, description: string, passing: string, failing: string }}
 */
function parseLawProse(proseContent) {
  const lines = proseContent.split('\n');
  let i = 0;

  // Skip heading line
  if (lines[i] && lines[i].startsWith('## ')) i++;

  // Skip blank lines after heading
  i = skipBlankLines(lines, i);

  // Name — description line
  const nd = parseNameDescription(lines[i] || '');
  i++;

  // Skip blank lines, collect passing, skip blank lines again
  i = skipBlankLines(lines, i);
  const passing = collectNonBlank(lines, i);
  i = passing.nextIndex;

  i = skipBlankLines(lines, i);

  // Remaining lines form failing
  const failingLines = lines.slice(i);

  return {
    name: nd.name,
    description: nd.description,
    passing: passing.lines.join('\n'),
    failing: failingLines.join('\n').trimEnd(),
  };
}

/**
 * Build the result block for an edit operation by appending validators.
 *
 * @param {string} newProse  Rebuilt prose section.
 * @param {{ validators?: object[] | null }} updates
 * @param {string} existingValidatorsContent  Original validators block text.
 * @returns {string}  Full new block content.
 */
function appendValidators(newProse, updates, existingValidatorsContent) {
  if (updates.validators !== undefined) {
    if (updates.validators !== null) {
      return newProse + '\n\n' + buildValidatorsBlock(updates.validators);
    }
    return newProse;
  }

  const trimmed = existingValidatorsContent.trim();
  if (trimmed) {
    return newProse + '\n\n' + trimmed;
  }
  return newProse;
}

/**
 * Pick a field value from updates, falling back to the existing value.
 *
 * @param {object} updates
 * @param {object} existing
 * @param {string} field
 * @returns {*}
 */
function pickField(updates, existing, field) {
  return updates[field] !== undefined ? updates[field] : existing[field];
}

/**
 * Update a law block in an existing body with new field values.
 *
 * Only the fields present in `updates` are replaced. Fields not in `updates`
 * retain their original values. Pass `validators: null` to remove the
 * validators block.
 *
 * @param {string} existingBody  Full file content (may contain multiple law blocks).
 * @param {{ name?: string, description?: string, passing?: string,
 *          failing?: string, validators?: object[] | null }} updates
 * @returns {string}  Updated full body with the first law block modified.
 */
export function assembleEditLawMarkdown(existingBody, updates) {
  const parsed = parseLawBlock(existingBody);
  if (!parsed) {
    throw new Error('Body must contain at least one ## law heading');
  }

  const { heading, headingIndex, blockEndIndex, proseContent } = parsed;
  const existing = parseLawProse(proseContent);

  const name = pickField(updates, existing, 'name');
  const description = pickField(updates, existing, 'description');
  const passing = pickField(updates, existing, 'passing');
  const failing = pickField(updates, existing, 'failing');

  const newProse = `${heading}\n\n${name} — ${description}\n\n${passing}\n\n${failing}`;
  const result = appendValidators(newProse, updates, parsed.validatorsContent);

  // If there are subsequent blocks, insert a newline separator so the gap
  // between blocks remains `\n\n` (end of result + `\n` + leading `\n` of
  // the remaining body).
  if (blockEndIndex < existingBody.length) {
    return existingBody.slice(0, headingIndex) + result + '\n'
      + existingBody.slice(blockEndIndex);
  }
  return existingBody.slice(0, headingIndex) + result
    + existingBody.slice(blockEndIndex);
}
