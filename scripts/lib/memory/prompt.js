import { checkEdgeRead, checkEdgeWrite } from './permissions.js';

function entityBlock(name, typeDef, isWrite) {
  return [
    `### entity: \`${name}\` (${isWrite ? 'read+write' : 'read-only'})`,
    '',
    typeDef.body ?? '(no description)',
    '',
  ].join('\n');
}

function edgeBlock(name, edgeDef, canWrite) {
  const renderList = (v) => v === 'any' ? 'any' : `[${v.join(', ')}]`;
  return [
    `### edge: \`${name}\` (${canWrite ? 'read+write' : 'read-only'})`,
    `Sources: ${renderList(edgeDef.sources)}. Targets: ${renderList(edgeDef.targets)}.`,
    '',
    edgeDef.body ?? '(no description)',
    '',
  ].join('\n');
}

function extractorBlock({ name, body }) {
  return [
    `### extractor: \`${name}\``,
    '',
    (body && body.trim()) ? body.trim() : '(no description)',
    '',
  ].join('\n');
}

export function renderMemoryPrompt({ permissions, schema, extractors }) {
  if (!permissions.enabled) return '';

  const { readTypes, writeTypes, vocabulary } = permissions;
  const embeddingsEnabled = Boolean(schema?.embeddings?.dimensions);
  const allTypes = new Set([...readTypes, ...writeTypes]);

  const lines = [
    '## Flow memory',
    '',
    'You have access to a typed, graph-shaped memory store. Use it to save what you learn and to query what previous cycles learned.',
    '',
    'Types visible to this cycle:',
    '',
  ];

  for (const name of [...allTypes].sort()) {
    lines.push(entityBlock(name, vocabulary.entities[name], writeTypes.has(name)));
  }

  const visibleEdges = Object.keys(vocabulary.edges)
    .filter((n) => checkEdgeRead(permissions, n))
    .sort();

  if (visibleEdges.length > 0) {
    lines.push('Edges visible to this cycle:');
    lines.push('');
    for (const name of visibleEdges) {
      lines.push(edgeBlock(name, vocabulary.edges[name], checkEdgeWrite(permissions, name)));
    }
  }

  lines.push('### Memory tools available to you');
  lines.push('');
  lines.push('- `foundry_memory_get(type, name)` — fetch an entity (null if absent).');
  lines.push('- `foundry_memory_list(type)` — list all entities of a type.');
  lines.push('- `foundry_memory_neighbours(type, name, depth?, edge_types?)` — bounded graph traversal.');
  lines.push('- `foundry_memory_query(datalog)` — arbitrary read-only Cozo Datalog.');
  if (embeddingsEnabled) {
    lines.push('- `foundry_memory_search(type, query, limit?)` — semantic (vector) search over entities of a type.');
  }
  if (writeTypes.size > 0) {
    lines.push('- `foundry_memory_put(type, name, value)` — upsert an entity (≤4KB value).');
    lines.push('- `foundry_memory_relate(from_type, from_name, edge_type, to_type, to_name)` — upsert an edge.');
    lines.push('- `foundry_memory_unrelate(...)` — delete an edge.');
  }
  lines.push('');
  lines.push('Writes to types outside your permissions are rejected.');
  lines.push('');

  if (Array.isArray(extractors) && extractors.length > 0) {
    lines.push('## Extractors');
    lines.push('');
    lines.push('The following extractors populate this cycle\'s memory during the assay stage. Their prose briefs describe what gets captured:');
    lines.push('');
    for (const ex of extractors) {
      lines.push(extractorBlock(ex));
    }
  }

  return lines.join('\n');
}
