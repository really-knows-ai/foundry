import { join } from 'node:path';

export function memoryPaths(foundryDir) {
  const root = join(foundryDir, 'memory');
  const entitiesDir = join(root, 'entities');
  const edgesDir = join(root, 'edges');
  // Fixed sibling path — Phase 2 moved relations out of the foundry/
  // tree entirely. This sits at foundry-memory/relations/ (sibling to the
  // worktree root, not under foundryDir). No way to derive from foundryDir
  // without knowing the worktree root, so it's intentionally fixed.
  const relationsDir = 'foundry-memory/relations';
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
