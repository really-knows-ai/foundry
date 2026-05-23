import { execFileSync } from 'child_process';
import { randomUUID } from 'node:crypto';
import { signToken } from '../../scripts/lib/token.js';
import { readOrCreateSecret } from '../../scripts/lib/secret.js';
import { getCycleDefinition, getArtefactType } from '../../scripts/lib/config.js';
import { stageBaseOf } from '../../scripts/lib/stage-guard.js';
import { finalizeStage } from '../../scripts/lib/finalize.js';
import { commitWithPolicy } from '../../scripts/lib/git-bridge.js';
import { makeIO, makeExec, buildCyclePromptExtras } from './helpers.js';
import { requireNotFailed } from '../../scripts/lib/failed-flow.js';
import { requireOnFlowBranch } from '../../scripts/lib/branch-guard.js';

function createMint(secret, pending) {
  return ({ route, cycle, exp }) => {
    const nonce = randomUUID();
    const payload = { route, cycle, nonce, exp };
    pending.add(nonce, payload);
    return signToken(payload, secret);
  };
}

function createGitBridge(cwd) {
  const runGit = (argv) => execFileSync('git', argv, { cwd, encoding: 'utf8' });
  return {
    commit: (msg, opts = {}) => {
      const sha = commitWithPolicy({
        message: msg,
        allowedPatterns: opts.allowedPatterns ?? [],
        execFile: runGit,
      });
      return sha;
    },
    status: () => {
      const out = execFileSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf8' }).trim();
      return { clean: out === '', dirty: out.split('\n').filter(Boolean) };
    },
  };
}

async function createFinalize(cwd, io) {
  return async ({ cycleId, stage, baseSha }) => {
    let cycleDoc;
    try {
      cycleDoc = await getCycleDefinition('foundry', cycleId, io);
    } catch (e) {
      return { ok: false, error: e.message };
    }
    const outputType = cycleDoc.frontmatter['output-type'];
    const cycleDef = { outputArtefactType: outputType };
    const artefactTypes = {};
    if (outputType) {
      try {
        const artDoc = await getArtefactType('foundry', outputType, io);
        artefactTypes[outputType] = { filePatterns: artDoc.frontmatter['file-patterns'] || [] };
      } catch (e) {
        return {
          ok: false,
          error: `missing_artefact_type: ${outputType} (${e.message})`,
        };
      }
    }
    const result = finalizeStage({
      cwd,
      baseSha,
      stageBase: stageBaseOf(stage),
      cycleDef,
      artefactTypes,
      io,
    });
    return result;
  };
}

function getCycleId(result) {
  if (result.cycle) return result.cycle;
  if (typeof result.stage !== 'string') return null;
  return result.stage.split(':')[1];
}

async function injectDispatchPromptExtras(result, cwd) {
  if (!result) return;
  if (result.action !== 'dispatch') return;
  if (typeof result.prompt !== 'string') return;
  const cycleId = getCycleId(result);
  const extras = await buildCyclePromptExtras({ worktree: cwd, cycleId, stage: result.stage });
  if (!extras) return;
  result.prompt = `${result.prompt}\n\n${extras}`;
}

function buildOrchestrateArgs(tool) {
  return {
    lastResult: tool.schema.object({
      ok: tool.schema.boolean(),
      error: tool.schema.string().optional(),
    }).optional().describe('Result of a single-subagent dispatch or human-appraise stage'),
    lastResults: tool.schema.array(tool.schema.object({
      ok: tool.schema.boolean(),
      output: tool.schema.string().optional(),
      error: tool.schema.string().optional(),
    })).optional().describe('Results of a dispatch_multi (appraise) — one entry per completed appraiser task'),
    cycleDef: tool.schema.string().optional().describe('Test-mode cycle definition override (path to cycle file)'),
    baseBranch: tool.schema.string().optional().describe('Git base branch for artefact diff comparison (default "main")'),
    defaultModel: tool.schema.string().optional().describe('Fallback model for stages with no explicit model in the cycle definition (e.g. "opencode-go/deepseek-v4-flash")'),
  };
}

export function createOrchestrateTool({ tool, pending }) {
  return {
    foundry_orchestrate: tool({
      description: 'Run the next step of the current cycle. Call with no args on first invocation. After a dispatch or human_appraise, pass lastResult={ok,error?}. After a dispatch_multi (appraise), pass lastResults as an array of {ok,output?,error?} — one entry per completed task. Returns {action, ...} describing what the caller should do next.',
      args: buildOrchestrateArgs(tool),

      async execute(args, context) {
        const { runOrchestrate } = await import('../../scripts/orchestrate.js');
        const io = makeIO(context.worktree);
        const cwd = context.worktree;
        const secret = readOrCreateSecret(context.worktree);

        try {
          const branchGuard = requireOnFlowBranch({ exec: makeExec(cwd) });
          if (!branchGuard.ok) return JSON.stringify({ error: `foundry_orchestrate: ${branchGuard.error}` });

          const failedGuard = requireNotFailed(io);
          if (!failedGuard.ok) return JSON.stringify({ error: `foundry_orchestrate: ${failedGuard.error}` });

          const mint = createMint(secret, pending);
          const git = createGitBridge(cwd);
          const finalize = await createFinalize(cwd, io);

          const result = await runOrchestrate({
            cwd, cycleDef: args.cycleDef, git, mint, finalize,
            now: () => Date.now(),
            lastResult: args.lastResult,
            lastResults: args.lastResults,
            baseBranch: args.baseBranch,
            defaultModel: args.defaultModel,
          }, io);

          await injectDispatchPromptExtras(result, cwd);

          return JSON.stringify(result);
        } catch (e) {
          return JSON.stringify({ action: 'violation', details: `orchestrate threw: ${e.message}`, recoverable: false, affected_files: [] });
        }
      },
    }),
  };
}
