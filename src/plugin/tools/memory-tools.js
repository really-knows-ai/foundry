import { putEntity, relate as memRelate, unrelate as memUnrelate } from '../../scripts/lib/memory/writes.js';
import { getEntity, listEntities, neighbours as memNeighbours } from '../../scripts/lib/memory/reads.js';
import { runQuery } from '../../scripts/lib/memory/query.js';
import { checkEntityRead, checkEntityWrite, checkEdgeRead, checkEdgeWrite } from '../../scripts/lib/memory/permissions.js';
import { search as memSearch } from '../../scripts/lib/memory/search.js';
import { withStore } from './memory-helpers.js';
import { errorJson, makeIO, branchIoFactory, asyncIoFactory, flowBranchGuard } from './helpers.js';
import { guarded, notFailedGuard } from '../../scripts/lib/guards.js';

const gateNotFailed = notFailedGuard(makeIO);
const MAX_NEIGHBOUR_DEPTH = 5;
const MAX_SEARCH_K = 100;
const SPECIAL_CHARS = { '#': 'line', '"': 'string', "'": 'string' };
function skipLineComment(datalog, start) {
  let end = start;
  while (end < datalog.length && datalog[end] !== '\n') {
    end += 1;
  }
  if (end < datalog.length) {
    return { nextIndex: end + 1, output: '\n' };
  }
  return { nextIndex: end, output: '' };
}
function skipBlockComment(datalog, start) {
  let out = '';
  let i = start;
  while (i < datalog.length) {
    if (datalog[i] === '*' && datalog[i + 1] === '/') {
      return { nextIndex: i + 2, output: out + ' ' };
    }
    if (datalog[i] === '\n') {
      out += '\n';
    }
    i += 1;
  }
  return { nextIndex: i, output: out };
}
function readStringLiteral(datalog, start, quote) {
  let out = quote;
  let i = start + 1;
  let escaped = false;
  while (i < datalog.length) {
    const ch = datalog[i];
    out += ch;
    if (escaped) {
      escaped = false;
    } else if (ch === '\\') {
      escaped = true;
    } else if (ch === quote) {
      return { nextIndex: i + 1, output: out };
    }
    i += 1;
  }
  return { nextIndex: i, output: out };
}
function classifyChar(ch, next) {
  if (ch in SPECIAL_CHARS) return SPECIAL_CHARS[ch];
  if (ch === '/') {
    if (next === '*') return 'block';
  }
  return 'normal';
}
function stripQueryComments(datalog) {
  let out = '';
  let i = 0;
  while (i < datalog.length) {
    const kind = classifyChar(datalog[i], datalog[i + 1]);
    if (kind === 'line') {
      const result = skipLineComment(datalog, i + 1);
      out += result.output;
      i = result.nextIndex;
    } else if (kind === 'block') {
      const result = skipBlockComment(datalog, i + 2);
      out += result.output;
      i = result.nextIndex;
    } else if (kind === 'string') {
      const result = readStringLiteral(datalog, i, datalog[i]);
      out += result.output;
      i = result.nextIndex;
    } else {
      out += datalog[i];
      i += 1;
    }
  }
  return out;
}
function referencedStoredRelations(datalog) {
  const matches = stripQueryComments(datalog).matchAll(/\*([a-z][a-z0-9_]*)\s*\{/g);
  const names = new Set();
  for (const match of matches) {
    const name = match[1];
    if (name.startsWith('ent_') || name.startsWith('edge_')) names.add(name);
  }
  return [...names];
}
function validateNeighbourDepth(depth) {
  if ((depth ?? 1) > MAX_NEIGHBOUR_DEPTH) {
    throw new Error(`depth must be ≤ ${MAX_NEIGHBOUR_DEPTH}`);
  }
}
function filterEdgeTypes(edgeTypes, permissions) {
  if (!permissions) return edgeTypes;
  return edgeTypes.filter((e) => checkEdgeRead(permissions, e));
}
function filterNeighbourResult(result, permissions) {
  if (!permissions) return result;
  return {
    entities: result.entities.filter((e) => checkEntityRead(permissions, e.type)),
    edges: result.edges.filter((e) =>
      checkEntityRead(permissions, e.from_type) && checkEntityRead(permissions, e.to_type),
    ),
  };
}
function validateSearchK(k) {
  if ((k ?? 5) > MAX_SEARCH_K) {
    throw new Error(`k must be ≤ ${MAX_SEARCH_K}`);
  }
}
function resolveSearchTypes(typeFilter, permissions, vocabulary) {
  const types = typeFilter && typeFilter.length > 0
    ? typeFilter
    : Object.keys(vocabulary.entities);
  if (!permissions) return types;
  return types.filter((t) => checkEntityRead(permissions, t));
}
function createWriteTool(tool, name, description, ops) {
  return tool({
    description,
    args: ops.makeArgs(tool),
    execute: guarded(name, [flowBranchGuard, gateNotFailed], async (args, context) => {
      try {
        const { store, vocabulary, permissions, writeEmbedder, syncIfOutOfCycle } = await withStore(context);
        if (permissions && !ops.checkPerm(permissions, args)) {
          return errorJson(new Error(ops.errMsg(context.cycle, args)));
        }
        await ops.doOp(store, args, vocabulary, { embedder: writeEmbedder });
        await syncIfOutOfCycle();
        return JSON.stringify({ ok: true });
      } catch (err) { return errorJson(err); }
    }, { branchIo: branchIoFactory, io: asyncIoFactory }),
  });
}
function createPutTool(tool) {
  return createWriteTool(tool, 'foundry_memory_put', 'Upsert an entity into flow memory. Value must be ≤4KB.', {
    makeArgs: (t) => ({
      type: t.schema.string().describe('Entity type (must be declared)'),
      name: t.schema.string().describe('Entity name (unique within type)'),
      value: t.schema.string().describe('Free-text intrinsic description (≤4KB)'),
    }),
    checkPerm: (p, a) => checkEntityWrite(p, a.type),
    doOp: (s, a, v, o) => putEntity(s, a, v, o),
    errMsg: (c, a) => `cycle '${c}' does not have write permission on entity type '${a.type}'`,
  });
}
function createRelateTool(tool) {
  return createWriteTool(tool, 'foundry_memory_relate', 'Upsert an edge between two entities.', {
    makeArgs: (t) => ({
      from_type: t.schema.string(), from_name: t.schema.string(),
      edge_type: t.schema.string(), to_type: t.schema.string(), to_name: t.schema.string(),
    }),
    checkPerm: (p, a) => checkEdgeWrite(p, a.edge_type),
    doOp: (s, a, v) => memRelate(s, a, v),
    errMsg: (c, a) => `cycle '${c}' does not have write permission on edge type '${a.edge_type}'`,
  });
}
function createUnrelateTool(tool) {
  return createWriteTool(tool, 'foundry_memory_unrelate', 'Delete an edge between two entities.', {
    makeArgs: (t) => ({
      from_type: t.schema.string(), from_name: t.schema.string(),
      edge_type: t.schema.string(), to_type: t.schema.string(), to_name: t.schema.string(),
    }),
    checkPerm: (p, a) => checkEdgeWrite(p, a.edge_type),
    doOp: (s, a, v) => memUnrelate(s, a, v),
    errMsg: (c, a) => `cycle '${c}' does not have write permission on edge type '${a.edge_type}'`,
  });
}
function createGetTool(tool) {
  return tool({
    description: 'Fetch a single entity by composite key (type, name).',
    args: { type: tool.schema.string(), name: tool.schema.string() },
    async execute(args, context) {
      try {
        const { store, permissions } = await withStore(context);
        if (permissions && !checkEntityRead(permissions, args.type)) {
          return JSON.stringify(null);
        }
        const ent = await getEntity(store, args);
        return JSON.stringify(ent);
      } catch (err) { return errorJson(err); }
    },
  });
}
function createListTool(tool) {
  return tool({
    description: 'List all entities of a given type.',
    args: { type: tool.schema.string() },
    async execute(args, context) {
      try {
        const { store, permissions } = await withStore(context);
        if (permissions && !checkEntityRead(permissions, args.type)) {
          return JSON.stringify([]);
        }
        const out = await listEntities(store, args);
        return JSON.stringify(out);
      } catch (err) { return errorJson(err); }
    },
  });
}
function createNeighboursTool(tool) {
  return tool({
    description: 'Bounded graph traversal from an entity. Returns entities and edges within `depth` hops.',
    args: {
      type: tool.schema.string(), name: tool.schema.string(),
      depth: tool.schema.number().optional().describe('Default 1'),
      edge_types: tool.schema.array(tool.schema.string()).optional().describe('Restrict traversal to named edges'),
    },
    async execute(args, context) {
      try {
        validateNeighbourDepth(args.depth);
        const { store, vocabulary, permissions } = await withStore(context);
        if (permissions && !checkEntityRead(permissions, args.type)) {
          return JSON.stringify({ entities: [], edges: [] });
        }
        const edgeTypesInput = args.edge_types ?? Object.keys(vocabulary.edges);
        const filteredEdgeTypes = filterEdgeTypes(edgeTypesInput, permissions);
        const result = await memNeighbours(store, { ...args, edge_types: filteredEdgeTypes }, vocabulary);
        return JSON.stringify(filterNeighbourResult(result, permissions));
      } catch (err) { return errorJson(err); }
    },
  });
}
function createQueryTool(tool) {
  return tool({
    description: 'Arbitrary read-only Cozo Datalog query. Rejects :put, :rm, :create, ::remove. Returns {headers, rows}.',
    args: { datalog: tool.schema.string().describe('Cozo Datalog query (read-only)') },
    async execute(args, context) {
      try {
        const { store, vocabulary, permissions } = await withStore(context);
        if (permissions) {
          const allowed = new Set([
            ...[...permissions.readTypes].map((t) => `ent_${t}`),
            ...Object.keys(vocabulary.edges).filter((e) => checkEdgeRead(permissions, e)).map((e) => `edge_${e}`),
          ]);
          const referenced = referencedStoredRelations(args.datalog);
          for (const r of referenced) {
            if (!allowed.has(r)) {
              return errorJson(new Error(`cycle '${context.cycle}' cannot query relation '${r}' (not in read permissions)`));
            }
          }
        }
        const out = await runQuery(store, args.datalog);
        return JSON.stringify(out);
      } catch (err) { return errorJson(err); }
    },
  });
}
function createSearchTool(tool) {
  return tool({
    description: 'Semantic nearest-neighbour search over entity values. Requires embeddings enabled. Performance: fetches k results from each entity type then merges to global top-k (N×k amplification). Use type_filter to limit search to specific types when possible.',
    args: {
      query_text: tool.schema.string(),
      k: tool.schema.number().optional().describe('Default 5'),
      type_filter: tool.schema.array(tool.schema.string()).optional(),
    },
    async execute(args, context) {
      try {
        validateSearchK(args.k);
        const { store, permissions, embedder, vocabulary } = await withStore(context);
        if (!embedder) return errorJson(new Error('embeddings are disabled in memory config'));
        const types = resolveSearchTypes(args.type_filter, permissions, vocabulary);
        const out = await memSearch({
          store, query_text: args.query_text, k: args.k ?? 5, type_filter: types, embedder,
        });
        return JSON.stringify(out);
      } catch (err) { return errorJson(err); }
    },
  });
}
export function createMemoryTools({ tool }) {
  return {
    foundry_memory_put: createPutTool(tool), foundry_memory_relate: createRelateTool(tool),
    foundry_memory_unrelate: createUnrelateTool(tool), foundry_memory_get: createGetTool(tool),
    foundry_memory_list: createListTool(tool), foundry_memory_neighbours: createNeighboursTool(tool),
    foundry_memory_query: createQueryTool(tool), foundry_memory_search: createSearchTool(tool),
  };
}
