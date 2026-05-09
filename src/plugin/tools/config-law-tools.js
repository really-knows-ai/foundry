// Tools for reading, adding, and editing laws.
//
// `foundry_config_read_law` — read-only, returns the full markdown of a law including validators block.
// Runs anywhere (no branch guard).
//
// `foundry_config_add_law` — replaces foundry_config_create_law. Mutates the worktree (write + commit)
// on a config/* branch.
//
// `foundry_config_edit_law` — updates an existing law's body, validates, and commits on config/* branch.

import { join, dirname } from 'path';
import { validate as validateLaw } from '../../scripts/lib/config-validators/law.js';
import { requireGitRepo, requireFoundryRoot } from '../../scripts/lib/foundational-guards.js';
import { requireOnConfigBranch } from '../../scripts/lib/branch-guard.js';
import { guarded, notFailedGuard } from '../../scripts/lib/guards.js';
import { UnexpectedFilesError, commitWithPolicy } from '../../scripts/lib/git-bridge.js';
import { makeIO, makeExec, makeAsyncIO, errorJson, branchIoFactory, asyncIoFactory } from './helpers.js';
import { execFileSync } from 'child_process';

// --- utility functions -------------------------------------------------------

/**
 * Check if content contains a law with given ID.
 * Uses simple string search and heading pattern matching.
 */
function contentContainsLaw(content, lawId) {
  const pattern = new RegExp(`^## ${lawId}(?:\\s|$)`, 'm');
  return pattern.test(content);
}

/**
 * Find the starting index of a law in an array of lines.
 */
