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

export async function withStore(context) {
  const io = makeMemoryIO(context.worktree);
  const store = await getOrOpenStore({ worktreeRoot: context.worktree, io });
  const ctx = getContext(context.worktree);
  const embeddingsCfg = ctx?.config?.embeddings;
  const schemaEmbeddings = ctx?.schema?.embeddings;
  // `embedder` follows the provider config (enabled → available for queries
  // like search/probe). `writeEmbedder` additionally requires that the schema
  // declare vector dimensions (i.e. init-memory has provisioned the typed
  // column); otherwise put paths stay embedding-free to keep the relation
  // compatible with the non-HNSW column type.
  const embedder = embeddingsCfg && embeddingsCfg.enabled
    ? (inputs) => memEmbed({ config: embeddingsCfg, inputs })
    : null;
  const writeEmbedder = embedder && schemaEmbeddings && schemaEmbeddings.dimensions
    ? embedder
    : null;
  let permissions = null;
  const { cycleId, fromActiveStage } = resolveCycleId(context);
  if (cycleId) {
    try {
      const cycleDef = await getCycleDefinition('foundry', cycleId, io);
      permissions = resolvePermissions({ cycleFrontmatter: cycleDef.frontmatter, vocabulary: ctx.vocabulary });
    } catch (err) {
      // Active stages enforce cycle-scoped permissions, so an unresolved
      // cycle keeps the call within those permissions. Explicit
      // `context.cycle` calls continue to treat an unresolved cycle as
      // "no permissions" (full access), because that path is a
      // trust-the-caller contract.
      if (fromActiveStage) {
        throw new Error(
          `active stage references cycle '${cycleId}' but its definition could not be loaded: ${err.message ?? err}`,
        );
      }
      permissions = null;
    }
  }
  return {
    io,
    store,
    vocabulary: ctx.vocabulary,
    permissions,
    embedder,
    writeEmbedder,
    syncIfOutOfCycle: async () => { if (!cycleId) await syncStore({ store, io }); },
  };
}
