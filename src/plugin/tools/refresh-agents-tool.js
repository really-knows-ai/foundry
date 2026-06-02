import { refreshAgents } from './agent-refresh.js';

export function createRefreshAgentsTool({ tool }) {
  return {
    foundry_refresh_agents: tool({
      description: 'Delete stale .opencode/agents/foundry-*.md stage files. Generates no new agent files.',
      args: {},
      async execute(_args, context) {
        try {
          const result = refreshAgents(context.worktree);
          if (!result.ok) {
            return JSON.stringify({
              ok: false,
              error: `foundry_refresh_agents: ${result.error}`,
            });
          }
          return JSON.stringify(result);
        } catch (err) {
          return JSON.stringify({
            ok: false,
            error: `foundry_refresh_agents: ${err.message ?? String(err)}`,
          });
        }
      },
    }),
  };
}
