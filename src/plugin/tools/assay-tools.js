import { requireActiveStage } from '../../scripts/lib/stage-guard.js';
import { markWorkfileFailed } from '../../scripts/lib/failed-flow.js';
import { guarded, notFailedGuard } from '../../scripts/lib/guards.js';
import { runAssay } from '../../scripts/lib/assay/run.js';
import { syncStore } from '../../scripts/lib/memory/store.js';
import { putEntity, relate as memRelate } from '../../scripts/lib/memory/writes.js';
import { withStore } from './memory-helpers.js';
import { makeIO, branchIoFactory, asyncIoFactory, flowBranchGuard } from './helpers.js';

const gateNotFailed = notFailedGuard(makeIO);

function truncateStderr(stderr) {
  if (!stderr) return '';
  const trimmed = stderr.trim();
  if (trimmed.length <= 500) return trimmed;
  const bytesRemaining = trimmed.length - 500;
  const plural = bytesRemaining === 1 ? 'byte' : 'bytes';
  return `${trimmed.slice(0, 500)}... (${bytesRemaining} more ${plural})`;
}

function handleExtractorFailure(io, res) {
  const stderrSnippet = truncateStderr(res.stderr);
  const msg = `assay aborted on extractor \`${res.failedExtractor}\`: ${res.reason}` +
    (stderrSnippet ? ` (stderr: ${stderrSnippet})` : '');
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

async function syncAfterAssay(store, memIo) {
  try {
    await syncStore({ store, io: memIo });
    return { ok: true };
  } catch (err) {
    return { ok: false, err };
  }
}

function handleSyncFailure(io, err) {
  const msg = `assay post-run memory sync failed: ${err?.message ?? err}`;
  try { markWorkfileFailed(io, msg); } catch { /* WORK.md gone? nothing we can do */ }
  return JSON.stringify({ error: msg, flow_failed: true });
}

async function handleAssayRun(args, context) {
  const io = makeIO(context.worktree);
  const guard = requireActiveStage(io, { stageBase: 'assay', cycle: args.cycle });
  if (!guard.ok) return JSON.stringify({ error: `foundry_assay_run requires active assay stage for cycle '${args.cycle}'; ${guard.error}` });

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

  if (!res.ok) return handleExtractorFailure(io, res);

  const syncResult = await syncAfterAssay(store, memIo);
  if (!syncResult.ok) return handleSyncFailure(io, syncResult.err);

  return JSON.stringify(res);
}

export function createAssayTools({ tool }) {
  return {
    foundry_assay_run: tool({
      description: 'Run extractors to populate flow memory. Only callable during an active assay stage. Aborts on first failure; marks the workfile failed. Extractors must output one JSON object per line (JSONL/NDJSON format), not pretty-printed multi-line JSON.',
      args: {
        cycle: tool.schema.string().describe('Cycle name'),
        extractors: tool.schema.array(tool.schema.string()).describe('Extractor names, executed in order'),
      },
      execute: guarded('foundry_assay_run', [flowBranchGuard, gateNotFailed], handleAssayRun, { branchIo: branchIoFactory, io: asyncIoFactory }),
    }),
  };
}
