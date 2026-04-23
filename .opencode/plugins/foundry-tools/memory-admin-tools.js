import path from 'path';
import { createEntityType as admCreateEntity } from '../../../scripts/lib/memory/admin/create-entity-type.js';
import { createExtractor as admCreateExtractor } from '../../../scripts/lib/memory/admin/create-extractor.js';
import { createEdgeType as admCreateEdge } from '../../../scripts/lib/memory/admin/create-edge-type.js';
import { renameEntityType as admRenameEntity } from '../../../scripts/lib/memory/admin/rename-entity-type.js';
import { renameEdgeType as admRenameEdge } from '../../../scripts/lib/memory/admin/rename-edge-type.js';
import { dropEntityType as admDropEntity } from '../../../scripts/lib/memory/admin/drop-entity-type.js';
import { dropEdgeType as admDropEdge } from '../../../scripts/lib/memory/admin/drop-edge-type.js';
import { resetMemory as admReset } from '../../../scripts/lib/memory/admin/reset.js';
import { validateMemory as admValidate } from '../../../scripts/lib/memory/admin/validate.js';
import { dumpMemory as admDump } from '../../../scripts/lib/memory/admin/dump.js';
import { vacuumMemory as admVacuum } from '../../../scripts/lib/memory/admin/vacuum.js';
import { reembed as admReembed } from '../../../scripts/lib/memory/admin/reembed.js';
import { initMemory as admInitMemory } from '../../../scripts/lib/memory/admin/init.js';
import { loadMemoryConfig, writeMemoryConfig } from '../../../scripts/lib/memory/config.js';
import { embed as memEmbed, probeEmbeddings as memProbeEmbeddings } from '../../../scripts/lib/memory/embeddings.js';
import { withStore } from './memory-helpers.js';
import { makeMemoryIO, errorJson } from './helpers.js';

