import { execSync } from 'child_process';
import { glob } from 'fs/promises';
import { join } from 'path';
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
 * Extract error message from various error object properties.
 */
function fallbackMessage(err) {
  return (err.stderr || err.stdout || err.message || '').trim();
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
    // Validator command failed - parse stderr/stdout as JSONL
    const output = fallbackMessage(err);
    const { Readable } = await import('stream');
    const stream = Readable.from([output]);
    return await parseValidatorJsonl(stream, patterns);
  }
}

/**
 * Run all validators for laws and collect results.
 */
async function runValidators(laws, patterns, patternSubstitution, worktree) {
  const results = { validatorsRun: 0, feedbackItems: 0, allErrors: [] };

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
    results.validatorsRun++;
    const expanded = expandValidatorCommand(validator.command, patternSubstitution);
    const parseResult = await executeValidator(expanded, worktree, patterns);
    processValidatorResult(parseResult, law.id, validator.id, results);
  }
}

/**
 * Process validator execution result.
 */
function processValidatorResult(parseResult, lawId, validatorId, results) {
  if (!parseResult.ok) {
    for (const error of parseResult.errors) {
      results.allErrors.push(`${lawId}/${validatorId}: ${error}`);
    }
  } else {
    results.feedbackItems += parseResult.items.length;
  }
}

export function createValidateTools({ tool }) {
  return {
    foundry_validate_run: tool({
      description: 'Run validation commands for an artefact type',
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
async function performValidation(args, context) {
  const io = makeIO(context.worktree);
  const foundryDir = join(context.worktree, 'foundry');

  // Get artefact type definition first to validate it exists
  const artType = await getArtefactType(foundryDir, args.typeId, io);
  const patterns = artType.frontmatter['file-patterns'] || [];
  
  const validationErr = validatePatterns(patterns, args.typeId);
  if (validationErr) return JSON.stringify(validationErr);

  // Get laws for this artefact type
  const laws = await getLawsForQuench(foundryDir, io, { typeId: args.typeId });
  if (!laws || laws.length === 0) {
    return JSON.stringify({ ok: true, validatorsRun: 0, feedbackItems: 0 });
  }

  return runValidatorsAndReport(laws, patterns, context.worktree);
}

/**
 * Run validators and report results.
 */
async function runValidatorsAndReport(laws, patterns, worktree) {
  // Expand patterns and run validators
  const expandedFiles = await expandPatterns(patterns, worktree);
  const patternSubstitution = expandedFiles.map(shellQuote).join(' ');
  const results = await runValidators(laws, patterns, patternSubstitution, worktree);

  // Check for errors
  if (results.allErrors.length > 0) {
    return JSON.stringify({
      ok: false,
      error: `Validator errors: ${results.allErrors.join('; ')}`,
    });
  }

  return JSON.stringify({ ok: true, validatorsRun: results.validatorsRun, feedbackItems: results.feedbackItems });
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

/**
 * Expand glob patterns to actual files in the worktree.
 */
async function expandPatterns(patterns, worktree) {
  const files = new Set();
  for (const pattern of patterns) {
    try {
      const matches = await glob(pattern, {
        cwd: worktree,
        nodir: true,
      });
      for (const match of matches) {
        files.add(match);
      }
    } catch {
      // Pattern didn't match any files
    }
  }
  return Array.from(files).sort();
}

/**
 * Expand validator command by replacing {pattern} placeholder.
 */
function expandValidatorCommand(command, patternSubstitution) {
  return command
    .replace(/"\{pattern\}"/g, '{pattern}')
    .replace(/'\{pattern\}'/g, '{pattern}')
    .replace(/\{pattern\}/g, patternSubstitution);
}
