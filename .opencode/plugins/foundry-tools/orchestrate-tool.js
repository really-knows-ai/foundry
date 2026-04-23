import path from 'path';
import { execFileSync } from 'child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'fs';
import { signToken } from '../../../scripts/lib/token.js';
import { getCycleDefinition, getArtefactType } from '../../../scripts/lib/config.js';
import { addArtefactRow } from '../../../scripts/lib/artefacts.js';
import { stageBaseOf } from '../../../scripts/lib/stage-guard.js';
import { finalizeStage } from '../../../scripts/lib/finalize.js';
import { makeIO, buildCyclePromptExtras } from './helpers.js';

export function createOrchestrateTool({ tool, secret, pending }) {
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
        const { runOrchestrate } = await import('../../../scripts/orchestrate.js');
        const io = makeIO(context.worktree);
        const cwd = context.worktree;

        // Mint: same pattern as removed foundry_sort.
        const mint = ({ route, cycle, exp }) => {
          const nonce = randomUUID();
          const payload = { route, cycle, nonce, exp };
          pending.add(nonce, payload);
          return signToken(payload, secret);
        };

        // Git bridge: commit staged changes with a cycle-prefixed message.
        const git = {
          commit: (msg) => {
            execFileSync('git', ['add', '.'], { cwd, encoding: 'utf8' });
            execFileSync('git', ['commit', '-m', msg], { cwd, encoding: 'utf8' });
            return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd, encoding: 'utf8' }).trim();
          },
          status: () => {
            const out = execFileSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf8' }).trim();
            return { clean: out === '', dirty: out.split('\n').filter(Boolean) };
          },
        };

        // Finalize bridge: mimics the deleted foundry_stage_finalize body.
        const finalize = async ({ cycleId, stage, baseSha }) => {
          let cycleDoc;
          try {
            cycleDoc = await getCycleDefinition('foundry', cycleId, io);
          } catch (e) {
            return { ok: false, error: e.message };
          }
          const outputType = cycleDoc.frontmatter.output;
          const cycleDef = { outputArtefactType: outputType };
          const artefactTypes = {};
          if (outputType) {
            try {
              const artDoc = await getArtefactType('foundry', outputType, io);
              artefactTypes[outputType] = { filePatterns: artDoc.frontmatter['file-patterns'] || [] };
            } catch {
              artefactTypes[outputType] = { filePatterns: [] };
            }
          }
          const workPath = path.join(cwd, 'WORK.md');
          const result = finalizeStage({
            cwd,
            baseSha,
            stageBase: stageBaseOf(stage),
            cycleDef,
            artefactTypes,
            registerArtefact: ({ file, type, status }) => {
              const text = readFileSync(workPath, 'utf-8');
              const updated = addArtefactRow(text, { file, type, cycle: cycleId, status });
              writeFileSync(workPath, updated, 'utf-8');
            },
          });
          return result;
        };

        try {
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
