import { openFeedbackStore } from '../../scripts/lib/feedback-store.js';
import { guarded, notFailedGuard } from '../../scripts/lib/guards.js';
import { makeIO, flowBranchGuard, branchIoFactory, asyncIoFactory } from './helpers.js';
import { writeCall } from '../../scripts/lib/stage-calls.js';

const gateNotFailed = notFailedGuard(makeIO);

const FLOW_GUARDS = [flowBranchGuard, gateNotFailed];

async function executeFeedbackList(args, context) {
  const io = makeIO(context.worktree);
  if (!io.exists('WORK.md')) {
    return JSON.stringify({ error: 'foundry_feedback_list: WORK.md cycle not found' });
  }
  try {
    const store = openFeedbackStore('WORK.feedback.yaml', io);
    writeCall(io, 'foundry_feedback_list');
    const items = store.list()
      .filter(it => !args.file || it.file === args.file)
      .map(it => {
        const head = it.history[0];
        const base = {
          id: it.id,
          file: it.file,
          tag: it.tag,
          text: it.text,
          source: it.source,
          state: head.state,
          depth: it.history.length,
        };
        if (head.reason) base.reason = head.reason;
        return base;
      });
    return JSON.stringify(items);
  } catch (err) {
    return JSON.stringify({ error: `foundry_feedback_list: ${err.message}` });
  }
}

export function createFeedbackTools({ tool }) {
  return {
    foundry_feedback_list: tool({
      description: 'List feedback items, optionally filtered by file',
      args: {
        file: tool.schema.string().optional().describe('Filter by artefact file path'),
      },
      execute: guarded('foundry_feedback_list', FLOW_GUARDS, executeFeedbackList, { branchIo: branchIoFactory, io: asyncIoFactory }),
    }),
  };
}
