import { getCycleDefinition, getArtefactType, getLaws, getValidation, getAppraisers, getFlow } from '../../scripts/lib/config.js';
import { makeIO } from './helpers.js';

function makeConfigTool(tool, description, argSchema, invoke) {
  return tool({
    description,
    args: argSchema,
    async execute(args, context) {
      const io = makeIO(context.worktree);
      return JSON.stringify(await invoke(args, io));
    },
  });
}

export function createConfigTools({ tool }) {
  return {
    foundry_config_cycle: makeConfigTool(
      tool, 'Get a cycle definition from foundry config',
      { cycleId: tool.schema.string().describe('Cycle ID') },
      (args, io) => getCycleDefinition('foundry', args.cycleId, io),
    ),
    foundry_config_artefact_type: makeConfigTool(
      tool, 'Get an artefact type definition',
      { typeId: tool.schema.string().describe('Artefact type ID') },
      (args, io) => getArtefactType('foundry', args.typeId, io),
    ),
    foundry_config_laws: makeConfigTool(
      tool, 'Get laws, optionally filtered by artefact type',
      { typeId: tool.schema.string().optional().describe('Artefact type ID') },
      (args, io) => getLaws('foundry', io, { typeId: args.typeId }),
    ),
    foundry_config_validation: makeConfigTool(
      tool, 'Get validation commands for an artefact type',
      { typeId: tool.schema.string().describe('Artefact type ID') },
      (args, io) => getValidation('foundry', args.typeId, io),
    ),
    foundry_config_appraisers: makeConfigTool(
      tool, 'List all appraisers',
      {},
      (_args, io) => getAppraisers('foundry', io),
    ),
    foundry_config_flow: makeConfigTool(
      tool, 'Get a flow definition',
      { flowId: tool.schema.string().describe('Flow ID') },
      (args, io) => getFlow('foundry', args.flowId, io),
    ),
  };
}
