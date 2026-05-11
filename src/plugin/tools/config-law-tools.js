// Tools for reading, adding, and editing laws
// foundry_config_read_law: read-only, returns full markdown (no branch guard)
// foundry_config_add_law: write + commit on config/* branch
// foundry_config_edit_law: update body and commit on config/* branch

import { join, dirname } from 'path';
import { unlink } from 'node:fs/promises';
import { validate as validateLaw } from '../../scripts/lib/config-validators/law.js';
import { requireGitRepo, requireFoundryRoot } from '../../scripts/lib/foundational-guards.js';
import { requireOnConfigBranch } from '../../scripts/lib/branch-guard.js';
import { guarded, notFailedGuard } from '../../scripts/lib/guards.js';
import { UnexpectedFilesError, commitWithPolicy } from '../../scripts/lib/git-bridge.js';
import { makeIO, makeExec, makeAsyncIO, errorJson, branchIoFactory, asyncIoFactory } from './helpers.js';
import { execFileSync } from 'child_process';

// --- utility functions -------------------------------------------------------

function contentContainsLaw(content, lawId) {
  const pattern = new RegExp(`^## ${lawId}(?:\\s|$)`, 'm');
  return pattern.test(content);
}

function findLawStart(lines, lawId) {
  for (let i = 0; i < lines.length; i++) {
    const heading = lines[i].match(/^## (.+)/);
    if (heading && heading[1].trim() === lawId) {
      return i;
    }
  }
  return -1;
}

function findLawEnd(lines, startIdx) {
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (lines[i].match(/^## (.+)/)) {
      return i;
    }
  }
  return lines.length;
}

// Extract full markdown for a single law from file content
function extractLawMarkdown(content, lawId) {
  const lines = content.split('\n');
  const startIdx = findLawStart(lines, lawId);

  if (startIdx < 0) return null;

  const endIdx = findLawEnd(lines, startIdx);
  const lawLines = lines.slice(startIdx, endIdx);
  
  while (lawLines.length > 0 && lawLines[lawLines.length - 1] === '') {
    lawLines.pop();
  }
  
  return lawLines.join('\n') + '\n';
}

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

function validateAddLawTarget(target) {
  const err = validateAddLawTargetStruct(target);
  if (err) return err;
  return target.kind === 'global' ? validateGlobalLawTarget(target) : validateTypeSpecLawTarget(target);
}

function validateAddLawTargetStruct(target) {
  if (!target || typeof target !== 'object') {
    return 'target argument is required (object with kind + locator)';
  }
  const kinds = ['global', 'type-specific'];
  if (!kinds.includes(target.kind)) return `unknown target.kind: ${target.kind}`;
  return null;
}

function validateGlobalLawTarget(target) {
  if (typeof target.file !== 'string' || !target.file.trim()) {
    return 'target.file is required for kind: "global"';
  }
  return null;
}

function validateTypeSpecLawTarget(target) {
  if (typeof target.typeId !== 'string' || !target.typeId.trim()) {
    return 'target.typeId is required for kind: "type-specific"';
  }
  return null;
}

function computeTargetPath(target) {
  if (target?.kind === 'global') {
    return join('foundry', 'laws', target.file);
  }
  return join('foundry', 'artefacts', target.typeId, 'laws.md');
}

function extractLawIdFromBody(body) {
  const match = body.match(/^## ([^\s]+)/m);
  return match ? match[1] : null;
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

  const lawId = extractLawIdFromBody(args.body);
  if (!lawId) {
    return { ok: false, errors: ['could not determine law id from body (expected "## <law-id>" heading)'] };
  }

  const existedBefore = await io.exists(path);
  const priorContent = existedBefore ? await io.readFile(path) : null;
  if (existedBefore && contentContainsLaw(priorContent, lawId)) {
    return {
      ok: false,
      errors: [`law id "${lawId}" already exists in ${path}; use foundry_config_edit_law to update it`],
    };
  }
  return { ok: true, path, lawId, existedBefore, priorContent };
}

async function commitAddLaw(opts) {
  const { execFile, args, path, existedBefore, priorContent, io, worktree } = opts;
  try {
    const sha = commitWithPolicy({
      message: `config: add law ${args.name}\n\nvia foundry_config_add_law`,
      allowedPatterns: ['foundry/**'],
      execFile,
    });
    return { ok: true, path, sha };
  } catch (commitErr) {
    if (existedBefore) {
      await io.writeFile(path, priorContent);
    } else {
      try { await unlink(join(worktree, path)); } catch {}
    }
    throw commitErr;
  }
}

async function doAddLaw(io, args, context) {
  const prereq = await validateAddLawPrerequisites(io, args);
  if (prereq.error) {
    return { error: true, result: { ok: false, errors: [prereq.error] } };
  }
  if (!prereq.ok) {
    return { error: true, result: prereq };
  }

  const { path, existedBefore, priorContent } = prereq;
  const nextContent = existedBefore
    ? priorContent.trimEnd() + '\n\n' + args.body.trimStart()
    : args.body;

  await io.mkdirp(dirname(path));
  await io.writeFile(path, nextContent);
  const result = await commitAddLaw({
    execFile: makeExecFile(context.worktree), args, path,
    existedBefore, priorContent, io, worktree: context.worktree,
  });
  return { error: false, result };
}

async function executeAddLaw(args, context) {
  try {
    const io = makeAsyncIO(context.worktree);
    const { error, result } = await doAddLaw(io, args, context);
    return JSON.stringify(error ? result : result);
  } catch (err) {
    return err instanceof UnexpectedFilesError
      ? JSON.stringify({ error: err.message, affected_files: err.files })
      : errorJson(err);
  }
}

// --- helper for preserving sibling laws -------------------------------------------------------

// Replace a law in file content while preserving other laws
function replaceLawInContent(content, lawId, newLawMarkdown) {
  const lines = content.split('\n');
  const startIdx = findLawStart(lines, lawId);
  if (startIdx < 0) return content.trimEnd() + '\n\n' + newLawMarkdown;
  
  const endIdx = findLawEnd(lines, startIdx);
  const before = lines.slice(0, startIdx);
  const after = lines.slice(endIdx);
  
  // Trim trailing empty lines from before
  const beforeEnd = before.findLastIndex(l => l !== '') + 1;
  before.length = beforeEnd;
  
  // Trim leading empty lines from after  
  const afterStart = after.findIndex(l => l !== '');
  if (afterStart > 0) after.splice(0, afterStart);
  
  // newLawMarkdown includes trailing newline; split and rejoin without final empty string
  const newLines = newLawMarkdown.trimEnd().split('\n');
  return before.concat(newLines, after).join('\n') + '\n';
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

    const fileContent = replaceLawInContent(result.fullMarkdown, args.id, args.body);
    await io.writeFile(result.path, fileContent);
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
