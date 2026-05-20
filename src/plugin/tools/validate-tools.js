import { join } from 'path';
import { makeIO, branchIoFactory, asyncIoFactory, flowBranchGuard } from './helpers.js';
import { guarded, notFailedGuard } from '../../scripts/lib/guards.js';
import { performValidation } from '../../scripts/lib/validation.js';

const gateNotFailed = notFailedGuard(makeIO);

export function createValidateTools({ tool }) {
  return {
    foundry_validate_run: tool({
      description: 'Run validation commands for an artefact type. Returns parsed feedback items per validator with their law and validator IDs so the caller can tag feedback as law:<law-id>:<validator-id>.',
      args: {
        typeId: tool.schema.string().describe('Artefact type ID'),
      },
      execute: guarded('foundry_validate_run', [flowBranchGuard, gateNotFailed],
        executeValidateRun,
        { branchIo: branchIoFactory, io: asyncIoFactory }),
    }),
  };
}

async function executeValidateRun(args, context) {
  try {
    const io = makeIO(context.worktree);
    const foundryDir = join(context.worktree, 'foundry');
    const result = await performValidation({ typeId: args.typeId, io, foundryDir });
    return JSON.stringify(result);
  } catch (err) {
    return JSON.stringify({ ok: false, error: `foundry_validate_run: ${err.message}` });
  }
}

// Re-export for existing tests (validator-command-expansion.test.js)
export { expandValidatorCommand } from '../../scripts/lib/validation.js';
