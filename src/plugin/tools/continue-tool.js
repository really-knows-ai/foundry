// src/plugin/tools/continue-tool.js
// Stub for foundry_continue — returns a violation envelope in Phase 1.

export function createContinueTool({ tool, client, childSessions }) {
  return {
    foundry_continue: tool({
      description: 'Advance an existing Foundry run. Reads state from disk. Phase 1 stub — returns a violation envelope.',
      args: {},
      async execute(_args, _context) {
        // Phase 1 stub — real implementation in Phase 2
        return JSON.stringify({
          action: 'violation',
          details: 'foundry_continue: not yet implemented in Phase 1',
          recoverable: false,
        });
      },
    }),
  };
}
