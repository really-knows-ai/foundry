import { join } from 'node:path';

export function memoryPaths(foundryDir) {
  const root = join(foundryDir, 'memory');
  const entitiesDir = join(root, 'entities');
  const edgesDir = join(root, 'edges');
  // Phase 2 moved relations out of foundry/ to foundry-memory/relations/
  // (sibling to foundry/). Derive from foundryDir using '..' to go up one level.
  const relationsDir = join(foundryDir, '..', 'foundry-memory', 'relations');
  const extractorsDir = join(root, 'extractors');
  return {
    root,
    config: join(root, 'config.md'),
    schema: join(root, 'schema.json'),
    entitiesDir,
    edgesDir,
    relationsDir,
    extractorsDir,
    db: join(root, 'memory.db'),
    entityTypeFile: (name) => join(entitiesDir, `${name}.md`),
    edgeTypeFile: (name) => join(edgesDir, `${name}.md`),
    relationFile: (name) => join(relationsDir, `${name}.ndjson`),
    extractorFile: (name) => join(extractorsDir, `${name}.md`),
  };
}
