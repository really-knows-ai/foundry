/**
 * Shared validation utilities extracted from the plugin's validate-tools.
 *
 * These functions run deterministic validator commands (no LLM involvement)
 * and return structured results consumed by the quench module and the
 * plugin's `foundry_validate_run` tool.
 */

import { execSync } from 'child_process';
import { readdir } from 'fs/promises';
import { join, relative, dirname, sep } from 'path';
import { minimatch } from 'minimatch';
import { getLawsForQuench, getArtefactType } from './config.js';
import { parseValidatorJsonl } from './validator-jsonl.js';

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

export function shellQuote(value) {
  return "'" + String(value).replace(/'/g, "'\\''") + "'";
}

function validatePatterns(patterns, typeId) {
  if (!Array.isArray(patterns) || patterns.length === 0) {
    return { ok: false, error: `Artefact type ${typeId} has no file-patterns` };
  }
  return null;
}

const SKIP_DIRS = new Set(['node_modules', '.git']);

function toPosix(p) {
  return sep === '/' ? p : p.split(sep).join('/');
}

async function readdirSafe(dir) {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function* walkFiles(root, dir) {
  for (const entry of await readdirSafe(dir)) {
    const full = join(dir, entry.name);
    if (entry.isDirectory() && !SKIP_DIRS.has(entry.name)) {
      yield* walkFiles(root, full);
    } else if (entry.isFile()) {
      yield toPosix(relative(root, full));
    }
  }
}

function fileMatchesAnyPattern(rel, patterns) {
  for (const pattern of patterns) {
    if (minimatch(rel, pattern)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Exported functions
// ---------------------------------------------------------------------------

/**
 * Read file-patterns for an artefact type from its definition.
 */
export async function getValidationPatterns(foundryDir, typeId, io) {
  const artType = await getArtefactType(foundryDir, typeId, io);
  return artType.frontmatter['file-patterns'] || [];
}

/**
 * Run validation commands for an artefact type deterministically.
 *
 * Accepts an IO interface and foundryDir directly (no plugin context
 * dependency). When `artefacts` is provided, the `{files}` substitution
 * uses non-deleted files from the artefact list instead of expanding
 * patterns across the worktree.
 *
 * @param {{ typeId: string, io: object, foundryDir: string, artefacts?: Array<{file: string, state: string}> }} params
 * @returns {Promise<{ ok: boolean, validatorsRun: number, items: Array, errors: Array }>}
 */
export async function performValidation({ typeId, io, foundryDir, artefacts }) {
  let patterns;
  try {
    patterns = await getValidationPatterns(foundryDir, typeId, io);
  } catch (err) {
    return { ok: false, error: err.message };
  }

  const validationErr = validatePatterns(patterns, typeId);
  if (validationErr) return validationErr;

  const laws = await getLawsForQuench(foundryDir, io, { typeId });
  if (!laws?.length) {
    return { ok: true, validatorsRun: 0, items: [], errors: [] };
  }
  return runValidatorsAndReport(laws, patterns, foundryDir, artefacts);
}

/**
 * Run validators for a set of laws and build the aggregated result.
 *
 * When `artefacts` is provided, the `{files}` substitution uses non-deleted
 * files from the artefact list. Otherwise patterns are expanded across the
 * worktree (backwards compatibility for callers like `foundry_validate_run`).
 */
export async function runValidatorsAndReport(laws, patterns, foundryDir, artefacts) {
  const worktree = dirname(foundryDir);
  let expandedFiles;
  if (artefacts) {
    expandedFiles = artefacts
      .filter(({ state }) => state !== 'deleted')
      .map(({ file }) => file)
      .sort();
  } else {
    expandedFiles = await expandPatterns(patterns, worktree);
  }
  const substitutions = {
    pattern: patterns.map(shellQuote).join(' '),
    files: expandedFiles.map(shellQuote).join(' '),
  };
  const results = await runValidators(laws, patterns, substitutions, worktree);

  return {
    ok: results.errors.length === 0,
    validatorsRun: results.validatorsRun,
    items: results.items,
    errors: results.errors,
  };
}

/**
 * Expand glob patterns to actual file paths in the worktree.
 *
 * Uses readdir + minimatch for Node 20 compatibility (glob added in Node 22).
 */
export async function expandPatterns(patterns, worktree) {
  const files = new Set();
  for await (const rel of walkFiles(worktree, worktree)) {
    if (fileMatchesAnyPattern(rel, patterns)) {
      files.add(rel);
    }
  }
  return Array.from(files).sort();
}

/**
 * Run all validators across a list of laws and collect results.
 */
export async function runValidators(laws, patterns, substitutions, worktree) {
  const results = {
    validatorsRun: 0,
    items: [],
    errors: [],
  };

  for (const law of laws) {
    if (!law.validators || law.validators.length === 0) continue;
    await runLawValidators(law, patterns, substitutions, worktree, results);
  }

  return results;
}

/**
 * Run validators for a single law.
 */
export async function runLawValidators(law, patterns, substitutions, worktree, results) {
  for (const validator of law.validators) {
    // Skip commands that require {files} when there are no matching files
    if (substitutions.files === '' && /(?:^|\s)\{files\}(?=\s|$)/.test(validator.command)) {
      continue;
    }
    results.validatorsRun++;
    const expanded = expandValidatorCommand(validator.command, substitutions);
    const parseResult = await executeValidator(expanded, worktree, patterns);
    collectValidatorResult(parseResult, law.id, validator.id, results);
  }
}

/**
 * Fold a single validator's parse result into the aggregate results.
 */
export function collectValidatorResult(parseResult, lawId, validatorId, results) {
  for (const item of parseResult.items) {
    results.items.push({ lawId, validatorId, ...item });
  }
  for (const message of parseResult.parseErrors) {
    results.errors.push({ lawId, validatorId, type: 'parse', message });
  }
  for (const message of parseResult.patternErrors) {
    results.errors.push({ lawId, validatorId, type: 'pattern-mismatch', message });
  }
}

/**
 * If every line of output was unparseable, the validator script itself is
 * broken (syntax error, runtime crash, etc.). Replace the noise of 20+
 * individual "Invalid JSON" errors with a single actionable message.
 */
export function checkForValidatorCrash(result) {
  if (result.items.length === 0 && result.parseErrors.length > 0) {
    return {
      ...result,
      parseErrors: [
        `Validator produced no valid output (${result.parseErrors.length} unparseable lines). Check the validator script for syntax errors.`,
      ],
    };
  }
  return result;
}

/**
 * Execute a validator command and parse its JSONL output.
 */
export async function executeValidator(expanded, worktree, patterns) {
  try {
    const output = execSync(expanded, {
      cwd: worktree,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const { Readable } = await import('stream');
    const stream = Readable.from([output]);
    return checkForValidatorCrash(
      await parseValidatorJsonl(stream, patterns),
    );
  } catch (err) {
    // Validator command failed — prefer stdout for JSONL
    // (tools like rg exit 1 with results on stdout)
    const output = (err.stdout || err.stderr || err.message || '').trim();
    const { Readable } = await import('stream');
    const stream = Readable.from([output]);
    return checkForValidatorCrash(
      await parseValidatorJsonl(stream, patterns),
    );
  }
}

/**
 * Expand validator command placeholders {pattern} and {files}.
 *
 * Both placeholders are recognised only as standalone tokens bounded by
 * whitespace or start/end of string. Surrounding single or double quotes
 * around the placeholder are stripped first.
 */
export function expandValidatorCommand(command, { pattern, files }) {
  let cmd = command
    .replace(/"\{pattern\}"/g, '{pattern}')
    .replace(/'\{pattern\}'/g, '{pattern}')
    .replace(/"\{files\}"/g, '{files}')
    .replace(/'\{files\}'/g, '{files}');

  cmd = cmd.replace(/(?:^|\s)\{pattern\}(?=\s|$)/g, (match) =>
    match.startsWith('{') ? pattern : ' ' + pattern);

  cmd = cmd.replace(/(?:^|\s)\{files\}(?=\s|$)/g, (match) =>
    match.startsWith('{') ? files : ' ' + files);

  return cmd;
}
