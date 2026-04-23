import { requireActiveStage } from '../../../scripts/lib/stage-guard.js';
import { addFeedbackItem } from '../../../scripts/lib/feedback.js';
import { runAssay } from '../../../scripts/lib/assay/run.js';
import { syncStore } from '../../../scripts/lib/memory/store.js';
import { putEntity, relate as memRelate } from '../../../scripts/lib/memory/writes.js';
import { withStore } from './memory-helpers.js';
import { makeIO, errorJson } from './helpers.js';

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
          // withStore resolves store + vocabulary + writeEmbedder the same way
          // the memory-* tools do, so extractor writes behave identically to
          // in-cycle foundry_memory_put calls.
          const { store, vocabulary, writeEmbedder, io: memIo } = await withStore(context);
          const res = await runAssay({
            foundryDir: 'foundry',
            cwd: context.worktree,
            io: memIo,
            extractors: args.extractors,
            store,
            vocabulary,
            putEntity,
            relate: memRelate,
            writeEmbedder,
          });
          if (res.ok) {
            // Defence-in-depth: flush extractor writes to NDJSON immediately
            // rather than deferring to stage_end. A stage killed before
            // stage_end would otherwise lose every extractor-written row on
            // the next process start.
            try {
              await syncStore({ store, io: memIo });
            } catch (err) {
              console.error(`assay post-run memory sync failed: ${err.message ?? err}`);
            }
          } else {
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
