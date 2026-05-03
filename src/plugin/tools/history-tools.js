import path from 'path';
import { loadHistory } from '../../../scripts/lib/history.js';
import { makeIO } from './helpers.js';

export function createHistoryTools({ tool }) {
  return {
    foundry_history_list: tool({
      description: 'List history entries for a cycle',
      args: {
        cycle: tool.schema.string().describe('Cycle name'),
      },
      async execute(args, context) {
        const io = makeIO(context.worktree);
        const historyPath = path.join(context.worktree, 'WORK.history.yaml');
        const entries = loadHistory(historyPath, args.cycle, io);
        return JSON.stringify(entries);
      },
    }),
  };
}
