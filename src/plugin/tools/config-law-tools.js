// Tools for reading, adding, and editing laws
// foundry_config_read_law: read-only, returns full markdown (no branch guard)
// foundry_config_add_law: write + commit on config/* branch
// foundry_config_edit_law: update body and commit on config/* branch

import { join, dirname } from 'path';
import { validate as validateLaw } from '../../scripts/lib/config-validators/law.js';
import { requireGitRepo, requireFoundryRoot } from '../../scripts/lib/foundational-guards.js';
import { requireOnConfigBranch } from '../../scripts/lib/branch-guard.js';
import { guarded, notFailedGuard } from '../../scripts/lib/guards.js';
import { UnexpectedFilesError, commitWithPolicy } from '../../scripts/lib/git-bridge.js';
import { makeIO, makeExec, makeAsyncIO, errorJson, branchIoFactory, asyncIoFactory } from './helpers.js';
import { execFileSync } from 'child_process';
import { assembleLawMarkdown, assembleEditLawMarkdown } from '../../scripts/lib/config-creators/law.js';

// --- utility functions -------------------------------------------------------

function contentContainsLaw(content, lawId) {
  const pattern = new RegExp(`^## ${lawId}(?:\\s|$)`, 'm');
  return pattern.test(content);
}

function findLawStart(lines, lawId) {
  for (let i = 0; i < lines.length; i++) {
    const heading = lines[i].match(/^## (.+)/);
    if (heading && heading[1].trim() === lawId) return i;
  }
  return -1;
}

function findLawEnd(lines, startIdx) {
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (lines[i].match(/^## (.+)/)) return i;
  }
  return lines.length;
}

function extractLawMarkdown(content, lawId) {
  const lines = content.split('\n');
  const startIdx = findLawStart(lines, lawId);
  if (startIdx < 0) return null;
  const endIdx = findLawEnd(lines, startIdx);
  const lawLines = lines.slice(startIdx, endIdx);
  while (lawLines.length > 0 && lawLines[lawLines.length - 1] === '') lawLines.pop();
  return lawLines.join('\n');
}

async function searchGlobalLaws(io, foundryDir, lawId) {
  const globalLawsDir = join(foundryDir, 'laws');
  if (!(await io.exists(globalLawsDir))) return null;
  const files = await io.readDir(globalLawsDir);
  for (const file of files) {
    if (!file.endsWith('.md')) continue;
    const path = join(globalLawsDir, file);
    const content = await io.readFile(path);
    if (contentContainsLaw(content, lawId)) return { path, fullMarkdown: content, source: 'global' };
  }
  return null;
}

async function searchTypeSpecificLaws(io, foundryDir, lawId) {
  const artefactsDir = join(foundryDir, 'artefacts');
  if (!(await io.exists(artefactsDir))) return null;
  const types = await io.readDir(artefactsDir);
  for (const typeId of types) {
    const typeLawsPath = join(artefactsDir, typeId, 'laws.md');
    if (!(await io.exists(typeLawsPath))) continue;
    const content = await io.readFile(typeLawsPath);
    if (contentContainsLaw(content, lawId)) return { path: typeLawsPath, fullMarkdown: content, source: `type:${typeId}` };
  }
  return null;
}

async function findLawByID(io, foundryDir, lawId) {
  const global = await searchGlobalLaws(io, foundryDir, lawId);
  if (global) return { found: true, ...global };
  const typeSpec = await searchTypeSpecificLaws(io, foundryDir, lawId);
  if (typeSpec) return { found: true, ...typeSpec };
  return { found: false };
}

// --- guard helpers ---------------------------------------------------------

function gitRepoGuard(_a, c) { return requireGitRepo(makeIO(c.worktree)); }
function foundryRootGuard(_a, c) { return requireFoundryRoot(makeIO(c.worktree)); }
function configBranchGuard(_a, c) { return requireOnConfigBranch({ exec: makeExec(c.worktree) }); }
const gateNotFailed = notFailedGuard(makeIO);

function makeExecFile(cwd) {
  return (argv) => execFileSync('git', argv, { cwd, encoding: 'utf8', stdio: 'pipe' });
}

const READ_GUARDS = [gitRepoGuard, foundryRootGuard];
const CREATE_GUARDS = [...READ_GUARDS, configBranchGuard, gateNotFailed];
const EDIT_GUARDS = [...READ_GUARDS, configBranchGuard, gateNotFailed];

// --- read law executor -------------------------------------------------------

async function executeReadLaw(args, context) {
  try {
    const io = makeAsyncIO(context.worktree);
    const result = await findLawByID(io, 'foundry', args.id);
    if (!result.found) return JSON.stringify({ ok: false, errors: [`Law "${args.id}" not found`] });
    const markdown = extractLawMarkdown(result.fullMarkdown, args.id);
    if (!markdown) return JSON.stringify({ ok: false, errors: [`Could not extract law "${args.id}" from file`] });
    return JSON.stringify({ ok: true, id: args.id, markdown, source: result.source });
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
  if (!target || typeof target !== 'object') return 'target argument is required (object with kind + locator)';
  const kinds = ['global', 'type-specific'];
  if (!kinds.includes(target.kind)) return `unknown target.kind: ${target.kind}`;
  return null;
}

function validateGlobalLawTarget(target) {
  if (typeof target.file !== 'string' || !target.file.trim()) return 'target.file is required for kind: "global"';
  return null;
}

function validateTypeSpecLawTarget(target) {
  if (typeof target.typeId !== 'string' || !target.typeId.trim()) return 'target.typeId is required for kind: "type-specific"';
  return null;
}

function computeTargetPath(target) {
  if (target?.kind === 'global') return join('foundry', 'laws', target.file);
  return join('foundry', 'artefacts', target.typeId, 'laws.md');
}

// --- add law executor --------------------------------------------------------

function extractLawId(body) {
  const match = body.match(/^## ([^\s]+)/m);
  return match ? match[1] : null;
}

async function checkExistingLaw(io, path, lawId) {
  if (!(await io.exists(path))) return { existedBefore: false, priorContent: null };
  const priorContent = await io.readFile(path);
  if (contentContainsLaw(priorContent, lawId)) {
    return { error: `law id "${lawId}" already exists in ${path}; use foundry_config_edit_law to update it` };
  }
  return { existedBefore: true, priorContent };
}

async function validateAddLawPrerequisites(io, args) {
  const targetError = validateAddLawTarget(args.target);
  if (targetError) return { error: targetError };
  const path = computeTargetPath(args.target);
  const validation = await validateLaw({ body: args.body, io });
  if (!validation.ok) return validation;
  const lawId = extractLawId(args.body);
  if (!lawId) return { error: 'could not determine law id from body (expected "## <law-id>" heading)' };
  const existing = await checkExistingLaw(io, path, lawId);
  if (existing.error) return { error: existing.error };
  return { ok: true, path, lawId, ...existing };
}

function formatAddLawError(err) {
  return err instanceof UnexpectedFilesError
    ? JSON.stringify({ error: err.message, affected_files: err.files })
    : errorJson(err);
}

function buildNextContent(existedBefore, priorContent, body) {
  return existedBefore ? priorContent.trimEnd() + '\n\n' + body.trimStart() : body;
}

async function rollbackAddLaw(io, path, existedBefore, priorContent) {
  if (!path) return;
  if (existedBefore) await io.writeFile(path, priorContent);
  else await io.rm(path);
}

async function executeAddLaw(args, context) {
  if (!args.id) return JSON.stringify({ ok: false, errors: ['id is required'] });

  const io = makeAsyncIO(context.worktree);
  const execFile = makeExecFile(context.worktree);

  const body = assembleLawMarkdown({
    id: args.id, name: args.name, description: args.description,
    passing: args.passing, failing: args.failing, validators: args.validators,
  });

  const addArgs = { name: args.id, body, target: args.target };
  let path, existedBefore, priorContent;

  try {
    const prereq = await validateAddLawPrerequisites(io, addArgs);
    if (prereq.error) return JSON.stringify({ ok: false, errors: [prereq.error] });
    if (!prereq.ok) return JSON.stringify(prereq);

    ({ path, existedBefore, priorContent } = prereq);
    const nextContent = buildNextContent(existedBefore, priorContent, addArgs.body);

    await io.mkdirp(dirname(path));
    await io.writeFile(path, nextContent);

    const sha = commitWithPolicy({
      message: `config: add law ${args.name}\n\nvia foundry_config_add_law`,
      allowedPatterns: ['foundry/**'], execFile,
    });
    return JSON.stringify({ ok: true, path, sha });
  } catch (err) {
    await rollbackAddLaw(io, path, existedBefore, priorContent);
    return formatAddLawError(err);
  }
}

// --- helper for preserving sibling laws -------------------------------------------------------

function replaceLawInContent(content, lawId, newLawMarkdown) {
  const lines = content.split('\n');
  const startIdx = findLawStart(lines, lawId);
  if (startIdx < 0) return content.trimEnd() + '\n\n' + newLawMarkdown;
  const endIdx = findLawEnd(lines, startIdx);
  const before = lines.slice(0, startIdx);
  const after = lines.slice(endIdx);
  const beforeEnd = before.findLastIndex(l => l !== '') + 1;
  before.length = beforeEnd;
  const afterStart = after.findIndex(l => l !== '');
  if (afterStart > 0) after.splice(0, afterStart);
  const newLines = newLawMarkdown.trimEnd().split('\n');
  return before.concat(newLines, after).join('\n') + '\n';
}

// --- edit law helpers -------------------------------------------------------

class EditLawResponse extends Error {
  constructor(response) {
    super();
    this.response = response;
    this.isEditLawResponse = true;
  }
}

function hasEditLawFields(args) {
  return args.name !== undefined || args.description !== undefined ||
    args.passing !== undefined || args.failing !== undefined || args.validators !== undefined;
}

async function findAndExtractEditLaw(io, lawId) {
  const result = await findLawByID(io, 'foundry', lawId);
  if (!result.found) throw new EditLawResponse({ ok: false, errors: [`Law "${lawId}" not found`] });
  const existingBody = extractLawMarkdown(result.fullMarkdown, lawId);
  if (!existingBody) throw new EditLawResponse({ ok: false, errors: [`Could not extract law "${lawId}" from file`] });
  return { result, existingBody };
}

async function assembleEditLawBody(existingBody, args, io) {
  const newBody = assembleEditLawMarkdown(existingBody, {
    name: args.name, description: args.description,
    passing: args.passing, failing: args.failing, validators: args.validators,
  });
  const validation = await validateLaw({ body: newBody, io });
  if (!validation.ok) throw new EditLawResponse(validation);
  return newBody;
}

async function commitEditLawChange(result, newBody, lawId, execFile, io) {
  const fileContent = replaceLawInContent(result.fullMarkdown, lawId, newBody);
  await io.writeFile(result.path, fileContent);
  execFile(['add', result.path]);
  execFile(['commit', '-m', `config: edit law ${lawId}\n\nvia foundry_config_edit_law`]);
}

// --- edit law executor -------------------------------------------------------

async function executeEditLaw(args, context) {
  const io = makeAsyncIO(context.worktree);
  const execFile = makeExecFile(context.worktree);

  try {
    if (!hasEditLawFields(args)) throw new EditLawResponse({
      ok: false,
      errors: ['at least one field to update must be provided (name, description, passing, failing, validators)'],
    });

    const { result, existingBody } = await findAndExtractEditLaw(io, args.id);
    const newBody = await assembleEditLawBody(existingBody, args, io);
    await commitEditLawChange(result, newBody, args.id, execFile, io);

    return JSON.stringify({
      ok: true, id: args.id,
      path: result.path.replace(/^foundry\//, 'foundry/'),
      source: result.source,
    });
  } catch (err) {
    if (err.isEditLawResponse) return JSON.stringify(err.response);
    if (err instanceof UnexpectedFilesError) return JSON.stringify({ error: err.message, affected_files: err.files });
    return errorJson(err);
  }
}

// --- tool factories -------------------------------------------------------

function makeReadLawTool(tool) {
  return tool({
    description: 'Read a law by ID, returning the full markdown including validators block.',
    args: { id: tool.schema.string().describe('Law ID to read') },
    execute: guarded('foundry_config_read_law', READ_GUARDS, executeReadLaw, { branchIo: branchIoFactory, io: asyncIoFactory }),
  });
}

function makeAddLawTool(tool) {
  return tool({
    description: 'Add a new law (config-tier; requires a config/* branch). ' +
      'Fields: id, name, description, passing, failing, target ({kind, file|typeId}), validators ([{id, command, failureMeans?}]).',
    args: {
      id: tool.schema.string().describe('Law identifier. Becomes the ## <id> heading.'),
      name: tool.schema.string().describe('Human-readable name stored as prose after heading.'),
      description: tool.schema.string().describe('Prose describing what the law covers.'),
      passing: tool.schema.string().describe('Criteria that define a passing artefact.'),
      failing: tool.schema.string().describe('Criteria that define a failing artefact.'),
      target: tool.schema.object({
        kind: tool.schema.enum(['global', 'type-specific']).describe('Target kind: global or type-specific'),
        file: tool.schema.string().optional().describe('Filename for global laws (e.g. rules.md)'),
        typeId: tool.schema.string().optional().describe('Artefact type ID for type-specific laws'),
      }).describe('Where to write the law'),
      validators: tool.schema.array(tool.schema.object({
        id: tool.schema.string().describe('Validator identifier'),
        command: tool.schema.string().describe('CLI command with optional {pattern} / {files} placeholders. Prefer JavaScript (.mjs) scripts as separate files (e.g. "node foundry/artefacts/<type>/check.mjs {files}"). Stdout must be NDJSON: one JSON object per line with required fields "file" (relative path) and "text" (message). Optional: "location" (line:col), "severity" (error|warning). Exit code is ignored.'),
        failureMeans: tool.schema.string().optional().describe('Description of what failure means'),
      })).optional().describe('Optional deterministic validators'),
    },
    execute: guarded('foundry_config_add_law', CREATE_GUARDS, executeAddLaw, { branchIo: branchIoFactory, io: asyncIoFactory }),
  });
}

function makeEditLawTool(tool) {
  return tool({
    description: 'Edit an existing law by ID (config-tier; requires a config/* branch). ' +
      'At least one optional field must be provided. Fields: id, name?, description?, passing?, failing?, validators?.',
    args: {
      id: tool.schema.string().describe('Law ID to edit'),
      name: tool.schema.string().optional().describe('Updated human-readable name'),
      description: tool.schema.string().optional().describe('Updated description'),
      passing: tool.schema.string().optional().describe('Updated passing criteria'),
      failing: tool.schema.string().optional().describe('Updated failing criteria'),
      validators: tool.schema.array(tool.schema.object({
        id: tool.schema.string(), command: tool.schema.string(), failureMeans: tool.schema.string().optional(),
      })).optional().nullable().describe('Updated validators (replaces existing; null removes validators block; omitted leaves unchanged)'),
    },
    execute: guarded('foundry_config_edit_law', EDIT_GUARDS, executeEditLaw, { branchIo: branchIoFactory, io: asyncIoFactory }),
  });
}

export function createConfigLawTools({ tool }) {
  return {
    foundry_config_read_law: makeReadLawTool(tool),
    foundry_config_add_law: makeAddLawTool(tool),
    foundry_config_edit_law: makeEditLawTool(tool),
  };
}
