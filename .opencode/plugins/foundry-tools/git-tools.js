import path from 'path';
import { execFileSync } from 'child_process';
import { existsSync, unlinkSync } from 'fs';
import { slugify } from '../../../scripts/lib/slug.js';
import { requireNoActiveStage } from '../../../scripts/lib/stage-guard.js';
import { makeIO } from './helpers.js';

export function createGitTools({ tool }) {
  return {
    foundry_git_branch: tool({
      description: 'Create and checkout a work branch for a flow',
      args: {
        flowId: tool.schema.string().describe('Flow ID'),
        description: tool.schema.string().describe('Branch description suffix'),
      },
      async execute(args, context) {
        const io = makeIO(context.worktree);
        const guard = requireNoActiveStage(io);
        if (!guard.ok) return JSON.stringify({ error: `foundry_git_branch ${guard.error}` });
        const flowSlug = slugify(args.flowId);
        const descSlug = slugify(args.description);
        const branch = `work/${flowSlug}-${descSlug}`;
        execFileSync('git', ['checkout', '-b', branch], { cwd: context.worktree, encoding: 'utf8', stdio: 'pipe' });
        return JSON.stringify({ ok: true, branch });
      },
    }),

    foundry_git_finish: tool({
      description: 'Clean up work files, squash merge to base branch, and delete the work branch',
      args: {
        message: tool.schema.string().describe('Squash merge commit message'),
        baseBranch: tool.schema.string().optional().describe('Target branch (default: main)'),
      },
      async execute(args, context) {
        const io = makeIO(context.worktree);
        const guard = requireNoActiveStage(io);
        if (!guard.ok) return JSON.stringify({ error: `foundry_git_finish ${guard.error}` });
        const base = args.baseBranch || 'main';
        const cwd = context.worktree;
        const opts = { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] };

        // Get current branch name
        const workBranch = execFileSync('git', ['branch', '--show-current'], opts).trim();
        if (workBranch === base) {
          return JSON.stringify({ error: `Already on ${base} — nothing to merge` });
        }

        // Delete work files
        const workPath = path.join(cwd, 'WORK.md');
        const historyPath = path.join(cwd, 'WORK.history.yaml');
        if (existsSync(workPath)) unlinkSync(workPath);
        if (existsSync(historyPath)) unlinkSync(historyPath);

        // Commit cleanup if there are changes
        try {
          execFileSync('git', ['add', '-A'], opts);
          const status = execFileSync('git', ['status', '--porcelain'], opts).trim();
          if (status) {
            const cleanupMsg = `[${workBranch.replace('work/', '')}] cleanup: remove work files`;
            execFileSync('git', ['commit', '-m', cleanupMsg], opts);
          }
        } catch { /* no changes to commit */ }

        // Switch to base and squash merge
        execFileSync('git', ['checkout', base], opts);
        execFileSync('git', ['merge', '--squash', workBranch], opts);
        execFileSync('git', ['commit', '-m', args.message], opts);
        const hash = execFileSync('git', ['rev-parse', '--short', 'HEAD'], opts).trim();

        // Force-delete work branch (required after squash)
        execFileSync('git', ['branch', '-D', workBranch], opts);

        return JSON.stringify({ ok: true, hash, branch: base });
      },
    }),
  };
}
