export const MAX_VALUE_BYTES = 4096;

// Names are the primary key, get embedded in NDJSON serialisation and Cozo
// query literals, and appear in error messages. Reject newline, CR, tab, and
// NUL so round-trips stay lossless and users can't craft names that would
// split across lines in the relation files.
const FORBIDDEN_CHARS = /[\n\r\t]/;

function assertValidName(label, v) {
  if (typeof v !== 'string' || v.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  if (FORBIDDEN_CHARS.test(v) || v.includes('\0')) {
    throw new Error(`${label} must not contain newline, carriage return, tab, or NUL`);
  }
}

function byteLen(s) {
  return Buffer.byteLength(s, 'utf8');
}

export function validateEntityWrite({ type, name, value }, vocabulary) {
  if (!vocabulary.entities[type]) {
    throw new Error(`entity type '${type}' is not declared`);
  }
  assertValidName('entity name', name);
  if (typeof value !== 'string') {
    throw new Error(`entity value must be a string`);
  }
  if (value.includes('\0')) {
    throw new Error(`entity value must not contain NUL`);
  }
  if (byteLen(value) > MAX_VALUE_BYTES) {
    throw new Error(`entity value is too large: ${byteLen(value)} bytes exceeds 4KB limit`);
  }
}

function checkEdgeRole(entities, allowed, actualType, label, edgeType) {
  if (allowed !== 'any') {
    if (!entities[actualType]) {
      throw new Error(`edge ${label} type '${actualType}' is not a declared entity type`);
    }
    if (!allowed.includes(actualType)) {
      throw new Error(`edge '${edgeType}' does not permit ${label} type '${actualType}' (allowed: ${allowed.join(', ')})`);
    }
  }
}

export function validateEdgeWrite({ edge_type, from_type, from_name, to_type, to_name }, vocabulary) {
  const edge = vocabulary.edges[edge_type];
  if (!edge) {
    throw new Error(`edge type '${edge_type}' is not declared`);
  }
  checkEdgeRole(vocabulary.entities, edge.sources, from_type, 'source', edge_type);
  checkEdgeRole(vocabulary.entities, edge.targets, to_type, 'target', edge_type);
  assertValidName('from_name', from_name);
  assertValidName('to_name', to_name);
}
