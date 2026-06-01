// src/plugin/tools/run-tool.js
// Stub for foundry_run — validated but returns a violation envelope in Phase 1.

function validateInputs(args) {
  if (typeof args.flow !== 'string') return 'foundry_run: flow and goal are required';
  if (args.flow.trim() === '') return 'foundry_run: flow and goal are required';
  if (typeof args.goal !== 'string') return 'foundry_run: flow and goal are required';
  if (args.goal.trim() === '') return 'foundry_run: flow and goal are required';
  return null;
}

export function createRunTool({ tool, client, childSessions }) {
  return {
    foundry_run: tool({
      description: 'Start a Foundry run. Requires a flow ID and a goal. Phase 1 stub — returns a violation envelope.',
      args: {
        flow: tool.schema.string().describe('The flow ID to run'),
        goal: tool.schema.string().describe('The goal for this run'),
        inputs: tool.schema.object().optional().describe('Optional input artefacts for the start cycle'),
      },
      async execute(args, _context) {
        const error = validateInputs(args);
        if (error) {
          return JSON.stringify({ action: 'violation', details: error, recoverable: false });
        }
        // Phase 1 stub — real implementation in Phase 2
        return JSON.stringify({
          action: 'violation',
          details: 'foundry_run: not yet implemented in Phase 1',
          recoverable: false,
        });
      },
    }),
  };
}
