// Tools for writing config support files under foundry/.
//
// Registers:
//   foundry_config_write_validator — .mjs validator script under artefact type dir
//   foundry_config_write_test       — .test.js companion test under artefact type dir
//   foundry_config_write_fixture    — .md fixture under artefact type/test/fixtures/
//
// All three require a config/* branch, validate the artefact type exists, commit
// through the config commit policy, and roll back on commit-policy rejection.

import path from 'path';
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync, realpathSync, statSync } from 'fs';
import { execFileSync } from 'child_process';
import { guarded } from '../../scripts/lib/guards.js';
import { commitWithPolicy, UnexpectedFilesError } from '../../scripts/lib/git-bridge.js';
import { branchIoFactory, asyncIoFactory } from './helpers.js';
import { resolveGit } from '../../scripts/lib/tool-paths.js';
import { ulid } from '../../scripts/lib/ulid.js';
import { gitRepoGuard, foundryRootGuard, configBranchGuard, configGateNotFailed } from './guard-helpers.js';

const CORE_GUARDS = [gitRepoGuard, foundryRootGuard, configGateNotFailed];

// -- path helpers ------------------------------------------------------------

function resolveInWorktree(worktree, filePath) {
  return path.isAbsolute(filePath) ? path.resolve(filePath) : path.resolve(worktree, filePath);
}

function pathUnderFoundry(worktree, filePath) {
  const resolved = resolveInWorktree(worktree, filePath);
  const foundryDir = path.resolve(worktree, 'foundry');
  let real;
  try {
    real = realpathSync.native(resolved);
  } catch {
    real = resolved;
  }
  if (!real.startsWith(foundryDir + path.sep)) return false;
  try {
    const stat = statSync(real);
    if (stat.isDirectory()) return false;
  } catch {
    // Path does not exist — valid as a new file path
  }
  return true;
}

// -- rollback helpers --------------------------------------------------------

function snapshotFile(worktree, filePath) {
  const resolved = resolveInWorktree(worktree, filePath);
  return {
    exists: existsSync(resolved),
    content: existsSync(resolved) ? readFileSync(resolved, 'utf8') : null,
    resolved,
  };
}

function rollbackSnapshot(snapshot) {
  if (snapshot.exists) {
    writeFileSync(snapshot.resolved, snapshot.content, 'utf8');
  } else if (existsSync(snapshot.resolved)) {
    unlinkSync(snapshot.resolved);
  }
}

// -- artefact type validation -------------------------------------------------

function artefactDefinitionPath(worktree, typeId) {
  return path.join(worktree, 'foundry', 'artefacts', typeId, 'definition.md');
}

function isValidTypeId(typeId) {
  return !typeId.includes('/') && !typeId.includes('..');
}

function validateArtefactType(worktree, typeId) {
  if (!typeId || typeId.trim() === '') return 'typeId is required';
  if (!isValidTypeId(typeId)) return 'invalid typeId';
  if (!existsSync(artefactDefinitionPath(worktree, typeId))) {
    return `artefact type not found: ${typeId}`;
  }
  return null;
}

// -- audit log ---------------------------------------------------------------

function writeFileAuditLog(worktree, logData) {
  const logDir = '.foundry/config-command-logs';
  mkdirSync(path.resolve(worktree, logDir), { recursive: true });
  const id = ulid();
  const logPath = path.join(logDir, `${id}.json`);
  const fullLog = { ...logData, id };
  writeFileSync(path.resolve(worktree, logPath), JSON.stringify(fullLog, null, 2), 'utf8');
  return logPath;
}

// -- git exec helper ---------------------------------------------------------

function makeGitExecFile(worktree) {
  const gitPath = resolveGit();
  return (argv) => execFileSync(gitPath, argv, {
    cwd: worktree, encoding: 'utf8', stdio: 'pipe',
  });
}

// -- write-and-commit with rollback ------------------------------------------

