import { openStore, closeStore } from '../store.js';
import { loadSchema, writeSchema, bumpVersion } from '../schema.js';
import { entRelName, dropHnswIndex, dropRelation } from '../cozo.js';
import { putEntity } from '../writes.js';
import { invalidateStore } from '../singleton.js';

export async function reembed({
  worktreeRoot,
  io,
  dbAbsolutePath,
  newModel,
  newDimensions,
  embedder,
  batchSize = 64,
}) {
  if (!embedder) throw new Error('reembed requires an embedder');
  if (!Number.isInteger(newDimensions) || newDimensions <= 0) {
    throw new Error('newDimensions must be positive integer');
  }

  const oldSchema = await loadSchema('foundry', io);
  const entityTypes = Object.keys(oldSchema.entities);

  // Phase 1: harvest existing rows under OLD schema, then drop vector index +
  // relation so we can recreate with a new typed column width.
  const oldStore = await openStore({
    foundryDir: 'foundry',
    schema: oldSchema,
    io,
    dbAbsolutePath,
  });
  const rowsByType = {};
  try {
    for (const type of entityTypes) {
      const rel = entRelName(type);
      const res = await oldStore.db.run(`?[name, value] := *${rel}{name, value}`);
      rowsByType[type] = res.rows.map(([name, value]) => ({ name, value }));
      await dropHnswIndex(oldStore.db, rel);
      await dropRelation(oldStore.db, rel);
    }
  } finally {
    closeStore(oldStore);
  }

  // Phase 2: install new schema, reopen to create fresh relations/indices at
  // the new dimensionality, re-embed each value, and write rows back.
  const newSchema = { ...oldSchema, embeddings: { model: newModel, dimensions: newDimensions } };
  bumpVersion(newSchema);
  const vocabulary = { entities: newSchema.entities, edges: newSchema.edges };
  const newStore = await openStore({
    foundryDir: 'foundry',
    schema: newSchema,
    io,
    dbAbsolutePath,
  });
  try {
    for (const type of entityTypes) {
      const rows = rowsByType[type] ?? [];
      for (let i = 0; i < rows.length; i += batchSize) {
        const chunk = rows.slice(i, i + batchSize);
        const vectors = await embedder(chunk.map((r) => r.value));
        for (let j = 0; j < chunk.length; j++) {
          const v = vectors[j];
          if (!Array.isArray(v) || v.length !== newDimensions) {
            throw new Error(
              `reembed: vector length ${Array.isArray(v) ? v.length : 'n/a'} != expected ${newDimensions}`,
            );
          }
          await putEntity(
            newStore,
            { type, name: chunk[j].name, value: chunk[j].value },
            vocabulary,
            { embedder: async () => [v] },
          );
        }
      }
    }
  } finally {
    closeStore(newStore);
  }

  await writeSchema('foundry', newSchema, io);
  invalidateStore(worktreeRoot);
  return { model: newModel, dimensions: newDimensions, types: entityTypes.length };
}
