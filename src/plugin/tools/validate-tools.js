import { execSync } from 'child_process';
import { getValidation } from '../../scripts/lib/config.js';
import { makeIO, branchIoFactory, asyncIoFactory, flowBranchGuard } from './helpers.js';
import { guarded, notFailedGuard } from '../../scripts/lib/guards.js';

const gateNotFailed = notFailedGuard(makeIO);

/**
 * Shell-quote a string for POSIX `/bin/sh` so it is treated as a single literal
 * argument. Wraps the value in single quotes and escapes any embedded single
 * quotes via the `'\''` idiom. Safe for arbitrary file paths including ones
 * containing spaces, semicolons, `$()`, backticks, quotes, and newlines.
 */
function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

export function createValidateTools({ tool }) {
  return {
    foundry_validate_run: tool({
      description: 'Run validation commands for an artefact type against a file',
      args: {
        typeId: tool.schema.string().describe('Artefact type ID'),
        file: tool.schema.string().describe('File path to validate'),
      },
      execute: guarded('foundry_validate_run', [flowBranchGuard, gateNotFailed], async (args, context) => {
        const io = makeIO(context.worktree);
        // Validation commands are project-defined subprocesses with arbitrary
        // side effects (linters with --fix, formatters, codegen). Treat the
        // tool as state-changing: gate it on failed flow.
        const commands = await getValidation('foundry', args.typeId, io);
        if (!commands || commands.length === 0) return JSON.stringify({ error: 'No validation defined for type: ' + args.typeId });
        const results = [];
        // Substitute {file} with a shell-quoted path so file names containing
        // shell metacharacters (spaces, ;, $(), `, quotes) are passed as a
        // single literal shell argument. Supports both unquoted {file} and
        // quoted "{file}" or '{file}' patterns - quotes are stripped before
        // substitution to avoid nested quotes like "'path'".
        const quotedFile = shellQuote(args.file);
        for (const entry of commands) {
          // Replace "{file}" or '{file}' with unquoted {file}, then substitute
          const expanded = entry.command
            .replace(/"\{file\}"/g, '{file}')
            .replace(/'\{file\}'/g, '{file}')
            .replace(/\{file\}/g, quotedFile);
          try {
            const output = execSync(expanded, { cwd: context.worktree, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
            results.push({ id: entry.id, command: expanded, passed: true, output: output.trim() });
          } catch (err) {
            results.push({ id: entry.id, command: expanded, passed: false, output: (err.stderr || err.stdout || err.message || '').trim(), failureMeans: entry.failureMeans });
          }
        }
        return JSON.stringify(results);
      }, { branchIo: branchIoFactory, io: asyncIoFactory }),
    }),
  };
}