function findLawStart(lines, lawId) {
  for (let i = 0; i < lines.length; i++) {
    const heading = lines[i].match(/^## (.+)/);
    if (heading && heading[1].trim() === lawId) {
      return i;
    }
  }
  return -1;
}

/**
 * Find the ending index of a law in an array of lines.
 */
function findLawEnd(lines, startIdx) {
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (lines[i].match(/^## (.+)/)) {
      return i;
    }
  }
  return lines.length;
}

/**
 * Extract the full markdown for a single law from file content.
 * Preserves original formatting including trailing newlines.
 */
function extractLawMarkdown(content, lawId) {
  const lines = content.split('\n');
  const startIdx = findLawStart(lines, lawId);

  if (startIdx < 0) return null;

  const endIdx = findLawEnd(lines, startIdx);
  const lawLines = lines.slice(startIdx, endIdx);
  
  // Trim trailing empty lines, then add exactly one newline
  while (lawLines.length > 0 && lawLines[lawLines.length - 1] === '') {
    lawLines.pop();
  }
  
  return lawLines.join('\n') + '\n';
}

/**
 * Search global laws directory for a law with matching ID.
 */
async function searchGlobalLaws(io, foundryDir, lawId) {
  const globalLawsDir = join(foundryDir, 'laws');
  if (!(await io.exists(globalLawsDir))) {
    return null;
  }

  const files = await io.readDir(globalLawsDir);
  for (const file of files) {
    if (!file.endsWith('.md')) continue;
    const path = join(globalLawsDir, file);
    const content = await io.readFile(path);
    if (contentContainsLaw(content, lawId)) {
      return { path, fullMarkdown: content, source: 'global' };
    }
  }

  return null;
}

/**
 * Search type-specific laws for a law with matching ID.
 */
async function searchTypeSpecificLaws(io, foundryDir, lawId) {
  const artefactsDir = join(foundryDir, 'artefacts');
  if (!(await io.exists(artefactsDir))) {
    return null;
  }

  const types = await io.readDir(artefactsDir);
  for (const typeId of types) {
    const typeLawsPath = join(artefactsDir, typeId, 'laws.md');
    if (!(await io.exists(typeLawsPath))) continue;

    const content = await io.readFile(typeLawsPath);
    if (contentContainsLaw(content, lawId)) {
      return { path: typeLawsPath, fullMarkdown: content, source: `type:${typeId}` };
    }
  }

  return null;
}

/**
 * Find a law by ID across all law locations (global and type-specific).
 * Returns { found: true, path, fullMarkdown, source } or { found: false }.
 */
async function findLawByID(io, foundryDir, lawId) {
  let result = await searchGlobalLaws(io, foundryDir, lawId);
  if (result) {
    return { found: true, ...result };
  }

  result = await searchTypeSpecificLaws(io, foundryDir, lawId);
  if (result) {
    return { found: true, ...result };
  }

  return { found: false };
}

// --- guard helpers ---------------------------------------------------------

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

const GIT_COMMAND = 'git';

function makeExecFile(cwd) {
  return (argv) => execFileSync(GIT_COMMAND, argv, { cwd, encoding: 'utf8', stdio: 'pipe' });
}

const READ_GUARDS = [gitRepoGuard, foundryRootGuard];
const CREATE_GUARDS = [gitRepoGuard, foundryRootGuard, configBranchGuard, gateNotFailed];
const EDIT_GUARDS = [gitRepoGuard, foundryRootGuard, configBranchGuard, gateNotFailed];

// --- read law executor -------------------------------------------------------

async function executeReadLaw(args, context) {
  try {
    const io = makeAsyncIO(context.worktree);
    const result = await findLawByID(io, 'foundry', args.id);
    if (!result.found) {
      return JSON.stringify({
        ok: false,
        errors: [`Law "${args.id}" not found`],
      });
    }
    const markdown = extractLawMarkdown(result.fullMarkdown, args.id);
    if (!markdown) {
      return JSON.stringify({
        ok: false,
        errors: [`Could not extract law "${args.id}" from file`],
      });
    }
    return JSON.stringify({
      ok: true,
      id: args.id,
      markdown,
      source: result.source,
    });
  } catch (err) {
    return errorJson(err);
  }
}

// --- add law validation helpers -------------------------------------------------------

function isGlobalTarget(target) {
  return target?.kind === 'global';
}

function isTypeSpecificTarget(target) {
  return target?.kind === 'type-specific';
}

function errorIfInvalidTargetObject(target) {
  if (!target || typeof target !== 'object') {
    return 'target argument is required (object with kind + locator)';
  }
  return null;
}

function errorIfInvalidTargetKind(target) {
  if (!isGlobalTarget(target) && !isTypeSpecificTarget(target)) {
    return `unknown target.kind: ${target.kind}`;
  }
  return null;
}

function errorIfInvalidGlobalTarget(target) {
  if (!isGlobalTarget(target)) return null;
  if (typeof target.file !== 'string' || !target.file.trim()) {
    return 'target.file is required for kind: "global"';
  }
  return null;
}

function errorIfInvalidTypeSpecificTarget(target) {
  if (!isTypeSpecificTarget(target)) return null;
  if (typeof target.typeId !== 'string' || !target.typeId.trim()) {
    return 'target.typeId is required for kind: "type-specific"';
  }
  return null;
}

function validateAddLawTarget(target) {
  return (
    errorIfInvalidTargetObject(target)
    || errorIfInvalidTargetKind(target)
    || errorIfInvalidGlobalTarget(target)
    || errorIfInvalidTypeSpecificTarget(target)
  );
}

function computeTargetPath(target) {
  if (isGlobalTarget(target)) {
    return join('foundry', 'laws', target.file);
  }
  return join('foundry', 'artefacts', target.typeId, 'laws.md');
}

// --- add law executor --------------------------------------------------------

async function validateAddLawPrerequisites(io, args) {
  const targetError = validateAddLawTarget(args.target);
  if (targetError) {
    return { error: targetError };
  }

  const path = computeTargetPath(args.target);
  const validation = await validateLaw({ body: args.body, io });
  if (!validation.ok) {
    return validation;
  }

  if (await io.exists(path)) {
    return {
      ok: false,
      errors: [`${path} already exists; updates are not supported in 3.0.0 — edit by hand on this config/* branch`],
    };
  }

  return { ok: true, path };
}

async function executeAddLaw(args, context) {
  const io = makeAsyncIO(context.worktree);
  const execFile = makeExecFile(context.worktree);

  try {
    const prereq = await validateAddLawPrerequisites(io, args);
    if (prereq.error) {
      return JSON.stringify({ ok: false, errors: [prereq.error] });
    }
    if (!prereq.ok) {
      return JSON.stringify(prereq);
    }

    const path = prereq.path;

    await io.mkdirp(dirname(path));
    await io.writeFile(path, args.body);

    const sha = commitWithPolicy({
      message: `config: add law ${args.name}\n\nvia foundry_config_add_law`,
      allowedPatterns: ['foundry/**'],
      execFile,
    });

    return JSON.stringify({ ok: true, path, sha });
  } catch (err) {
    if (err instanceof UnexpectedFilesError) {
      return JSON.stringify({ error: err.message, affected_files: err.files });
    }
    return errorJson(err);
  }
}

// --- edit law executor -------------------------------------------------------

async function executeEditLaw(args, context) {
  const io = makeAsyncIO(context.worktree);
  const execFile = makeExecFile(context.worktree);

  try {
    const result = await findLawByID(io, 'foundry', args.id);
    if (!result.found) {
      return JSON.stringify({
        ok: false,
        errors: [`Law "${args.id}" not found`],
      });
    }

    const validation = await validateLaw({ body: args.body, io });
    if (!validation.ok) {
      return JSON.stringify(validation);
    }

    await io.writeFile(result.path, args.body);
    execFile(['add', result.path]);
    execFile(['commit', '-m', `config: edit law ${args.id}\n\nvia foundry_config_edit_law`]);

    return JSON.stringify({
      ok: true,
      id: args.id,
      path: result.path.replace(/^foundry\//, 'foundry/'),
      source: result.source,
    });
  } catch (err) {
    if (err instanceof UnexpectedFilesError) {
      return JSON.stringify({ error: err.message, affected_files: err.files });
    }
    return errorJson(err);
  }
}

// --- tool factories -------------------------------------------------------

function makeReadLawTool(tool) {
  return tool({
    description: 'Read a law by ID, returning the full markdown including validators block.',
    args: {
      id: tool.schema.string().describe('Law ID to read'),
    },
    execute: guarded('foundry_config_read_law', READ_GUARDS, executeReadLaw, {
      branchIo: branchIoFactory,
      io: asyncIoFactory,
    }),
  });
}

function makeAddLawTool(tool) {
  return tool({
    description: 'Add a new law (config-tier; requires a config/* branch). Target must be {kind:"global", file:"<name>.md"} or {kind:"type-specific", typeId:"<id>"}.',
    args: {
      name: tool.schema.string(),
      body: tool.schema.string(),
      target: tool.schema.object({
        kind: tool.schema.string(),
        file: tool.schema.string().optional(),
        typeId: tool.schema.string().optional(),
      }),
    },
    execute: guarded('foundry_config_add_law', CREATE_GUARDS, executeAddLaw, {
      branchIo: branchIoFactory,
      io: asyncIoFactory,
    }),
  });
}

function makeEditLawTool(tool) {
  return tool({
    description: 'Edit an existing law by ID. Validates the new body, updates the file, and commits on the current config/* branch.',
    args: {
      id: tool.schema.string().describe('Law ID to edit'),
      body: tool.schema.string().describe('Full new markdown body for the law'),
    },
    execute: guarded('foundry_config_edit_law', EDIT_GUARDS, executeEditLaw, {
      branchIo: branchIoFactory,
      io: asyncIoFactory,
    }),
  });
}

export function createConfigLawTools({ tool }) {
  return {
    foundry_config_read_law: makeReadLawTool(tool),
    foundry_config_add_law: makeAddLawTool(tool),
    foundry_config_edit_law: makeEditLawTool(tool),
  };
}
