import path from 'path';
import { execFileSync } from 'child_process';
import { existsSync, unlinkSync, writeFileSync, readFileSync } from 'fs';
import { slugify } from '../../scripts/lib/slug.js';
import { CONFIG_RE, DRY_RUN_RE } from '../../scripts/lib/branch-guard.js';
import { finishWorkBranchWithArchive } from '../../scripts/lib/git-finish/work-finish.js';
import { finishDryRun } from '../../scripts/lib/snapshot/finish.js';
import { asyncIoFactory } from './helpers.js';

const WORK_FILES = ['WORK.md', 'WORK.history.yaml', 'WORK.feedback.yaml'];

export const KIND_CONFIG  = 'config';
export const KIND_WORK    = 'work';
export const KIND_DRY_RUN = 'dry-run';
export const KINDS = [KIND_CONFIG, KIND_WORK, KIND_DRY_RUN];

const WORK_RE           = /^work\/.+$/;
const DRY_RUN_DEEPER_RE = /^dry-run\/[^/]+\/[^/]+\/.+$/;

// -- Shared: stderr extraction --

function extractStderr(err) {
  if (!err) return '';
  const text = err.stderr || err.stdout;
  return text ? String(text).trim() : '';
}

// -- Kind argument validation --

function validateConfigArgs(args) {
  if (args.flowId !== undefined && args.flowId !== null && args.flowId !== '')
    return `flowId is not valid for kind="config"; supply only { kind, description }.`;
  if (!args.description)
    return `description is required for kind="config".`;
  return null;
}

function validateFlowArgs(kind, args) {
  if (!args.flowId)
    return `flowId is required for kind="${kind}".`;
  if (!args.description)
    return `description is required for kind="${kind}".`;
  return null;
}

export function validateKindArgs(kind, args) {
  if (kind === KIND_CONFIG) return validateConfigArgs(args);
  if (kind === KIND_WORK || kind === KIND_DRY_RUN) return validateFlowArgs(kind, args);
  return `unknown kind "${kind}"; expected one of: ${KINDS.join(', ')}.`;
}

// -- Starting branch validation --

function validateDryRunDepth(branch) {
  if (branch && (DRY_RUN_RE.test(branch) || DRY_RUN_DEEPER_RE.test(branch)))
    return `cannot nest deeper than one dry-run level; you are on '${branch}'.`;
  return null;
}

function validateConfigStartBranch(branch) {
  if (branch && CONFIG_RE.test(branch))
    return `already on a config/* branch ('${branch}'); edit here directly or finish first.`;
  if (branch && WORK_RE.test(branch))
    return `cannot start a config branch from a work branch ('${branch}'); finish or abandon it first.`;
  return null;
}

function validateWorkStartBranch(branch) {
  if (branch && CONFIG_RE.test(branch))
    return `cannot start a work branch from a config branch ('${branch}'); ` +
           `use kind="dry-run" to dry-run the in-progress config, or finish config first.`;
  if (branch && WORK_RE.test(branch))
    return `already on a work branch ('${branch}'); finish or abandon it first.`;
  return null;
}

function validateDryRunStartBranch(branch) {
  if (!branch || !CONFIG_RE.test(branch))
    return `kind="dry-run" requires a config/<description> branch as starting point; ` +
           `currently on ${branch ? "'" + branch + "'" : 'detached HEAD'}.`;
  return null;
}

export function validateStartingBranch(kind, branch) {
  const depthErr = validateDryRunDepth(branch);
  if (depthErr) return depthErr;
  if (kind === KIND_CONFIG) return validateConfigStartBranch(branch);
  if (kind === KIND_WORK) return validateWorkStartBranch(branch);
  if (kind === KIND_DRY_RUN) return validateDryRunStartBranch(branch);
  return null;
}

// -- Branch name construction --

function buildConfigBranchName(descSlug) {
  return { name: `config/${descSlug}` };
}

function buildWorkBranchName(flowSlug, descSlug) {
  return { name: `work/${flowSlug}-${descSlug}` };
}

