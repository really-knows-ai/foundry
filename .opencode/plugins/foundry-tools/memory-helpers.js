// withStore — shared memory-tool helper. Resolves store, vocabulary,
// permissions and embedder from plugin context.

import { getOrOpenStore, getContext } from '../../../scripts/lib/memory/singleton.js';
import { syncStore } from '../../../scripts/lib/memory/store.js';
import { getCycleDefinition } from '../../../scripts/lib/config.js';
import { resolvePermissions } from '../../../scripts/lib/memory/permissions.js';
import { embed as memEmbed } from '../../../scripts/lib/memory/embeddings.js';
import { makeMemoryIO } from './helpers.js';

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
  if (context.cycle) {
    try {
      const cycleDef = await getCycleDefinition('foundry', context.cycle, io);
      permissions = resolvePermissions({ cycleFrontmatter: cycleDef.frontmatter, vocabulary: ctx.vocabulary });
    } catch {
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
    syncIfOutOfCycle: async () => { if (!context.cycle) await syncStore({ store, io }); },
  };
}
