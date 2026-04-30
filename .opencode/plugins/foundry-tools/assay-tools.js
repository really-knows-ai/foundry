import { requireActiveStage } from '../../../scripts/lib/stage-guard.js';
import { markWorkfileFailed } from '../../../scripts/lib/failed-flow.js';
import { guarded, notFailedGuard } from '../../../scripts/lib/guards.js';
import { runAssay } from '../../../scripts/lib/assay/run.js';
import { syncStore } from '../../../scripts/lib/memory/store.js';
import { putEntity, relate as memRelate } from '../../../scripts/lib/memory/writes.js';
import { withStore } from './memory-helpers.js';
import { makeIO, errorJson } from './helpers.js';

const gateNotFailed = notFailedGuard(makeIO);

export function createAssayTools({ tool }) {
  return {
    foundry_assay_run: tool({
      description: 'Run extractors to populate flow memory. Only callable during an active assay stage. Aborts on first failure; marks the workfile failed.',
      args: {
        cycle: tool.schema.string().describe('Cycle name'),
        extractors: tool.schema.array(tool.schema.string()).describe('Extractor names, executed in order'),
      },
      execute: guarded('foundry_assay_run', [gateNotFailed], async (args, context) => {
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
            //
            // If this sync fails, the in-memory DB is ahead of the on-disk
            // NDJSON source of truth — same data-loss risk that stage_end
            // guards against. Mirror that behaviour: mark the workfile failed
            // and surface flow_failed to the caller, so subsequent mutating
            // tools refuse to run until the user abandons the cycle.
            try {
              await syncStore({ store, io: memIo });
            } catch (err) {
              const msg = `assay post-run memory sync failed: ${err?.message ?? err}`;
              try { markWorkfileFailed(io, msg); } catch { /* WORK.md gone? nothing we can do */ }
              return JSON.stringify({ error: msg, flow_failed: true });
            }
          } else {
            // Extractor failure is a deterministic infrastructure failure.
            // The extractor scripts live under foundry/memory/extractors/ —
            // outside any artefact's file-patterns and outside forge's allowed
            // write scope — so forge cannot fix them. Treat this the same as
            // a memory-sync failure: mark the workfile failed and surface
            // flow_failed. The user must fix the extractor and start a new
            // cycle.
            const msg = `assay aborted on extractor \`${res.failedExtractor}\`: ${res.reason}` +
              (res.stderr ? ` (stderr: ${res.stderr.trim().slice(0, 500)})` : '');
            try { markWorkfileFailed(io, msg); } catch { /* WORK.md gone? nothing we can do */ }
            return JSON.stringify({
              error: msg,
              flow_failed: true,
              aborted: true,
              failedExtractor: res.failedExtractor,
              reason: res.reason,
              stderr: res.stderr,
              perExtractor: res.perExtractor,
            });
          }
          return JSON.stringify(res);
        } catch (err) {
          return errorJson(err);
        }
      }),
    }),
  };
}
