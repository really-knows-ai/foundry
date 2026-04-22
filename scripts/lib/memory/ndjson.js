function assertFiniteNumbers(value, path) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`NDJSON: non-finite number at ${path}`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertFiniteNumbers(v, `${path}[${i}]`));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) assertFiniteNumbers(v, `${path}.${k}`);
  }
}

function canonicalise(value) {
  if (Array.isArray(value)) return value.map(canonicalise);
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value).sort()) out[k] = canonicalise(value[k]);
    return out;
  }
  return value;
}

function serialiseLine(row) {
  assertFiniteNumbers(row, 'row');
  return JSON.stringify(canonicalise(row));
}

function compareEntity(a, b) {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

const EDGE_KEY_ORDER = ['from_type', 'from_name', 'to_type', 'to_name'];
function compareEdge(a, b) {
  for (const k of EDGE_KEY_ORDER) {
    if (a[k] < b[k]) return -1;
    if (a[k] > b[k]) return 1;
  }
  return 0;
}

export function serialiseEntityRows(rows) {
  if (rows.length === 0) return '';
  const sorted = [...rows].sort(compareEntity);
  return sorted.map(serialiseLine).join('\n') + '\n';
}

export function serialiseEdgeRows(rows) {
  if (rows.length === 0) return '';
  const sorted = [...rows].sort(compareEdge);
  return sorted.map(serialiseLine).join('\n') + '\n';
}

function parseLines(text) {
  const out = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '') continue;
    try {
      out.push(JSON.parse(line));
    } catch (err) {
      throw new Error(`NDJSON: invalid JSON at line ${i + 1}: ${err.message}`);
    }
  }
  return out;
}

export const parseEntityRows = parseLines;
export const parseEdgeRows = parseLines;
