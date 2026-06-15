// Tools for managing Foundry package dependencies.
//
// Registers foundry_config_add_dependency — a safe, auditable path for
// installing packages into the Foundry package boundary at foundry/.
// Runs pnpm add inside foundry/, verifies only expected files changed,
// and commits through the config commit policy with exact-file patterns.

import path from 'path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { spawnSync, execFileSync } from 'child_process';
import { requireOnConfigBranch } from '../../scripts/lib/branch-guard.js';
import { commitWithPolicy, UnexpectedFilesError } from '../../scripts/lib/git-bridge.js';
import { makeExec } from './helpers.js';
import { resolveFromPath, resolveGit } from '../../scripts/lib/tool-paths.js';
import { ulid } from '../../scripts/lib/ulid.js';
import { MAX_CAPTURE_BYTES } from '../../scripts/lib/config-command-runner.js';
import { parsePorcelainZ } from '../../scripts/lib/git-policy.js';

// -- constants ---------------------------------------------------------------

const ROOT_PACKAGE_FILES = [
  'package.json',
  'pnpm-lock.yaml',
  'package-lock.json',
  'yarn.lock',
  'bun.lock',
];

const ALLOWED_DEPENDENCY_FILES = [
  'foundry/package.json',
  'foundry/pnpm-lock.yaml',
];

const TOOL_MANAGED_FILES = [
  'WORK.md', 'WORK.history.yaml', 'WORK.feedback.yaml', '.gitignore',
];

// -- classification helpers --------------------------------------------------

function isRootPackageFile(file) {
  return ROOT_PACKAGE_FILES.includes(file);
}

function isAllowedDependencyFile(file) {
  return ALLOWED_DEPENDENCY_FILES.includes(file);
}

function isToolManagedFile(file) {
  if (TOOL_MANAGED_FILES.includes(file)) return true;
  if (file.startsWith('.foundry/')) return true;
  return false;
}

function classifyDirtyFiles(dirtyFiles) {
  const unexpected = [];
  const rootFiles = [];
  const toolManagedFiles = [];
  for (const f of dirtyFiles) {
    if (isToolManagedFile(f)) {
      toolManagedFiles.push(f);
      continue;
    }
    if (isAllowedDependencyFile(f)) continue;
    if (isRootPackageFile(f)) {
      rootFiles.push(f);
    } else {
      unexpected.push(f);
    }
  }
  return { rootFiles, unexpected, toolManagedFiles };
}

// -- git status helpers ------------------------------------------------------

function detectDirtyFiles(exec) {
  try {
    const result = exec(['git', 'status', '--porcelain=v1', '-z']);
    const out = typeof result === 'string' ? result : (result.stdout ?? '');
    return parsePorcelainZ(out);
  } catch {
    return [];
  }
}

function checkPreInstallDirty(dirtyFiles) {
  const { rootFiles, unexpected } = classifyDirtyFiles(dirtyFiles);
  if (rootFiles.length > 0) {
    return {
      ok: false,
      error:
        `root package-file isolation: root package file(s) dirty: ` +
        `${rootFiles.join(', ')}. Config dependencies must be installed in foundry/ only.`,
    };
  }
  if (unexpected.length > 0) {
    return {
      ok: false,
      error: `unexpected dirty file(s) before installation: ${unexpected.join(', ')}`,
    };
  }
  return null;
}

function checkPostInstallDirty(dirtyFiles) {
  const { rootFiles, unexpected } = classifyDirtyFiles(dirtyFiles);
  if (rootFiles.length > 0) {
    return {
      ok: false,
      error:
        `root package-file isolation: root package file(s) changed: ` +
        `${rootFiles.join(', ')}. Config dependencies must be installed in foundry/ only.`,
      unexpectedFiles: rootFiles,
    };
  }
  if (unexpected.length > 0) {
    return {
      ok: false,
      error: `unexpected changed files after installation: ${unexpected.join(', ')}`,
      unexpectedFiles: unexpected,
    };
  }
  return null;
}

// -- pnpm execution ---------------------------------------------------------

function runPnpmAdd(pnpmPath, name, dev, cwd) {
  const argv = dev ? [pnpmPath, 'add', '-D', name] : [pnpmPath, 'add', name];
  const result = spawnSync(argv[0], argv.slice(1), {
    cwd,
    encoding: 'utf8',
    stdio: 'pipe',
    shell: false,
    maxBuffer: MAX_CAPTURE_BYTES * 4,
  });
  return {
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    exitCode: result.status,
    signal: result.signal,
  };
}

// -- validation helpers ------------------------------------------------------

function validateArgs(args) {
  if (!args.name || args.name.trim() === '') {
    return { error: 'name is required' };
  }
  if (!args.reason || args.reason.trim() === '') {
    return { error: 'reason is required' };
  }
  return { name: args.name.trim(), reason: args.reason.trim(), dev: args.dev === true };
}

