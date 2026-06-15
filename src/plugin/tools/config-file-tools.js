// Tools for writing config files under foundry/.
//
// Registers foundry_config_write_file — a safe, auditable path for writing
// validator scripts, tests, fixtures, and support files under foundry/**.
// Writes the file, commits it through the config commit policy, and rolls
// back on commit-policy rejection.

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
  // Must be strictly under foundry/ (not equal to foundry/ itself)
  if (!real.startsWith(foundryDir + path.sep)) return false;
  // If the path exists on disk it must be a normal file, not a directory
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

// -- overlap detection -------------------------------------------------------

const CONFIG_TOOL_DIR_PREFIXES = [
  'foundry/artefacts/',
  'foundry/flows/',
  'foundry/cycles/',
  'foundry/appraisers/',
  'foundry/laws/',
];

function isConfigOverlap(filePath) {
  const normalised = filePath.split(path.sep).join('/');
  for (const prefix of CONFIG_TOOL_DIR_PREFIXES) {
    if (normalised.startsWith(prefix) && (normalised.endsWith('.json') || normalised.endsWith('.md'))) {
      return true;
    }
  }
  return false;
}

function checkOverlapError(args, filePath) {
  if (args.update) return null;
  if (!isConfigOverlap(filePath)) return null;
  return `path overlaps with specialised config tool: ${filePath}`;
}

// -- validation --------------------------------------------------------------

function isEmpty(val) {
  return !val || val.trim() === '';
}

function validateWriteFileArgs(args) {
  if (isEmpty(args.path)) return 'path is required';
  if (isEmpty(args.content)) return 'content is required';
  if (isEmpty(args.reason) && isEmpty(args.message)) return 'reason or message is required';
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

// -- core handler ------------------------------------------------------------

function rejectIfNotConfigBranch(context) {
  const guard = configBranchGuard(null, context);
  if (!guard.ok) {
    return `foundry_config_write_file: ${guard.error}`;
  }
  return null;
}

function validateFilePreconditions(worktree, args) {
  const filePath = args.path.trim();
  if (!pathUnderFoundry(worktree, filePath)) {
    return `path must be under foundry/: ${filePath}`;
  }
  const overlapErr = checkOverlapError(args, filePath);
  if (overlapErr) return overlapErr;
  return null;
}

function handleWriteFile(args, context) {
  const worktree = context.worktree;

  const branchErr = rejectIfNotConfigBranch(context);
  if (branchErr) return JSON.stringify({ ok: false, error: branchErr });

  const validationErr = validateWriteFileArgs(args);
  if (validationErr) return JSON.stringify({ ok: false, error: validationErr });

  const filePath = args.path.trim();
  const preErr = validateFilePreconditions(worktree, args);
  if (preErr) return JSON.stringify({ ok: false, error: preErr });

  const { commitMessage, auditReason } = buildCommitDetails(args);

  const snapshot = snapshotFile(worktree, filePath);
  const t0 = Date.now();

  const result = writeFileWithRollback(worktree, snapshot, args.content, commitMessage);
  if (!result.ok) return JSON.stringify(result);

  writeFileAuditLog(worktree, {
    reason: auditReason,
    command: 'foundry_config_write_file',
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

// -- tool factory ------------------------------------------------------------

export function createConfigFileTools({ tool }) {
  return {
    foundry_config_write_file: tool({
      description:
        'Write a support file under foundry/** and commit it through the ' +
        'config commit policy. Requires a config/* branch. The file path ' +
        'must resolve to a normal file under foundry/. Rolls back on ' +
        'commit-policy rejection.',
      args: {
        path: tool.schema.string()
          .describe('Relative file path under foundry/'),
        content: tool.schema.string()
          .describe('File content (non-empty)'),
        reason: tool.schema.string()
          .describe('Structured reason for the commit message and audit log'),
        message: tool.schema.string()
          .describe('Full commit message (alternative to reason)'),
        update: tool.schema.boolean().optional()
          .describe('Bypass overlap rejection for files owned by specialised config create tools'),
      },
      execute: guarded(
        'foundry_config_write_file',
        CORE_GUARDS,
        handleWriteFile,
        { branchIo: branchIoFactory, io: asyncIoFactory },
      ),
    }),
  };
}