function writeFileWithRollback(worktree, snapshot, content, commitMessage) {
  const execFile = makeGitExecFile(worktree);
  mkdirSync(path.dirname(snapshot.resolved), { recursive: true });
  writeFileSync(snapshot.resolved, content, 'utf8');

  try {
    const sha = commitWithPolicy({
      message: commitMessage,
      allowedPatterns: ['foundry/**'],
      execFile,
    });

    if (sha === null) {
      rollbackSnapshot(snapshot);
      return { ok: false, error: 'no changes to commit after file write' };
    }

    return { ok: true, sha };
  } catch (err) {
    rollbackSnapshot(snapshot);
    if (err instanceof UnexpectedFilesError) {
      return {
        ok: false,
        error: `unexpected files in worktree: ${err.files.join(', ')}`,
        affected_files: err.files,
      };
    }
    return { ok: false, error: err.message ?? String(err) };
  }
}

// -- commit message helpers ---------------------------------------------------

function buildCommitDetails(args) {
  if (args.message) {
    const msg = args.message.trim();
    return { commitMessage: msg, auditReason: msg };
  }
  return {
    commitMessage: `config: ${args.reason.trim()}`,
    auditReason: args.reason.trim(),
  };
}

function isEmpty(val) {
  return !val || val.trim() === '';
}

function validateCommonArgs(args) {
  if (isEmpty(args.content)) return 'content is required';
  if (isEmpty(args.reason) && isEmpty(args.message)) return 'reason or message is required';
  return null;
}

// -- branch guard (internal, for ok: false error shape) ----------------------

function rejectIfNotConfigBranch(context) {
  const guard = configBranchGuard(null, context);
  if (!guard.ok) {
    return `foundry_config_write_file: ${guard.error}`;
  }
  return null;
}

// -- shared handler ----------------------------------------------------------

function handleConfigFileWrite(toolName, filePath, args, context) {
  const worktree = context.worktree;

  const branchErr = rejectIfNotConfigBranch(context);
  if (branchErr) return JSON.stringify({ ok: false, error: branchErr });

  const validationErr = validateCommonArgs(args);
  if (validationErr) return JSON.stringify({ ok: false, error: validationErr });

  if (!pathUnderFoundry(worktree, filePath)) {
    return JSON.stringify({ ok: false, error: `path must be under foundry/: ${filePath}` });
  }

  const { commitMessage, auditReason } = buildCommitDetails(args);

  const snapshot = snapshotFile(worktree, filePath);
  const t0 = Date.now();

  const result = writeFileWithRollback(worktree, snapshot, args.content, commitMessage);
  if (!result.ok) return JSON.stringify(result);

  writeFileAuditLog(worktree, {
    reason: auditReason,
    command: toolName,
    argv: args,
    cwd: worktree,
    path: filePath,
    startedAt: new Date(t0).toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - t0,
    exitCode: null,
    signal: null,
    timedOut: false,
    stdout: null,
    stderr: null,
    stdoutTruncated: false,
    stderrTruncated: false,
    dirtyBefore: null,
    dirtyAfter: null,
    sha: result.sha,
    changedFiles: [filePath],
  });

  return JSON.stringify({ ok: true, path: filePath, sha: result.sha });
}

// -- tool-specific handlers --------------------------------------------------

function handleWriteValidator(args, context) {
  const typeErr = validateArtefactType(context.worktree, args.typeId);
  if (typeErr) return JSON.stringify({ ok: false, error: typeErr });

  if (isEmpty(args.name)) return JSON.stringify({ ok: false, error: 'name is required' });
  if (args.name.includes('/') || args.name.includes('..')) {
    return JSON.stringify({ ok: false, error: 'invalid name' });
  }

  const filePath = `foundry/artefacts/${args.typeId}/${args.name}.mjs`;
  return handleConfigFileWrite('foundry_config_write_validator', filePath, args, context);
}

function handleWriteTest(args, context) {
  const typeErr = validateArtefactType(context.worktree, args.typeId);
  if (typeErr) return JSON.stringify({ ok: false, error: typeErr });

  if (isEmpty(args.name)) return JSON.stringify({ ok: false, error: 'name is required' });
  if (args.name.includes('/') || args.name.includes('..')) {
    return JSON.stringify({ ok: false, error: 'invalid name' });
  }

  const filePath = `foundry/artefacts/${args.typeId}/${args.name}.test.js`;
  return handleConfigFileWrite('foundry_config_write_test', filePath, args, context);
}

