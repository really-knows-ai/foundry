export function resolvePermissions({ cycleFrontmatter, vocabulary }) {
  const mem = cycleFrontmatter?.memory;
  const readTypes = new Set();
  const writeTypes = new Set();

  if (mem && typeof mem === 'object') {
    for (const t of mem.read ?? []) if (vocabulary.entities[t]) readTypes.add(t);
    for (const t of mem.write ?? []) if (vocabulary.entities[t]) writeTypes.add(t);
  }

  const enabled = readTypes.size > 0 || writeTypes.size > 0;
  return { enabled, readTypes, writeTypes, vocabulary };
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
