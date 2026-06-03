/**
 * Check if a law block contains deprecated Passing:/Failing: scaffolding.
 * @param {string[]} lines
 * @returns {string[]} Array of error messages (empty if valid)
 */
function checkForDeprecatedScaffolding(lines) {
  const errors = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('Passing:') || line.startsWith('Failing:')) {
      errors.push(`Line ${i + 1}: Deprecated scaffolding (${line.split(':')[0]}:) not allowed. Prose must be plain statements without structured fields. See spec: "No structured fields within the prose — no Passing: or Failing: scaffolding."`);
    }
  }
  return errors;
}

/**
 * Check for duplicate law IDs within blocks.
 * @param {{id: string}[]} blocks
 * @returns {string[]} Array of error messages (empty if valid)
 */
function checkForDuplicateIds(blocks) {
  const errors = [];
  const seen = new Set();
  for (const block of blocks) {
    if (seen.has(block.id)) {
      errors.push(`duplicate law id: ${block.id}`);
    }
    seen.add(block.id);
  }
  return errors;
}

/**
 * Validate a law definition body.
 *
 * Laws derive their ID from the filename rather than frontmatter, so name
 * and io are unused here but accepted for API parity with other validators.
 *
 * @param {object} opts
 * @param {string} opts.name      Slugged identifier (unused; laws use filename as ID).
 * @param {string} opts.body      Full markdown body.
 * @param {object} [opts.io]      IO adapter (unused; laws validate body only).
 * @returns {Promise<{ok: true} | {ok: false, errors: string[]}>}
 */
export async function validate({ body }) {
  const lines = body.split('\n');
  let errors = checkForDeprecatedScaffolding(lines);
  
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  
  const blocks = parseLawBlocks(body);

  if (blocks.length === 0) {
    return { ok: false, errors: ['body must contain at least one law block (## <law-id>)'] };
  }

  errors = [...checkForDuplicateIds(blocks), ...checkLawGroups(blocks)];
  return errors.length ? { ok: false, errors } : { ok: true };
}

/**
 * Extract the optional `group:` field from law text.
 * @param {string} text
 * @returns {string|null} The group name or null if absent.
 */
function extractGroupFromText(text) {
  const match = text.match(/^group:\s*(.+)/m);
  return match ? match[1].trim() : null;
}

/**
 * Check law groups for validity.
 * Each block may have an optional `group:` line. If present, the value must
 * be a non-empty string matching the slug pattern (lowercase alphanumeric
 * and hyphens only).
 * @param {{id: string, group: string|null}[]} blocks
 * @returns {string[]} Array of error messages (empty if valid)
 */
function checkLawGroups(blocks) {
  const errors = [];
  for (const block of blocks) {
    if (block.group) {
      if (!/^[a-z0-9-]+$/.test(block.group)) {
        errors.push(`law "${block.id}": group "${block.group}" is not a valid slug (lowercase alphanumeric and hyphens only)`);
      }
    }
  }
  return errors;
}

/**
 * Parse law blocks from the body.
 * Each block is a ## heading followed by its content until the next heading.
 * @param {string} body
 * @returns {{id: string, text: string, group: string|null}[]}
 */
function parseLawBlocks(body) {
  const blocks = [];
  const lines = body.split('\n');
  let currentId = null;
  let currentLines = [];

  const flushBlock = () => {
    if (currentId) {
      const text = currentLines.join('\n');
      blocks.push({ id: currentId, text, group: extractGroupFromText(text) });
    }
  };

  for (const line of lines) {
    const heading = line.match(/^## (.+)/);
    if (!heading && currentId) {
      currentLines.push(line);
    }
    if (heading) {
      flushBlock();
      currentId = heading[1].trim();
      currentLines = [];
    }
  }
  flushBlock();

  return blocks;
}
