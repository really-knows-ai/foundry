// Tools for scoped config command execution.
//
// Registers foundry_config_run_command — the no-shell command runner for
// config-tier validator and test commands.
//
// Phase 02: registration stub. Full integration (guards, detailed error
// handling) is deferred to Phase 03.

import { runCommand, createExec } from '../../scripts/lib/config-command-runner.js';
import { makeIO } from './helpers.js';
import { requireOnConfigBranch } from '../../scripts/lib/branch-guard.js';

export function createConfigCommandTools({ tool }) {
  return {
    foundry_config_run_command: tool({
      description:
        'Run an allowed command with no shell, policy enforcement, ' +
        'timeout, output capture, dirty-tree tracking, and an audit log. ' +
        'Requires a config/* branch. The command must be a node script ' +
        'under foundry/** or a pnpm run script.',
      args: {
        command: tool.schema.string()
          .describe('Command string (e.g. "node foundry/artefacts/haiku/validate-syllables.test.mjs")'),
        reason: tool.schema.string()
          .describe('Non-empty reason for the audit log'),
        timeout: tool.schema.number().optional()
          .describe('Timeout in milliseconds (default 30000, max 120000)'),
      },
      execute(args, context) {
        // Branch guard
        const guard = requireOnConfigBranch({ exec: createExec(context.worktree) });
        if (!guard.ok) {
          return JSON.stringify({ ok: false, error: `foundry_config_run_command: ${guard.error}` });
        }

        try {
          const io = makeIO(context.worktree);
          const exec = createExec(context.worktree, 30000);
          const result = runCommand({ io, exec, command: args.command, reason: args.reason, timeout: args.timeout });
          return JSON.stringify(result);
        } catch (err) {
          return JSON.stringify({ ok: false, error: err.message ?? String(err) });
        }
      },
    }),
  };
}
