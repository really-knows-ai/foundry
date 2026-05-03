import { requireActiveStage } from '../../../scripts/lib/stage-guard.js';
import { markWorkfileFailed } from '../../../scripts/lib/failed-flow.js';
import { guarded, notFailedGuard } from '../../../scripts/lib/guards.js';
import { runAssay } from '../../../scripts/lib/assay/run.js';
import { syncStore } from '../../../scripts/lib/memory/store.js';
import { putEntity, relate as memRelate } from '../../../scripts/lib/memory/writes.js';
import { withStore } from './memory-helpers.js';
import { makeIO, errorJson, branchIoFactory, asyncIoFactory, flowBranchGuard } from './helpers.js';

const gateNotFailed = notFailedGuard(makeIO);

export function createAssayTools({ tool }) {
  return {
    foundry_assay_run: tool({
      description: 'Run extractors to populate flow memory. Only callable during an active assay stage. Aborts on first failure; marks the workfile failed. Extractors must output one JSON object per line (JSONL/NDJSON format), not pretty-printed multi-line JSON.',
      args: {
        cycle: tool.schema.string().describe('Cycle name'),
        extractors: tool.schema.array(tool.schema.string()).describe('Extractor names, executed in order'),
      },
      execute: guarded('foundry_assay_run', [flowBranchGuard, gateNotFailed], async (args, context) => {
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
            syncStore, // G29: Pass syncStore so it's called after each extractor
          });
          if (res.ok) {
            // G29: runAssay now syncs store after each extractor internally.
            // Keep this defence-in-depth sync for safety in case of changes.
            // A final sync ensures all writes are flushed before returning success.
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
            const trimmed = res.stderr ? res.stderr.trim() : '';
            let stderrSnippet = trimmed;
            if (trimmed.length > 500) {
              const bytesRemaining = trimmed.length - 500;
              const plural = bytesRemaining === 1 ? 'byte' : 'bytes';
              stderrSnippet = `${trimmed.slice(0, 500)}... (${bytesRemaining} more ${plural})`;
            }
            const msg = `assay aborted on extractor \`${res.failedExtractor}\`: ${res.reason}` +
              (trimmed ? ` (stderr: ${stderrSnippet})` : '');
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
      }, { branchIo: branchIoFactory, io: asyncIoFactory }),
    }),
  };
}
