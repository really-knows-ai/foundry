// Meta tools for inspecting and managing forensic snapshots produced by
// dry-run finishes. These tools are branch-agnostic per spec §11.6 — they
// carry only the foundational guards (gitRepo, foundryRoot) so authors
// can list/show/delete/prune snapshots from any branch including main.

import {
  listSnapshots,
  showSnapshot,
  deleteSnapshot,
  pruneSnapshots,
} from '../../scripts/lib/snapshot/inspect.js';
import { requireGitRepo, requireFoundryRoot } from '../../scripts/lib/foundational-guards.js';
import { guarded } from '../../scripts/lib/guards.js';
import { makeIO, makeAsyncIO, errorJson, branchIoFactory, asyncIoFactory } from './helpers.js';

// --- guard helpers ---------------------------------------------------------

function gitRepoGuard(_args, context) {
  return requireGitRepo(makeIO(context.worktree));
}

function foundryRootGuard(_args, context) {
  return requireFoundryRoot(makeIO(context.worktree));
}

const GUARDS = [gitRepoGuard, foundryRootGuard];
const TRACE_OPTS = { branchIo: branchIoFactory, io: asyncIoFactory };

// --- tool factory ----------------------------------------------------------

export function createSnapshotTools({ tool }) {
  return {
    foundry_snapshot_list: tool({
      description: 'List forensic snapshots from past dry-run finishes.',
      args: {},
      execute: guarded('foundry_snapshot_list', GUARDS, async (_args, context) => {
        try {
          const io = makeAsyncIO(context.worktree);
          return JSON.stringify(await listSnapshots({ io }));
        } catch (err) {
          return errorJson(err);
        }
      }, TRACE_OPTS),
    }),

    foundry_snapshot_show: tool({
      description: 'Show a structured summary of one forensic snapshot.',
      args: {
        runId: tool.schema.string(),
      },
      execute: guarded('foundry_snapshot_show', GUARDS, async (args, context) => {
        try {
          const io = makeAsyncIO(context.worktree);
          return JSON.stringify(await showSnapshot({ runId: args.runId, io }));
        } catch (err) {
          return errorJson(err);
        }
      }, TRACE_OPTS),
    }),

    foundry_snapshot_delete: tool({
      description: 'Delete a forensic snapshot directory. Requires {confirm: true} to actually remove.',
      args: {
        runId: tool.schema.string(),
        confirm: tool.schema.boolean().optional(),
      },
      execute: guarded('foundry_snapshot_delete', GUARDS, async (args, context) => {
        try {
          const io = makeAsyncIO(context.worktree);
          return JSON.stringify(await deleteSnapshot({
            runId: args.runId,
            io,
            confirm: args.confirm === true,
          }));
        } catch (err) {
          return errorJson(err);
        }
      }, TRACE_OPTS),
    }),

    foundry_snapshot_prune: tool({
      description: 'Prune forensic snapshots older than `olderThanDays`. Requires {confirm: true} to actually remove.',
      args: {
        olderThanDays: tool.schema.number(),
        confirm: tool.schema.boolean().optional(),
      },
      execute: guarded('foundry_snapshot_prune', GUARDS, async (args, context) => {
        if (!Number.isInteger(args.olderThanDays) || args.olderThanDays <= 0) {
          return JSON.stringify({ ok: false, error: 'olderThanDays must be a positive integer' });
        }
        try {
          const io = makeAsyncIO(context.worktree);
          return JSON.stringify(await pruneSnapshots({
            olderThanDays: args.olderThanDays,
            io,
            confirm: args.confirm === true,
            now: Date.now(),
          }));
        } catch (err) {
          return errorJson(err);
        }
      }, TRACE_OPTS),
    }),
  };
}
