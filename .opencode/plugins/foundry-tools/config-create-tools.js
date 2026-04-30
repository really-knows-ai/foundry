// Tools for creating and validating the five foundry config kinds:
// artefact-type, law, appraiser, flow, cycle.
//
// `_validate_<kind>` tools are read-only — they parse the supplied body
// and report errors. They run anywhere (no branch guard, no failed-flow
// guard) so authors can iterate on a draft from any branch.
//
// `_create_<kind>` tools mutate the worktree (write the file + commit
// it) and so carry the full guard stack:
//   gitRepo → foundryRoot → configBranch → notFailed
// matching the config-tier policy.

import { execFileSync } from 'child_process';
import { create as createArtefactType } from '../../../scripts/lib/config-creators/artefact-type.js';
import { create as createLaw } from '../../../scripts/lib/config-creators/law.js';
import { create as createAppraiser } from '../../../scripts/lib/config-creators/appraiser.js';
import { create as createFlow } from '../../../scripts/lib/config-creators/flow.js';
import { create as createCycle } from '../../../scripts/lib/config-creators/cycle.js';
import { validate as validateArtefactType } from '../../../scripts/lib/config-validators/artefact-type.js';
import { validate as validateLaw } from '../../../scripts/lib/config-validators/law.js';
import { validate as validateAppraiser } from '../../../scripts/lib/config-validators/appraiser.js';
import { validate as validateFlow } from '../../../scripts/lib/config-validators/flow.js';
import { validate as validateCycle } from '../../../scripts/lib/config-validators/cycle.js';
import { requireGitRepo, requireFoundryRoot } from '../../../scripts/lib/foundational-guards.js';
import { requireOnConfigBranch } from '../../../scripts/lib/branch-guard.js';
import { guarded, notFailedGuard } from '../../../scripts/lib/guards.js';
import { makeIO, makeAsyncIO, errorJson, branchIoFactory, asyncIoFactory } from './helpers.js';

// --- guard helpers ---------------------------------------------------------

function gitRepoGuard(_args, context) {
  return requireGitRepo(makeIO(context.worktree));
}

function foundryRootGuard(_args, context) {
  return requireFoundryRoot(makeIO(context.worktree));
}

function makeBranchExec(cwd) {
  return (argv) => execFileSync(argv[0], argv.slice(1),
    { cwd, encoding: 'utf8', stdio: 'pipe' });
}

function configBranchGuard(_args, context) {
  return requireOnConfigBranch({ exec: makeBranchExec(context.worktree) });
}

const gateNotFailed = notFailedGuard(makeIO);

// `git`-prefixed argv runner that satisfies commitWithPolicy's contract:
// it accepts argv WITHOUT the `git` prefix and prepends it itself.
function makeExecFile(cwd) {
  return (argv) => execFileSync('git', argv, { cwd, encoding: 'utf8', stdio: 'pipe' });
}

const CREATE_GUARDS = [gitRepoGuard, foundryRootGuard, configBranchGuard, gateNotFailed];
const VALIDATE_GUARDS = [gitRepoGuard, foundryRootGuard];

// --- tool factory ---------------------------------------------------------

export function createConfigCreateTools({ tool }) {
  const baseArgs = {
    name: tool.schema.string(),
    body: tool.schema.string(),
  };

  // The plugin schema may not support discriminated unions; accept a
  // permissive object and let the law creator validate the shape.
  const lawTargetSchema = tool.schema.object({
    kind: tool.schema.string(),
    file: tool.schema.string().optional(),
    typeId: tool.schema.string().optional(),
  });

  // Helper to build a create-tool. `creator` is the async create fn.
  // `extraArgs` lets `law` add its `target` parameter.
  function makeCreate(toolName, creator, extraArgs = {}) {
    return tool({
      description: `Create a new ${toolName.replace('foundry_config_create_', '')} definition (config-tier; requires a config/* branch).`,
      args: { ...baseArgs, ...extraArgs },
      execute: guarded(toolName, CREATE_GUARDS, async (args, context) => {
        try {
          const io = makeAsyncIO(context.worktree);
          const execFile = makeExecFile(context.worktree);
          const out = await creator({ ...args, io, execFile });
          return JSON.stringify(out);
        } catch (err) {
          return errorJson(err);
        }
      }, { branchIo: branchIoFactory, io: asyncIoFactory }),
    });
  }

  function makeValidate(toolName, validator) {
    return tool({
      description: `Validate a ${toolName.replace('foundry_config_validate_', '')} body without writing it.`,
      args: baseArgs,
      execute: guarded(toolName, VALIDATE_GUARDS, async (args, context) => {
        try {
          const io = makeAsyncIO(context.worktree);
          const out = await validator({ ...args, io });
          return JSON.stringify(out);
        } catch (err) {
          return errorJson(err);
        }
      }, { branchIo: branchIoFactory, io: asyncIoFactory }),
    });
  }

  return {
    foundry_config_create_artefact_type: makeCreate('foundry_config_create_artefact_type', createArtefactType),
    foundry_config_create_law: makeCreate('foundry_config_create_law', createLaw, {
      target: lawTargetSchema,
    }),
    foundry_config_create_appraiser: makeCreate('foundry_config_create_appraiser', createAppraiser),
    foundry_config_create_flow: makeCreate('foundry_config_create_flow', createFlow),
    foundry_config_create_cycle: makeCreate('foundry_config_create_cycle', createCycle),

    foundry_config_validate_artefact_type: makeValidate('foundry_config_validate_artefact_type', validateArtefactType),
    foundry_config_validate_law: makeValidate('foundry_config_validate_law', validateLaw),
    foundry_config_validate_appraiser: makeValidate('foundry_config_validate_appraiser', validateAppraiser),
    foundry_config_validate_flow: makeValidate('foundry_config_validate_flow', validateFlow),
    foundry_config_validate_cycle: makeValidate('foundry_config_validate_cycle', validateCycle),
  };
}
