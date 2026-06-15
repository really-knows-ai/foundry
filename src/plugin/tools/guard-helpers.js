import { requireGitRepo, requireFoundryRoot } from '../../scripts/lib/foundational-guards.js';
import { requireOnConfigBranch, requireOnFlowBranch } from '../../scripts/lib/branch-guard.js';
import { notFailedGuard } from '../../scripts/lib/guards.js';
import { makeIO, makeExec } from './helpers.js';

export function gitRepoGuard(_args, context) {
  return requireGitRepo(makeIO(context.worktree));
}

export function foundryRootGuard(_args, context) {
  return requireFoundryRoot(makeIO(context.worktree));
}

export function configBranchGuard(_args, context) {
  return requireOnConfigBranch({ exec: makeExec(context.worktree) });
}

export function flowBranchGuard(_args, context) {
  return requireOnFlowBranch({ exec: makeExec(context.worktree) });
}

export const configGateNotFailed = notFailedGuard(makeIO);
