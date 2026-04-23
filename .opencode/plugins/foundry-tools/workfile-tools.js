import path from 'path';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { requireNoActiveStage } from '../../../scripts/lib/stage-guard.js';
import { parseFrontmatter, createWorkfile, enrichStages, parseModelsValue } from '../../../scripts/lib/workfile.js';
import { makeIO } from './helpers.js';

export function createWorkfileTools({ tool }) {
  return {
    foundry_workfile_create: tool({
      description: 'Create WORK.md with frontmatter and goal',
      args: {
        flow: tool.schema.string().describe('Flow name'),
        cycle: tool.schema.string().describe('Cycle name'),
        stages: tool.schema.array(tool.schema.string()).optional().describe('Ordered stage names'),
        maxIterations: tool.schema.number().optional().describe('Maximum iterations'),
        goal: tool.schema.string().describe('Goal text'),
        models: tool.schema.string().optional().describe('Per-stage model overrides as JSON object, e.g. \'{"forge":"openai/gpt-4o"}\''),
      },
      async execute(args, context) {
        const io = makeIO(context.worktree);
        const guard = requireNoActiveStage(io);
        if (!guard.ok) return JSON.stringify({ error: `foundry_workfile_create ${guard.error}` });
        const workPath = path.join(context.worktree, 'WORK.md');
        if (existsSync(workPath)) {
          return JSON.stringify({ error: 'foundry_workfile_create requires no WORK.md; current: exists' });
        }
        const fm = { flow: args.flow, cycle: args.cycle };
        if (args.stages) {
          fm.stages = enrichStages(args.stages, args.cycle);
        }
        if (args.maxIterations !== undefined) {
          fm['max-iterations'] = args.maxIterations;
        }
        if (args.models) {
          fm.models = parseModelsValue(args.models);
        }
        const content = createWorkfile(fm, args.goal);
        writeFileSync(workPath, content, 'utf-8');
        return JSON.stringify({ ok: true });
      },
    }),

    foundry_workfile_get: tool({
      description: 'Read WORK.md and return frontmatter + goal',
      args: {},
      async execute(_args, context) {
        const workPath = path.join(context.worktree, 'WORK.md');
        if (!existsSync(workPath)) {
          return JSON.stringify({ error: 'WORK.md not found' });
        }
        const text = readFileSync(workPath, 'utf-8');
        const fm = parseFrontmatter(text);
        const goalMatch = text.match(/# Goal\n\n([\s\S]*?)(?=\n\||\n##|$)/);
        const goal = goalMatch ? goalMatch[1].trim() : '';
        return JSON.stringify({ ...fm, goal });
      },
    }),

    foundry_workfile_delete: tool({
      description: 'Delete WORK.md and WORK.history.yaml (requires confirm:true)',
      args: {
        confirm: tool.schema.boolean().describe('Must be true to confirm deletion'),
      },
      async execute(args, context) {
        const io = makeIO(context.worktree);
        const guard = requireNoActiveStage(io);
        if (!guard.ok) return JSON.stringify({ error: `foundry_workfile_delete ${guard.error}` });
        if (args.confirm !== true) {
          return JSON.stringify({ error: 'foundry_workfile_delete requires {confirm: true}' });
        }
        const workPath = path.join(context.worktree, 'WORK.md');
        const historyPath = path.join(context.worktree, 'WORK.history.yaml');
        if (existsSync(workPath)) {
          unlinkSync(workPath);
        }
        if (existsSync(historyPath)) {
          unlinkSync(historyPath);
        }
        return JSON.stringify({ ok: true });
      },
    }),
  };
}
