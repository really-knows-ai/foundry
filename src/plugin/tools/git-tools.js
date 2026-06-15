import { execFileSync } from 'child_process';
import {
  validateKindArgs,
  validateStartingBranch,
  buildBranchName,
  classifyBranch,
  finishWorkBranch,
  finishConfigBranch,
  untrackedFoundryFiles,
  KIND_DRY_RUN,
  KINDS,
} from './git-helpers.js';
import { guarded } from '../../scripts/lib/guards.js';
import { makeIO, makeExec, asyncIoFactory } from './helpers.js';
import { requireNoActiveStage } from '../../scripts/lib/stage-guard.js';
import { currentBranch } from '../../scripts/lib/branch-guard.js';
import { truncateTrace } from '../../scripts/lib/tracing.js';
import { finishDryRun } from '../../scripts/lib/snapshot/finish.js';
import { gitRepoGuard } from './guard-helpers.js';

const GIT_GUARDS = [gitRepoGuard];

function refuse(error) { return JSON.stringify({ error }); }

// -- foundry_git_branch helpers --

function validateBranchCreationArgs(args) {
  if (!args.kind)
    return 'foundry_git_branch: kind is required (one of: config, work, dry-run)';
  if (!KINDS.includes(args.kind))
    return `foundry_git_branch: unknown kind "${args.kind}" ` +
           `(expected one of: ${KINDS.join(', ')})`;
  const argErr = validateKindArgs(args.kind, args);
  if (argErr) return `foundry_git_branch: ${argErr}`;
  return null;
}

function refuseBranchCreate(branchName, err) {
  if (!err) return refuse(`foundry_git_branch: failed to create branch '${branchName}'.`);
  const text = err.stderr || err.stdout;
  if (!text) return refuse(`foundry_git_branch: failed to create branch '${branchName}'.`);
  return refuse(`foundry_git_branch: failed to create branch '${branchName}'. ${String(text).trim()}`);
}

async function tryCreateBranch(name, cwd) {
  try {
    execFileSync('git', ['checkout', '-b', name],
      { cwd, encoding: 'utf8', stdio: 'pipe' });
    return null;
  } catch (err) {
    return refuseBranchCreate(name, err);
  }
}

async function tryTruncateTrace(branch, worktree) {
  try {
    await truncateTrace({
      branch,
      io: asyncIoFactory({ worktree }),
    });
  } catch { /* swallow */ }
}

async function createAndFinaliseBranch(kind, built, worktree) {
  const createErr = await tryCreateBranch(built.name, worktree);
  if (createErr) return createErr;
  if (kind === KIND_DRY_RUN)
    await tryTruncateTrace(built.name, worktree);
  return JSON.stringify({ ok: true, branch: built.name });
}

async function executeGitBranch(args, context) {
  const io = makeIO(context.worktree);
  const stageGuard = requireNoActiveStage(io);
  if (!stageGuard.ok)
    return refuse(`foundry_git_branch ${stageGuard.error}`);

  const validationErr = validateBranchCreationArgs(args);
  if (validationErr) return refuse(validationErr);

  const branch = currentBranch({ exec: makeExec(context.worktree) });
  const startErr = validateStartingBranch(args.kind, branch);
  if (startErr) return refuse(`foundry_git_branch: ${startErr}`);

  const built = buildBranchName(args.kind, args, branch);
  if (built.error) return refuse(`foundry_git_branch: ${built.error}`);

  return createAndFinaliseBranch(args.kind, built, context.worktree);
}

// -- foundry_git_finish helpers --

function refuseBaseBranchForDryRun() {
  return refuse(
    'foundry_git_finish: baseBranch is not valid for a dry-run ' +
    'finish; the parent config branch is determined by the dry-run ' +
    'branch name.');
}

function makeNoopResult(base) {
  return JSON.stringify({
    ok: true,
    noop: true,
    message: `Already on ${base} — nothing to merge`,
    branch: base,
  });
}

function refuseUnknownFinishBranch(branch) {
  return refuse(
    `foundry_git_finish: nothing to finish on '${branch || 'detached HEAD'}' ` +
    `(expected work/<x>, config/<x>, or dry-run/<x>/<y>).`);
}

