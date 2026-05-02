import { selectAppraisers } from '../../../scripts/lib/config.js';
import { makeIO, branchIoFactory, asyncIoFactory, flowBranchGuard } from './helpers.js';
import { guarded, notFailedGuard } from '../../../scripts/lib/guards.js';

const gateNotFailed = notFailedGuard(makeIO);

export function createAppraiserTools({ tool }) {
  return {
    foundry_appraisers_select: tool({
      description: 'Select appraisers for an artefact type',
      args: {
        typeId: tool.schema.string().describe('Artefact type ID'),
        count: tool.schema.number().optional().describe('Number of appraisers to select'),
      },
      // Flow-tier mutation per SPEC §6: appraiser selection mutates the
      // dispatch state of the in-flight cycle. Branch guard runs before
      // failed-flow gate so wrong-branch refusals win over failed-state.
      execute: guarded('foundry_appraisers_select', [flowBranchGuard, gateNotFailed], async (args, context) => {
        const io = makeIO(context.worktree);
        const result = args.count
          ? await selectAppraisers('foundry', args.typeId, args.count, io)
          : await selectAppraisers('foundry', args.typeId, io);
        return JSON.stringify(result);
      }, { branchIo: branchIoFactory, io: asyncIoFactory }),
    }),
  };
}
