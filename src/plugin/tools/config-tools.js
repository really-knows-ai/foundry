import { getCycleDefinition, getArtefactType, getLaws, getAppraisers, getFlow } from '../../scripts/lib/config.js';
import { guarded } from '../../scripts/lib/guards.js';
import { makeIO, branchIoFactory, asyncIoFactory } from './helpers.js';
import { writeCall } from '../../scripts/lib/stage-calls.js';

function makeConfigTool(tool, opts) {
  const { toolName, description, argSchema, invoke, logName } = opts;
  return tool({
    description,
    args: argSchema,
    execute: guarded(toolName, [], async (args, context) => {
      const io = makeIO(context.worktree);
      const result = await invoke(args, io);
      if (logName) writeCall(io, logName);
      return JSON.stringify(result);
    }, { branchIo: branchIoFactory, io: asyncIoFactory }),
  });
}

export function createConfigTools({ tool }) {
  return {
    foundry_config_read_cycle: makeConfigTool(tool, {
      toolName: 'foundry_config_read_cycle',
      description: 'Get a cycle definition from foundry config',
      argSchema: { cycleId: tool.schema.string().describe('Cycle ID') },
      invoke: (args, io) => getCycleDefinition('foundry', args.cycleId, io),
      logName: 'foundry_config_read_cycle',
    }),
    foundry_config_read_artefact_type: makeConfigTool(tool, {
      toolName: 'foundry_config_read_artefact_type',
      description: 'Get an artefact type definition',
      argSchema: { typeId: tool.schema.string().describe('Artefact type ID') },
      invoke: (args, io) => getArtefactType('foundry', args.typeId, io),
      logName: 'foundry_config_read_artefact_type',
    }),
    foundry_config_read_laws: makeConfigTool(tool, {
      toolName: 'foundry_config_read_laws',
      description: 'Get laws, optionally filtered by artefact type',
      argSchema: { typeId: tool.schema.string().optional().describe('Artefact type ID') },
      invoke: (args, io) => getLaws('foundry', io, { typeId: args.typeId }),
      logName: 'foundry_config_read_laws',
    }),
    foundry_config_read_appraisers: makeConfigTool(tool, {
      toolName: 'foundry_config_read_appraisers',
      description: 'List all appraisers',
      argSchema: {},
      invoke: (_args, io) => getAppraisers('foundry', io),
    }),
    foundry_config_read_flow: makeConfigTool(tool, {
      toolName: 'foundry_config_read_flow',
      description: 'Get a flow definition',
      argSchema: { flowId: tool.schema.string().describe('Flow ID') },
      invoke: (args, io) => getFlow('foundry', args.flowId, io),
    }),
  };
}