async function finishDryRunBranch({ branch, args, cwd }) {
  const io = asyncIoFactory({ worktree: cwd });
  const exec = (argv) => execFileSync('git', argv,
    { cwd, encoding: 'utf8', stdio: 'pipe' });

  const untrackedRefusal = checkUntrackedFoundryFiles(cwd);
  if (untrackedRefusal) return untrackedRefusal;

  if (args.confirm !== true) {
    return JSON.stringify({
      ok: false,
      error: 'foundry_git_finish requires {confirm: true} to perform destructive operations. Re-invoke with confirm:true to apply the plan.',
      planned: {
        branch,
        action: 'snapshot + discard (dry-run finish)',
        snapshotPath: '.snapshots/<runId> (computed at apply time)',
      },
    });
  }

  try {
    const out = await finishDryRun({
      message: args.message, branch, io, execFile: exec,
    });
    return JSON.stringify(out);
  } catch (err) {
    return JSON.stringify({
      ok: false,
      error: `foundry_git_finish: dry-run finish failed: ${err.message ?? String(err)}`,
    });
  }
}

function routeDryRunFinish(branch, args, cwd) {
  if (args.baseBranch !== undefined)
    return refuseBaseBranchForDryRun();
  return finishDryRunBranch({ branch, args, cwd });
}

function checkUntrackedFoundryFiles(cwd) {
  const untracked = untrackedFoundryFiles(cwd);
  if (!untracked.length) return null;
  return JSON.stringify({
    ok: false,
    error: 'foundry_git_finish refuses: untracked foundry/** files exist: ' +
      untracked.join(', ') + '. Commit or stash them first.',
    untrackedFoundry: untracked,
  });
}

function routeBranchFinish(kind, branch, base, cwd, args) {
  const untrackedRefusal = checkUntrackedFoundryFiles(cwd);
  if (untrackedRefusal) return untrackedRefusal;
  if (kind === 'work')
    return finishWorkBranch({ workBranch: branch, base, cwd, args });
  if (kind === 'config')
    return finishConfigBranch({ configBranch: branch, base, cwd, args });
  return refuseUnknownFinishBranch(branch);
}

function finishNonDryRunBranch(branch, kind, base, args, cwd) {
  const untrackedRefusal = checkUntrackedFoundryFiles(cwd);
  if (untrackedRefusal) return untrackedRefusal;
  if (branch === base) return makeNoopResult(base);
  return routeBranchFinish(kind, branch, base, cwd, args);
}

async function executeGitFinish(args, context) {
  const io = makeIO(context.worktree);
  const stageGuard = requireNoActiveStage(io);
  if (!stageGuard.ok)
    return refuse(`foundry_git_finish ${stageGuard.error}`);

  const cwd = context.worktree;
  const branch = currentBranch({ exec: makeExec(cwd) });
  const kind = classifyBranch(branch);

  if (kind === 'dry-run')
    return routeDryRunFinish(branch, args, cwd);

  const base = args.baseBranch || 'main';
  return finishNonDryRunBranch(branch, kind, base, args, cwd);
}

// -- Tool definitions --

export function createGitTools({ tool }) {
  return {
    foundry_git_branch: tool({
      description:
        'Create and checkout a foundry branch. Requires `kind`: ' +
        '"config" (schema work, off main), "work" (flow run, off main), ' +
        'or "dry-run" (flow run off a config/* branch).',
      args: {
        kind: tool.schema.string().describe('config | work | dry-run'),
        flowId: tool.schema.string().optional()
          .describe('Flow ID. Required for kind="work" and "dry-run"; not valid for kind="config".'),
        description: tool.schema.string()
          .describe('Slugified description suffix.'),
      },
      execute: guarded('foundry_git_branch', GIT_GUARDS, executeGitBranch),
    }),

    foundry_git_finish: tool({
      description:
        'Finish the current foundry branch. ' +
        'work/<x>: squash-merge + WORK cleanup. ' +
        'config/<x>: squash-merge. ' +
        'dry-run/<x>/<y>: snapshot + discard.',
      args: {
        message: tool.schema.string().describe('Squash merge / snapshot message'),
        baseBranch: tool.schema.string().optional()
          .describe('Target branch (default: main). Not valid for dry-run finish.'),
        confirm: tool.schema.boolean().optional()
          .describe('Must be true to perform destructive operations; otherwise returns a plan'),
      },
      execute: guarded('foundry_git_finish', GIT_GUARDS, executeGitFinish),
    }),
  };
}