function buildDryRunBranchName(parentBranch, flowSlug, descSlug) {
  const parentSlug = parentBranch.replace(/^config\//, '');
  return { name: `dry-run/${parentSlug}/${flowSlug}-${descSlug}` };
}

function requireFlowSlug(args) {
  const flowSlug = slugify(args.flowId);
  if (!flowSlug) return { error: 'flowId slug is empty after normalisation.' };
  return { flowSlug };
}

function buildFlowBranch(kind, parentBranch, flowSlug, descSlug) {
  if (kind === KIND_WORK) return buildWorkBranchName(flowSlug, descSlug);
  if (kind === KIND_DRY_RUN) return buildDryRunBranchName(parentBranch, flowSlug, descSlug);
  return { error: 'internal: unhandled kind' };
}

export function buildBranchName(kind, args, parentBranch) {
  const descSlug = slugify(args.description);
  if (!descSlug) return { error: 'description slug is empty after normalisation.' };
  if (kind === KIND_CONFIG) return buildConfigBranchName(descSlug);
  const flowResult = requireFlowSlug(args);
  if (flowResult.error) return flowResult;
  return buildFlowBranch(kind, parentBranch, flowResult.flowSlug, descSlug);
}

// -- Branch classification --

export function classifyBranch(branch) {
  if (!branch) return 'detached';
  if (DRY_RUN_RE.test(branch)) return 'dry-run';
  if (CONFIG_RE.test(branch)) return 'config';
  if (WORK_RE.test(branch)) return 'work';
  return 'other';
}

// -- Dirty-file detection --

export function dirtyTrackedFiles(cwd) {
  const out = execFileSync('git',
    ['status', '--porcelain', '--untracked-files=no'],
    { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
  return out ? out.split('\n').map((l) => l.slice(3)) : [];
}

// -- finishBranchCommon helpers --

function computeFinishPlan(opts) {
  const { branchName, branchType, base, args, cwd } = opts;
  const shouldDelete = branchType === 'work';
  const filesToDelete = shouldDelete
    ? WORK_FILES.filter((f) => existsSync(path.join(cwd, f)))
    : [];
  const action = shouldDelete
    ? 'delete-work-files, commit-cleanup, checkout-base, squash-merge, commit, delete-work-branch'
    : `checkout-base, squash-merge, commit, delete-${branchType}-branch`;
  return { workBranch: branchName, baseBranch: base, filesToDelete, action, commitMessage: args.message };
}

function makeConfirmRefusal(planned) {
  return JSON.stringify({
    ok: false,
    error: 'foundry_git_finish requires {confirm: true} to perform destructive operations. Re-invoke with confirm:true to apply the plan.',
    planned,
  });
}

function makeDirtyRefusal(dirty) {
  return JSON.stringify({
    ok: false,
    error: 'foundry_git_finish refuses to run on a dirty worktree (uncommitted changes to tracked files). Commit or stash them first.',
    dirty,
  });
}

function mergeErrorLabel(branchType) {
  return branchType === 'work' ? 'Work' : 'Config';
}

function formatMergeError(branchName, branchType, err) {
  const branchLabel = mergeErrorLabel(branchType);
  const stderr = extractStderr(err);
  const suffix = stderr ? ' ' + stderr : '';
  return `foundry_git_finish: squash merge failed (likely a conflict). ${branchLabel} branch '${branchName}' preserved.${suffix}`;
}

function bestEffortReset(opts) {
  try { execFileSync('git', ['reset', '--hard', 'HEAD'], opts); } catch { /* best-effort */ }
}

function bestEffortCheckout(branchName, opts) {
  try { execFileSync('git', ['checkout', branchName], opts); } catch { /* best-effort */ }
}

function squashMergeIntoBase(base, branchName, branchType, opts) {
  execFileSync('git', ['checkout', base], opts);
  try {
    execFileSync('git', ['merge', '--squash', branchName], opts);
  } catch (err) {
    bestEffortReset(opts);
    bestEffortCheckout(branchName, opts);
    return JSON.stringify({ ok: false, error: formatMergeError(branchName, branchType, err) });
  }
  return null;
}

function commitAndDeleteBranch(message, branchName, opts) {
  execFileSync('git', ['commit', '--no-gpg-sign', '-m', message], opts);
  const hash = execFileSync('git', ['rev-parse', '--short', 'HEAD'], opts).trim();
  execFileSync('git', ['branch', '-D', branchName], opts);
  return { hash };
}

function deleteWorkFilesAndCommit(filesToDelete, cwd, branchName) {
  for (const f of filesToDelete) {
    const p = path.join(cwd, f);
    if (existsSync(p)) unlinkSync(p);
  }
  try {
    const opts = { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] };
    execFileSync('git', ['add', '-A'], opts);
    const status = execFileSync('git', ['status', '--porcelain'], opts).trim();
    if (status) {
      const cleanupMsg = `[${branchName.replace('work/', '')}] cleanup: remove work files`;
      execFileSync('git', ['commit', '-m', cleanupMsg], opts);
    }
  } catch { /* no changes to commit */ }
}

export function finishBranchCommon({ branchName, branchType, base, cwd, args }) {
  const opts = { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] };
  const planned = computeFinishPlan({ branchName, branchType, base, args, cwd });
  if (args.confirm !== true) return makeConfirmRefusal(planned);
  const dirty = dirtyTrackedFiles(cwd);
  if (dirty.length) return makeDirtyRefusal(dirty);
  if (branchType === 'work') deleteWorkFilesAndCommit(planned.filesToDelete, cwd, branchName);
  const mergeErr = squashMergeIntoBase(base, branchName, branchType, opts);
  if (mergeErr) return mergeErr;
  const { hash } = commitAndDeleteBranch(args.message, branchName, opts);
  return JSON.stringify({ ok: true, hash, branch: base });
}

// -- finishWorkBranch helpers --

function makeExecGit(cwd, opts) {
  return (argv) => {
    if (argv[0] === 'diff')
      return execFileSync('git', argv, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    return execFileSync('git', argv, opts);
  };
}

function makeWriteTempMessage(cwd, opts) {
  return (content) => {
    const gitDir = execFileSync('git', ['rev-parse', '--git-dir'], opts).trim();
    const gitDirAbsolute = path.isAbsolute(gitDir) ? gitDir : path.join(cwd, gitDir);
    const tmpPath = path.join(gitDirAbsolute, `COMMIT_EDITMSG_${Date.now()}`);
    writeFileSync(tmpPath, content, 'utf8');
    return tmpPath;
  };
}

function makeWorkFinishPlanned(workBranch, base) {
  return {
    workBranch,
    baseBranch: base,
    action: 'verify-attest, checkout-base, squash-merge, signed-commit',
  };
}

function formatWorkFinishError(err) {
  const stderr = extractStderr(err);
  if (stderr) return `foundry_git_finish: attested work finish failed. ${stderr}`;
  return `foundry_git_finish: attested work finish failed. ${err.message ?? String(err)}`;
}

export async function finishWorkBranch({ workBranch, base, cwd, args }) {
  const opts = { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] };
  if (args.confirm !== true) {
    return JSON.stringify({
      ok: false,
      error: 'foundry_git_finish requires {confirm: true}.',
      planned: makeWorkFinishPlanned(workBranch, base),
    });
  }
  const dirty = dirtyTrackedFiles(cwd);
  if (dirty.length) {
    return JSON.stringify({ ok: false, error: 'foundry_git_finish: dirty tracked files.', dirty });
  }
  const execGit = makeExecGit(cwd, opts);
  const writeTempMessage = makeWriteTempMessage(cwd, opts);
  try {
    const result = await finishWorkBranchWithArchive({
      branchName: workBranch,
      baseBranch: base,
      confirm: args.confirm,
      execGit,
      fileExists: (p) => existsSync(p),
      readAttest: (p) => readFileSync(p, 'utf8'),
      deleteFile: (p) => { if (existsSync(p)) unlinkSync(p); },
      writeTempMessage,
      cwd,
    });
    return JSON.stringify(result);
  } catch (err) {
    return JSON.stringify({ ok: false, error: formatWorkFinishError(err) });
  }
}

// -- finishConfigBranch --

export function finishConfigBranch({ configBranch, base, cwd, args }) {
  return finishBranchCommon({
    branchName: configBranch,
    branchType: 'config',
    base,
    cwd,
    args,
  });
}

// -- finishDryRunBranch --

export async function finishDryRunBranch({ branch, args, cwd }) {
  const io = asyncIoFactory({ worktree: cwd });
  const exec = (argv) => execFileSync('git', argv,
    { cwd, encoding: 'utf8', stdio: 'pipe' });

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