function checkPackagePreconditions(foundryPkgPath) {
  if (!existsSync(foundryPkgPath)) {
    return {
      ok: false,
      error:
        'foundry/package.json not found. Run bootstrap or upgrade to ' +
        'create the Foundry package boundary first.',
    };
  }

  let pkgMeta;
  try {
    pkgMeta = JSON.parse(readFileSync(foundryPkgPath, 'utf8'));
  } catch {
    return { ok: false, error: 'foundry/package.json is not valid JSON' };
  }

  const pm = pkgMeta.packageManager || '';
  if (!pm.startsWith('pnpm')) {
    return {
      ok: false,
      error:
        `unsupported package manager: '${pm}'. Only pnpm is supported for ` +
        `config dependency installation.`,
    };
  }

  const packageManager = pm.split('@')[0];

  return { ok: true, packageManager };
}

// -- install execution ------------------------------------------------------

function performInstall(worktree, name, dev, packageManager) {
  const exec = makeExec(worktree);
  const beforeDirty = detectDirtyFiles(exec);

  const preErr = checkPreInstallDirty(beforeDirty);
  if (preErr) return preErr;

  const pmPath = resolveFromPath(packageManager);
  const foundryDir = path.resolve(worktree, 'foundry');
  const pnpmResult = runPnpmAdd(pmPath, name, dev, foundryDir);

  const afterDirty = detectDirtyFiles(exec);
  const postErr = checkPostInstallDirty(afterDirty);
  if (postErr) return postErr;

  const changedFiles = [...new Set(afterDirty.filter((f) =>
    !isToolManagedFile(f) && (!beforeDirty.includes(f) || isAllowedDependencyFile(f)),
  ))];

  return { pnpmResult, changedFiles };
}

// -- commit helper -----------------------------------------------------------

function commitDependencyInstall(worktree, message) {
  const gitPath = resolveGit();
  const execFile = (argv) => execFileSync(gitPath, argv, {
    cwd: worktree, encoding: 'utf8', stdio: 'pipe',
  });

  try {
    const sha = commitWithPolicy({
      message,
      allowedPatterns: ALLOWED_DEPENDENCY_FILES,
      execFile,
    });
    if (sha === null) {
      return { ok: false, error: 'no changes to commit after dependency installation' };
    }
    return { ok: true, sha };
  } catch (err) {
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

// -- audit log helper -------------------------------------------------------

function buildAuditLog(worktree, logData) {
  const logDir = '.foundry/config-command-logs';
  const logDirAbs = path.resolve(worktree, logDir);
  if (!existsSync(logDirAbs)) {
    mkdirSync(logDirAbs, { recursive: true });
  }
  const id = ulid();
  const logPath = path.join(logDir, `${id}.json`);
  const fullLog = { ...logData, id };
  writeFileSync(path.resolve(worktree, logPath), JSON.stringify(fullLog, null, 2), 'utf8');
  return logPath;
}

// -- core handler ------------------------------------------------------------

function handleAddDependency(worktree, args) {
  const validated = validateArgs(args);
  if (validated.error) return { ok: false, error: validated.error };

  const { name, reason, dev } = validated;

  const preconditions = checkPackagePreconditions(
    path.resolve(worktree, 'foundry', 'package.json'),
  );
  if (!preconditions.ok) return preconditions;

  const t0 = Date.now();

  const installResult = performInstall(worktree, name, dev, preconditions.packageManager);
  if (!installResult.ok) return installResult;

  const commitResult = commitDependencyInstall(
    worktree,
    `config: add dependency ${name} — ${reason}`,
  );
  if (!commitResult.ok) return commitResult;

  const logPath = buildAuditLog(worktree, {
    reason,
    tool: 'foundry_config_add_dependency',
    dependency: name,
    dev,
    startedAt: new Date(t0).toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - t0,
    exitCode: installResult.pnpmResult.exitCode,
    stdout: installResult.pnpmResult.stdout,
    stderr: installResult.pnpmResult.stderr,
    changedFiles: installResult.changedFiles,
  });

  return {
    ok: true,
    sha: commitResult.sha,
    changedFiles: installResult.changedFiles,
    logPath,
  };
}

// -- tool factory ------------------------------------------------------------

export function createConfigDependencyTools({ tool }) {
  return {
    foundry_config_add_dependency: tool({
      description:
        'Install a dependency into the Foundry package boundary. ' +
        'Runs pnpm add inside foundry/, verifies only expected package ' +
        'files changed, and commits through the config commit policy. ' +
        'Requires a config/* branch and an existing foundry/package.json.',
      args: {
        name: tool.schema.string()
          .describe('Package name to install (e.g. zod)'),
        dev: tool.schema.boolean().optional()
          .describe('Install as devDependency (default false)'),
        reason: tool.schema.string()
          .describe('Non-empty reason for the audit log and commit message'),
      },
      execute(args, context) {
        const guard = requireOnConfigBranch({ exec: makeExec(context.worktree) });
        if (!guard.ok) {
          return JSON.stringify({ ok: false, error: `foundry_config_add_dependency: ${guard.error}` });
        }

        try {
          return JSON.stringify(handleAddDependency(context.worktree, args));
        } catch (err) {
          return JSON.stringify({ ok: false, error: err.message ?? String(err) });
        }
      },
    }),
  };
}