export function createMemoryAdminTools({ tool }) {
  return {
    foundry_memory_create_entity_type: tool({
      description: 'Create a new entity type with a prose body brief.',
      args: {
        name: tool.schema.string(),
        body: tool.schema.string(),
      },
      async execute(args, context) {
        try {
          const io = makeMemoryIO(context.worktree);
          const out = await admCreateEntity({ worktreeRoot: context.worktree, io, ...args });
          return JSON.stringify(out);
        } catch (err) { return errorJson(err); }
      },
    }),
    foundry_extractor_create: tool({
      description: 'Create a new extractor definition under foundry/memory/extractors/.',
      args: {
        name: tool.schema.string(),
        command: tool.schema.string(),
        memoryWrite: tool.schema.array(tool.schema.string()),
        body: tool.schema.string(),
        timeout: tool.schema.string().optional(),
      },
      async execute(args, context) {
        try {
          const io = makeMemoryIO(context.worktree);
          const out = await admCreateExtractor({ worktreeRoot: context.worktree, io, ...args });
          return JSON.stringify(out);
        } catch (err) { return errorJson(err); }
      },
    }),
    foundry_memory_create_edge_type: tool({
      description: 'Create a new edge type.',
      args: {
        name: tool.schema.string(),
        sources: tool.schema.union([tool.schema.literal('any'), tool.schema.array(tool.schema.string())]),
        targets: tool.schema.union([tool.schema.literal('any'), tool.schema.array(tool.schema.string())]),
        body: tool.schema.string(),
      },
      async execute(args, context) {
        try {
          const io = makeMemoryIO(context.worktree);
          const out = await admCreateEdge({ worktreeRoot: context.worktree, io, ...args });
          return JSON.stringify(out);
        } catch (err) { return errorJson(err); }
      },
    }),
    foundry_memory_rename_entity_type: tool({
      description: 'Rename an entity type and cascade updates to edges and rows.',
      args: { from: tool.schema.string(), to: tool.schema.string() },
      async execute(args, context) {
        try {
          const io = makeMemoryIO(context.worktree);
          const out = await admRenameEntity({ worktreeRoot: context.worktree, io, ...args });
          return JSON.stringify(out);
        } catch (err) { return errorJson(err); }
      },
    }),
    foundry_memory_rename_edge_type: tool({
      description: 'Rename an edge type.',
      args: { from: tool.schema.string(), to: tool.schema.string() },
      async execute(args, context) {
        try {
          const io = makeMemoryIO(context.worktree);
          const out = await admRenameEdge({ worktreeRoot: context.worktree, io, ...args });
          return JSON.stringify(out);
        } catch (err) { return errorJson(err); }
      },
    }),
    foundry_memory_drop_entity_type: tool({
      description:
        'Destructive. Delete an entity type and cascade to affected edges. Call without confirm (or confirm:false) to get a preview of what would be deleted. Pass confirm:true to actually drop.',
      args: { name: tool.schema.string(), confirm: tool.schema.boolean().optional() },
      async execute(args, context) {
        try {
          const io = makeMemoryIO(context.worktree);
          const out = await admDropEntity({ worktreeRoot: context.worktree, io, ...args });
          return JSON.stringify(out);
        } catch (err) { return errorJson(err); }
      },
    }),
    foundry_memory_drop_edge_type: tool({
      description:
        'Destructive. Delete an edge type. Call without confirm (or confirm:false) to preview row count. Pass confirm:true to actually drop.',
      args: { name: tool.schema.string(), confirm: tool.schema.boolean().optional() },
      async execute(args, context) {
        try {
          const io = makeMemoryIO(context.worktree);
          const out = await admDropEdge({ worktreeRoot: context.worktree, io, ...args });
          return JSON.stringify(out);
        } catch (err) { return errorJson(err); }
      },
    }),
    foundry_memory_reset: tool({
      description: 'Destructive. Purge all memory data (keeps type definitions). Requires confirm: true.',
      args: { confirm: tool.schema.boolean() },
      async execute(args, context) {
        try {
          const io = makeMemoryIO(context.worktree);
          const out = await admReset({ worktreeRoot: context.worktree, io, ...args });
          return JSON.stringify(out);
        } catch (err) { return errorJson(err); }
      },
    }),
    foundry_memory_validate: tool({
      description: 'Run load-time and drift checks; returns a report.',
      args: {},
      async execute(_args, context) {
        try {
          const io = makeMemoryIO(context.worktree);
          return JSON.stringify(await admValidate({ io }));
        } catch (err) { return errorJson(err); }
      },
    }),
    foundry_memory_init: tool({
      description:
        'Scaffold foundry/memory/: creates entities/edges/relations dirs with .gitkeep, writes config.md and schema.json, appends .gitignore entries, and optionally probes the embedding provider. Fails if foundry/memory/ already exists.',
      args: {
        embeddings_enabled: tool.schema.boolean().optional(),
        probe: tool.schema.boolean().optional(),
      },
      async execute(args, context) {
        try {
          const io = makeMemoryIO(context.worktree);
          const out = await admInitMemory({
            io,
            embeddingsEnabled: args.embeddings_enabled ?? true,
            probe: args.probe ?? true,
          });
          return JSON.stringify(out);
        } catch (err) { return errorJson(err); }
      },
    }),
    foundry_memory_dump: tool({
      description: 'Human-readable snapshot of memory. Optional type + name.',
      args: {
        type: tool.schema.string().optional(),
        name: tool.schema.string().optional(),
        depth: tool.schema.number().optional(),
      },
      async execute(args, context) {
        try {
          const { store, vocabulary } = await withStore(context);
          return await admDump({ store, vocabulary, ...args });
        } catch (err) { return errorJson(err); }
      },
    }),
    foundry_memory_vacuum: tool({
      description: 'Compact the Cozo database.',
      args: {},
      async execute(_args, context) {
        try {
          const { store } = await withStore(context);
          return JSON.stringify(await admVacuum({ store }));
        } catch (err) { return errorJson(err); }
      },
    }),
    foundry_memory_change_embedding_model: tool({
      description: 'Swap the embedding model and re-embed all existing entities.',
      args: {
        model: tool.schema.string(),
        dimensions: tool.schema.number(),
        baseURL: tool.schema.string().optional(),
        apiKey: tool.schema.string().optional(),
      },
      async execute(args, context) {
        try {
          const io = makeMemoryIO(context.worktree);
          // Load config fresh from disk: the singleton context is only
          // populated once a store is opened, which isn't guaranteed here.
          const currentConfig = await loadMemoryConfig('foundry', io);
          const baseConfig = currentConfig.embeddings;
          const newConfig = {
            ...baseConfig,
            enabled: true,
            model: args.model,
            dimensions: args.dimensions,
            baseURL: args.baseURL ?? baseConfig.baseURL,
            apiKey: args.apiKey ?? baseConfig.apiKey,
          };
          const probe = await memProbeEmbeddings({ config: newConfig });
          if (!probe.ok) return errorJson(new Error(`probe failed: ${probe.error}`));
          if (probe.dimensions !== args.dimensions) {
            return errorJson(new Error(`provider returned ${probe.dimensions}-dim vectors, config declares ${args.dimensions}`));
          }
          const dbAbsolutePath = path.join(context.worktree, 'foundry/memory/memory.db');
          const embedder = (inputs) => memEmbed({ config: newConfig, inputs });
          const out = await admReembed({
            worktreeRoot: context.worktree,
            io, dbAbsolutePath,
            newModel: args.model,
            newDimensions: args.dimensions,
            embedder,
          });
          // Persist the new embeddings block to config.md so a subsequent
          // session (which re-reads config from disk) stays in sync with
          // schema.json. Only runs on successful reembed.
          await writeMemoryConfig('foundry', { embeddings: newConfig }, io);
          return JSON.stringify(out);
        } catch (err) { return errorJson(err); }
      },
    }),
  };
}
