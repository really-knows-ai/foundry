import { getCycleDefinition, getArtefactType, getLaws, getAppraisers, getFlow } from '../../scripts/lib/config.js';
import { makeIO } from './helpers.js';
import { writeCall } from '../../scripts/lib/stage-calls.js';

function makeConfigTool(tool, description, argSchema, invoke, logName) {
  return tool({
    description,
    args: argSchema,
    async execute(args, context) {
      const io = makeIO(context.worktree);
      const result = await invoke(args, io);
      if (logName) writeCall(io, logName);
      return JSON.stringify(result);
    },
  });
}

export function createConfigTools({ tool }) {
  return {
    foundry_config_read_cycle: makeConfigTool(
      tool, 'Get a cycle definition from foundry config',
      { cycleId: tool.schema.string().describe('Cycle ID') },
      (args, io) => getCycleDefinition('foundry', args.cycleId, io),
      'foundry_config_read_cycle',
    ),
    foundry_config_read_artefact_type: makeConfigTool(
      tool, 'Get an artefact type definition',
      { typeId: tool.schema.string().describe('Artefact type ID') },
      (args, io) => getArtefactType('foundry', args.typeId, io),
      'foundry_config_read_artefact_type',
    ),
    foundry_config_read_laws: makeConfigTool(
      tool, 'Get laws, optionally filtered by artefact type',
      { typeId: tool.schema.string().optional().describe('Artefact type ID') },
      (args, io) => getLaws('foundry', io, { typeId: args.typeId }),
      'foundry_config_read_laws',
    ),
    foundry_config_read_appraisers: makeConfigTool(
      tool, 'List all appraisers',
      {},
      (_args, io) => getAppraisers('foundry', io),
    ),
    foundry_config_read_flow: makeConfigTool(
      tool, 'Get a flow definition',
      { flowId: tool.schema.string().describe('Flow ID') },
      (args, io) => getFlow('foundry', args.flowId, io),
    ),
  };
}
