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
 * @param {Stream} stream - readable stream of JSONL lines
 * @param {string[]} patterns - array of glob patterns for file matching
 * @returns {Promise<{ok: true, items: object[]} | {ok: false, errors: string[]}>}
 */
export async function parseValidatorJsonl(stream, patterns) {
  const items = [];
  const errors = [];

  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: stream,
      crlfDelay: Infinity,
    });

    let lineNum = 0;

    rl.on('line', (line) => {
      lineNum++;
      processLine(line, lineNum, patterns, items, errors);
    });

    rl.on('close', () => {
      finalizeParsing(errors, items, resolve);
    });

    rl.on('error', (err) => {
      errors.push(`Stream error: ${err.message}`);
      resolve({ ok: false, errors });
    });
  });
}

/**
 * Process a single JSONL line.
 */
function processLine(line, lineNum, patterns, items, errors) {
  const trimmed = line.trim();
  
  // Skip empty lines
  if (!trimmed) return;

  // Parse JSON
  let obj;
  try {
    obj = JSON.parse(trimmed);
  } catch (err) {
    errors.push(`Line ${lineNum}: Invalid JSON: ${err.message}`);
    return;
  }

  // Validate required fields
  const validation = validateRequired(obj, lineNum);
  if (validation.error) {
    errors.push(validation.error);
    return;
  }

  // Validate file matches pattern
  if (!fileMatchesPattern(obj.file, patterns)) {
    errors.push(`Line ${lineNum}: File '${obj.file}' does not match any pattern: ${patterns.join(', ')}`);
    return;
  }

  // Build final item with location/severity prepended if present
  const finalItem = buildFinalItem(obj);
  items.push(finalItem);
}

/**
 * Finalize parsing and resolve promise.
 */
function finalizeParsing(errors, items, resolve) {
  if (errors.length > 0) {
    resolve({ ok: false, errors });
  } else {
    resolve({ ok: true, items });
  }
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
