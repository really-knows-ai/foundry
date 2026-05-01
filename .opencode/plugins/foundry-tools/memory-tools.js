import { execFileSync } from 'child_process';
import { putEntity, relate as memRelate, unrelate as memUnrelate } from '../../../scripts/lib/memory/writes.js';
import { getEntity, listEntities, neighbours as memNeighbours } from '../../../scripts/lib/memory/reads.js';
import { runQuery } from '../../../scripts/lib/memory/query.js';
import { checkEntityRead, checkEntityWrite, checkEdgeRead, checkEdgeWrite } from '../../../scripts/lib/memory/permissions.js';
import { search as memSearch } from '../../../scripts/lib/memory/search.js';
import { withStore } from './memory-helpers.js';
import { errorJson, makeIO, branchIoFactory, asyncIoFactory } from './helpers.js';
import { guarded, notFailedGuard } from '../../../scripts/lib/guards.js';
import { requireOnFlowBranch } from '../../../scripts/lib/branch-guard.js';

const gateNotFailed = notFailedGuard(makeIO);
const MAX_NEIGHBOUR_DEPTH = 5;
const MAX_SEARCH_K = 100;

function stripQueryComments(datalog) {
  let out = '';
  let inString = false;
  let quote = '';
  let escaped = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < datalog.length; i += 1) {
    const ch = datalog[i];
    const next = datalog[i + 1];

    if (inLineComment) {
      if (ch === '\n') {
        inLineComment = false;
        out += ch;
      }
      continue;
    }

    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        out += ' ';
        i += 1;
      } else if (ch === '\n') {
        out += ch;
      }
      continue;
    }

    if (inString) {
      out += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === quote) {
        inString = false;
        quote = '';
      }
      continue;
    }

    if (ch === '/' && next === '*') {
      inBlockComment = true;
      i += 1;
      continue;
    }

    if (ch === '#') {
      inLineComment = true;
      continue;
    }

    if (ch === '"' || ch === '\'') {
      inString = true;
      quote = ch;
    }

    out += ch;
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

function makeBranchExec(cwd) {
  return (argv) => execFileSync(argv[0], argv.slice(1), {
    cwd, encoding: 'utf8', stdio: 'pipe',
  });
}
function flowBranchGuard(_args, context) {
  return requireOnFlowBranch({ exec: makeBranchExec(context.worktree) });
}

