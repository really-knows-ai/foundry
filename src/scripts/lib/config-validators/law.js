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

  errors = checkForDuplicateIds(blocks);
  return errors.length ? { ok: false, errors } : { ok: true };
}

/**
 * Parse law blocks from the body.
 * Each block is a ## heading followed by its content until the next heading.
 * @param {string} body
 * @returns {{id: string, text: string}[]}
 */
function parseLawBlocks(body) {
  const blocks = [];
  const lines = body.split('\n');
  let currentId = null;
  let currentLines = [];

  const flushBlock = () => {
    if (currentId) {
      blocks.push({ id: currentId, text: currentLines.join('\n') });
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
