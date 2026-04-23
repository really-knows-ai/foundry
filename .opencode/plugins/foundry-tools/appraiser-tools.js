import { selectAppraisers } from '../../../scripts/lib/config.js';
import { makeIO } from './helpers.js';

export function createAppraiserTools({ tool }) {
  return {
    foundry_appraisers_select: tool({
      description: 'Select appraisers for an artefact type',
      args: {
        typeId: tool.schema.string().describe('Artefact type ID'),
        count: tool.schema.number().optional().describe('Number of appraisers to select'),
      },
      async execute(args, context) {
        const io = makeIO(context.worktree);
        const result = args.count
          ? await selectAppraisers('foundry', args.typeId, args.count, io)
          : await selectAppraisers('foundry', args.typeId, io);
        return JSON.stringify(result);
      },
    }),
  };
}
