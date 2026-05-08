import { MAX_VALUE_BYTES } from '../memory/validate.js';

const ENTITY_FIELDS = new Set(['kind', 'type', 'name', 'value']);
const EDGE_FIELDS = new Set(['kind', 'from', 'edge', 'to']);

function checkFields(obj, allowed, lineNo, kind) {
  for (const k of Object.keys(obj)) {
    if (!allowed.has(k)) {
      throw new Error(`extractor output line ${lineNo}: unknown field '${k}' on ${kind} row`);
    }
  }
}

function req(obj, key, lineNo, kind) {
  if (obj[key] === undefined || obj[key] === null || obj[key] === '') {
    throw new Error(`extractor output line ${lineNo}: ${kind}.${key} is required`);
  }
}

function parseEntityRow(obj, lineNo) {
  checkFields(obj, ENTITY_FIELDS, lineNo, 'entity');
  req(obj, 'type', lineNo, 'entity');
  req(obj, 'name', lineNo, 'entity');
  if (typeof obj.value !== 'string') {
    throw new Error(`extractor output line ${lineNo}: entity.value is required and must be a string`);
  }
  const bytes = Buffer.byteLength(obj.value, 'utf-8');
  if (bytes > MAX_VALUE_BYTES) {
    throw new Error(`extractor output line ${lineNo}: entity.value is ${bytes} bytes (max ${MAX_VALUE_BYTES}, too large)`);
  }
  return { kind: 'entity', type: obj.type, name: obj.name, value: obj.value };
}

function validateRef(obj, fieldName, lineNo) {
  if (!obj[fieldName] || typeof obj[fieldName] !== 'object') {
    throw new Error(`extractor output line ${lineNo}: edge.${fieldName} is required and must be an object {type,name}`);
  }
  req(obj[fieldName], 'type', lineNo, `edge.${fieldName}`);
  req(obj[fieldName], 'name', lineNo, `edge.${fieldName}`);
}

function checkRefSize(ref, fieldName, lineNo) {
  const bytes = Buffer.byteLength(ref.name, 'utf-8');
  if (bytes > MAX_VALUE_BYTES) {
    throw new Error(`extractor output line ${lineNo}: edge.${fieldName}.name is ${bytes} bytes (max ${MAX_VALUE_BYTES}, too large)`);
  }
}

function parseEdgeRow(obj, lineNo) {
  checkFields(obj, EDGE_FIELDS, lineNo, 'edge');
  validateRef(obj, 'from', lineNo);
  validateRef(obj, 'to', lineNo);
  req(obj, 'edge', lineNo, 'edge');
  checkRefSize(obj.from, 'from', lineNo);
  checkRefSize(obj.to, 'to', lineNo);
  return {
    kind: 'edge',
    edge_type: obj.edge,
    from_type: obj.from.type,
    from_name: obj.from.name,
    to_type: obj.to.type,
    to_name: obj.to.name,
  };
}

function isSkippableLine(trimmed) {
  return trimmed === '' || trimmed.startsWith('#');
}

function parseJsonLine(trimmed, lineNo) {
  try {
    return JSON.parse(trimmed);
  } catch (err) {
    throw new Error(`extractor output line ${lineNo}: invalid JSON (${err.message}). Extractors must output one JSON object per line (JSONL/NDJSON format), not pretty-printed multi-line JSON.`, { cause: err });
  }
}

function validateParsedObject(obj, lineNo) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new Error(`extractor output line ${lineNo}: expected a JSON object`);
  }
}

function dispatchKind(obj, lineNo) {
  if (obj.kind === 'entity') return parseEntityRow(obj, lineNo);
  if (obj.kind === 'edge') return parseEdgeRow(obj, lineNo);
  throw new Error(`extractor output: unknown kind '${obj.kind}' at line ${lineNo}`);
}

export function parseExtractorOutput(text) {
  if (!text) return [];
  const lines = text.split(/\r?\n/);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (isSkippableLine(trimmed)) continue;
    const obj = parseJsonLine(trimmed, i + 1);
    validateParsedObject(obj, i + 1);
    out.push(dispatchKind(obj, i + 1));
  }
  return out;
}
