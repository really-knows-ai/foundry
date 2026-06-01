// src/plugin/tools/run-tool.js
// foundry_run — starts a run, bootstraps WORK.md, and executes the state machine.

import { createWorkfile, parseFrontmatter } from '../../scripts/lib/workfile.js';
import { setupWorkfile } from '../../scripts/orchestrate-phases.js';
import { requireOnFlowBranch } from '../../scripts/lib/branch-guard.js';
import { readFailedStatus } from '../../scripts/lib/failed-flow.js';
import { runRun } from '../../scripts/run.js';
import { makeIO, makeExec } from './helpers.js';

function validateInputs(args) {
  if (typeof args.flow !== 'string') return 'foundry_run: flow and goal are required';
  if (args.flow.trim() === '') return 'foundry_run: flow and goal are required';
  if (typeof args.goal !== 'string') return 'foundry_run: flow and goal are required';
  if (args.goal.trim() === '') return 'foundry_run: flow and goal are required';
  return null;
}

function readFlowDefinition(foundryDir, flowId, io) {
  const flowPath = foundryDir + '/flows/' + flowId + '.md';
  if (!io.exists(flowPath)) return null;
  return parseFrontmatter(io.readFile(flowPath));
}

function resolveStartCycles(fm) {
  const raw = fm.start || fm['starting-cycles'] || null;
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [raw];
}

function resolveSingleCycle(startCycles, args) {
  if (startCycles.length === 0) return { error: 'flow has no start cycle' };
  if (startCycles.length === 1) return { cycle: startCycles[0] };
  if (!args.cycle) {
    return { error: 'flow has multiple start cycles (' + startCycles.join(', ') + '); specify cycle' };
  }
  if (!startCycles.includes(args.cycle)) {
    return { error: 'flow does not have a start cycle named ' + args.cycle + '. Available: ' + startCycles.join(', ') };
  }
  return { cycle: args.cycle };
}

function buildGuardedResponse(branchIo, io) {
  const branchGuard = requireOnFlowBranch(branchIo);
  if (!branchGuard.ok) return { error: 'foundry_run: ' + branchGuard.error };

  const failed = readFailedStatus(io);
  if (failed) return { error: 'foundry_run: flow is in failed state' };

  if (io.exists('WORK.md')) {
    return { error: 'foundry_run: WORK.md already exists. Use foundry_continue() to advance an existing run.' };
  }

  return null;
}

function bootstrapWorkfile(io, args, startCycle) {
  const frontmatter = { flow: args.flow, cycle: startCycle, goal: args.goal, stages: [], 'max-iterations': 3 };
  if (args.inputs) frontmatter.inputs = args.inputs;
  io.writeFile('WORK.md', createWorkfile(frontmatter, args.goal));
}

function isSetupViolation(result) {
  return result && result.action === 'violation';
}

function resolveFlowStartCycle(args, io) {
  const flowFm = readFlowDefinition('foundry', args.flow, io);
  if (!flowFm) return { error: 'foundry_run: flow ' + args.flow + ' not found' };
  const startCycles = resolveStartCycles(flowFm);
  const resolved = resolveSingleCycle(startCycles, args);
  if (resolved.error) return { error: 'foundry_run: ' + resolved.error };
  return { startCycle: resolved.cycle };
}

export function createRunTool(pluginOpts) {
  const { tool, client, childSessions } = pluginOpts;
  return {
    foundry_run: tool({
      description: 'Start a Foundry run on the current work branch.',
      args: {
        flow: tool.schema.string().describe('Flow name (id of a flow file in foundry/flows/)'),
        goal: tool.schema.string().describe('Goal text for this run'),
        cycle: tool.schema.string().optional().describe('Explicit cycle name (required when the flow has multiple start cycles)'),
        inputs: tool.schema.object({}).optional().describe('Upstream artefacts when the start cycle declares an input contract'),
      },
      async execute(args, context) {
        const error = validateInputs(args);
        if (error) return JSON.stringify({ action: 'violation', details: error, recoverable: false });

        const io = makeIO(context.worktree);
        const exec = makeExec(context.worktree);
        const branchIo = { exec };

        const guard = buildGuardedResponse(branchIo, io);
        if (guard) return JSON.stringify({ action: 'violation', details: guard.error, recoverable: false });

        const resolved = resolveFlowStartCycle(args, io);
        if (resolved.error) return JSON.stringify({ error: resolved.error });

        bootstrapWorkfile(io, args, resolved.startCycle);

        const setupResult = await setupWorkfile({
          cycleId: resolved.startCycle,
          workContent: io.readFile('WORK.md'),
          io,
          git: null,
          foundryDir: context.worktree + '/foundry',
        });

        if (isSetupViolation(setupResult)) return JSON.stringify(setupResult);

        const result = await runRun({
          cwd: context.worktree, client, childSessions, context, io, worktree: context.worktree,
        });
        return JSON.stringify(result);
      },
    }),
  };
}
