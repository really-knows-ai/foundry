import { requireActiveStage } from '../../../scripts/lib/stage-guard.js';
import { requireNotFailed } from '../../../scripts/lib/failed-flow.js';
import { openFeedbackStore } from '../../../scripts/lib/feedback-store.js';
import { parseFrontmatter } from '../../../scripts/lib/workfile.js';
import { runAssay } from '../../../scripts/lib/assay/run.js';
import { syncStore } from '../../../scripts/lib/memory/store.js';
import { putEntity, relate as memRelate } from '../../../scripts/lib/memory/writes.js';
import { withStore } from './memory-helpers.js';
import { makeIO, errorJson } from './helpers.js';

export function createAssayTools({ tool }) {
  return {
    foundry_assay_run: tool({
      description: 'Run extractors to populate flow memory. Only callable during an active assay stage. Aborts on first failure; emits a validation feedback item on abort.',
      args: {
        cycle: tool.schema.string().describe('Cycle name'),
        extractors: tool.schema.array(tool.schema.string()).describe('Extractor names, executed in order'),
      },
      async execute(args, context) {
        const io = makeIO(context.worktree);
        const failedGuard = requireNotFailed(io);
        if (!failedGuard.ok) return JSON.stringify({ error: `foundry_assay_run: ${failedGuard.error}` });
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
              if (io.exists('WORK.md')) {
                const fm = parseFrontmatter(io.readFile('WORK.md'));
                const cycle = fm.cycle;
                if (cycle) {
                  const msg = `assay aborted on extractor \`${res.failedExtractor}\`: ${res.reason}` +
                    (res.stderr ? ` (stderr: ${res.stderr.trim().slice(0, 500)})` : '');
                  const fbStore = openFeedbackStore('WORK.feedback.yaml', io);
                  fbStore.add({
                    file: 'WORK.md',
                    tag: 'validation',
                    text: msg,
                    source: guard.active.stage,
                    cycle,
                  });
                }
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
