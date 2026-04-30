import path from 'path';
import { execFileSync } from 'child_process';
import { existsSync, unlinkSync } from 'fs';
import { slugify } from '../../../scripts/lib/slug.js';
import { requireNoActiveStage } from '../../../scripts/lib/stage-guard.js';
import { currentBranch } from '../../../scripts/lib/branch-guard.js';
import { finishDryRun } from '../../../scripts/lib/snapshot/finish.js';
import { truncateTrace } from '../../../scripts/lib/tracing.js';
import { makeIO, asyncIoFactory } from './helpers.js';

const WORK_FILES = ['WORK.md', 'WORK.history.yaml', 'WORK.feedback.yaml'];

const KIND_CONFIG  = 'config';
const KIND_WORK    = 'work';
const KIND_DRY_RUN = 'dry-run';
const KINDS = [KIND_CONFIG, KIND_WORK, KIND_DRY_RUN];

const CONFIG_RE         = /^config\/[^/]+$/;
const WORK_RE           = /^work\/.+$/;
const DRY_RUN_RE        = /^dry-run\/[^/]+\/[^/]+$/;
const DRY_RUN_DEEPER_RE = /^dry-run\/[^/]+\/[^/]+\/.+$/;

function refuse(error) { return JSON.stringify({ error }); }

function makeExec(cwd) {
  return (argv) => execFileSync(argv[0], argv.slice(1),
    { cwd, encoding: 'utf8', stdio: 'pipe' });
}

function validateKindArgs(kind, args) {
  if (kind === KIND_CONFIG) {
    if (args.flowId !== undefined && args.flowId !== null && args.flowId !== '')
      return `flowId is not valid for kind="config"; supply only { kind, description }.`;
    if (!args.description)
      return `description is required for kind="config".`;
    return null;
  }
  if (kind === KIND_WORK || kind === KIND_DRY_RUN) {
    if (!args.flowId)
      return `flowId is required for kind="${kind}".`;
    if (!args.description)
      return `description is required for kind="${kind}".`;
    return null;
  }
  return `unknown kind "${kind}"; expected one of: ${KINDS.join(', ')}.`;
}

function validateStartingBranch(kind, branch) {
  // Already on a dry-run branch — never permit a new branch of any kind.
  if (branch && (DRY_RUN_RE.test(branch) || DRY_RUN_DEEPER_RE.test(branch))) {
    return `cannot nest deeper than one dry-run level; you are on '${branch}'.`;
  }
  if (kind === KIND_CONFIG) {
    if (branch && CONFIG_RE.test(branch))
      return `already on a config/* branch ('${branch}'); edit here directly or finish first.`;
    if (branch && WORK_RE.test(branch))
      return `cannot start a config branch from a work branch ('${branch}'); finish or abandon it first.`;
    return null;
  }
  if (kind === KIND_WORK) {
    if (branch && CONFIG_RE.test(branch))
      return `cannot start a work branch from a config branch ('${branch}'); ` +
             `use kind="dry-run" to dry-run the in-progress config, or finish config first.`;
    if (branch && WORK_RE.test(branch))
      return `already on a work branch ('${branch}'); finish or abandon it first.`;
    return null;
  }
  if (kind === KIND_DRY_RUN) {
    if (!branch || !CONFIG_RE.test(branch))
      return `kind="dry-run" requires a config/<description> branch as starting point; ` +
             `currently on ${branch ? `'${branch}'` : 'detached HEAD'}.`;
    return null;
  }
  return null;
}

