// Tools for scoped config command execution.
//
// Registers:
//   foundry_config_run_command      — no-shell config command runner
//   foundry_config_run_validator    — validator with {files}/{pattern} expansion
//                                      and JSONL parsing
//   foundry_config_run_validator_test — companion test runner for validator
//                                        scripts
//
// All three require a config/* branch, a git repository, a Foundry root, and
// a not-failed gate.  Validator and test tools are new in Phase 04.

import path from 'path';
import { Readable } from 'stream';
import { runCommand, createExec } from '../../scripts/lib/config-command-runner.js';
import { parseValidatorJsonl } from '../../scripts/lib/validator-jsonl.js';
import { expandValidatorCommand } from '../../scripts/lib/validation.js';
import { makeIO, makeExec } from './helpers.js';
import { requireOnConfigBranch } from '../../scripts/lib/branch-guard.js';
import { requireGitRepo, requireFoundryRoot } from '../../scripts/lib/foundational-guards.js';
import { guarded, notFailedGuard } from '../../scripts/lib/guards.js';

const ROOT_PACKAGE_FILES = ['package.json', 'pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'bun.lock'];

// ---------------------------------------------------------------------------
// Guard functions — matches the pattern from config-create-tools and
// config-law-tools.
// ---------------------------------------------------------------------------

function gitRepoGuard(_args, context) {
  return requireGitRepo(makeIO(context.worktree));
}

function foundryRootGuard(_args, context) {
  return requireFoundryRoot(makeIO(context.worktree));
}

function configBranchGuard(_args, context) {
  return requireOnConfigBranch({ exec: makeExec(context.worktree) });
}

const gateNotFailed = notFailedGuard(makeIO);

const ALL_GUARDS = [gitRepoGuard, foundryRootGuard, configBranchGuard, gateNotFailed];

// ---------------------------------------------------------------------------
// Root package file protection — enforces spec item 13 (line 130):
// "The command runner must not modify host root package manager files by
// default." When a command changes root package.json, pnpm-lock.yaml,
// package-lock.json, yarn.lock, or bun.lock, the result is flagged as a
// policy violation.
// ---------------------------------------------------------------------------

function rejectRootPackageChanges(runResult) {
  if (!runResult.ok || !runResult.changedFiles) return runResult;
  const disallowed = runResult.changedFiles.filter((f) => ROOT_PACKAGE_FILES.includes(f));
  if (disallowed.length === 0) return runResult;
  return {
    ...runResult,
    ok: false,
    error: `root package file(s) changed: ${disallowed.join(', ')}`,
    reason: 'root_package_file_changed',
    disallowedFiles: disallowed,
  };
}

// ---------------------------------------------------------------------------
// Shell-quote a value for safe argv tokenisation via parseCommand.
// Matches the shellQuote helper used by validation.js.
// ---------------------------------------------------------------------------

function shellQuote(value) {
  return "'" + String(value).replace(/'/g, "'\\''") + "'";
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

function isUnderFoundry(worktree, testPath) {
  const resolved = path.resolve(worktree, testPath);
  const foundryResolved = path.resolve(worktree, 'foundry');
  return resolved.startsWith(foundryResolved + path.sep);
}

// ---------------------------------------------------------------------------
// Validator input helpers
// ---------------------------------------------------------------------------

function checkStringArrayElements(arr, label) {
  if (!Array.isArray(arr)) return `${label} must be a string array`;
  if (arr.some(item => typeof item !== 'string')) return `each element in ${label} must be a string`;
  return null;
}

function validateRunValidatorArgs(args) {
  if (!args.command) return 'command is required';
  const filesErr = checkStringArrayElements(args.files, 'files');
  if (filesErr) return filesErr;
  const patternsErr = checkStringArrayElements(args.patterns, 'patterns');
  if (patternsErr) return patternsErr;
  return null;
}

function buildCrashResponse(runResult) {
  return {
    ok: false,
    error: 'validator exited non-zero without valid JSONL',
    exitCode: runResult.exitCode,
    logPath: runResult.logPath,
  };
}

function buildSuccessResponse(runResult, parseResult) {
  return {
    ok: parseResult.parseErrors.length === 0,
    violations: parseResult.items,
    parseErrors: parseResult.parseErrors,
    patternErrors: parseResult.patternErrors,
    rawStdout: runResult.stdout,
    rawStderr: runResult.stderr,
    exitCode: runResult.exitCode,
    logPath: runResult.logPath,
  };
}

function expandPlaceholders(command, files, patterns) {
  const filesSubst = files.map(shellQuote).join(' ');
  const patternsSubst = patterns.map(shellQuote).join(' ');
  return expandValidatorCommand(command, {
    pattern: patternsSubst,
    files: filesSubst,
  });
}

function hasValidatorCrashed(parseResult, exitCode) {
  return parseResult.items.length === 0 && parseResult.parseErrors.length > 0 && exitCode !== 0;
}

// ---------------------------------------------------------------------------
// Validator test input helpers
// ---------------------------------------------------------------------------

function validateTestPath(worktree, testPath) {
  if (!testPath) return 'path is required';
  if (!isUnderFoundry(worktree, testPath)) return `path outside foundry/: ${testPath}`;
  if (!/\.test\.(?:js|mjs)$/.test(testPath)) {
    return `path does not match *.test.js or *.test.mjs: ${testPath}`;
  }
  return null;
}

function buildTestResponse(result) {
  if (!result.ok) return result;
  return {
    ok: true,
    passed: result.exitCode === 0,
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
    durationMs: result.durationMs,
    changedFiles: result.changedFiles,
    logPath: result.logPath,
  };
}

// ---------------------------------------------------------------------------
// foundry_config_run_command executor  (Phase 02, unchanged behaviour)
// ---------------------------------------------------------------------------

function isPnpmRun(command) {
  return (command || '').trim().startsWith('pnpm run ');
}

function executeRunCommand(args, context) {
  const guard = requireOnConfigBranch({ exec: createExec(context.worktree) });
  if (!guard.ok) {
    return JSON.stringify({ ok: false, error: `foundry_config_run_command: ${guard.error}` });
  }

  try {
    const io = makeIO(context.worktree);
    const execCwd = isPnpmRun(args.command)
      ? path.resolve(context.worktree, 'foundry')
      : context.worktree;
    const exec = createExec(execCwd, 30000);
    const result = runCommand({
      io, exec, command: args.command, reason: args.reason,
      timeout: args.timeout, worktree: context.worktree, cwd: execCwd,
    });
    return JSON.stringify(rejectRootPackageChanges(result));
  } catch (err) {
    return JSON.stringify({ ok: false, error: err.message ?? String(err) });
  }
}

// ---------------------------------------------------------------------------
// Validator command runner — shared between executeRunValidator and test
// helpers.
// ---------------------------------------------------------------------------

async function runValidatorCommand(expanded, patterns, io, exec, worktree) {
  const runResult = rejectRootPackageChanges(runCommand({ io, exec, command: expanded, reason: 'validator execution', worktree, cwd: worktree }));
  if (!runResult.ok) return JSON.stringify(runResult);

  const stdout = runResult.stdout || '';
  const stream = Readable.from([stdout]);
  const parseResult = await parseValidatorJsonl(stream, patterns);

  if (hasValidatorCrashed(parseResult, runResult.exitCode)) return JSON.stringify(buildCrashResponse(runResult));
  return JSON.stringify(buildSuccessResponse(runResult, parseResult));
}

// ---------------------------------------------------------------------------
// foundry_config_run_validator executor
// ---------------------------------------------------------------------------

async function executeRunValidator(args, context) {
  const validationError = validateRunValidatorArgs(args);
  if (validationError) return JSON.stringify({ ok: false, error: validationError });

  try {
    const expanded = expandPlaceholders(args.command, args.files, args.patterns);
    const io = makeIO(context.worktree);
    const exec = createExec(context.worktree, 30000);
    return await runValidatorCommand(expanded, args.patterns, io, exec, context.worktree);
  } catch (err) {
    return JSON.stringify({ ok: false, error: String(err) });
  }
}

// ---------------------------------------------------------------------------
// foundry_config_run_validator_test executor
// ---------------------------------------------------------------------------

function executeRunValidatorTest(args, context) {
  const validationError = validateTestPath(context.worktree, args.path);
  if (validationError) return JSON.stringify({ ok: false, error: validationError, reason: 'path_outside_foundry' });

  try {
    const io = makeIO(context.worktree);
    const exec = createExec(context.worktree, 30000);
    const result = rejectRootPackageChanges(runCommand({ io, exec, command: `node ${args.path}`, reason: 'validator companion test', worktree: context.worktree, cwd: context.worktree }));
    return JSON.stringify(buildTestResponse(result));
  } catch (err) {
    return JSON.stringify({ ok: false, error: err.message ?? String(err) });
  }
}

// ---------------------------------------------------------------------------
// Tool factories
// ---------------------------------------------------------------------------

function makeRunCommandTool(tool) {
  return tool({
    description:
      'Run an allowed command with no shell, policy enforcement, ' +
      'timeout, output capture, dirty-tree tracking, and an audit log. ' +
      'Requires a config/* branch. The command must be a node script ' +
      'under foundry/** or a pnpm run script.',
    args: {
      command: tool.schema.string()
        .describe('Command string (e.g. "node foundry/artefacts/haiku/validate-syllables.test.mjs")'),
      reason: tool.schema.string()
        .describe('Non-empty reason for the audit log'),
      timeout: tool.schema.number().optional()
        .describe('Timeout in milliseconds (default 30000, max 120000)'),
    },
    execute: executeRunCommand,
  });
}

function makeRunValidatorTool(tool) {
  return tool({
    description:
      'Run a validator command with quench-compatible {files} and ' +
      '{pattern} placeholder expansion. Parses stdout as JSONL using ' +
      'the real validator parser. Reports violations, parse errors, ' +
      'pattern errors, and the audit log path. Tolerates non-zero exit ' +
      'codes when stdout contains valid JSONL. Requires a config/* branch.',
    args: {
      command: tool.schema.string()
        .describe('Validator command with optional {files} and {pattern} placeholders'),
      files: tool.schema.array(tool.schema.string())
        .describe('Array of file paths for {files} expansion')
        .required(),
      patterns: tool.schema.array(tool.schema.string())
        .describe('Array of glob patterns for {pattern} expansion and JSONL file matching')
        .required(),
    },
    execute: guarded('foundry_config_run_validator', ALL_GUARDS, executeRunValidator),
  });
}

function makeRunValidatorTestTool(tool) {
  return tool({
    description:
      'Run a validator companion test under foundry/. Validates the ' +
      'path is under foundry/** and matches *.test.js or *.test.mjs, ' +
      'then runs node <path> without a shell. Returns pass/fail, exit ' +
      'code, output, duration, dirty-tree changes, and the audit log ' +
      'path. Requires a config/* branch.',
    args: {
      path: tool.schema.string()
        .describe('Path to the test file under foundry/ (e.g. foundry/artefacts/haiku/validate.test.mjs)'),
    },
    execute: guarded('foundry_config_run_validator_test', ALL_GUARDS, executeRunValidatorTest),
  });
}

export function createConfigCommandTools({ tool }) {
  return {
    foundry_config_run_command: makeRunCommandTool(tool),
    foundry_config_run_validator: makeRunValidatorTool(tool),
    foundry_config_run_validator_test: makeRunValidatorTestTool(tool),
  };
}
