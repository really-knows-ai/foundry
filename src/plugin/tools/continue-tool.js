// src/plugin/tools/continue-tool.js
// foundry_continue — advances an existing run by reading state from disk.

import { requireOnFlowBranch } from '../../scripts/lib/branch-guard.js';
import { readFailedStatus } from '../../scripts/lib/failed-flow.js';
import { continueRun } from '../../scripts/run.js';
import { commitWithPolicy } from '../../scripts/lib/git-bridge.js';
import { makeIO, makeExec, makeExecGit } from './helpers.js';

function makeGit(worktree) {
  const execFile = makeExecGit(worktree);
  return {
    commit: function(message, opts) {
      return commitWithPolicy({ message, allowedPatterns: (opts && opts.allowedPatterns) || [], execFile });
    },
  };
}

export function createContinueTool(pluginOpts) {
  const { tool, client } = pluginOpts;
  return {
    foundry_continue: tool({
      description: 'Advance an existing run. Reads state from disk and runs until blocked.',
      args: {},
      async execute(_args, context) {
        const io = makeIO(context.worktree);
        const exec = makeExec(context.worktree);
        const branchIo = { exec };

        const branchGuard = requireOnFlowBranch(branchIo);
        if (!branchGuard.ok) {
          return JSON.stringify({ action: 'violation', details: 'foundry_continue: ' + branchGuard.error, recoverable: false });
        }

        const failed = readFailedStatus(io);
        if (failed) {
          return JSON.stringify({ action: 'violation', details: 'foundry_continue: flow is in failed state', recoverable: false });
        }

        if (!io.exists('WORK.md')) {
          return JSON.stringify({ action: 'violation', details: 'foundry_continue: WORK.md not found. Use foundry_run() to start a new run.', recoverable: false });
        }

        const git = makeGit(context.worktree);
        const result = await continueRun({
          cwd: context.worktree, client, context, io,
          worktree: context.worktree, git,
        });
        return JSON.stringify(result);
      },
    }),
  };
}
