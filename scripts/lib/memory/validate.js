export const MAX_VALUE_BYTES = 4096;

function byteLen(s) {
  return Buffer.byteLength(s, 'utf8');
}

export function validateEntityWrite({ type, name, value }, vocabulary) {
  if (!vocabulary.entities[type]) {
    throw new Error(`entity type '${type}' is not declared`);
  }
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error(`entity name must be a non-empty string`);
  }
  if (typeof value !== 'string') {
    throw new Error(`entity value must be a string`);
  }
  if (byteLen(value) > MAX_VALUE_BYTES) {
    throw new Error(`entity value is too large: ${byteLen(value)} bytes exceeds 4KB limit`);
  }
}

export function validateEdgeWrite({ edge_type, from_type, from_name, to_type, to_name }, vocabulary) {
  const edge = vocabulary.edges[edge_type];
  if (!edge) {
    throw new Error(`edge type '${edge_type}' is not declared`);
  }
  if (edge.sources !== 'any') {
    if (!vocabulary.entities[from_type]) {
      throw new Error(`edge source type '${from_type}' is not a declared entity type`);
    }
    if (!edge.sources.includes(from_type)) {
      throw new Error(`edge '${edge_type}' does not permit source type '${from_type}' (allowed: ${edge.sources.join(', ')})`);
    }
  }
  if (edge.targets !== 'any') {
    if (!vocabulary.entities[to_type]) {
      throw new Error(`edge target type '${to_type}' is not a declared entity type`);
    }
    if (!edge.targets.includes(to_type)) {
      throw new Error(`edge '${edge_type}' does not permit target type '${to_type}' (allowed: ${edge.targets.join(', ')})`);
    }
  }
  for (const [k, v] of Object.entries({ from_name, to_name })) {
    if (typeof v !== 'string' || v.length === 0) throw new Error(`${k} must be a non-empty string`);
  }
}
