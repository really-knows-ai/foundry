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
import { create as createArtefactType } from '../../scripts/lib/config-creators/artefact-type.js';
import { create as createAppraiser } from '../../scripts/lib/config-creators/appraiser.js';
import { create as createFlow } from '../../scripts/lib/config-creators/flow.js';
import { create as createCycle } from '../../scripts/lib/config-creators/cycle.js';
import { validate as validateArtefactType } from '../../scripts/lib/config-validators/artefact-type.js';
import { validate as validateLaw } from '../../scripts/lib/config-validators/law.js';
import { validate as validateAppraiser } from '../../scripts/lib/config-validators/appraiser.js';
import { validate as validateFlow } from '../../scripts/lib/config-validators/flow.js';
import { validate as validateCycle } from '../../scripts/lib/config-validators/cycle.js';
import { requireGitRepo, requireFoundryRoot } from '../../scripts/lib/foundational-guards.js';
import { requireOnConfigBranch } from '../../scripts/lib/branch-guard.js';
import { guarded, notFailedGuard } from '../../scripts/lib/guards.js';
import { UnexpectedFilesError } from '../../scripts/lib/git-bridge.js';
import { makeIO, makeExec, makeAsyncIO, errorJson, branchIoFactory, asyncIoFactory } from './helpers.js';

// --- guard helpers ---------------------------------------------------------

function gitRepoGuard(_args, context) {
  return requireGitRepo(makeIO(context.worktree));
}

function foundryRootGuard(_args, context) {
  return requireFoundryRoot(makeIO(context.worktree));
}

function configBranchGuard(_args, context) {
  return requireOnConfigBranch({ exec: makeExec(context.worktree) });
}

const gateNotFailed = notFailedGuard(makeIO);

// `git`-prefixed argv runner that satisfies commitWithPolicy's contract:
// it accepts argv WITHOUT the `git` prefix and prepends it itself.
function makeExecFile(cwd) {
  return (argv) => execFileSync('git', argv, { cwd, encoding: 'utf8', stdio: 'pipe' });
}

const CREATE_GUARDS = [gitRepoGuard, foundryRootGuard, configBranchGuard, gateNotFailed];
const VALIDATE_GUARDS = [gitRepoGuard, foundryRootGuard];

// --- tool factories --------------------------------------------------------

// Module-level helper: returns a `makeCreate` function bound to `tool` and `baseArgs`.
function createMakeCreate(tool, baseArgs) {
  return function makeCreate(toolName, creator, extraArgs = {}) {
    const kind = toolName.replace('foundry_config_create_', '');
    let desc = `Create a new ${kind} definition (config-tier; requires a config/* branch).`;

    if (kind === 'law') {
      desc += ' target must be {kind:"global", file:"<name>.md"} or {kind:"type-specific", typeId:"<id>"}.';
    }

    return tool({
      description: desc,
      args: { ...baseArgs, ...extraArgs },
      execute: guarded(toolName, CREATE_GUARDS, async (args, context) => {
        try {
          const io = makeAsyncIO(context.worktree);
          const execFile = makeExecFile(context.worktree);
          const out = await creator({ ...args, io, execFile });
          return JSON.stringify(out);
        } catch (err) {
          if (err instanceof UnexpectedFilesError) {
            return JSON.stringify({ error: err.message, affected_files: err.files });
          }
          return errorJson(err);
        }
      }, { branchIo: branchIoFactory, io: asyncIoFactory }),
    });
  };
}

// Module-level helper: returns a `makeValidate` function bound to `tool` and `baseArgs`.
function createMakeValidate(tool, baseArgs) {
  return function makeValidate(toolName, validator) {
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
  };
}

// --- tool factory ---------------------------------------------------------

export function createConfigCreateTools({ tool }) {
  const baseArgs = {
    name: tool.schema.string(),
    body: tool.schema.string(),
  };

  const makeCreate = createMakeCreate(tool, baseArgs);
  const makeValidate = createMakeValidate(tool, baseArgs);

  return {
    foundry_config_create_artefact_type: makeCreate('foundry_config_create_artefact_type', createArtefactType),
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
