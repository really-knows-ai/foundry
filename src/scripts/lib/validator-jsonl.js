import readline from 'readline';
import { minimatch } from 'minimatch';

/**
 * Parse JSONL output from a validator, validating each line against patterns.
 *
 * Processes one JSON object per line. Each line must have:
 * - file (REQUIRED): matches at least one pattern from patterns array
 * - text (REQUIRED): feedback text
 * - location (OPTIONAL): "line:col" format, prepended to text if present
 * - severity (OPTIONAL): "error", "warning", etc., prepended to text if present
 *
 * If location and/or severity present, they are prepended to text as:
 *   [severity] file:location — <text>
 * If only severity: [severity] file — <text>
 * If only location: file:location — <text>
 *
 * Successfully parsed and pattern-matched lines flow into `items`.
 * Errors are split into two categories so callers can distinguish them:
 * - `parseErrors`: malformed JSON or missing required fields
 * - `patternErrors`: file did not match any artefact-type file-pattern
 *
 * `ok` is true only when both error arrays are empty. Items are always
 * returned regardless of `ok`, so a validator producing a mix of valid
 * items and errors surfaces both.
 *
 * @param {Stream} stream - readable stream of JSONL lines
 * @param {string[]} patterns - array of glob patterns for file matching
 * @returns {Promise<{ok: boolean, items: object[], parseErrors: string[], patternErrors: string[]}>}
 */
export async function parseValidatorJsonl(stream, patterns) {
  const items = [];
  const parseErrors = [];
  const patternErrors = [];

  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: stream,
      crlfDelay: Infinity,
    });

    let lineNum = 0;

    rl.on('line', (line) => {
      lineNum++;
      processLine(line, lineNum, patterns, items, { parseErrors, patternErrors });
    });

    rl.on('close', () => {
      resolve(buildResult(items, parseErrors, patternErrors));
    });

    rl.on('error', (err) => {
      parseErrors.push(`Stream error: ${err.message}`);
      resolve(buildResult(items, parseErrors, patternErrors));
    });
  });
}

/**
 * Build the final parse result with `ok` reflecting whether any errors occurred.
 */
function buildResult(items, parseErrors, patternErrors) {
  const ok = parseErrors.length === 0 && patternErrors.length === 0;
  return { ok, items, parseErrors, patternErrors };
}

/**
 * Process a single JSONL line.
 *
 * `errors` bundles `parseErrors` and `patternErrors` so this function stays
 * within the project's max-params lint budget.
 */
function processLine(line, lineNum, patterns, items, errors) {
  const { parseErrors, patternErrors } = errors;
  const trimmed = line.trim();

  // Skip empty lines
  if (!trimmed) return;

  // Parse JSON
  let obj;
  try {
    obj = JSON.parse(trimmed);
  } catch (err) {
    parseErrors.push(`Line ${lineNum}: Invalid JSON: ${err.message}`);
    return;
  }

  // Validate required fields
  const validation = validateRequired(obj, lineNum);
  if (validation.error) {
    parseErrors.push(validation.error);
    return;
  }

  // Validate file matches pattern
  if (!fileMatchesPattern(obj.file, patterns)) {
    patternErrors.push(`Line ${lineNum}: File '${obj.file}' does not match any pattern: ${patterns.join(', ')}`);
    return;
  }

  // Build final item with location/severity prepended if present
  const finalItem = buildFinalItem(obj);
  items.push(finalItem);
}

/**
 * Validate required fields in parsed line.
 */
function validateRequired(obj, lineNum) {
  if (typeof obj.file !== 'string' || obj.file.length === 0) {
    return { error: `Line ${lineNum}: Missing required field 'file'` };
  }
  if (typeof obj.text !== 'string' || obj.text.length === 0) {
    return { error: `Line ${lineNum}: Missing or empty required field 'text'` };
  }
  return { error: null };
}

/**
 * Check if a file path matches at least one pattern.
 */
function fileMatchesPattern(file, patterns) {
  return patterns.some(pattern => minimatch(file, pattern));
}

/**
 * Build final item with location/severity prepended to text if present.
 */
function buildFinalItem(obj) {
  const { file, text, location, severity, ...extra } = obj;
  const finalText = prependLocationSeverity(text, file, location, severity);

  // Return all fields including extra ones
  const result = { file, text: finalText, ...extra };
  if (location) result.location = location;
  if (severity) result.severity = severity;

  return result;
}

/**
 * Prepend location and/or severity to text.
 */
function prependLocationSeverity(text, file, location, severity) {
  if (!severity && !location) {
    return text;
  }

  let prefix = '';
  if (severity) {
    prefix += `[${severity}] `;
  }
  prefix += file;
  if (location) {
    prefix += `:${location}`;
  }
  prefix += ' — ';

  return prefix + text;
}
