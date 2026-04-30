import { execFileSync } from 'child_process';
import { selectAppraisers } from '../../../scripts/lib/config.js';
import { makeIO } from './helpers.js';
import { guarded, notFailedGuard } from '../../../scripts/lib/guards.js';
import { requireOnFlowBranch } from '../../../scripts/lib/branch-guard.js';

const gateNotFailed = notFailedGuard(makeIO);

function makeBranchExec(cwd) {
  return (argv) => execFileSync(argv[0], argv.slice(1), {
    cwd, encoding: 'utf8', stdio: 'pipe',
  });
}
function flowBranchGuard(_args, context) {
  return requireOnFlowBranch({ exec: makeBranchExec(context.worktree) });
}

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
      }),
    }),
  };
}
