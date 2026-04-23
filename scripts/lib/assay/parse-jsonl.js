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

function parseEdgeRow(obj, lineNo) {
  checkFields(obj, EDGE_FIELDS, lineNo, 'edge');
  if (!obj.from || typeof obj.from !== 'object') {
    throw new Error(`extractor output line ${lineNo}: edge.from is required and must be an object {type,name}`);
  }
  if (!obj.to || typeof obj.to !== 'object') {
    throw new Error(`extractor output line ${lineNo}: edge.to is required and must be an object {type,name}`);
  }
  req(obj.from, 'type', lineNo, 'edge.from');
  req(obj.from, 'name', lineNo, 'edge.from');
  req(obj.to, 'type', lineNo, 'edge.to');
  req(obj.to, 'name', lineNo, 'edge.to');
  req(obj, 'edge', lineNo, 'edge');
  return {
    kind: 'edge',
    edge_type: obj.edge,
    from_type: obj.from.type,
    from_name: obj.from.name,
    to_type: obj.to.type,
    to_name: obj.to.name,
  };
}

export function parseExtractorOutput(text) {
  if (!text) return [];
  const lines = text.split(/\r?\n/);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    let obj;
    try {
      obj = JSON.parse(trimmed);
    } catch (err) {
      throw new Error(`extractor output line ${i + 1}: invalid JSON (${err.message})`);
    }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
      throw new Error(`extractor output line ${i + 1}: expected a JSON object`);
    }
    const kind = obj.kind;
    if (kind === 'entity') out.push(parseEntityRow(obj, i + 1));
    else if (kind === 'edge') out.push(parseEdgeRow(obj, i + 1));
    else throw new Error(`extractor output: unknown kind '${kind}' at line ${i + 1}`);
  }
  return out;
}
