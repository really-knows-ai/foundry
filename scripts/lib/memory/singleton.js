import { join } from 'path';
import { loadMemoryConfig } from './config.js';
import { loadSchema } from './schema.js';
import { loadVocabulary } from './types.js';
import { detectDrift } from './drift.js';
import { openStore, closeStore } from './store.js';
import { memoryPaths } from './paths.js';

const stores = new Map(); // worktreeRoot -> { store, vocabulary, config, schema }

export async function getOrOpenStore({ worktreeRoot, io }) {
  if (stores.has(worktreeRoot)) return stores.get(worktreeRoot).store;

  const config = await loadMemoryConfig('foundry', io);
  if (!config.enabled) {
    throw new Error('memory is not enabled in foundry/memory/config.md');
  }
  const schema = await loadSchema('foundry', io);
  const vocabulary = await loadVocabulary('foundry', io);
  const drift = detectDrift({ vocabulary, schema });
  if (drift.hasDrift) {
    const msg = drift.items
      .map((d) => `  - [${d.typeFamily}] ${d.typeName}: ${d.message} → use skill: ${d.suggestedSkill}`)
      .join('\n');
    throw new Error(`memory schema drift detected; refusing to open store:\n${msg}`);
  }

  const dbAbsolutePath = join(worktreeRoot, memoryPaths('foundry').db);
  const store = await openStore({ foundryDir: 'foundry', schema, io, dbAbsolutePath });
  stores.set(worktreeRoot, { store, vocabulary, config, schema });
  return store;
}

export function getContext(worktreeRoot) {
  return stores.get(worktreeRoot) ?? null;
}

export function disposeStores() {
  for (const [, ctx] of stores) closeStore(ctx.store);
  stores.clear();
}
