// Extractor-level permission checks. Two scopes:
//   1. Cycle-load: extractor.memoryWrite ⊆ cycle.memory.write
//   2. Runtime per-row: a given entity or edge row is within the extractor's scope.
//
// The edge rule mirrors scripts/lib/memory/permissions.js: an edge is permitted
// if either of its endpoint entity types is in the extractor's memoryWrite.

export function checkExtractorAgainstCycle(extractor, cyclePerms) {
  const missing = extractor.memoryWrite.filter((t) => !cyclePerms.writeTypes.has(t));
  if (missing.length === 0) return { ok: true };
  return {
    ok: false,
    error: `extractor '${extractor.name}' declares memory.write types not permitted by the cycle: ${missing.join(', ')}`,
  };
}

export function checkEntityRowAgainstExtractor(extractor, entityType) {
  if (extractor.memoryWrite.includes(entityType)) return { ok: true };
  return {
    ok: false,
    error: `extractor '${extractor.name}': entity type '${entityType}' is not in memory.write (${extractor.memoryWrite.join(', ')})`,
  };
}

export function checkEdgeRowAgainstExtractor(extractor, edge, vocabulary) {
  const edgeDef = vocabulary.edges?.[edge.edge_type];
  if (!edgeDef) {
    return { ok: false, error: `extractor '${extractor.name}': edge type '${edge.edge_type}' not declared in project vocabulary` };
  }
  if (!vocabulary.entities?.[edge.from_type]) {
    return { ok: false, error: `extractor '${extractor.name}': edge '${edge.edge_type}' from_type '${edge.from_type}' not declared in project vocabulary` };
  }
  if (!vocabulary.entities?.[edge.to_type]) {
    return { ok: false, error: `extractor '${extractor.name}': edge '${edge.edge_type}' to_type '${edge.to_type}' not declared in project vocabulary` };
  }
  const writable = new Set(extractor.memoryWrite);
  if (writable.has(edge.from_type) || writable.has(edge.to_type)) return { ok: true };
  return {
    ok: false,
    error: `extractor '${extractor.name}': edge '${edge.edge_type}' has neither endpoint in memory.write (${extractor.memoryWrite.join(', ')})`,
  };
}
