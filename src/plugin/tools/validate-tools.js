import { execSync } from 'child_process';
import { readdir } from 'fs/promises';
import { join, relative, sep } from 'path';
import { minimatch } from 'minimatch';
import { getLawsForQuench, getArtefactType } from '../../scripts/lib/config.js';
import { parseValidatorJsonl } from '../../scripts/lib/validator-jsonl.js';
import { makeIO, branchIoFactory, asyncIoFactory, flowBranchGuard } from './helpers.js';
import { guarded, notFailedGuard } from '../../scripts/lib/guards.js';

const gateNotFailed = notFailedGuard(makeIO);

/**
 * Shell-quote a string for POSIX `/bin/sh` so it is treated as a single literal
 * argument. Wraps the value in single quotes and escapes any embedded single
 * quotes via the `'\''` idiom. Safe for arbitrary file paths including ones
 * containing spaces, semicolons, `$()`, backticks, quotes, and newlines.
 */
function shellQuote(value) {
  return "'" + String(value).replace(/'/g, "'\\''") + "'";
}

/**
 * Execute a validator command and parse its output.
 */
async function executeValidator(expanded, worktree, patterns) {
  try {
    const output = execSync(expanded, {
      cwd: worktree,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const { Readable } = await import('stream');
    const stream = Readable.from([output]);
    return await parseValidatorJsonl(stream, patterns);
  } catch (err) {
    // Validator command failed - prefer stdout for JSONL (tools like rg exit 1 with results on stdout)
    const output = (err.stdout || err.stderr || err.message || '').trim();
    const { Readable } = await import('stream');
    const stream = Readable.from([output]);
    return await parseValidatorJsonl(stream, patterns);
  }
}

/**
 * Run all validators for laws and collect results.
 *
 * Aggregates per-validator parse results into a single structured payload:
 * - `items`: each successfully parsed feedback item, annotated with the
 *   `lawId` and `validatorId` it came from. The quench skill consumes this
 *   to call `foundry_feedback_add` with tag `law:<lawId>:<validatorId>`.
 * - `errors`: validator-level errors split by type. `parse` for malformed
 *   JSON or missing required fields, `pattern-mismatch` for files that
 *   didn't match the artefact type's `file-patterns`.
 */
async function runValidators(laws, patterns, patternSubstitution, worktree) {
  const results = {
    validatorsRun: 0,
    items: [],
    errors: [],
  };

  for (const law of laws) {
    if (!law.validators || law.validators.length === 0) continue;
    await runLawValidators(law, patterns, patternSubstitution, worktree, results);
  }

  return results;
}

/**
 * Run validators for a single law.
 */
async function runLawValidators(law, patterns, patternSubstitution, worktree, results) {
  for (const validator of law.validators) {
    // Skip validators if pattern substitution is empty (no matching files)
    // Self-resolving validators (npm test, tsc) omit {pattern}, so they still run
    if (patternSubstitution === '' && validator.command.includes('{pattern}')) {
      continue;
    }
    results.validatorsRun++;
    const expanded = expandValidatorCommand(validator.command, patternSubstitution);
    const parseResult = await executeValidator(expanded, worktree, patterns);
    collectValidatorResult(parseResult, law.id, validator.id, results);
  }
}

/**
 * Fold a single validator's parse result into the aggregate results.
 *
 * Items always flow through annotated with their `lawId` and `validatorId`,
 * so the caller can construct `law:<lawId>:<validatorId>` feedback tags.
 * Errors are surfaced with their type so the caller can distinguish parse
 * failures from file-pattern mismatches.
 */
function collectValidatorResult(parseResult, lawId, validatorId, results) {
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

export function createValidateTools({ tool }) {
  return {
    foundry_validate_run: tool({
      description: 'Run validation commands for an artefact type. Returns parsed feedback items per validator with their law and validator IDs so the caller can tag feedback as law:<law-id>:<validator-id>.',
      args: {
        typeId: tool.schema.string().describe('Artefact type ID'),
      },
      execute: guarded('foundry_validate_run', [flowBranchGuard, gateNotFailed],
        executeValidateRun,
        { branchIo: branchIoFactory, io: asyncIoFactory }),
    }),
  };
}

async function executeValidateRun(args, context) {
  try {
    return await performValidation(args, context);
  } catch (err) {
    return JSON.stringify({ ok: false, error: `foundry_validate_run: ${err.message}` });
  }
}

/**
 * Perform actual validation work.
 */
async function getValidationPatterns(foundryDir, typeId, io) {
  const artType = await getArtefactType(foundryDir, typeId, io);
  return artType.frontmatter['file-patterns'] || [];
}

async function performValidation(args, context) {
  const io = makeIO(context.worktree);
  const foundryDir = join(context.worktree, 'foundry');

  let patterns;
  try {
    patterns = await getValidationPatterns(foundryDir, args.typeId, io);
  } catch (err) {
    return JSON.stringify({ ok: false, error: err.message });
  }

  const validationErr = validatePatterns(patterns, args.typeId);
  if (validationErr) return JSON.stringify(validationErr);

  const laws = await getLawsForQuench(foundryDir, io, { typeId: args.typeId });
  if (!laws?.length) {
    return JSON.stringify({ ok: true, validatorsRun: 0, items: [], errors: [] });
  }
  return runValidatorsAndReport(laws, patterns, context.worktree);
}

/**
 * Run validators and report results.
 */
async function runValidatorsAndReport(laws, patterns, worktree) {
  const expandedFiles = await expandPatterns(patterns, worktree);
  const patternSubstitution = expandedFiles.map(shellQuote).join(' ');
  const results = await runValidators(laws, patterns, patternSubstitution, worktree);

  return JSON.stringify({
    ok: results.errors.length === 0,
    validatorsRun: results.validatorsRun,
    items: results.items,
    errors: results.errors,
  });
}

/**
 * Validate file patterns.
 */
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

/**
 * Recursively walk `dir` and yield POSIX-style paths relative to `root`.
 * Skips `node_modules` and `.git` for speed; the artefacts we validate live
 * elsewhere.
 */
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

/**
 * Expand glob patterns to actual files in the worktree.
 *
 * Implemented over `readdir` + `minimatch` so we work on Node 20, which lacks
 * `fs/promises.glob` (added in Node 22).
 */
async function expandPatterns(patterns, worktree) {
  const files = new Set();
  for await (const rel of walkFiles(worktree, worktree)) {
    if (fileMatchesAnyPattern(rel, patterns)) {
      files.add(rel);
    }
  }
  return Array.from(files).sort();
}

/**
 * Expand validator command by replacing {pattern} and {files} placeholders.
 *
 * - {pattern} → space-separated, shell-quoted globs from the artefact
 *   type's `file-patterns:` array (e.g. "'haikus/*.md' 'drafts/*.md'").
 * - {files}   → space-separated, shell-quoted matching file paths in the
 *   worktree (e.g. "'haikus/one.md' 'haikus/two.md'").
 *
 * Both placeholders are recognised only as standalone tokens, bounded
 * by whitespace or start/end of string. Surrounding single or double
 * quotes around the placeholder are stripped first so authors can
 * write `rg "{pattern}"` for readability.
 *
 * @param {string} command
 * @param {{ pattern: string, files: string }} substitutions
 * @returns {string}
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
