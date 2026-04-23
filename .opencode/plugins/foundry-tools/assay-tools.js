import { requireActiveStage } from '../../../scripts/lib/stage-guard.js';
import { addFeedbackItem } from '../../../scripts/lib/feedback.js';
import { runAssay } from '../../../scripts/lib/assay/run.js';
import { getOrOpenStore, getContext } from '../../../scripts/lib/memory/singleton.js';
import { putEntity, relate as memRelate } from '../../../scripts/lib/memory/writes.js';
import { makeIO, makeMemoryIO, errorJson } from './helpers.js';

export function createAssayTools({ tool }) {
  return {
    foundry_assay_run: tool({
      description: 'Run extractors to populate flow memory. Only callable during an active assay stage. Aborts on first failure; writes #validation feedback against WORK.md on abort.',
      args: {
        cycle: tool.schema.string().describe('Cycle name'),
        extractors: tool.schema.array(tool.schema.string()).describe('Extractor names, executed in order'),
      },
      async execute(args, context) {
        const io = makeIO(context.worktree);
        const guard = requireActiveStage(io, { stageBase: 'assay', cycle: args.cycle });
        if (!guard.ok) return JSON.stringify({ error: `foundry_assay_run requires active assay stage for cycle '${args.cycle}'; ${guard.error}` });
        try {
          const memIo = makeMemoryIO(context.worktree);
          const store = await getOrOpenStore({ worktreeRoot: context.worktree, io: memIo });
          const ctx = getContext(context.worktree);
          const res = await runAssay({
            foundryDir: 'foundry',
            cwd: context.worktree,
            io: memIo,
            extractors: args.extractors,
            store,
            vocabulary: ctx.vocabulary,
            putEntity,
            relate: memRelate,
          });
          if (!res.ok) {
            try {
              const workPath = 'WORK.md';
              if (await memIo.exists(workPath)) {
                const text = await memIo.readFile(workPath);
                const msg = `assay aborted on extractor \`${res.failedExtractor}\`: ${res.reason}` +
                  (res.stderr ? ` (stderr: ${res.stderr.trim().slice(0, 500)})` : '');
                const out = addFeedbackItem(text, 'WORK.md', msg, 'validation');
                await memIo.writeFile(workPath, out.text);
              }
            } catch (_err) { /* best effort */ }
          }
          return JSON.stringify(res);
        } catch (err) {
          return errorJson(err);
        }
      },
    }),
  };
}
