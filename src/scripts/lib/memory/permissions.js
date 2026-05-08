function filterValidTypes(types, vocabulary) {
  const result = new Set();
  for (const t of types ?? []) {
    if (vocabulary.entities[t]) result.add(t);
  }
  return result;
}

export function resolvePermissions({ cycleFrontmatter, vocabulary }) {
  const mem = cycleFrontmatter?.memory;
  if (!mem || typeof mem !== 'object') {
    return { enabled: false, readTypes: new Set(), writeTypes: new Set(), vocabulary };
  }
  const readTypes = filterValidTypes(mem.read, vocabulary);
  const writeTypes = filterValidTypes(mem.write, vocabulary);
  return { enabled: readTypes.size > 0 || writeTypes.size > 0, readTypes, writeTypes, vocabulary };
}

function endpointInSet(endpointSpec, set) {
  if (endpointSpec === 'any') return set.size > 0;
  return endpointSpec.some((t) => set.has(t));
}

export function checkEntityRead(perms, type) { return perms.readTypes.has(type); }
export function checkEntityWrite(perms, type) { return perms.writeTypes.has(type); }

export function checkEdgeRead(perms, edgeType) {
  const edge = perms.vocabulary.edges[edgeType];
  if (!edge) return false;
  return endpointInSet(edge.sources, perms.readTypes)
      || endpointInSet(edge.targets, perms.readTypes)
      || endpointInSet(edge.sources, perms.writeTypes)
      || endpointInSet(edge.targets, perms.writeTypes);
}

export function checkEdgeWrite(perms, edgeType) {
  const edge = perms.vocabulary.edges[edgeType];
  if (!edge) return false;
  return endpointInSet(edge.sources, perms.writeTypes)
      || endpointInSet(edge.targets, perms.writeTypes);
}
