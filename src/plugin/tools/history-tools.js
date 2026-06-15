import path from 'path';
import { loadHistory } from '../../scripts/lib/history.js';
import { guarded } from '../../scripts/lib/guards.js';
import { makeIO, branchIoFactory, asyncIoFactory } from './helpers.js';

const HISTORY_GUARDS = [];

async function executeHistoryList(args, context) {
  const io = makeIO(context.worktree);
  const historyPath = path.join(context.worktree, 'WORK.history.yaml');
  const entries = loadHistory(historyPath, args.cycle, io);
  return JSON.stringify(entries);
}

export function createHistoryTools({ tool }) {
  return {
    foundry_history_list: tool({
      description: 'List history entries for a cycle',
      args: {
        cycle: tool.schema.string().describe('Cycle name'),
      },
      execute: guarded('foundry_history_list', HISTORY_GUARDS, executeHistoryList, { branchIo: branchIoFactory, io: asyncIoFactory }),
    }),
  };
}
