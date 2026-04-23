import { execSync } from 'child_process';
import { getValidation } from '../../../scripts/lib/config.js';
import { makeIO } from './helpers.js';

export function createValidateTools({ tool }) {
  return {
    foundry_validate_run: tool({
      description: 'Run validation commands for an artefact type against a file',
      args: {
        typeId: tool.schema.string().describe('Artefact type ID'),
        file: tool.schema.string().describe('File path to validate'),
      },
      async execute(args, context) {
        const io = makeIO(context.worktree);
        const commands = await getValidation('foundry', args.typeId, io);
        if (!commands || commands.length === 0) return JSON.stringify({ error: 'No validation defined for type: ' + args.typeId });
        const results = [];
        for (const entry of commands) {
          const expanded = entry.command.replace(/\{file\}/g, args.file);
          try {
            const output = execSync(expanded, { cwd: context.worktree, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
            results.push({ id: entry.id, command: expanded, passed: true, output: output.trim() });
          } catch (err) {
            results.push({ id: entry.id, command: expanded, passed: false, output: (err.stderr || err.stdout || err.message || '').trim(), failureMeans: entry.failureMeans });
          }
        }
        return JSON.stringify(results);
      },
    }),
  };
}
