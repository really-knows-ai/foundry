/**
 * Validate a law definition body.
 *
 * @param {object} opts
 * @param {string} opts.name      Slugged identifier (unused; accepted for parity).
 * @param {string} opts.body      Full markdown body.
 * @param {object} [opts.io]      IO adapter (unused; accepted for parity).
 * @returns {Promise<{ok: true} | {ok: false, errors: string[]}>}
 */
export async function validate({ body }) {
  const errors = [];
  const blocks = [];
  const lines = body.split('\n');
  let currentId = null;
  let currentLines = [];

  for (const line of lines) {
    const heading = line.match(/^## (.+)/);
    if (heading) {
      if (currentId) {
        blocks.push({ id: currentId, text: currentLines.join('\n') });
      }
      currentId = heading[1].trim();
      currentLines = [];
    } else if (currentId) {
      currentLines.push(line);
    }
  }
  if (currentId) {
    blocks.push({ id: currentId, text: currentLines.join('\n') });
  }

  if (blocks.length === 0) {
    errors.push('body must contain at least one law block (## <law-id>)');
    return { ok: false, errors };
  }

  const seen = new Set();
  for (const b of blocks) {
    if (seen.has(b.id)) {
      errors.push(`duplicate law id: ${b.id}`);
    }
    seen.add(b.id);
    if (!/^Passing:/m.test(b.text)) {
      errors.push(`law "${b.id}" must contain a "Passing:" line`);
    }
    if (!/^Failing:/m.test(b.text)) {
      errors.push(`law "${b.id}" must contain a "Failing:" line`);
    }
  }

  return errors.length ? { ok: false, errors } : { ok: true };
}