function buildBranchName(kind, args, parentBranch) {
  const descSlug = slugify(args.description);
  if (!descSlug) return { error: 'description slug is empty after normalisation.' };
  if (kind === KIND_CONFIG) return { name: `config/${descSlug}` };
  const flowSlug = slugify(args.flowId);
  if (!flowSlug) return { error: 'flowId slug is empty after normalisation.' };
  if (kind === KIND_WORK)
    return { name: `work/${flowSlug}-${descSlug}` };
  if (kind === KIND_DRY_RUN) {
    // parentBranch is config/<x>; encode the parent's <x> into a flat
    // dry-run/<x>/<flow>-<desc> sibling namespace.
    const parentSlug = parentBranch.replace(/^config\//, '');
    return { name: `dry-run/${parentSlug}/${flowSlug}-${descSlug}` };
  }
  return { error: 'internal: unhandled kind' };
}

function classifyBranch(branch) {
  if (!branch) return 'detached';
  if (DRY_RUN_RE.test(branch)) return 'dry-run';
  if (CONFIG_RE.test(branch)) return 'config';
  if (WORK_RE.test(branch)) return 'work';
  return 'other';
}

function dirtyTrackedFiles(cwd) {
  const out = execFileSync('git',
    ['status', '--porcelain', '--untracked-files=no'],
    { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
  return out ? out.split('\n').map((l) => l.slice(3)) : [];
}

function finishWorkBranch({ workBranch, base, cwd, args }) {
  const opts = { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] };

  // Compute planned side effects.
  const filesToDelete = WORK_FILES.filter((f) => existsSync(path.join(cwd, f)));
  const planned = {
    workBranch,
    baseBranch: base,
    filesToDelete,
    action: 'delete-work-files, commit-cleanup, checkout-base, squash-merge, commit, delete-work-branch',
    commitMessage: args.message,
  };

  if (args.confirm !== true) {
    return JSON.stringify({
      ok: false,
      error: 'foundry_git_finish requires {confirm: true} to perform destructive operations. Re-invoke with confirm:true to apply the plan.',
      planned,
    });
  }

  const dirty = dirtyTrackedFiles(cwd);
  if (dirty.length) {
    return JSON.stringify({
      ok: false,
      error: 'foundry_git_finish refuses to run on a dirty worktree (uncommitted changes to tracked files). Commit or stash them first.',
      dirty,
    });
  }

  // Delete work files
  for (const f of filesToDelete) {
    const p = path.join(cwd, f);
    if (existsSync(p)) unlinkSync(p);
  }

  // Commit cleanup if there are changes
  try {
    execFileSync('git', ['add', '-A'], opts);
    const status = execFileSync('git', ['status', '--porcelain'], opts).trim();
    if (status) {
      const cleanupMsg = `[${workBranch.replace('work/', '')}] cleanup: remove work files`;
      execFileSync('git', ['commit', '-m', cleanupMsg], opts);
    }
  } catch { /* no changes to commit */ }

  // Switch to base and squash merge. Abort on conflict.
  execFileSync('git', ['checkout', base], opts);
  try {
    execFileSync('git', ['merge', '--squash', workBranch], opts);
  } catch (err) {
    try { execFileSync('git', ['reset', '--hard', 'HEAD'], opts); } catch { /* best-effort */ }
    try { execFileSync('git', ['checkout', workBranch], opts); } catch { /* best-effort */ }
    const stderr = (err && (err.stderr || err.stdout)) ? String(err.stderr || err.stdout).trim() : '';
    return JSON.stringify({
      ok: false,
      error: `foundry_git_finish: squash merge failed (likely a conflict). Work branch '${workBranch}' preserved.${stderr ? ' ' + stderr : ''}`,
    });
  }

  execFileSync('git', ['commit', '-m', args.message], opts);
  const hash = execFileSync('git', ['rev-parse', '--short', 'HEAD'], opts).trim();
  execFileSync('git', ['branch', '-D', workBranch], opts);

  return JSON.stringify({ ok: true, hash, branch: base });
}

function finishConfigBranch({ configBranch, base, cwd, args }) {
  const opts = { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] };

  const planned = {
    workBranch: configBranch,
    baseBranch: base,
    filesToDelete: [],
    action: 'checkout-base, squash-merge, commit, delete-config-branch',
    commitMessage: args.message,
  };

  if (args.confirm !== true) {
    return JSON.stringify({
      ok: false,
      error: 'foundry_git_finish requires {confirm: true} to perform destructive operations. Re-invoke with confirm:true to apply the plan.',
      planned,
    });
  }

  const dirty = dirtyTrackedFiles(cwd);
  if (dirty.length) {
    return JSON.stringify({
      ok: false,
      error: 'foundry_git_finish refuses to run on a dirty worktree (uncommitted changes to tracked files). Commit or stash them first.',
      dirty,
    });
  }

  execFileSync('git', ['checkout', base], opts);
  try {
    execFileSync('git', ['merge', '--squash', configBranch], opts);
  } catch (err) {
    try { execFileSync('git', ['reset', '--hard', 'HEAD'], opts); } catch { /* best-effort */ }
    try { execFileSync('git', ['checkout', configBranch], opts); } catch { /* best-effort */ }
    const stderr = (err && (err.stderr || err.stdout)) ? String(err.stderr || err.stdout).trim() : '';
    return JSON.stringify({
      ok: false,
      error: `foundry_git_finish: squash merge failed (likely a conflict). Config branch '${configBranch}' preserved.${stderr ? ' ' + stderr : ''}`,
    });
  }

  execFileSync('git', ['commit', '-m', args.message], opts);
  const hash = execFileSync('git', ['rev-parse', '--short', 'HEAD'], opts).trim();
  execFileSync('git', ['branch', '-D', configBranch], opts);

  return JSON.stringify({ ok: true, hash, branch: base });
}

async function finishDryRunBranch({ branch, args, cwd }) {
  const io = asyncIoFactory({ worktree: cwd });
  const exec = (argv) => execFileSync('git', argv,
    { cwd, encoding: 'utf8', stdio: 'pipe' });

  // Confirm gate (matches work/* and config/* preview semantics).
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
      async execute(args, context) {
        const io = makeIO(context.worktree);
        const stageGuard = requireNoActiveStage(io);
        if (!stageGuard.ok)
          return refuse(`foundry_git_branch ${stageGuard.error}`);

        if (!args.kind)
          return refuse('foundry_git_branch: kind is required (one of: config, work, dry-run)');
        if (!KINDS.includes(args.kind))
          return refuse(`foundry_git_branch: unknown kind "${args.kind}" ` +
                        `(expected one of: ${KINDS.join(', ')})`);

        const argErr = validateKindArgs(args.kind, args);
        if (argErr) return refuse(`foundry_git_branch: ${argErr}`);

        const branch = currentBranch({ exec: makeExec(context.worktree) });
        const startErr = validateStartingBranch(args.kind, branch);
        if (startErr) return refuse(`foundry_git_branch: ${startErr}`);

        const built = buildBranchName(args.kind, args, branch);
        if (built.error) return refuse(`foundry_git_branch: ${built.error}`);

        try {
          execFileSync('git', ['checkout', '-b', built.name],
            { cwd: context.worktree, encoding: 'utf8', stdio: 'pipe' });
        } catch (err) {
          const stderr = (err && (err.stderr || err.stdout))
            ? String(err.stderr || err.stdout).trim() : '';
          return refuse(`foundry_git_branch: failed to create branch ` +
                        `'${built.name}'.${stderr ? ' ' + stderr : ''}`);
        }

        // Truncate any stale trace file when entering a dry-run branch.
        // Must never break branch creation.
        if (args.kind === KIND_DRY_RUN) {
          try {
            await truncateTrace({
              branch: built.name,
              io: asyncIoFactory({ worktree: context.worktree }),
            });
          } catch { /* swallow */ }
        }

        return JSON.stringify({ ok: true, branch: built.name });
      },
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
      async execute(args, context) {
        const io = makeIO(context.worktree);
        const stageGuard = requireNoActiveStage(io);
        if (!stageGuard.ok)
          return refuse(`foundry_git_finish ${stageGuard.error}`);

        const cwd = context.worktree;
        const branch = execFileSync('git', ['branch', '--show-current'],
          { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
        const kind = classifyBranch(branch);

        if (kind === 'dry-run') {
          if (args.baseBranch !== undefined) {
            return refuse(
              'foundry_git_finish: baseBranch is not valid for a dry-run ' +
              'finish; the parent config branch is determined by the dry-run ' +
              'branch name.');
          }
          return finishDryRunBranch({ branch, args, cwd });
        }

        const base = args.baseBranch || 'main';

        // Already on base — graceful no-op (nothing to merge from).
        if (branch === base) {
          return JSON.stringify({
            ok: true,
            noop: true,
            message: `Already on ${base} — nothing to merge`,
            branch: base,
          });
        }

        if (kind === 'work')
          return finishWorkBranch({ workBranch: branch, base, cwd, args });
        if (kind === 'config')
          return finishConfigBranch({ configBranch: branch, base, cwd, args });

        return refuse(
          `foundry_git_finish: nothing to finish on '${branch || 'detached HEAD'}' ` +
          `(expected work/<x>, config/<x>, or dry-run/<x>/<y>).`);
      },
    }),
  };
}