function handleWriteFixture(args, context) {
  const typeErr = validateArtefactType(context.worktree, args.typeId);
  if (typeErr) return JSON.stringify({ ok: false, error: typeErr });

  if (isEmpty(args.name)) return JSON.stringify({ ok: false, error: 'name is required' });
  if (args.name.includes('/') || args.name.includes('..')) {
    return JSON.stringify({ ok: false, error: 'invalid name' });
  }

  const filePath = `foundry/artefacts/${args.typeId}/test/fixtures/${args.name}.md`;
  return handleConfigFileWrite('foundry_config_write_fixture', filePath, args, context);
}

// -- tool factories ----------------------------------------------------------

function makeWriteValidatorTool(tool) {
  return tool({
    description:
      'Write a validator script (.mjs) under foundry/artefacts/<typeId>/ and ' +
      'commit it through the config commit policy. Requires a config/* branch ' +
      'and the artefact type must already exist.',
    args: {
      typeId: tool.schema.string()
        .describe('Artefact type ID (e.g. "haiku") — must already exist'),
      name: tool.schema.string()
        .describe('Script name without extension (e.g. "validate-syllables")'),
      content: tool.schema.string()
        .describe('File content (non-empty)'),
      reason: tool.schema.string()
        .describe('Structured reason for the commit message and audit log'),
      message: tool.schema.string()
        .describe('Full commit message (alternative to reason)'),
    },
    execute: guarded(
      'foundry_config_write_validator',
      CORE_GUARDS,
      handleWriteValidator,
      { branchIo: branchIoFactory, io: asyncIoFactory },
    ),
  });
}

function makeWriteTestTool(tool) {
  return tool({
    description:
      'Write a companion test file (.test.js) under foundry/artefacts/<typeId>/ ' +
      'and commit it through the config commit policy. Requires a config/* branch ' +
      'and the artefact type must already exist.',
    args: {
      typeId: tool.schema.string()
        .describe('Artefact type ID (e.g. "haiku") — must already exist'),
      name: tool.schema.string()
        .describe('Script name without extension (e.g. "validate-syllables")'),
      content: tool.schema.string()
        .describe('File content (non-empty)'),
      reason: tool.schema.string()
        .describe('Structured reason for the commit message and audit log'),
      message: tool.schema.string()
        .describe('Full commit message (alternative to reason)'),
    },
    execute: guarded(
      'foundry_config_write_test',
      CORE_GUARDS,
      handleWriteTest,
      { branchIo: branchIoFactory, io: asyncIoFactory },
    ),
  });
}

function makeWriteFixtureTool(tool) {
  return tool({
    description:
      'Write a test fixture file (.md) under foundry/artefacts/<typeId>/test/fixtures/ ' +
      'and commit it through the config commit policy. Requires a config/* branch ' +
      'and the artefact type must already exist.',
    args: {
      typeId: tool.schema.string()
        .describe('Artefact type ID (e.g. "haiku") — must already exist'),
      name: tool.schema.string()
        .describe('Fixture name without extension (e.g. "valid-haiku")'),
      content: tool.schema.string()
        .describe('File content (non-empty)'),
      reason: tool.schema.string()
        .describe('Structured reason for the commit message and audit log'),
      message: tool.schema.string()
        .describe('Full commit message (alternative to reason)'),
    },
    execute: guarded(
      'foundry_config_write_fixture',
      CORE_GUARDS,
      handleWriteFixture,
      { branchIo: branchIoFactory, io: asyncIoFactory },
    ),
  });
}

export function createConfigFileTools({ tool }) {
  return {
    foundry_config_write_validator: makeWriteValidatorTool(tool),
    foundry_config_write_test: makeWriteTestTool(tool),
    foundry_config_write_fixture: makeWriteFixtureTool(tool),
  };
}
