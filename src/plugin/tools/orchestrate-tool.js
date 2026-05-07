import path from 'path';
import { execFileSync } from 'child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'fs';
import { signToken } from '../../scripts/lib/token.js';
import { readOrCreateSecret } from '../../scripts/lib/secret.js';
import { getCycleDefinition, getArtefactType } from '../../scripts/lib/config.js';
import { addArtefactRow } from '../../scripts/lib/artefacts.js';
import { stageBaseOf } from '../../scripts/lib/stage-guard.js';
import { finalizeStage } from '../../scripts/lib/finalize.js';
import { commitWithPolicy } from '../../scripts/lib/git-bridge.js';
import { makeIO, makeExec, buildCyclePromptExtras } from './helpers.js';
import { requireNotFailed } from '../../scripts/lib/failed-flow.js';
import { requireOnFlowBranch } from '../../scripts/lib/branch-guard.js';

export function createOrchestrateTool({ tool, pending }) {
  return {
    foundry_orchestrate: tool({
      description: 'Run the next step of the current cycle. Call with no args on first invocation; call with lastResult={ok,error?} after a dispatch/human_appraise completes. Returns {action, ...} describing what the caller should do next.',
      args: {
        lastResult: tool.schema.object({
          ok: tool.schema.boolean(),
          error: tool.schema.string().optional(),
        }).optional(),
        cycleDef: tool.schema.string().optional().describe('Test-mode cycle definition override (path to cycle file)'),
      },
      async execute(args, context) {
        const { runOrchestrate } = await import('../../scripts/orchestrate.js');
        const io = makeIO(context.worktree);
        const cwd = context.worktree;
        // Load secret from the execution-time worktree, not boot-time directory.
        const secret = readOrCreateSecret(context.worktree);

        try {
          // Branch guard. Kept inline because the orchestrate tool surfaces all errors through its violation
          // envelope (see comment on the failed-flow guard below). A
          // wrong-branch refusal is a more fundamental error than failed
          // flow, so it runs first.
          const branchGuard = requireOnFlowBranch({ exec: makeExec(cwd) });
          if (!branchGuard.ok) return JSON.stringify({ error: `foundry_orchestrate: ${branchGuard.error}` });

          // Failed-flow guard. Kept inline to preserve the violation envelope.
          // because requireNotFailed parses WORK.md frontmatter, which throws
          // on malformed YAML. The surrounding try/catch (line 30) converts
          // that throw into a violation-shaped envelope per the contract
          // exercised by tests/plugin/orchestrate-wrapper.test.js. A guarded()
          // wrapper would let the throw escape to a plain { error } envelope
          // and break that contract. orchestrate-tool is the one Phase 1.5
          // exception to the inline-gate refactor.
          const failedGuard = requireNotFailed(io);
          if (!failedGuard.ok) return JSON.stringify({ error: `foundry_orchestrate: ${failedGuard.error}` });

          // Mint signed dispatch tokens for orchestrator routes.
          const mint = ({ route, cycle, exp }) => {
            const nonce = randomUUID();
            const payload = { route, cycle, nonce, exp };
            pending.add(nonce, payload);
            return signToken(payload, secret);
          };

          // Git bridge: stage ONLY the files allowed for the current phase
          // (tool-managed workfiles plus `allowedPatterns`) and commit. If the
          // worktree contains anything else, throws UnexpectedFilesError so the
          // orchestrator surfaces a `violation` action without committing.
          const runGit = (argv) => execFileSync('git', argv, { cwd, encoding: 'utf8' });
          const git = {
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

          // Finalize bridge: load the cycle definition and finalise the stage.
          const finalize = async ({ cycleId, stage, baseSha }) => {
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
                // Surface as a typed finalize error and avoid falling back to
                // empty filePatterns. The fallback would let the forge-written
                // artefact file resurface as a misleading `unexpected_files`
                // violation, hiding the actual cause: a missing or malformed
                // artefact-type definition.
                return {
                  ok: false,
                  error: `missing_artefact_type: ${outputType} (${e.message})`,
                };
              }
            }
            const workPath = path.join(cwd, 'WORK.md');
            const result = finalizeStage({
              cwd,
              baseSha,
              stageBase: stageBaseOf(stage),
              cycleDef,
              artefactTypes,
              io,
              registerArtefact: ({ file, type, status }) => {
                const text = readFileSync(workPath, 'utf-8');
                const updated = addArtefactRow(text, { file, type, cycle: cycleId, status });
                writeFileSync(workPath, updated, 'utf-8');
              },
            });
            return result;
          };

          const result = await runOrchestrate({
            cwd, cycleDef: args.cycleDef, git, mint, finalize,
            now: () => Date.now(),
            lastResult: args.lastResult ?? null,
          }, io);
          // Inject memory vocabulary block into dispatch prompt, if any.
          if (result && result.action === 'dispatch' && typeof result.prompt === 'string') {
            const cycleId = result.cycle ?? (typeof result.stage === 'string' ? result.stage.split(':')[1] : null);
            const extras = await buildCyclePromptExtras({ worktree: cwd, cycleId, stage: result.stage });
            if (extras) {
              result.prompt = `${result.prompt}\n\n${extras}`;
            }
          }
          return JSON.stringify(result);
        } catch (e) {
          return JSON.stringify({ action: 'violation', details: `orchestrate threw: ${e.message}`, recoverable: false, affected_files: [] });
        }
      },
    }),
  };
}
