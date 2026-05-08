// withStore — shared memory-tool helper. Resolves store, vocabulary,
// permissions and embedder from plugin context.

import { getOrOpenStore, getContext } from '../../scripts/lib/memory/singleton.js';
import { syncStore } from '../../scripts/lib/memory/store.js';
import { getCycleDefinition } from '../../scripts/lib/config.js';
import { resolvePermissions } from '../../scripts/lib/memory/permissions.js';
import { embed as memEmbed } from '../../scripts/lib/memory/embeddings.js';
import { makeMemoryIO, makeIO } from './helpers.js';
import { readActiveStage } from '../../scripts/lib/state.js';

// Resolve the cycle id to scope this memory call to. Prefers an explicit
// `context.cycle` (used by orchestrate-driven dispatch); otherwise falls back
// to `.foundry/active-stage.json` so that tool calls made inside an active
// stage with a minimal context (e.g. `{ worktree }`) still respect cycle
// permissions. Returns `{ cycleId, fromActiveStage }` where `cycleId` may be
// null when neither source provides one (out-of-stage call → unscoped).
function resolveCycleId(context) {
  if (context.cycle) return { cycleId: context.cycle, fromActiveStage: false };
  try {
    const syncIo = makeIO(context.worktree);
    const active = readActiveStage(syncIo);
    if (active && active.cycle) return { cycleId: active.cycle, fromActiveStage: true };
  } catch {
    // Treat unreadable/corrupt active-stage as no active stage. The stage
    // guard checks elsewhere already cover the integrity case for stage
    // tools; memory tools continue with unscoped behaviour so unrelated
    // direct calls stay available.
  }
  return { cycleId: null, fromActiveStage: false };
}

// Build an embedder function from the embeddings config, or null when
// embeddings are disabled.
function createEmbedder(embeddingsCfg) {
  if (!embeddingsCfg || !embeddingsCfg.enabled) return null;
  return (inputs) => memEmbed({ config: embeddingsCfg, inputs });
}

// Build a write-capable embedder. Requires both a working embedder and
// schema-declared vector dimensions (provisioned by init-memory).
function createWriteEmbedder(embedder, schemaEmbeddings) {
  if (!embedder) return null;
  if (!schemaEmbeddings || !schemaEmbeddings.dimensions) return null;
  return embedder;
}

// Resolve cycle-scoped permissions. When the cycle definition cannot be
// loaded and the call originated from an active stage, the error is
// rethrown; otherwise permissions fall back to null (full access).
async function resolveCyclePermissions(cycleId, fromActiveStage, io, vocabulary) {
  try {
    const cycleDef = await getCycleDefinition('foundry', cycleId, io);
    return resolvePermissions({ cycleFrontmatter: cycleDef.frontmatter, vocabulary });
  } catch (err) {
    if (fromActiveStage) {
      throw new Error(
        `active stage references cycle '${cycleId}' but its definition could not be loaded: ${err.message ?? err}`,
        { cause: err },
      );
    }
    return null;
  }
}

// Build a sync callback that reconciles the store when the call is
// unscoped (no active cycle).
function makeSyncCallback(cycleId, store, io) {
  return async () => {
    if (!cycleId) await syncStore({ store, io });
  };
}

export async function withStore(context) {
  const io = makeMemoryIO(context.worktree);
  const store = await getOrOpenStore({ worktreeRoot: context.worktree, io });
  const ctx = getContext(context.worktree);
  const embeddingsCfg = ctx?.config?.embeddings;
  const schemaEmbeddings = ctx?.schema?.embeddings;
  const embedder = createEmbedder(embeddingsCfg);
  const writeEmbedder = createWriteEmbedder(embedder, schemaEmbeddings);
  const { cycleId, fromActiveStage } = resolveCycleId(context);
  let permissions = null;
  if (cycleId) {
    permissions = await resolveCyclePermissions(cycleId, fromActiveStage, io, ctx.vocabulary);
  }
  const syncIfOutOfCycle = makeSyncCallback(cycleId, store, io);
  return {
    io,
    store,
    vocabulary: ctx.vocabulary,
    permissions,
    embedder,
    writeEmbedder,
    syncIfOutOfCycle,
  };
}