export function createMemoryTools({ tool }) {
  return {
    foundry_memory_put: tool({
      description: 'Upsert an entity into flow memory. Value must be ≤4KB.',
      args: {
        type: tool.schema.string().describe('Entity type (must be declared)'),
        name: tool.schema.string().describe('Entity name (unique within type)'),
        value: tool.schema.string().describe('Free-text intrinsic description (≤4KB)'),
      },
      execute: guarded('foundry_memory_put', [flowBranchGuard, gateNotFailed], async (args, context) => {
        try {
          const { store, vocabulary, permissions, writeEmbedder, syncIfOutOfCycle } = await withStore(context);
          if (permissions && !checkEntityWrite(permissions, args.type)) {
            return errorJson(new Error(`cycle '${context.cycle}' does not have write permission on entity type '${args.type}'`));
          }
          await putEntity(store, args, vocabulary, { embedder: writeEmbedder });
          await syncIfOutOfCycle();
          return JSON.stringify({ ok: true });
        } catch (err) { return errorJson(err); }
      }, { branchIo: branchIoFactory, io: asyncIoFactory }),
    }),

    foundry_memory_relate: tool({
      description: 'Upsert an edge between two entities.',
      args: {
        from_type: tool.schema.string(),
        from_name: tool.schema.string(),
        edge_type: tool.schema.string(),
        to_type: tool.schema.string(),
        to_name: tool.schema.string(),
      },
      execute: guarded('foundry_memory_relate', [flowBranchGuard, gateNotFailed], async (args, context) => {
        try {
          const { store, vocabulary, permissions, syncIfOutOfCycle } = await withStore(context);
          if (permissions && !checkEdgeWrite(permissions, args.edge_type)) {
            return errorJson(new Error(`cycle '${context.cycle}' does not have write permission on edge type '${args.edge_type}'`));
          }
          await memRelate(store, args, vocabulary);
          await syncIfOutOfCycle();
          return JSON.stringify({ ok: true });
        } catch (err) { return errorJson(err); }
      }, { branchIo: branchIoFactory, io: asyncIoFactory }),
    }),

    foundry_memory_unrelate: tool({
      description: 'Delete an edge between two entities.',
      args: {
        from_type: tool.schema.string(),
        from_name: tool.schema.string(),
        edge_type: tool.schema.string(),
        to_type: tool.schema.string(),
        to_name: tool.schema.string(),
      },
      execute: guarded('foundry_memory_unrelate', [flowBranchGuard, gateNotFailed], async (args, context) => {
        try {
          const { store, vocabulary, permissions, syncIfOutOfCycle } = await withStore(context);
          if (permissions && !checkEdgeWrite(permissions, args.edge_type)) {
            return errorJson(new Error(`cycle '${context.cycle}' does not have write permission on edge type '${args.edge_type}'`));
          }
          await memUnrelate(store, args, vocabulary);
          await syncIfOutOfCycle();
          return JSON.stringify({ ok: true });
        } catch (err) { return errorJson(err); }
      }, { branchIo: branchIoFactory, io: asyncIoFactory }),
    }),

    foundry_memory_get: tool({
      description: 'Fetch a single entity by composite key (type, name).',
      args: {
        type: tool.schema.string(),
        name: tool.schema.string(),
      },
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
    }),

    foundry_memory_list: tool({
      description: 'List all entities of a given type.',
      args: {
        type: tool.schema.string(),
      },
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
    }),

    foundry_memory_neighbours: tool({
      description: 'Bounded graph traversal from an entity. Returns entities and edges within `depth` hops.',
      args: {
        type: tool.schema.string(),
        name: tool.schema.string(),
        depth: tool.schema.number().optional().describe('Default 1'),
        edge_types: tool.schema.array(tool.schema.string()).optional().describe('Restrict traversal to named edges'),
      },
      async execute(args, context) {
        try {
          if ((args.depth ?? 1) > MAX_NEIGHBOUR_DEPTH) {
            throw new Error(`depth must be ≤ ${MAX_NEIGHBOUR_DEPTH}`);
          }
          const { store, vocabulary, permissions } = await withStore(context);
          if (permissions && !checkEntityRead(permissions, args.type)) {
            return JSON.stringify({ entities: [], edges: [] });
          }
          const edgeTypesInput = args.edge_types ?? Object.keys(vocabulary.edges);
          const filteredEdgeTypes = permissions
            ? edgeTypesInput.filter((e) => checkEdgeRead(permissions, e))
            : edgeTypesInput;
          const result = await memNeighbours(store, { ...args, edge_types: filteredEdgeTypes }, vocabulary);
          const filtered = permissions
            ? {
                entities: result.entities.filter((e) => checkEntityRead(permissions, e.type)),
                edges: result.edges.filter((e) =>
                  checkEntityRead(permissions, e.from_type) && checkEntityRead(permissions, e.to_type),
                ),
              }
            : result;
          return JSON.stringify(filtered);
        } catch (err) { return errorJson(err); }
      },
    }),

    foundry_memory_query: tool({
      description: 'Arbitrary read-only Cozo Datalog query. Rejects :put, :rm, :create, ::remove. Returns {headers, rows}.',
      args: {
        datalog: tool.schema.string().describe('Cozo Datalog query (read-only)'),
      },
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
    }),

    foundry_memory_search: tool({
      description: 'Semantic nearest-neighbour search over entity values. Requires embeddings enabled.',
      args: {
        query_text: tool.schema.string(),
        k: tool.schema.number().optional().describe('Default 5'),
        type_filter: tool.schema.array(tool.schema.string()).optional(),
      },
      async execute(args, context) {
        try {
          if ((args.k ?? 5) > MAX_SEARCH_K) {
            throw new Error(`k must be ≤ ${MAX_SEARCH_K}`);
          }
          const { store, permissions, embedder, vocabulary } = await withStore(context);
          if (!embedder) return errorJson(new Error('embeddings are disabled in memory config'));

          let types = args.type_filter && args.type_filter.length > 0
            ? args.type_filter
            : Object.keys(vocabulary.entities);
          if (permissions) types = types.filter((t) => checkEntityRead(permissions, t));

          const out = await memSearch({
            store,
            query_text: args.query_text,
            k: args.k ?? 5,
            type_filter: types,
            embedder,
          });
          return JSON.stringify(out);
        } catch (err) { return errorJson(err); }
      },
    }),
  };
}
