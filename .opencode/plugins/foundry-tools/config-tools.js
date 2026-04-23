import { getCycleDefinition, getArtefactType, getLaws, getValidation, getAppraisers, getFlow } from '../../../scripts/lib/config.js';
import { makeIO } from './helpers.js';

export function createConfigTools({ tool }) {
  return {
    foundry_config_cycle: tool({
      description: 'Get a cycle definition from foundry config',
      args: {
        cycleId: tool.schema.string().describe('Cycle ID'),
      },
      async execute(args, context) {
        const io = makeIO(context.worktree);
        const result = await getCycleDefinition('foundry', args.cycleId, io);
        return JSON.stringify(result);
      },
    }),

    foundry_config_artefact_type: tool({
      description: 'Get an artefact type definition',
      args: {
        typeId: tool.schema.string().describe('Artefact type ID'),
      },
      async execute(args, context) {
        const io = makeIO(context.worktree);
        const result = await getArtefactType('foundry', args.typeId, io);
        return JSON.stringify(result);
      },
    }),

    foundry_config_laws: tool({
      description: 'Get laws, optionally filtered by artefact type',
      args: {
        typeId: tool.schema.string().optional().describe('Artefact type ID'),
      },
      async execute(args, context) {
        const io = makeIO(context.worktree);
        const result = args.typeId
          ? await getLaws('foundry', args.typeId, io)
          : await getLaws('foundry', io);
        return JSON.stringify(result);
      },
    }),

    foundry_config_validation: tool({
      description: 'Get validation commands for an artefact type',
      args: {
        typeId: tool.schema.string().describe('Artefact type ID'),
      },
      async execute(args, context) {
        const io = makeIO(context.worktree);
        const result = await getValidation('foundry', args.typeId, io);
        return JSON.stringify(result);
      },
    }),

    foundry_config_appraisers: tool({
      description: 'List all appraisers',
      args: {},
      async execute(_args, context) {
        const io = makeIO(context.worktree);
        const result = await getAppraisers('foundry', io);
        return JSON.stringify(result);
      },
    }),

    foundry_config_flow: tool({
      description: 'Get a flow definition',
      args: {
        flowId: tool.schema.string().describe('Flow ID'),
      },
      async execute(args, context) {
        const io = makeIO(context.worktree);
        const result = await getFlow('foundry', args.flowId, io);
        return JSON.stringify(result);
      },
    }),
  };
}
